/**
 * Post-bulk triple-pass orchestrator for Perplexity cleanup.
 *
 * Phase 1: Wait until bulk check finishes (process exited or all rows checked).
 * Phase 2: Run TRIPLE_PASS_TOTAL full corpus passes over no/uncertain rows.
 * Phase 4: Assign topics to rows with summaries but no topic (quality-check backlog).
 * Phase 3: Write summary report to tmp/perplexity-batch/triple-pass-report.{json,md}
 *
 * Usage:
 *   npx tsx server/scripts/run-perplexity-post-bulk-orchestrator.ts --apply
 *   npx tsx server/scripts/run-perplexity-post-bulk-orchestrator.ts --dry-run --wait-poll-ms 5000
 */

import "dotenv/config";
import dotenv from "dotenv";
import { execSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

dotenv.config({ path: path.resolve("client/.env") });

import {
  ORCHESTRATOR_LOG_FILE,
  ORCHESTRATOR_PID_FILE,
  TRIPLE_PASS_REPORT_JSON,
  TRIPLE_PASS_REPORT_MD,
  TRIPLE_PASS_TOTAL,
  WORKERS_PER_LEAF,
  countCorpusBacklog,
  createFileLogger,
  ensureBatchDir,
  formatCleanupStats,
  isBulkCheckRunning,
  isBulkFinished,
  isLeafWorkerRunning,
  isProcessRunning,
  leafDisplayName,
  leafWorkerKey,
  loadOrchestratorState,
  loadWorkerState,
  mergeCleanupStats,
  passPhaseForNumber,
  prioritizePendingLeafWorkers,
  queryCompletedLeavesWithBacklog,
  runNoTopicFixPhase,
  saveOrchestratorState,
  sleep,
  workerAgentLabel,
  type CleanupStats,
  type LeafBacklog,
  type NoTopicFixRecord,
  type OrchestratorPassRecord,
  type OrchestratorState,
  type PassStats,
  type PendingLeafWorker,
} from "./perplexity-cleanup-shared";

const PROJECT_ROOT = path.resolve(".");
const LEAF_SCRIPT = path.join(PROJECT_ROOT, "server/scripts/run-perplexity-cleanup-leaf.ts");
const COORDINATOR_SCRIPT = "run-perplexity-cleanup-coordinator.ts";
const WAIT_POLL_MS_DEFAULT = 60_000;
const PASS_POLL_MS = 15_000;

type Args = {
  apply: boolean;
  waitPollMs: number;
  maxConcurrent: number;
};

type ActiveSpawn = {
  leaf: string;
  workerIndex: number;
  workerTotal: number;
  pid: number;
  key: string;
};

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const pollIdx = argv.indexOf("--wait-poll-ms");
  const pollRaw = pollIdx >= 0 ? argv[pollIdx + 1] : undefined;
  const pollMs = pollRaw != null ? Number(pollRaw) : WAIT_POLL_MS_DEFAULT;
  const maxRaw = process.env.MAX_CONCURRENT_LEAF_WORKERS?.trim();
  const maxConcurrent = maxRaw ? Number(maxRaw) : 8;

  return {
    apply: !argv.includes("--dry-run"),
    waitPollMs: Number.isFinite(pollMs) && pollMs > 0 ? pollMs : WAIT_POLL_MS_DEFAULT,
    maxConcurrent:
      Number.isFinite(maxConcurrent) && maxConcurrent >= 1 ? Math.floor(maxConcurrent) : 8,
  };
}

function stopCoordinatorIfRunning(logger: { log: (msg: string) => void }): void {
  try {
    const out = execSync("ps -eo pid=,command=", {
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
    });
    for (const line of out.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed.includes(COORDINATOR_SCRIPT)) continue;
      const pid = Number(trimmed.split(/\s+/)[0]);
      if (pid > 0 && isProcessRunning(pid)) {
        logger.log(`Stopping cleanup coordinator pid=${pid} before triple-pass`);
        try {
          process.kill(pid, "SIGTERM");
        } catch {
          // already exited
        }
      }
    }
  } catch {
    // ps unavailable
  }
}

