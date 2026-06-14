import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { evaluateGoogleCheckRetrospectiveHeuristic } from "../../shared/google-check-heuristics";
import {
  TOPIC_HIERARCHY_LEAVES,
  formatTopicLeafWithGroup,
} from "../../shared/topic-hierarchy";
import {
  evaluateSummaryQuality,
  isValidPipelineTopArticleId,
  normalizeEditorialSummaryText,
} from "../services/editorial-pipeline/editorial-quality";
import {
  editorialTagKey,
  filterEditorialTagAdds,
  isEditorialEntityTagCandidate,
} from "../services/editorial-pipeline/editorial-tag-rules";
import type { ArticleCandidate } from "../services/editorial-pipeline/review-package";
import { buildStoredArticleCandidates, resolveStoredWinningArticle } from "../services/editorial-pipeline/run";
import { fetchCandidatesForDate } from "../services/editorial-pipeline/source-finder-v2";
import {
  evaluateSummaryWithAgent,
  expandShortSummaryWithAgent,
  regenerateSummaryWithAgent,
} from "../services/editorial-pipeline/summary-agent";
import {
  ensureTopicCategoryAndStorylineLinks,
  rankTopicCandidatesFromSummary,
  syncStorylineAssignmentsForDate,
} from "../services/editorial-pipeline/storyline-taxonomy";
import { topicLabelsFromRow } from "../services/editorial-pipeline/tools";
import { suggestTagsWithAgent } from "../services/editorial-pipeline/tag-agent";
import {
  findGroundedTaxonomyTagsMissingFromRow,
  groundAndCanonicaliseTags,
  isTagGroundedInTexts,
  loadCanonicalTagIndex,
} from "../services/editorial-pipeline/tag-grounding";
import { suggestTopicsWithAgent } from "../services/editorial-pipeline/topic-agent";
import type { ArticleData } from "@shared/schema";
import { runGoogleCheckSingleWithRetry } from "../services/homepage-checks/google-check";
import { storage } from "../storage";

export const PERPLEXITY_BATCH_DIR = process.env.PERPLEXITY_BATCH_DIR?.trim()
  ? path.resolve(process.env.PERPLEXITY_BATCH_DIR.trim())
  : path.resolve("tmp/perplexity-batch");
export const COORDINATOR_LOG_FILE = path.join(PERPLEXITY_BATCH_DIR, "coordinator.log");
export const COORDINATOR_STATE_FILE = path.join(PERPLEXITY_BATCH_DIR, "cleanup-coordinator-state.json");
export const ORCHESTRATOR_LOG_FILE = path.join(PERPLEXITY_BATCH_DIR, "post-bulk-orchestrator.log");
export const ORCHESTRATOR_STATE_FILE = path.join(PERPLEXITY_BATCH_DIR, "post-bulk-orchestrator-state.json");
export const ORCHESTRATOR_PID_FILE = path.join(PERPLEXITY_BATCH_DIR, "post-bulk-orchestrator.pid");
export const TRIPLE_PASS_REPORT_JSON = path.join(PERPLEXITY_BATCH_DIR, "triple-pass-report.json");
export const TRIPLE_PASS_REPORT_MD = path.join(PERPLEXITY_BATCH_DIR, "triple-pass-report.md");
/** Full cleanup passes over no/uncertain rows (override: CLEANUP_PASS_TOTAL=1..3). Default 1 to limit Perplexity spend. */
export const TRIPLE_PASS_TOTAL = (() => {
  const raw = process.env.CLEANUP_PASS_TOTAL?.trim();
  if (raw) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 3) return Math.floor(parsed);
  }
  return 1;
})();
export const CLEANUP_BATCH_SIZE = 10;
export const MAX_CONCURRENT_BATCH_WORKERS = 15;
/** One cleanup worker per leaf — keeps Perplexity headroom for bulk check. */
export const WORKERS_PER_LEAF = 1;
/** Cap live leaf workers so bulk + cleanup share one Perplexity API key without 429 storms. */
export const MAX_CONCURRENT_LEAF_WORKERS = (() => {
  const raw = process.env.MAX_CONCURRENT_LEAF_WORKERS?.trim();
  if (raw) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed >= 1) return Math.floor(parsed);
  }
  return 8;
})();

export type CleanupStats = {
  attempted: number;
  upgradedToYes: number;
  stillNo: number;
  stillUncertain: number;
  summaryFixed: number;
  topicFixed: number;
  tagsFixed: number;
  articlesEnsured: number;
  retaggedOff: number;
  errors: number;
  verifySkipped: number;
};

export type CleanupLeafState = {
  leaf: string;
  status: "idle" | "running" | "completed" | "failed";
  pid?: number;
  startedAt?: string;
  finishedAt?: string;
  backlogAtStart?: { uncertain: number; no: number; total: number };
  workerIndex?: number;
  workerTotal?: number;
  assignedDates?: string[];
  resolvedDates: string[];
  /** Last processed summary/article/topic/tag fingerprint per date — skips repeat Perplexity when unchanged. */
  lastVerifyFingerprints?: Record<string, string>;
  stats: CleanupStats;
  lastError?: string;
};

export type CoordinatorSpawnRecord = {
  leaf: string;
  slug: string;
  pid: number;
  spawnedAt: string;
  completedAt?: string;
  backlogAtSpawn: { uncertain: number; no: number; total: number };
  status: "running" | "completed" | "failed";
  exitCode?: number;
  workerIndex?: number;
  workerTotal?: number;
};

export type CleanupBatchState = {
  leaf: string;
  batchIndex: number;
  batchTotal: number;
  dates: string[];
  status: "idle" | "running" | "completed" | "failed";
  pid?: number;
  startedAt?: string;
  finishedAt?: string;
  stats: CleanupStats;
  lastError?: string;
};

export type BatchSpawnRecord = {
  leaf: string;
  slug: string;
  batchIndex: number;
  batchTotal: number;
  batchKey: string;
  dates: string[];
  pid: number;
  spawnedAt: string;
  completedAt?: string;
  status: "running" | "completed" | "failed";
};

export type CoordinatorState = {
  mode: "per-leaf" | "batch";
  spawnedLeaves: Record<string, CoordinatorSpawnRecord>;
  /** @deprecated batch mode only — ignored in per-leaf mode */
  spawnedBatches?: Record<string, BatchSpawnRecord>;
  lastPollAt?: string;
};

export type OrchestratorPhase =
  | "waiting_for_bulk"
  | "pass_1"
  | "pass_2"
  | "pass_3"
  | "no_topic_fix"
  | "complete"
  | "failed";

export type NoTopicFixRecord = {
  startedAt: string;
  finishedAt?: string;
  backlogBefore: number;
  backlogAfter: number;
  stats: CleanupStats;
};

export type PassStats = CleanupStats & {
  leavesProcessed: number;
  backlogBefore: { uncertain: number; no: number; total: number };
  backlogAfter: { uncertain: number; no: number; total: number };
};

export type OrchestratorPassRecord = {
  pass: number;
  startedAt: string;
  finishedAt?: string;
  leavesWithBacklog: number;
  stats: PassStats;
};

export type OrchestratorState = {
  phase: OrchestratorPhase;
  currentPass: number;
  totalPasses: number;
  pid?: number;
  startedAt?: string;
  bulkFinishedAt?: string;
  passes: OrchestratorPassRecord[];
  noTopicFix?: NoTopicFixRecord;
  lastError?: string;
};

export type LeafBatchPlan = {
  batchIndex: number;
  batchTotal: number;
  dates: string[];
};

export type LeafBacklog = {
  leaf: string;
  uncertain: number;
  no: number;
  total: number;
};

export type PendingLeafWorker = LeafBacklog & {
  workerIndex: number;
  workerTotal: number;
};

export type CleanupLogger = {
  log: (message: string) => void;
};