function spawnLeafWorker(
  item: PendingLeafWorker,
  apply: boolean,
): { pid: number } {
  ensureBatchDir();
  const { leaf, workerIndex, workerTotal } = item;
  const label = workerAgentLabel(leaf, workerIndex, workerTotal);

  const tsxBin = path.join(PROJECT_ROOT, "node_modules/.bin/tsx");
  const runner = fs.existsSync(tsxBin) ? tsxBin : "npx";
  const sharedArgs = [
    "--leaf",
    leaf,
    "--worker-index",
    String(workerIndex),
    "--worker-total",
    String(workerTotal),
    ...(apply ? ["--apply"] : []),
  ];
  const args =
    runner === tsxBin ? [LEAF_SCRIPT, ...sharedArgs] : ["tsx", LEAF_SCRIPT, ...sharedArgs];

  const child = spawn(runner, args, {
    cwd: PROJECT_ROOT,
    detached: true,
    stdio: "ignore",
    env: {
      ...process.env,
      PERPLEXITY_SCRIPT: "1",
      PERPLEXITY_SCRIPT_POOL_SIZE: process.env.PERPLEXITY_SCRIPT_POOL_SIZE ?? "1",
      TRIPLE_PASS_MODE: "1",
      CLEANUP_LEAF: leafDisplayName(leaf),
      CLEANUP_WORKER: `${workerIndex}/${workerTotal}`,
    },
  });

  child.unref();

  if (!child.pid) {
    throw new Error(`Failed to spawn ${label}`);
  }

  return { pid: child.pid };
}

function buildPendingWorkers(backlogLeaves: LeafBacklog[]): PendingLeafWorker[] {
  const pending: PendingLeafWorker[] = [];
  for (const item of backlogLeaves) {
    for (let workerIndex = 1; workerIndex <= WORKERS_PER_LEAF; workerIndex += 1) {
      pending.push({
        ...item,
        workerIndex,
        workerTotal: WORKERS_PER_LEAF,
      });
    }
  }
  return pending;
}

function emptyPassStats(): PassStats {
  return {
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
    leavesProcessed: 0,
    backlogBefore: { uncertain: 0, no: 0, total: 0 },
    backlogAfter: { uncertain: 0, no: 0, total: 0 },
  };
}

async function waitForBulkComplete(
  args: Args,
  state: OrchestratorState,
  logger: { log: (msg: string) => void },
): Promise<void> {
  state.phase = "waiting_for_bulk";
  state.currentPass = 0;
  saveOrchestratorState(state);

  logger.log("=== Phase 1: waiting for bulk check to finish ===");

  while (true) {
    const bulkRunning = isBulkCheckRunning();
    const corpus = await countCorpusBacklog();
    const finished = isBulkFinished(bulkRunning, corpus.unchecked);

    logger.log(
      `bulk_running=${bulkRunning} unchecked=${corpus.unchecked} uncertain=${corpus.uncertain} no=${corpus.no} backlog_total=${corpus.total} leaves_with_backlog=${corpus.leavesWithBacklog}`,
    );

    if (finished) {
      state.bulkFinishedAt = new Date().toISOString();
      saveOrchestratorState(state);
      logger.log(`Bulk finished at ${state.bulkFinishedAt}`);
      return;
    }

    await sleep(args.waitPollMs);
  }
}