export function leafSlug(leaf: string): string {
  return leaf
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function batchKey(leaf: string, batchIndex: number): string {
  return `${leafSlug(leaf)}-batch-${batchIndex}`;
}

export function batchLogFile(leaf: string, batchIndex: number): string {
  return path.join(PERPLEXITY_BATCH_DIR, `cleanup-${leafSlug(leaf)}-batch-${batchIndex}.log`);
}

export function batchStateFile(leaf: string, batchIndex: number): string {
  return path.join(PERPLEXITY_BATCH_DIR, `cleanup-batch-${leafSlug(leaf)}-${batchIndex}.json`);
}

export function leafLogFile(leaf: string): string {
  return path.join(PERPLEXITY_BATCH_DIR, `cleanup-${leafSlug(leaf)}.log`);
}

export function leafDisplayName(leaf: string): string {
  return leaf.trim();
}

export function leafLogPrefix(leaf: string): string {
  return `[LEAF: ${leafDisplayName(leaf)}]`;
}

export function leafAgentLabel(leaf: string): string {
  return `AGENT ${leafDisplayName(leaf)}`;
}

export function leafCleanupAgentLabel(leaf: string): string {
  return `AGENT ${leafDisplayName(leaf)} · CLEANUP`;
}

export function leafWorkerKey(leaf: string, workerIndex: number): string {
  return `${leafSlug(leaf)}-w${workerIndex}`;
}

export function workerAgentLabel(leaf: string, workerIndex: number, workerTotal: number): string {
  return `AGENT ${leafDisplayName(leaf)} · worker ${workerIndex}/${workerTotal}`;
}

export function workerLogPrefix(leaf: string, workerIndex: number, workerTotal: number): string {
  return `[LEAF: ${leafDisplayName(leaf)} · worker ${workerIndex}/${workerTotal}]`;
}

export function workerLogFile(leaf: string, workerIndex: number): string {
  return path.join(PERPLEXITY_BATCH_DIR, `cleanup-${leafSlug(leaf)}-w${workerIndex}.log`);
}

export function workerStateFile(leaf: string, workerIndex: number): string {
  return path.join(PERPLEXITY_BATCH_DIR, `cleanup-leaf-${leafSlug(leaf)}-w${workerIndex}.json`);
}

export function batchDisplayIndex(batchIndex: number): number {
  return batchIndex + 1;
}

export function batchAgentLabel(leaf: string, batchIndex: number, batchTotal: number): string {
  return `AGENT ${leafDisplayName(leaf)} · batch ${batchDisplayIndex(batchIndex)}/${batchTotal}`;
}

export function batchLogPrefix(leaf: string, batchIndex: number, batchTotal: number): string {
  return `[LEAF: ${leafDisplayName(leaf)} · batch ${batchDisplayIndex(batchIndex)}/${batchTotal}]`;
}

export function setLeafProcessIdentity(leaf: string): void {
  const name = leafDisplayName(leaf);
  process.env.CLEANUP_LEAF = name;
  delete process.env.CLEANUP_BATCH;
  delete process.env.CLEANUP_WORKER;
  try {
    process.title = leafCleanupAgentLabel(leaf);
  } catch {
    // process.title unsupported on some platforms
  }
}

export function setWorkerProcessIdentity(
  leaf: string,
  workerIndex: number,
  workerTotal: number,
): void {
  const name = leafDisplayName(leaf);
  process.env.CLEANUP_LEAF = name;
  process.env.CLEANUP_WORKER = `${workerIndex}/${workerTotal}`;
  delete process.env.CLEANUP_BATCH;
  try {
    process.title = workerAgentLabel(leaf, workerIndex, workerTotal);
  } catch {
    // process.title unsupported on some platforms
  }
}

export function setBatchProcessIdentity(leaf: string, batchIndex: number, batchTotal: number): void {
  const name = `${leafDisplayName(leaf)} batch ${batchDisplayIndex(batchIndex)}`;
  process.env.CLEANUP_LEAF = leafDisplayName(leaf);
  process.env.CLEANUP_BATCH = `${batchDisplayIndex(batchIndex)}/${batchTotal}`;
  try {
    process.title = `cleanup: ${name}`;
  } catch {
    // process.title unsupported on some platforms
  }
}

export function leafStateFile(leaf: string): string {
  return path.join(PERPLEXITY_BATCH_DIR, `cleanup-leaf-${leafSlug(leaf)}.json`);
}

export function ensureBatchDir(): void {
  fs.mkdirSync(PERPLEXITY_BATCH_DIR, { recursive: true });
}

export function createFileLogger(logFile: string): CleanupLogger {
  ensureBatchDir();
  return {
    log(message: string) {
      const line = `[${new Date().toISOString()}] ${message}`;
      fs.appendFileSync(logFile, `${line}\n`);
    },
  };
}

export function createLeafLogger(leaf: string, logFile?: string): CleanupLogger {
  const file = logFile ?? leafLogFile(leaf);
  const prefix = leafLogPrefix(leaf);
  ensureBatchDir();
  return {
    log(message: string) {
      const line = `[${new Date().toISOString()}] ${prefix} ${message}`;
      fs.appendFileSync(file, `${line}\n`);
    },
  };
}

export function createWorkerLogger(
  leaf: string,
  workerIndex: number,
  workerTotal: number,
  logFile?: string,
): CleanupLogger {
  const file = logFile ?? workerLogFile(leaf, workerIndex);
  const prefix = workerLogPrefix(leaf, workerIndex, workerTotal);
  ensureBatchDir();
  return {
    log(message: string) {
      const line = `[${new Date().toISOString()}] ${prefix} ${message}`;
      fs.appendFileSync(file, `${line}\n`);
    },
  };
}

export function createBatchLogger(
  leaf: string,
  batchIndex: number,
  batchTotal: number,
  logFile?: string,
): CleanupLogger {
  const file = logFile ?? batchLogFile(leaf, batchDisplayIndex(batchIndex));
  const prefix = batchLogPrefix(leaf, batchIndex, batchTotal);
  ensureBatchDir();
  return {
    log(message: string) {
      const line = `[${new Date().toISOString()}] ${prefix} ${message}`;
      fs.appendFileSync(file, `${line}\n`);
    },
  };
}

export const emptyCleanupStats = (): CleanupStats => ({
  attempted: 0,
  upgradedToYes: 0,
  stillNo: 0,
  stillUncertain: 0,
  summaryFixed: 0,
  topicFixed: 0,
  tagsFixed: 0,
  articlesEnsured: 0,
  retaggedOff: 0,
  errors: 0,
  verifySkipped: 0,
});

export function loadLeafState(leaf: string): CleanupLeafState {
  const file = leafStateFile(leaf);
  try {
    if (!fs.existsSync(file)) {
      return { leaf, status: "idle", resolvedDates: [], stats: emptyCleanupStats() };
    }
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as CleanupLeafState;
    return {
      leaf,
      status: raw.status ?? "idle",
      pid: raw.pid,
      startedAt: raw.startedAt,
      finishedAt: raw.finishedAt,
      backlogAtStart: raw.backlogAtStart,
      workerIndex: raw.workerIndex,
      workerTotal: raw.workerTotal,
      assignedDates: Array.isArray(raw.assignedDates) ? raw.assignedDates : undefined,
      resolvedDates: Array.isArray(raw.resolvedDates) ? raw.resolvedDates : [],
      lastVerifyFingerprints:
        raw.lastVerifyFingerprints && typeof raw.lastVerifyFingerprints === "object"
          ? raw.lastVerifyFingerprints
          : undefined,
      stats: { ...emptyCleanupStats(), ...raw.stats },
      lastError: raw.lastError,
    };
  } catch {
    return { leaf, status: "idle", resolvedDates: [], stats: emptyCleanupStats() };
  }
}

export function loadWorkerState(leaf: string, workerIndex: number): CleanupLeafState {
  const file = workerStateFile(leaf, workerIndex);
  try {
    if (!fs.existsSync(file)) {
      return { leaf, status: "idle", resolvedDates: [], stats: emptyCleanupStats() };
    }
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as CleanupLeafState;
    return {
      leaf,
      status: raw.status ?? "idle",
      pid: raw.pid,
      startedAt: raw.startedAt,
      finishedAt: raw.finishedAt,
      backlogAtStart: raw.backlogAtStart,
      workerIndex: raw.workerIndex ?? workerIndex,
      workerTotal: raw.workerTotal,
      assignedDates: Array.isArray(raw.assignedDates) ? raw.assignedDates : undefined,
      resolvedDates: Array.isArray(raw.resolvedDates) ? raw.resolvedDates : [],
      lastVerifyFingerprints:
        raw.lastVerifyFingerprints && typeof raw.lastVerifyFingerprints === "object"
          ? raw.lastVerifyFingerprints
          : undefined,
      stats: { ...emptyCleanupStats(), ...raw.stats },
      lastError: raw.lastError,
    };
  } catch {
    return { leaf, status: "idle", resolvedDates: [], stats: emptyCleanupStats() };
  }
}

export function saveLeafState(state: CleanupLeafState): void {
  ensureBatchDir();
  fs.writeFileSync(leafStateFile(state.leaf), JSON.stringify(state, null, 2));
}

export function saveWorkerState(state: CleanupLeafState): void {
  if (!state.workerIndex) {
    saveLeafState(state);
    return;
  }
  ensureBatchDir();
  fs.writeFileSync(workerStateFile(state.leaf, state.workerIndex), JSON.stringify(state, null, 2));
}

export function loadBatchState(leaf: string, batchIndex: number): CleanupBatchState {
  const file = batchStateFile(leaf, batchIndex);
  try {
    if (!fs.existsSync(file)) {
      return {
        leaf,
        batchIndex,
        batchTotal: 0,
        dates: [],
        status: "idle",
        stats: emptyCleanupStats(),
      };
    }
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as CleanupBatchState;
    return {
      leaf,
      batchIndex: raw.batchIndex ?? batchIndex,
      batchTotal: raw.batchTotal ?? 0,
      dates: Array.isArray(raw.dates) ? raw.dates : [],
      status: raw.status ?? "idle",
      pid: raw.pid,
      startedAt: raw.startedAt,
      finishedAt: raw.finishedAt,
      stats: { ...emptyCleanupStats(), ...raw.stats },
      lastError: raw.lastError,
    };
  } catch {
    return {
      leaf,
      batchIndex,
      batchTotal: 0,
      dates: [],
      status: "idle",
      stats: emptyCleanupStats(),
    };
  }
}

export function saveBatchState(state: CleanupBatchState): void {
  ensureBatchDir();
  fs.writeFileSync(batchStateFile(state.leaf, state.batchIndex), JSON.stringify(state, null, 2));
}

export function loadCoordinatorState(): CoordinatorState {
  try {
    if (!fs.existsSync(COORDINATOR_STATE_FILE)) {
      return { mode: "per-leaf", spawnedLeaves: {} };
    }
    const raw = JSON.parse(fs.readFileSync(COORDINATOR_STATE_FILE, "utf8")) as Partial<CoordinatorState>;
    const mode = raw.mode === "batch" ? "batch" : "per-leaf";
    return {
      mode,
      spawnedLeaves:
        raw.spawnedLeaves && typeof raw.spawnedLeaves === "object"
          ? raw.spawnedLeaves
          : {},
      spawnedBatches:
        raw.spawnedBatches && typeof raw.spawnedBatches === "object"
          ? raw.spawnedBatches
          : undefined,
      lastPollAt: raw.lastPollAt,
    };
  } catch {
    return { mode: "per-leaf", spawnedLeaves: {} };
  }
}

export function saveCoordinatorState(state: CoordinatorState): void {
  ensureBatchDir();
  fs.writeFileSync(COORDINATOR_STATE_FILE, JSON.stringify(state, null, 2));
}

export function loadOrchestratorState(): OrchestratorState {
  try {
    if (!fs.existsSync(ORCHESTRATOR_STATE_FILE)) {
      return {
        phase: "waiting_for_bulk",
        currentPass: 0,
        totalPasses: TRIPLE_PASS_TOTAL,
        passes: [],
      };
    }
    const raw = JSON.parse(fs.readFileSync(ORCHESTRATOR_STATE_FILE, "utf8")) as Partial<OrchestratorState>;
    return {
      phase: (raw.phase as OrchestratorPhase) ?? "waiting_for_bulk",
      currentPass: raw.currentPass ?? 0,
      totalPasses: raw.totalPasses ?? TRIPLE_PASS_TOTAL,
      pid: raw.pid,
      startedAt: raw.startedAt,
      bulkFinishedAt: raw.bulkFinishedAt,
      passes: Array.isArray(raw.passes) ? raw.passes : [],
      noTopicFix: raw.noTopicFix,
      lastError: raw.lastError,
    };
  } catch {
    return {
      phase: "waiting_for_bulk",
      currentPass: 0,
      totalPasses: TRIPLE_PASS_TOTAL,
      passes: [],
    };
  }
}

export function saveOrchestratorState(state: OrchestratorState): void {
  ensureBatchDir();
  fs.writeFileSync(ORCHESTRATOR_STATE_FILE, JSON.stringify(state, null, 2));
}

/** True when orchestrator is running triple-pass cleanup (coordinator should pause). */
export function isOrchestratorRunningPasses(state?: OrchestratorState): boolean {
  const phase = state?.phase ?? loadOrchestratorState().phase;
  return phase === "pass_1" || phase === "pass_2" || phase === "pass_3";
}

export function shouldPauseCoordinatorCleanup(): boolean {
  if (process.env.PAUSE_CLEANUP === "1") return true;
  if (process.env.TRIPLE_PASS_MODE === "1") return true;
  const phase = loadOrchestratorState().phase;
  return (
    phase === "pass_1" ||
    phase === "pass_2" ||
    phase === "pass_3" ||
    phase === "no_topic_fix"
  );
}

/** PIDs of live bulk-check processes (tsx wrapper command line). */
export function findBulkCheckProcessPids(): number[] {
  const pids: number[] = [];
  try {
    const out = execSync("ps -eo pid=,command=", {
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
    });
    for (const line of out.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed.includes("run-perplexity-check-all-leaves.ts")) continue;
      const pid = Number(trimmed.split(/\s+/)[0]);
      if (pid > 0) pids.push(pid);
    }
  } catch {
    // ps unavailable or failed
  }
  return pids;
}

export function isBulkCheckRunning(): boolean {
  return findBulkCheckProcessPids().some((pid) => isProcessRunning(pid));
}

export type CorpusBacklogCounts = {
  unchecked: number;
  uncertain: number;
  no: number;
  total: number;
  leavesWithBacklog: number;
  leavesWithUnchecked: number;
};

export async function countCorpusBacklog(): Promise<CorpusBacklogCounts> {
  let unchecked = 0;
  let uncertain = 0;
  let no = 0;
  let leavesWithBacklog = 0;
  let leavesWithUnchecked = 0;

  for (const leaf of TOPIC_HIERARCHY_LEAVES) {
    const rows = await storage.getAnalysesForStorylineLeaf(leaf);
    if (rows.length === 0) continue;

    const leafUnchecked = rows.filter((row) => row.googleCheckHappened == null).length;
    const leafUncertain = rows.filter((row) => row.googleCheckHappened === "uncertain").length;
    const leafNo = rows.filter((row) => row.googleCheckHappened === "no").length;

    unchecked += leafUnchecked;
    uncertain += leafUncertain;
    no += leafNo;
    if (leafUnchecked > 0) leavesWithUnchecked += 1;
    if (leafUncertain + leafNo > 0) leavesWithBacklog += 1;
  }

  return {
    unchecked,
    uncertain,
    no,
    total: uncertain + no,
    leavesWithBacklog,
    leavesWithUnchecked,
  };
}

/** Bulk finished when process exited OR every row with a leaf assignment is checked. */
export function isBulkFinished(
  bulkRunning: boolean,
  unchecked: number,
): boolean {
  return !bulkRunning || unchecked === 0;
}

export function passPhaseForNumber(pass: number): OrchestratorPhase {
  if (pass === 1) return "pass_1";
  if (pass === 2) return "pass_2";
  if (pass === 3) return "pass_3";
  throw new Error(`Invalid pass number: ${pass}`);
}

/** Matches Events Manager "No topic" quality check: non-empty summary, zero topic labels. */
export function analysisHasNoTopic(row: {
  summary?: string | null;
  topicCategories: unknown;
}): boolean {
  const summary = normalizeEditorialSummaryText(String(row.summary ?? "").trim());
  if (!summary) return false;
  return topicLabelsFromRow(row.topicCategories).length === 0;
}

export async function queryNoTopicRows(): Promise<
  Array<{ date: string; summary: string; tags: string[] }>