async function runPass(
  passNumber: number,
  args: Args,
  state: OrchestratorState,
  logger: { log: (msg: string) => void },
): Promise<OrchestratorPassRecord> {
  const phase = passPhaseForNumber(passNumber);
  state.phase = phase;
  state.currentPass = passNumber;
  saveOrchestratorState(state);

  const backlogBefore = await countCorpusBacklog();
  const passRecord: OrchestratorPassRecord = {
    pass: passNumber,
    startedAt: new Date().toISOString(),
    leavesWithBacklog: backlogBefore.leavesWithBacklog,
    stats: {
      ...emptyPassStats(),
      backlogBefore: {
        uncertain: backlogBefore.uncertain,
        no: backlogBefore.no,
        total: backlogBefore.total,
      },
      backlogAfter: {
        uncertain: backlogBefore.uncertain,
        no: backlogBefore.no,
        total: backlogBefore.total,
      },
    },
  };

  logger.log(
    `=== Phase 2: pass ${passNumber}/${TRIPLE_PASS_TOTAL} started · leaves_with_backlog=${backlogBefore.leavesWithBacklog} uncertain=${backlogBefore.uncertain} no=${backlogBefore.no} ===`,
  );

  if (backlogBefore.total === 0) {
    logger.log(`Pass ${passNumber}: no backlog — skipping spawn`);
    passRecord.finishedAt = new Date().toISOString();
    state.passes.push(passRecord);
    saveOrchestratorState(state);
    return passRecord;
  }

  const active: ActiveSpawn[] = [];
  const completedKeys = new Set<string>();

  while (true) {
    const backlogLeaves = await queryCompletedLeavesWithBacklog();
    const pending = buildPendingWorkers(backlogLeaves).filter(
      (item) =>
        !completedKeys.has(leafWorkerKey(item.leaf, item.workerIndex)) &&
        !isLeafWorkerRunning(item.leaf, item.workerIndex),
    );

    const running = active.filter((spawn) =>
      isLeafWorkerRunning(spawn.leaf, spawn.workerIndex),
    ).length;
    const toSpawn = prioritizePendingLeafWorkers(pending, running, args.maxConcurrent);

    for (const item of toSpawn) {
      const { pid } = spawnLeafWorker(item, args.apply);
      const key = leafWorkerKey(item.leaf, item.workerIndex);
      active.push({
        leaf: item.leaf,
        workerIndex: item.workerIndex,
        workerTotal: item.workerTotal,
        pid,
        key,
      });
      logger.log(
        `SPAWN ${workerAgentLabel(item.leaf, item.workerIndex, item.workerTotal)} pid=${pid} backlog=${item.total}`,
      );
    }

    for (const spawn of active) {
      const key = spawn.key;
      if (completedKeys.has(key)) continue;
      if (isLeafWorkerRunning(spawn.leaf, spawn.workerIndex)) continue;

      const workerState = loadWorkerState(spawn.leaf, spawn.workerIndex);
      if (workerState.status !== "completed" && workerState.status !== "failed") continue;

      completedKeys.add(key);
      mergeCleanupStats(passRecord.stats, workerState.stats);
      passRecord.stats.leavesProcessed += 1;
      logger.log(
        `WORKER DONE ${workerAgentLabel(spawn.leaf, spawn.workerIndex, spawn.workerTotal)} status=${workerState.status} STATS ${formatCleanupStats(workerState.stats)}`,
      );
    }

    const stillRunning = active.some(
      (spawn) => !completedKeys.has(spawn.key) && isLeafWorkerRunning(spawn.leaf, spawn.workerIndex),
    );
    const remainingBacklog = (await countCorpusBacklog()).total;
    const pendingLeaves = backlogLeaves.filter(
      (item) => !completedKeys.has(leafWorkerKey(item.leaf, 1)),
    ).length;

    if (!stillRunning && pendingLeaves === 0 && remainingBacklog === 0) {
      break;
    }

    if (!stillRunning && pendingLeaves === 0) {
      break;
    }

    await sleep(PASS_POLL_MS);
  }

  const backlogAfter = await countCorpusBacklog();
  passRecord.stats.backlogAfter = {
    uncertain: backlogAfter.uncertain,
    no: backlogAfter.no,
    total: backlogAfter.total,
  };
  passRecord.finishedAt = new Date().toISOString();
  passRecord.leavesWithBacklog = backlogBefore.leavesWithBacklog;

  logger.log(
    `=== Pass ${passNumber}/${TRIPLE_PASS_TOTAL} finished · attempted=${passRecord.stats.attempted} upgraded_yes=${passRecord.stats.upgradedToYes} still_no=${passRecord.stats.stillNo} still_uncertain=${passRecord.stats.stillUncertain} backlog_before=${passRecord.stats.backlogBefore.total} backlog_after=${passRecord.stats.backlogAfter.total} ===`,
  );

  state.passes.push(passRecord);
  saveOrchestratorState(state);

  return passRecord;
}

function writeReports(state: OrchestratorState, logger: { log: (msg: string) => void }): void {
  ensureBatchDir();

  const finalCorpus = state.passes.length > 0
    ? state.passes[state.passes.length - 1]?.stats.backlogAfter
    : { uncertain: 0, no: 0, total: 0 };

  const report = {
    generatedAt: new Date().toISOString(),
    bulkFinishedAt: state.bulkFinishedAt,
    totalPasses: TRIPLE_PASS_TOTAL,
    passes: state.passes,
    noTopicFix: state.noTopicFix,
    finalBacklog: finalCorpus,
    totals: aggregatePassTotals(state.passes),
  };

  fs.writeFileSync(TRIPLE_PASS_REPORT_JSON, JSON.stringify(report, null, 2));

  const mdLines = [
    "# Perplexity triple-pass cleanup report",
    "",
    `Generated: ${report.generatedAt}`,
    `Bulk finished: ${state.bulkFinishedAt ?? "—"}`,
    "",
    "## Final backlog",
    `- uncertain: ${finalCorpus?.uncertain ?? 0}`,
    `- no: ${finalCorpus?.no ?? 0}`,
    `- total: ${finalCorpus?.total ?? 0}`,
    "",
    "## Pass summary",
    "",
    "| Pass | attempted | upgraded_yes | still_no | still_uncertain | backlog before | backlog after |",
    "|------|-----------|--------------|----------|-----------------|----------------|---------------|",
  ];

  for (const pass of state.passes) {
    const s = pass.stats;
    mdLines.push(
      `| ${pass.pass} | ${s.attempted} | ${s.upgradedToYes} | ${s.stillNo} | ${s.stillUncertain} | ${s.backlogBefore.total} | ${s.backlogAfter.total} |`,
    );
  }

  mdLines.push("", "## Totals across passes", "");
  const totals = report.totals;
  mdLines.push(
    `- attempted: ${totals.attempted}`,
    `- upgraded_yes: ${totals.upgradedToYes}`,
    `- still_no: ${totals.stillNo}`,
    `- still_uncertain: ${totals.stillUncertain}`,
    `- errors: ${totals.errors}`,
  );

  if (state.noTopicFix) {
    const n = state.noTopicFix;
    mdLines.push(
      "",
      "## Phase 4: no-topic fix",
      "",
      `- backlog before: ${n.backlogBefore}`,
      `- backlog after: ${n.backlogAfter}`,
      `- attempted: ${n.stats.attempted}`,
      `- topic_fixed: ${n.stats.topicFixed}`,
      `- tags_fixed: ${n.stats.tagsFixed}`,
      `- errors: ${n.stats.errors}`,
      `- started: ${n.startedAt}`,
      `- finished: ${n.finishedAt ?? "—"}`,
    );
  }

  fs.writeFileSync(TRIPLE_PASS_REPORT_MD, mdLines.join("\n"));

  logger.log(`Reports written: ${TRIPLE_PASS_REPORT_JSON} · ${TRIPLE_PASS_REPORT_MD}`);
}

async function runNoTopicFix(
  args: Args,
  state: OrchestratorState,
  logger: { log: (msg: string) => void },
): Promise<NoTopicFixRecord> {
  state.phase = "no_topic_fix";
  saveOrchestratorState(state);

  logger.log("=== Phase 4: no-topic fix ===");

  const record = await runNoTopicFixPhase({
    apply: args.apply,
    logger,
  });

  state.noTopicFix = record;
  saveOrchestratorState(state);

  return record;
}

function aggregatePassTotals(passes: OrchestratorPassRecord[]): CleanupStats {
  const totals = emptyPassStats();
  for (const pass of passes) {
    mergeCleanupStats(totals, pass.stats);
  }
  return totals;
}

async function main() {
  const args = parseArgs();
  try {
    process.title = "post-bulk-orchestrator";
  } catch {
    // ignore
  }

  ensureBatchDir();
  const logger = createFileLogger(ORCHESTRATOR_LOG_FILE);
  const state = loadOrchestratorState();
  state.pid = process.pid;
  state.startedAt = state.startedAt ?? new Date().toISOString();
  state.totalPasses = TRIPLE_PASS_TOTAL;
  saveOrchestratorState(state);
  fs.writeFileSync(ORCHESTRATOR_PID_FILE, String(process.pid));

  logger.log("=== Post-bulk triple-pass orchestrator started ===");
  logger.log(
    `Mode: ${args.apply ? "apply" : "dry-run"} · passes=${TRIPLE_PASS_TOTAL} · workers_per_leaf=${WORKERS_PER_LEAF} · max_concurrent=${args.maxConcurrent} · wait_poll=${args.waitPollMs}ms`,
  );

  try {
    await waitForBulkComplete(args, state, logger);

    stopCoordinatorIfRunning(logger);

    logger.log("=== Phase 2: triple-pass cleanup ===");

    for (let pass = 1; pass <= TRIPLE_PASS_TOTAL; pass += 1) {
      await runPass(pass, args, state, logger);
    }

    await runNoTopicFix(args, state, logger);

    state.phase = "complete";
    state.currentPass = TRIPLE_PASS_TOTAL;
    saveOrchestratorState(state);

    writeReports(state, logger);

    logger.log("=== Phase 3: report written · orchestrator complete ===");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    state.phase = "failed";
    state.lastError = message;
    saveOrchestratorState(state);
    logger.log(`FATAL: ${message}`);
    throw error;
  } finally {
    try {
      if (fs.existsSync(ORCHESTRATOR_PID_FILE)) {
        const pid = Number(fs.readFileSync(ORCHESTRATOR_PID_FILE, "utf8").trim());
        if (pid === process.pid) {
          fs.unlinkSync(ORCHESTRATOR_PID_FILE);
        }
      }
    } catch {
      // ignore
    }
  }
}

main().catch((error) => {
  console.error("Post-bulk orchestrator failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