> {
  const analyses = await storage.getAllAnalyses();
  return analyses
    .filter(analysisHasNoTopic)
    .map((row) => ({
      date: row.date,
      summary: normalizeEditorialSummaryText(String(row.summary ?? "").trim()),
      tags: currentTags(row),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

async function resolveTopicForNoTopicRow(
  date: string,
  summary: string,
  tags: string[],
): Promise<string | null> {
  const topicResult = await suggestTopicsWithAgent({
    date,
    summary,
    tags,
    currentTopics: [],
  });
  const fromAgent = topicResult.proposed[0] ?? topicResult.recommended ?? null;
  if (fromAgent) return fromAgent;

  const ranking = rankTopicCandidatesFromSummary({ summary, tags });
  if (ranking.primary) return ranking.primary;
  if (ranking.candidates[0]?.leaf) return ranking.candidates[0].leaf;
  return null;
}

export async function runNoTopicFixPhase(opts: {
  apply: boolean;
  logger: CleanupLogger;
}): Promise<NoTopicFixRecord> {
  const rows = await queryNoTopicRows();
  const record: NoTopicFixRecord = {
    startedAt: new Date().toISOString(),
    backlogBefore: rows.length,
    backlogAfter: rows.length,
    stats: emptyCleanupStats(),
  };

  opts.logger.log(`Phase 4: no-topic fix · backlog=${record.backlogBefore}`);

  if (rows.length === 0) {
    record.finishedAt = new Date().toISOString();
    opts.logger.log("Phase 4: no-topic fix · nothing to do");
    return record;
  }

  const leafState: CleanupLeafState = {
    leaf: "no-topic-fix",
    status: "running",
    resolvedDates: [],
    stats: record.stats,
  };

  for (const row of rows) {
    leafState.stats.attempted += 1;
    opts.logger.log(`Phase 4: no-topic fix · ${row.date}`);

    try {
      if (!opts.apply) {
        opts.logger.log(`  [dry-run] would run topic agent + tag grounding`);
        continue;
      }

      const analysis = await storage.getAnalysisByDate(row.date);
      if (!analysis) {
        leafState.stats.errors += 1;
        opts.logger.log(`  skip — no analysis row`);
        continue;
      }

      let summary = normalizeEditorialSummaryText(String(analysis.summary ?? "").trim());
      let tags = currentTags(analysis);

      if (tags.length === 0) {
        tags = await applyTagsWithAgent(row.date, summary, tags, leafState, opts.logger, true);
      } else {
        const index = await loadCanonicalTagIndex();
        const grounded = groundAndCanonicaliseTags({
          proposed: tags,
          texts: [summary],
          index,
        }).kept.slice(0, 2);
        if (grounded.length > 0 && grounded.join("|") !== tags.slice(0, 2).join("|")) {
          tags = await applyTagsWithAgent(row.date, summary, tags, leafState, opts.logger, true);
        }
      }

      const topic = await resolveTopicForNoTopicRow(row.date, summary, tags);
      if (!topic) {
        leafState.stats.errors += 1;
        opts.logger.log(`  no topic inferred`);
        continue;
      }

      const applied = await applyTopicFix(row.date, topic, leafState, true);
      opts.logger.log(`  topic → ${applied ?? topic}`);
    } catch (error) {
      leafState.stats.errors += 1;
      const message = error instanceof Error ? error.message : String(error);
      opts.logger.log(`  ✗ error: ${message}`);
    }
  }

  record.backlogAfter = (await queryNoTopicRows()).length;
  record.finishedAt = new Date().toISOString();
  opts.logger.log(
    `Phase 4: no-topic fix finished · backlog_before=${record.backlogBefore} backlog_after=${record.backlogAfter} topic_fixed=${record.stats.topicFixed} tags_fixed=${record.stats.tagsFixed} errors=${record.stats.errors}`,
  );

  return record;
}

export function mergeCleanupStats(target: CleanupStats, source: CleanupStats): void {
  target.attempted += source.attempted;
  target.upgradedToYes += source.upgradedToYes;
  target.stillNo += source.stillNo;
  target.stillUncertain += source.stillUncertain;
  target.summaryFixed += source.summaryFixed;
  target.topicFixed += source.topicFixed;
  target.tagsFixed += source.tagsFixed;
  target.articlesEnsured += source.articlesEnsured;
  target.retaggedOff += source.retaggedOff;
  target.errors += source.errors;
  target.verifySkipped += source.verifySkipped;
}

/** Fingerprint of fields that affect Perplexity verify — skip repeat calls when unchanged. */
export function buildRowVerifyFingerprint(row: {
  summary?: string | null;
  topArticleId?: string | null;
  topicCategories?: unknown;
  tagsVersion2?: unknown;
}): string {
  const tags = Array.isArray(row.tagsVersion2)
    ? row.tagsVersion2.filter((t): t is string => typeof t === "string" && t.trim().length > 0).sort()
    : [];
  return JSON.stringify({
    summary: normalizeEditorialSummaryText(String(row.summary ?? "").trim()),
    topArticleId: row.topArticleId ?? null,
    topics: topicLabelsFromRow(row.topicCategories).sort(),
    tags,
  });
}

function recordRowVerifyFingerprint(state: CleanupLeafState, date: string, fingerprint: string): void {
  if (!state.lastVerifyFingerprints) state.lastVerifyFingerprints = {};
  state.lastVerifyFingerprints[date] = fingerprint;
}

export async function queryAllLeavesWithBacklog(): Promise<LeafBacklog[]> {
  const results: LeafBacklog[] = [];

  for (const leaf of TOPIC_HIERARCHY_LEAVES) {
    const rows = await storage.getAnalysesForStorylineLeaf(leaf);
    if (rows.length === 0) continue;

    const uncertain = rows.filter((row) => row.googleCheckHappened === "uncertain").length;
    const no = rows.filter((row) => row.googleCheckHappened === "no").length;
    const total = uncertain + no;
    if (total === 0) continue;

    results.push({ leaf, uncertain, no, total });
  }

  return results.sort(
    (a, b) => TOPIC_HIERARCHY_LEAVES.indexOf(a.leaf) - TOPIC_HIERARCHY_LEAVES.indexOf(b.leaf),
  );
}

export function isValidLeafName(leaf: string): boolean {
  return TOPIC_HIERARCHY_LEAVES.includes(leaf);
}

export function randomDelayMs(): number {
  const raw = process.env.CLEANUP_RANDOM_DELAY_MAX?.trim();
  if (raw) {
    const max = Number(raw);
    if (Number.isFinite(max) && max >= 0) return Math.floor(Math.random() * (max + 1));
  }
  return Math.floor(Math.random() * 501);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isProcessRunning(pid: number | undefined): boolean {
  if (!pid || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** PIDs of live cleanup-leaf processes for a leaf (tsx wrapper command line). */
export function findLeafWorkerProcessPids(leaf: string, workerIndex?: number): number[] {
  const target = leafDisplayName(leaf);
  const pids: number[] = [];

  try {
    const out = execSync("ps -eo pid=,command=", {
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
    });
    for (const line of out.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed.includes("run-perplexity-cleanup-leaf.ts")) continue;

      const marker = "--leaf ";
      const markerIdx = trimmed.indexOf(marker);
      if (markerIdx < 0) continue;

      const rest = trimmed.slice(markerIdx + marker.length);
      if (rest.includes(" --batch-index ")) continue;

      const parsedLeaf = parseCleanupLeafFromArgv(rest);
      if (parsedLeaf !== target) continue;

      const workerMarker = " --worker-index ";
      const workerIdxPos = rest.indexOf(workerMarker);
      let parsedWorkerIndex: number | null = null;
      if (workerIdxPos >= 0) {
        parsedWorkerIndex = Number(
          rest.slice(workerIdxPos + workerMarker.length).split(/\s+/)[0]?.trim(),
        );
        if (!Number.isFinite(parsedWorkerIndex) || parsedWorkerIndex <= 0) {
          parsedWorkerIndex = null;
        }
      }

      if (workerIndex != null) {
        if (parsedWorkerIndex !== workerIndex) continue;
      } else if (workerIdxPos >= 0) {
        continue;
      }

      const pid = Number(trimmed.split(/\s+/)[0]);
      if (pid > 0) pids.push(pid);
    }
  } catch {
    // ps unavailable or failed
  }

  return pids;
}

/** True when a leaf worker process is alive (process scan, then state-file PID). */
export function isLeafWorkerRunning(leaf: string, workerIndex?: number): boolean {
  if (findLeafWorkerProcessPids(leaf, workerIndex).some((pid) => isProcessRunning(pid))) {
    return true;
  }

  const state =
    workerIndex != null ? loadWorkerState(leaf, workerIndex) : loadLeafState(leaf);
  if (state.status !== "running") return false;
  return isProcessRunning(state.pid);
}

/** Leaf name from cleanup-leaf argv segment after `--leaf`. */
export function parseCleanupLeafFromArgv(afterLeaf: string): string | null {
  let end = afterLeaf.length;
  for (const marker of [" --dates ", " --batch-index ", " --worker-index ", " --apply"]) {
    const idx = afterLeaf.indexOf(marker);
    if (idx >= 0) end = Math.min(end, idx);
  }
  const leaf = afterLeaf.slice(0, end).trim();
  return leaf || null;
}

/** PIDs of live cleanup-leaf batch processes for a leaf + batch index. */
export function findBatchWorkerProcessPids(leaf: string, batchIndex: number): number[] {
  const target = leafDisplayName(leaf);
  const displayBatch = String(batchDisplayIndex(batchIndex));
  const pids: number[] = [];

  try {
    const out = execSync("ps -eo pid=,command=", {
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
    });
    for (const line of out.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed.includes("run-perplexity-cleanup-leaf.ts")) continue;

      const leafMarker = "--leaf ";
      const leafIdx = trimmed.indexOf(leafMarker);
      if (leafIdx < 0) continue;

      const afterLeaf = trimmed.slice(leafIdx + leafMarker.length);
      const parsedLeaf = parseCleanupLeafFromArgv(afterLeaf);
      if (parsedLeaf !== target) continue;

      const batchMarker = " --batch-index ";
      const batchIdx = afterLeaf.indexOf(batchMarker);
      if (batchIdx < 0) continue;

      const afterBatch = afterLeaf.slice(batchIdx + batchMarker.length);
      const batchNum = afterBatch.split(/\s+/)[0]?.trim();
      if (batchNum !== displayBatch) continue;

      const pid = Number(trimmed.split(/\s+/)[0]);
      if (pid > 0) pids.push(pid);
    }
  } catch {
    // ps unavailable or failed
  }

  return pids;
}

/** True when a batch worker process is alive (process scan, then state-file PID). */
export function isBatchWorkerRunning(leaf: string, batchIndex: number): boolean {
  if (findBatchWorkerProcessPids(leaf, batchIndex).some((pid) => isProcessRunning(pid))) {
    return true;
  }

  const state = loadBatchState(leaf, batchIndex);
  if (state.status !== "running") return false;
  return isProcessRunning(state.pid);
}

export function splitIntoBatches<T>(items: T[], batchSize: number): T[][] {
  if (batchSize <= 0) return items.length > 0 ? [items] : [];
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    batches.push(items.slice(i, i + batchSize));
  }
  return batches;
}

export function computeLeafBatches(dates: string[], batchSize = CLEANUP_BATCH_SIZE): LeafBatchPlan[] {
  const chunks = splitIntoBatches(dates, batchSize);
  const batchTotal = chunks.length;
  return chunks.map((chunkDates, batchIndex) => ({
    batchIndex,
    batchTotal,
    dates: chunkDates,
  }));
}

/** Split flagged dates across N workers (sequential halves). workerIndex is 1-based. */
export function computeLeafWorkerSlice(
  dates: string[],
  workerIndex: number,
  workerTotal: number,
): string[] {
  if (workerTotal <= 1 || dates.length === 0) return dates;
  const idx = workerIndex - 1;
  if (idx < 0 || idx >= workerTotal) return [];
  const chunkSize = Math.ceil(dates.length / workerTotal);
  const start = idx * chunkSize;
  return dates.slice(start, start + chunkSize);
}

type FlaggedRow = Awaited<ReturnType<typeof storage.getAnalysesForStorylineLeaf>>[number];

export function sortFlaggedRows(
  rows: FlaggedRow[],
  resolvedDates: Set<string> = new Set(),
): FlaggedRow[] {
  const flagged = rows.filter(
    (row) =>
      (row.googleCheckHappened === "uncertain" || row.googleCheckHappened === "no") &&
      !resolvedDates.has(row.date),
  );
  flagged.sort((a, b) => {
    if (a.googleCheckHappened === b.googleCheckHappened) {
      return a.date.localeCompare(b.date);
    }
    return a.googleCheckHappened === "uncertain" ? -1 : 1;
  });
  return flagged;
}

export function flaggedDatesFromRows(rows: FlaggedRow[], resolvedDates: Set<string> = new Set()): string[] {
  return sortFlaggedRows(rows, resolvedDates).map((row) => row.date);
}

export async function getFlaggedDatesForLeaf(leaf: string): Promise<string[]> {
  const rows = await storage.getAnalysesForStorylineLeaf(leaf);
  return flaggedDatesFromRows(rows);
}

function isCoordinatorWorkerRecordLive(record: CoordinatorSpawnRecord): boolean {
  const workerIndex = record.workerIndex;
  const leafState =
    workerIndex != null
      ? loadWorkerState(record.leaf, workerIndex)
      : loadLeafState(record.leaf);
  if (leafState.status === "completed" || leafState.status === "failed") {
    return false;
  }
  return (
    isLeafWorkerRunning(record.leaf, workerIndex) || isProcessRunning(record.pid)
  );
}

function isCoordinatorLeafRecordLive(record: CoordinatorSpawnRecord): boolean {
  return isCoordinatorWorkerRecordLive(record);
}

export function countRunningLeafWorkers(state: CoordinatorState): number {
  let count = 0;
  for (const record of Object.values(state.spawnedLeaves)) {
    if (record.status !== "running") continue;
    if (isCoordinatorLeafRecordLive(record)) {
      count += 1;
    }
  }
  return count;
}

/** True when a per-leaf cleanup worker is alive (process scan, then state-file PID). */
export function isLeafSpawnedOrActive(state: CoordinatorState, leaf: string): boolean {
  for (let workerIndex = 1; workerIndex <= WORKERS_PER_LEAF; workerIndex += 1) {
    if (isLeafWorkerSpawnedOrActive(state, leaf, workerIndex)) {
      return true;
    }
  }
  return false;
}

/** True when a specific worker slot for a leaf is live or already spawned. */
export function isLeafWorkerSpawnedOrActive(
  state: CoordinatorState,
  leaf: string,
  workerIndex: number,
): boolean {
  const workerState = loadWorkerState(leaf, workerIndex);
  if (workerState.status === "completed") {
    return false;
  }
  if (workerState.status === "failed") {
    return false;
  }

  const key = leafWorkerKey(leaf, workerIndex);
  const record = state.spawnedLeaves[key];
  if (record?.status === "running") {
    return isCoordinatorWorkerRecordLive(record);
  }

  return isLeafWorkerRunning(leaf, workerIndex);
}

export async function collectPendingLeaves(state: CoordinatorState): Promise<LeafBacklog[]> {
  const backlogLeaves = await queryCompletedLeavesWithBacklog();
  return backlogLeaves.filter((item) => !isLeafSpawnedOrActive(state, item.leaf));
}

export async function collectPendingLeafWorkers(
  state: CoordinatorState,
  workerTotal = WORKERS_PER_LEAF,
): Promise<PendingLeafWorker[]> {
  const backlogLeaves = await queryCompletedLeavesWithBacklog();
  const pending: PendingLeafWorker[] = [];

  for (const item of backlogLeaves) {
    for (let workerIndex = 1; workerIndex <= workerTotal; workerIndex += 1) {
      if (isLeafWorkerSpawnedOrActive(state, item.leaf, workerIndex)) continue;
      pending.push({
        ...item,
        workerIndex,
        workerTotal,
      });
    }
  }

  return pending;
}

/**
 * Pick pending workers up to the concurrency cap. Prefers highest-backlog leaves and
 * keeps worker pairs intact (both w1/w2 for a leaf, or neither).
 */
export function prioritizePendingLeafWorkers(
  pending: PendingLeafWorker[],
  runningCount: number,
  maxWorkers: number = MAX_CONCURRENT_LEAF_WORKERS,
): PendingLeafWorker[] {
  const slots = Math.max(0, maxWorkers - runningCount);
  if (slots === 0 || pending.length === 0) return [];

  const byLeaf = new Map<string, PendingLeafWorker[]>();
  for (const item of pending) {
    const list = byLeaf.get(item.leaf) ?? [];
    list.push(item);
    byLeaf.set(item.leaf, list);
  }

  const leaves = [...byLeaf.entries()].sort((a, b) => {
    const backlogDiff = (b[1][0]?.total ?? 0) - (a[1][0]?.total ?? 0);
    if (backlogDiff !== 0) return backlogDiff;
    return TOPIC_HIERARCHY_LEAVES.indexOf(a[0]) - TOPIC_HIERARCHY_LEAVES.indexOf(b[0]);
  });

  const result: PendingLeafWorker[] = [];
  let used = 0;

  for (const [, workers] of leaves) {
    workers.sort((a, b) => a.workerIndex - b.workerIndex);
    if (used + workers.length > slots) continue;
    result.push(...workers);
    used += workers.length;
    if (used >= slots) break;
  }

  return result;
}

function isCoordinatorBatchRecordLive(record: BatchSpawnRecord): boolean {
  const batchState = loadBatchState(record.leaf, record.batchIndex);
  if (batchState.status === "completed" || batchState.status === "failed") {
    return false;
  }
  return (
    isBatchWorkerRunning(record.leaf, record.batchIndex) || isProcessRunning(record.pid)
  );
}

export function countRunningBatchWorkers(state: CoordinatorState): number {
  let count = 0;
  for (const record of Object.values(state.spawnedBatches ?? {})) {
    if (record.status !== "running") continue;
    if (isCoordinatorBatchRecordLive(record)) {
      count += 1;
    }
  }
  return count;
}

export function batchDatesEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((date, index) => date === b[index]);
}

/** True only when a batch worker is live or the same batch plan is already done without errors. */
export function isBatchSpawnedOrActive(
  state: CoordinatorState,
  leaf: string,
  batchIndex: number,
  planDates?: string[],
): boolean {
  const batchState = loadBatchState(leaf, batchIndex);

  if (batchState.status === "completed") {
    if (planDates && batchState.dates.length > 0 && !batchDatesEqual(planDates, batchState.dates)) {
      return false;
    }
    if (batchState.stats.errors > 0) {
      return false;
    }
    return false;
  }

  if (batchState.status === "failed") {
    return false;
  }

  const key = batchKey(leaf, batchIndex);
  const record = state.spawnedBatches?.[key];
  if (record?.status === "running") {
    return isCoordinatorBatchRecordLive(record);
  }

  return isBatchWorkerRunning(leaf, batchIndex);
}

export async function isLeafReadyForCleanup(leaf: string): Promise<boolean> {
  const rows = await storage.getAnalysesForStorylineLeaf(leaf);
  if (rows.length === 0) return false;
  return rows.every((row) => row.googleCheckHappened != null);
}

export async function countLeafBacklog(leaf: string): Promise<{ uncertain: number; no: number; total: number }> {
  const rows = await storage.getAnalysesForStorylineLeaf(leaf);
  const uncertain = rows.filter((row) => row.googleCheckHappened === "uncertain").length;
  const no = rows.filter((row) => row.googleCheckHappened === "no").length;
  return { uncertain, no, total: uncertain + no };
}

export async function queryCompletedLeavesWithBacklog(): Promise<LeafBacklog[]> {
  const results: LeafBacklog[] = [];

  for (const leaf of TOPIC_HIERARCHY_LEAVES) {
    const rows = await storage.getAnalysesForStorylineLeaf(leaf);
    if (rows.length === 0) continue;
    const unchecked = rows.filter((row) => row.googleCheckHappened == null).length;
    if (unchecked > 0) continue;

    const uncertain = rows.filter((row) => row.googleCheckHappened === "uncertain").length;
    const no = rows.filter((row) => row.googleCheckHappened === "no").length;
    const total = uncertain + no;
    if (total === 0) continue;

    results.push({ leaf, uncertain, no, total });
  }

  return results.sort(
    (a, b) => TOPIC_HIERARCHY_LEAVES.indexOf(a.leaf) - TOPIC_HIERARCHY_LEAVES.indexOf(b.leaf),
  );
}

export type PendingBatchItem = {
  leaf: string;
  plan: LeafBatchPlan;
  backlogTotal: number;
};

export type LeafBatchQueue = {
  leaf: string;
  plans: LeafBatchPlan[];
  backlogTotal: number;
};

/** One batch per leaf per round before any leaf gets a second batch. */
export function buildRoundRobinPendingBatches(queues: LeafBatchQueue[]): PendingBatchItem[] {
  const pending: PendingBatchItem[] = [];
  let round = 0;
  while (true) {
    let added = false;
    for (const queue of queues) {
      const plan = queue.plans[round];
      if (!plan) continue;
      pending.push({ leaf: queue.leaf, plan, backlogTotal: queue.backlogTotal });
      added = true;
    }
    if (!added) break;
    round += 1;
  }
  return pending;
}

export async function collectLeafBatchQueues(state: CoordinatorState): Promise<LeafBatchQueue[]> {
  const backlogLeaves = await queryCompletedLeavesWithBacklog();
  const queues: LeafBatchQueue[] = [];

  for (const item of backlogLeaves) {
    const dates = await getFlaggedDatesForLeaf(item.leaf);
    const plans = computeLeafBatches(dates, CLEANUP_BATCH_SIZE).filter(
      (plan) => !isBatchSpawnedOrActive(state, item.leaf, plan.batchIndex, plan.dates),
    );
    if (plans.length === 0) continue;
    queues.push({ leaf: item.leaf, plans, backlogTotal: item.total });
  }

  return queues;
}

export async function collectPendingBatches(state: CoordinatorState): Promise<PendingBatchItem[]> {
  const queues = await collectLeafBatchQueues(state);
  return buildRoundRobinPendingBatches(queues);
}

export function pickFlaggedRowsForLeaf(
  rows: Awaited<ReturnType<typeof storage.getAnalysesForStorylineLeaf>>,
  resolvedDates: Set<string>,
  maxRows: number | null,
) {
  const flagged = sortFlaggedRows(rows, resolvedDates);
  return maxRows != null && maxRows > 0 ? flagged.slice(0, maxRows) : flagged;
}

function currentTopics(row: Awaited<ReturnType<typeof storage.getAnalysesForStorylineLeaf>>[number]): string[] {
  const cats = row.topicCategories;
  if (Array.isArray(cats)) {
    return cats.filter((t): t is string => typeof t === "string" && t.trim().length > 0);
  }
  return [];
}

function currentTags(row: Awaited<ReturnType<typeof storage.getAnalysesForStorylineLeaf>>[number]): string[] {
  const tags = row.tagsVersion2;
  if (!Array.isArray(tags)) return [];
  return tags.filter((t): t is string => typeof t === "string" && t.trim().length > 0);
}

type ArticleContext = {
  articleTitle: string | null;
  articleSnippet: string | null;
  topArticleId: string | null;
};

function candidateToArticleData(candidate: ArticleCandidate): ArticleData {
  let host: string | undefined;
  try {
    host = new URL(candidate.url).hostname;
  } catch {
    host = undefined;
  }
  return {
    id: candidate.id,
    title: candidate.title,
    url: candidate.url,
    publishedDate: candidate.publishedDate ?? new Date().toISOString(),
    text: typeof candidate.summary === "string" ? candidate.summary : "",
    score: 0,
    summary: candidate.summary ?? "",
    source: candidate.source ?? host ?? "EXA",
  } as ArticleData;
}

function tieredArticlesFromCandidates(candidates: ArticleCandidate[]) {
  const out: { bitcoin: ArticleData[]; crypto: ArticleData[]; macro: ArticleData[] } = {
    bitcoin: [],
    crypto: [],
    macro: [],
  };
  for (const candidate of candidates) {
    out[candidate.tier].push(candidateToArticleData(candidate));
  }
  return out;
}

function articleContextFromResolved(
  resolved: NonNullable<ReturnType<typeof resolveStoredWinningArticle>>,
): ArticleContext {
  const snippet = `${resolved.article.title}\n${resolved.article.text || resolved.article.summary || ""}`.slice(0, 500);
  return {
    articleTitle: resolved.article.title ?? null,
    articleSnippet: snippet || null,
    topArticleId: String(resolved.article.id ?? "").trim() || null,
  };
}

function pickStoredArticleCandidate(
  row: NonNullable<Awaited<ReturnType<typeof storage.getAnalysisByDate>>>,
): ArticleCandidate | null {
  const candidates = buildStoredArticleCandidates({ ...row, targetDate: row.date });
  if (!candidates.length) return null;
  return candidates.find((c) => c.recommended) ?? candidates[0] ?? null;
}

async function ensureWinningArticle(
  date: string,
  state: CleanupLeafState,
  logger: CleanupLogger,
  apply: boolean,
): Promise<ArticleContext> {
  const analysis = await storage.getAnalysisByDate(date);
  if (!analysis) {
    return { articleTitle: null, articleSnippet: null, topArticleId: null };
  }

  let resolved = isValidPipelineTopArticleId(analysis.topArticleId)
    ? resolveStoredWinningArticle({
        topArticleId: analysis.topArticleId,
        tieredArticles: analysis.tieredArticles,
        analyzedArticles: analysis.analyzedArticles,
        winningTier: analysis.winningTier,
      })
    : null;

  if (!resolved) {
    const picked = pickStoredArticleCandidate(analysis);
    if (picked) {
      if (apply) {
        const tiered = tieredArticlesFromCandidates([picked]);
        await storage.updateAnalysis(date, {
          topArticleId: picked.id,
          winningTier: picked.tier,
          tieredArticles: tiered,
          analyzedArticles: [candidateToArticleData(picked)],
        });
        state.stats.articlesEnsured += 1;
        logger.log(`  picked stored article "${picked.title.slice(0, 60)}"`);
        resolved = resolveStoredWinningArticle({
          topArticleId: picked.id,
          tieredArticles: tiered,
          analyzedArticles: [candidateToArticleData(picked)],
          winningTier: picked.tier,
        });
      } else {
        logger.log(`  [dry-run] would pick stored article "${picked.title.slice(0, 60)}"`);
      }
    }
  }

  if (!resolved && apply) {
    const pool = await fetchCandidatesForDate(date, {
      requestId: `cleanup-refetch-${date}-${Date.now()}`,
      source: "perplexity-cleanup-refetch",
    });
    if (pool.hasCandidates) {
      const picked = pool.candidates.find((c) => c.recommended) ?? pool.candidates[0] ?? null;
      if (picked) {
        const tiered = tieredArticlesFromCandidates(pool.candidates);
        await storage.updateAnalysis(date, {
          topArticleId: picked.id,
          winningTier: picked.tier,
          tieredArticles: tiered,
          analyzedArticles: pool.candidates.map(candidateToArticleData),
          totalArticlesFetched: pool.candidates.length,
          uniqueArticlesAnalyzed: pool.candidates.length,
        });
        state.stats.articlesEnsured += 1;
        logger.log(`  refetched ${pool.candidates.length} article(s); picked "${picked.title.slice(0, 60)}"`);
        resolved = resolveStoredWinningArticle({
          topArticleId: picked.id,
          tieredArticles: tiered,
          analyzedArticles: pool.candidates.map(candidateToArticleData),
          winningTier: picked.tier,
        });
      }
    } else {
      logger.log(`  no articles found for ${date} — proceeding with summary only`);
    }
  } else if (!resolved && !apply) {
    logger.log(`  [dry-run] would refetch articles for ${date}`);
  }

  return resolved
    ? articleContextFromResolved(resolved)
    : {
        articleTitle: null,
        articleSnippet: null,
        topArticleId: analysis.topArticleId,
      };
}

async function applyTopicFix(
  date: string,
  topic: string | null,
  state: CleanupLeafState,
  apply: boolean,
): Promise<string | null> {
  if (!apply) return topic;

  if (!topic) {
    await syncStorylineAssignmentsForDate(date, []);
    await storage.updateAnalysis(date, { topicCategories: [] });
    state.stats.retaggedOff += 1;
    return null;
  }

  const linked = await ensureTopicCategoryAndStorylineLinks(date, [topic]);
  await storage.updateAnalysis(date, { topicCategories: linked });
  state.stats.topicFixed += 1;
  return linked[0] ?? topic;
}

async function applyTagsWithAgent(
  date: string,
  summary: string,
  existingTags: string[],
  state: CleanupLeafState,
  logger: CleanupLogger,
  apply: boolean,
): Promise<string[]> {
  if (!apply) {
    logger.log(`  [dry-run] would run tag agent`);
    return existingTags.slice(0, 2);
  }

  const index = await loadCanonicalTagIndex();
  const tagAgent = await suggestTagsWithAgent({
    date,
    summary,
    tags: existingTags,
    allowedAddCandidates: findGroundedTaxonomyTagsMissingFromRow({
      texts: [summary],
      currentTags: existingTags,
      index,
      limit: 12,
    }).filter(isEditorialEntityTagCandidate),
  });

  let tags = [...existingTags];
  if (tagAgent.dropTags.length > 0) {
    const dropKeys = new Set(tagAgent.dropTags.map((tag) => editorialTagKey(tag)).filter(Boolean));
    const filtered = tags.filter((tag) => !dropKeys.has(editorialTagKey(tag) ?? ""));
    if (filtered.length !== tags.length) {
      tags = filtered;
    }
  }

  if (tagAgent.confidence === "high" && tagAgent.addTags.length > 0) {
    const adds = tagAgent.addTags.filter((tag) => isTagGroundedInTexts(tag, [summary]));
    tags = filterEditorialTagAdds([...tags, ...adds], tags);
  }

  const grounded = groundAndCanonicaliseTags({
    proposed: tags,
    texts: [summary],
    index,
  }).kept.slice(0, 2);

  const normalizedExisting = existingTags.slice(0, 2);
  const finalTags = grounded.length > 0 ? grounded : normalizedExisting;
  const changed =
    finalTags.length !== normalizedExisting.length ||
    finalTags.some((tag, idx) => tag !== normalizedExisting[idx]);

  if (changed) {
    await storage.updateAnalysis(date, { tagsVersion2: finalTags });
    state.stats.tagsFixed += 1;
    if (tagAgent.source === "llm") {
      logger.log(`  tags agent → ${finalTags.join(", ") || "(none)"}`);
    }
  }
  return finalTags;
}

async function fixSummary(
  date: string,
  state: CleanupLeafState,
  articleCtx: ArticleContext,
  logger: CleanupLogger,
  apply: boolean,
): Promise<string> {
  const analysis = await storage.getAnalysisByDate(date);
  if (!analysis) return "";

  let summary = normalizeEditorialSummaryText(String(analysis.summary ?? "").trim());
  const quality = evaluateSummaryQuality(summary);

  if (!apply) {
    logger.log(`  [dry-run] would evaluate/fix summary (${summary.length} chars)`);
    return summary;
  }

  if (quality?.code === "too_short") {
    const expanded = await expandShortSummaryWithAgent(date);
    if (expanded.ok) {
      const refreshed = await storage.getAnalysisByDate(date);
      summary = normalizeEditorialSummaryText(String(refreshed?.summary ?? summary).trim());
      state.stats.summaryFixed += 1;
      logger.log(`  summary expanded → ${summary.length} chars`);
      return summary;
    }
  }

  const agent = await evaluateSummaryWithAgent({
    date,
    summary,
    articleTitle: articleCtx.articleTitle,
    articleSnippet: articleCtx.articleSnippet,
    topArticleId: articleCtx.topArticleId ?? analysis.topArticleId,
  });

  if (agent.suggestedSummary) {
    await storage.updateAnalysis(date, { summary: agent.suggestedSummary });
    summary = agent.suggestedSummary;
    state.stats.summaryFixed += 1;
    logger.log(`  summary agent rewrite → ${summary.length} chars`);
    return summary;
  }

  if (agent.needsRegeneration) {
    const regen = await regenerateSummaryWithAgent(date);
    if (regen.ok) {
      const refreshed = await storage.getAnalysisByDate(date);
      summary = normalizeEditorialSummaryText(String(refreshed?.summary ?? summary).trim());
      state.stats.summaryFixed += 1;
      logger.log(`  summary regenerated → ${summary.length} chars`);
      return summary;
    }
    if (regen.message?.includes("Top article id missing") || regen.message?.includes("Winning article missing")) {
      logger.log(`  summary regen skipped — ${regen.message}`);
    }
  }

  if (quality) {
    logger.log(`  summary still weak (${quality.message}) — proceeding with verify`);
  }

  return summary;
}

export async function processFlaggedRow(
  leaf: string,
  date: string,
  priorVerdict: "no" | "uncertain",
  state: CleanupLeafState,
  logger: CleanupLogger,
  opts: { apply: boolean; delayMs: number; persistState?: () => void },
): Promise<void> {
  state.stats.attempted += 1;
  const rowLabel =
    state.workerIndex && state.workerTotal
      ? workerAgentLabel(leaf, state.workerIndex, state.workerTotal)
      : leafCleanupAgentLabel(leaf);
  logger.log(`${rowLabel} ${date} · was ${priorVerdict}`);

  try {
    const analysis = await storage.getAnalysisByDate(date);
    if (!analysis) {
      logger.log(`  skip — no analysis row`);
      return;
    }

    const baselineFingerprint = buildRowVerifyFingerprint(analysis);

    const articleCtx = await ensureWinningArticle(date, state, logger, opts.apply);

    let summary = normalizeEditorialSummaryText(String(analysis.summary ?? "").trim());
    const retrospective = evaluateGoogleCheckRetrospectiveHeuristic(summary);
    if (retrospective.isRetrospective) {
      logger.log(`  retrospective heuristic (${retrospective.reason ?? "retrospective"}) — clearing topic`);
      await applyTopicFix(date, null, state, opts.apply);
    }

    summary = await fixSummary(date, state, articleCtx, logger, opts.apply);

    const tags = currentTags(analysis);
    const topics = currentTopics(analysis);

    if (opts.apply) {
      const topicResult = await suggestTopicsWithAgent({
        date,
        summary,
        tags,
        currentTopics: topics,
        expectedLeaf: leaf,
      });

      let topicForVerify = leaf;
      if (topicResult.recommended && topicResult.recommended !== leaf) {
        logger.log(`  topic ${leaf} → ${topicResult.recommended} (${topicResult.reason || "agent"})`);
        const applied = await applyTopicFix(date, topicResult.recommended, state, opts.apply);
        topicForVerify = applied ?? topicResult.recommended;
      } else if (
        (!topicResult.recommended && topicResult.confidence === "low") ||
        (!topicResult.recommended && priorVerdict === "no")
      ) {
        logger.log(`  no good topic fit — clearing assignment`);
        await applyTopicFix(date, null, state, opts.apply);
        topicForVerify = leaf;
      } else if (topics.length === 0 && topicResult.recommended) {
        await applyTopicFix(date, topicResult.recommended, state, opts.apply);
        topicForVerify = topicResult.recommended;
      }

      await applyTagsWithAgent(date, summary, tags, state, logger, opts.apply);

      const refreshed = await storage.getAnalysisByDate(date);
      summary = normalizeEditorialSummaryText(String(refreshed?.summary ?? summary).trim());
      const afterFingerprint = buildRowVerifyFingerprint(refreshed ?? analysis);

      if (afterFingerprint === baselineFingerprint) {
        state.stats.verifySkipped += 1;
        const existing = refreshed?.googleCheckHappened ?? priorVerdict;
        if (existing === "no") state.stats.stillNo += 1;
        else state.stats.stillUncertain += 1;
        recordRowVerifyFingerprint(state, date, afterFingerprint);
        logger.log(`  skip re-verify — no summary/topic/article/tag changes · still ${existing}`);
      } else {
        const verify = await runGoogleCheckSingleWithRetry(
          { date, summary, topicLeaf: topicForVerify },
          { delayAfterMs: opts.delayMs },
        );

        await storage.updateAnalysisGoogleCheck(date, {
          googleCheckHappened: verify.happened,
          googleCheckCheckedAt: new Date(),
        });

        if (verify.happened === "yes") {
          state.stats.upgradedToYes += 1;
          if (!state.resolvedDates.includes(date)) {
            state.resolvedDates.push(date);
          }
        } else if (verify.happened === "no") {
          state.stats.stillNo += 1;
        } else {
          state.stats.stillUncertain += 1;
        }

        recordRowVerifyFingerprint(state, date, afterFingerprint);
        logger.log(`  ✓ re-verify → ${verify.happened} · ${summary.length} chars`);
      }
    } else {
      logger.log(`  [dry-run] would run topic agent, tag agent, and Perplexity re-verify`);
    }
  } catch (error) {
    state.stats.errors += 1;
    const message = error instanceof Error ? error.message : String(error);
    state.lastError = message;
    logger.log(`  ✗ error: ${message}`);
  } finally {
    (opts.persistState ?? (() => saveLeafState(state)))();
  }
}

export function formatCleanupStats(stats: CleanupStats): string {
  return `attempted=${stats.attempted} upgraded_yes=${stats.upgradedToYes} still_no=${stats.stillNo} still_uncertain=${stats.stillUncertain} verify_skipped=${stats.verifySkipped} summary_fixed=${stats.summaryFixed} topic_fixed=${stats.topicFixed} tags_fixed=${stats.tagsFixed} articles_ensured=${stats.articlesEnsured} retagged_off=${stats.retaggedOff} errors=${stats.errors}`;
}

export async function runLeafCleanup(opts: {
  leaf: string;
  apply: boolean;
  maxRows: number | null;
  delayMs: number;
  logger?: CleanupLogger;
}): Promise<CleanupLeafState> {
  const { leaf, apply, maxRows, delayMs } = opts;
  setLeafProcessIdentity(leaf);
  const logger = opts.logger ?? createLeafLogger(leaf);
  const state = loadLeafState(leaf);

  if (!isValidLeafName(leaf)) {
    throw new Error(`Unknown leaf: ${leaf}`);
  }

  const ready = await isLeafReadyForCleanup(leaf);
  if (!ready) {
    throw new Error(`Leaf not ready — bulk still has unchecked rows on ${formatTopicLeafWithGroup(leaf)}`);
  }

  const backlog = await countLeafBacklog(leaf);
  state.leaf = leaf;
  state.status = "running";
  state.pid = process.pid;
  state.startedAt = new Date().toISOString();
  state.finishedAt = undefined;
  state.backlogAtStart = backlog;
  saveLeafState(state);

  logger.log(`=== ${leafCleanupAgentLabel(leaf)} started ===`);
  logger.log(`Mode: ${apply ? "apply" : "dry-run"} · maxRows=${maxRows ?? "all"} · delayMs=${delayMs}`);
  logger.log(`Backlog: ${backlog.uncertain} uncertain · ${backlog.no} no · ${backlog.total} total`);
  logger.log(`STATS ${formatCleanupStats(state.stats)}`);

  const rows = await storage.getAnalysesForStorylineLeaf(leaf);
  const resolvedDates = new Set(state.resolvedDates);
  const flagged = pickFlaggedRowsForLeaf(rows, resolvedDates, maxRows);

  if (flagged.length === 0) {
    logger.log("No flagged rows remaining — nothing to do");
    state.status = "completed";
    state.finishedAt = new Date().toISOString();
    saveLeafState(state);
    return state;
  }

  logger.log(`Processing ${flagged.length} row(s)`);

  for (const row of flagged) {
    const verdict = row.googleCheckHappened === "no" ? "no" : "uncertain";
    await processFlaggedRow(leaf, row.date, verdict, state, logger, { apply, delayMs });
    await sleep(randomDelayMs());
  }

  const remaining = pickFlaggedRowsForLeaf(
    await storage.getAnalysesForStorylineLeaf(leaf),
    new Set(state.resolvedDates),
    null,
  ).length;

  state.status = remaining === 0 ? "completed" : "idle";
  state.finishedAt = new Date().toISOString();
  saveLeafState(state);

  logger.log(`=== ${leafCleanupAgentLabel(leaf)} finished · remaining=${remaining} ===`);
  logger.log(`STATS ${formatCleanupStats(state.stats)}`);

  return state;
}

export async function runWorkerCleanup(opts: {
  leaf: string;
  workerIndex: number;
  workerTotal: number;
  apply: boolean;
  maxRows: number | null;
  delayMs: number;
  logger?: CleanupLogger;
}): Promise<CleanupLeafState> {
  const { leaf, workerIndex, workerTotal, apply, maxRows, delayMs } = opts;
  setWorkerProcessIdentity(leaf, workerIndex, workerTotal);
  const label = workerAgentLabel(leaf, workerIndex, workerTotal);
  const logger = opts.logger ?? createWorkerLogger(leaf, workerIndex, workerTotal);
  const state = loadWorkerState(leaf, workerIndex);

  if (!isValidLeafName(leaf)) {
    throw new Error(`Unknown leaf: ${leaf}`);
  }

  const ready = await isLeafReadyForCleanup(leaf);
  if (!ready) {
    throw new Error(`Leaf not ready — bulk still has unchecked rows on ${formatTopicLeafWithGroup(leaf)}`);
  }

  const backlog = await countLeafBacklog(leaf);
  state.leaf = leaf;
  state.workerIndex = workerIndex;
  state.workerTotal = workerTotal;
  state.status = "running";
  state.pid = process.pid;
  state.startedAt = new Date().toISOString();
  state.finishedAt = undefined;
  state.backlogAtStart = backlog;
  saveWorkerState(state);

  logger.log(`=== ${label} started ===`);
  logger.log(`Mode: ${apply ? "apply" : "dry-run"} · maxRows=${maxRows ?? "all"} · delayMs=${delayMs}`);
  logger.log(`Leaf backlog: ${backlog.uncertain} uncertain · ${backlog.no} no · ${backlog.total} total`);
  logger.log(`STATS ${formatCleanupStats(state.stats)}`);

  const rows = await storage.getAnalysesForStorylineLeaf(leaf);
  const allFlaggedDates = flaggedDatesFromRows(rows);
  const assignedDates = computeLeafWorkerSlice(allFlaggedDates, workerIndex, workerTotal);
  state.assignedDates = assignedDates;
  saveWorkerState(state);

  const resolvedDates = new Set(state.resolvedDates);
  const assignedSet = new Set(assignedDates);
  const flagged = sortFlaggedRows(rows, resolvedDates).filter((row) => assignedSet.has(row.date));
  const limited =
    maxRows != null && maxRows > 0 ? flagged.slice(0, maxRows) : flagged;

  if (limited.length === 0) {
    logger.log("No flagged rows remaining in this worker slice — nothing to do");
    state.status = "completed";
    state.finishedAt = new Date().toISOString();
    saveWorkerState(state);
    return state;
  }

  logger.log(
    `Processing ${limited.length} row(s) · worker slice ${assignedDates.length}/${allFlaggedDates.length} flagged dates`,
  );

  for (const row of limited) {
    const verdict = row.googleCheckHappened === "no" ? "no" : "uncertain";
    await processFlaggedRow(leaf, row.date, verdict, state, logger, {
      apply,
      delayMs,
      persistState: () => saveWorkerState(state),
    });
    await sleep(randomDelayMs());
  }

  const refreshedRows = await storage.getAnalysesForStorylineLeaf(leaf);
  const remainingInSlice = sortFlaggedRows(refreshedRows, new Set(state.resolvedDates)).filter((row) =>
    assignedSet.has(row.date),
  ).length;

  state.status = remainingInSlice === 0 ? "completed" : "idle";
  state.finishedAt = new Date().toISOString();
  saveWorkerState(state);

  logger.log(`=== ${label} finished · remaining_in_slice=${remainingInSlice} ===`);
  logger.log(`STATS ${formatCleanupStats(state.stats)}`);

  return state;
}

export async function runBatchCleanup(opts: {
  leaf: string;
  dates: string[];
  batchIndex: number;
  batchTotal: number;
  apply: boolean;
  delayMs: number;
  logger?: CleanupLogger;
}): Promise<CleanupBatchState> {
  const { leaf, dates, batchIndex, batchTotal, apply, delayMs } = opts;
  setBatchProcessIdentity(leaf, batchIndex, batchTotal);
  const logger = opts.logger ?? createBatchLogger(leaf, batchIndex, batchTotal);
  const state = loadBatchState(leaf, batchIndex);

  if (!isValidLeafName(leaf)) {
    throw new Error(`Unknown leaf: ${leaf}`);
  }

  const ready = await isLeafReadyForCleanup(leaf);
  if (!ready) {
    throw new Error(`Leaf not ready — bulk still has unchecked rows on ${formatTopicLeafWithGroup(leaf)}`);
  }

  const priorStatus = state.status;
  const datesChanged =
    state.dates.length > 0 && (state.dates.length !== dates.length || !batchDatesEqual(state.dates, dates));

  state.leaf = leaf;
  state.batchIndex = batchIndex;
  state.batchTotal = batchTotal;
  state.dates = dates;
  state.status = "running";
  state.pid = process.pid;
  state.startedAt = new Date().toISOString();
  state.finishedAt = undefined;
  state.lastError = undefined;
  if (datesChanged || priorStatus === "failed" || state.stats.errors > 0) {
    state.stats = emptyCleanupStats();
  }
  saveBatchState(state);

  const label = batchAgentLabel(leaf, batchIndex, batchTotal);
  logger.log(`=== ${label} started ===`);
  logger.log(`Mode: ${apply ? "apply" : "dry-run"} · rows=${dates.length} · delayMs=${delayMs}`);
  logger.log(`Dates: ${dates.join(", ")}`);
  logger.log(`STATS ${formatCleanupStats(state.stats)}`);

  if (dates.length === 0) {
    logger.log("No dates in batch — nothing to do");
    state.status = "completed";
    state.finishedAt = new Date().toISOString();
    saveBatchState(state);
    return state;
  }

  const rows = await storage.getAnalysesForStorylineLeaf(leaf);
  const rowByDate = new Map(rows.map((row) => [row.date, row]));
  const persist = () => saveBatchState(state);

  for (const date of dates) {
    const row = rowByDate.get(date);
    if (!row) {
      logger.log(`skip ${date} — no analysis row`);
      continue;
    }
    if (row.googleCheckHappened !== "no" && row.googleCheckHappened !== "uncertain") {
      logger.log(`skip ${date} — no longer flagged (${row.googleCheckHappened ?? "unchecked"})`);
      continue;
    }
    const verdict = row.googleCheckHappened === "no" ? "no" : "uncertain";
    const leafScratch: CleanupLeafState = {
      leaf,
      status: "running",
      resolvedDates: [],
      stats: state.stats,
      lastError: state.lastError,
    };
    await processFlaggedRow(leaf, date, verdict, leafScratch, logger, {
      apply,
      delayMs,
      persistState: () => {
        state.stats = leafScratch.stats;
        state.lastError = leafScratch.lastError;
        persist();
      },
    });
    await sleep(randomDelayMs());
  }

  state.status = "completed";
  state.finishedAt = new Date().toISOString();
  saveBatchState(state);

  logger.log(`=== ${label} finished ===`);
  logger.log(`STATS ${formatCleanupStats(state.stats)}`);

  return state;
}
