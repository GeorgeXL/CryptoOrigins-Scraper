import { aiService } from "../ai";
import {
  TOPIC_HIERARCHY,
  TOPIC_HIERARCHY_LEAVES,
  formatTopicLeafWithGroup,
  topicGroupForLeaf,
} from "@shared/topic-hierarchy";
import { normalizeTopicValue, summaryTokenJaccardForDuplicateCheck } from "../editorial-pipeline/tools";
import { loadAllValidMainEventsCacheEntries, resolveMainEventsGeminiModel, applyMainEventsVerificationUpdates } from "./cache";
import { buildCachedCoverageResult, loadAnalysisIndex, resolveStorylineLeaf } from "./coverage";
import { mainEventsSummaryAlignmentBatchSchema } from "./coverage-schemas";
import {
  emptyLockStats,
  lockActionFromVerdict,
  recordVerificationLock,
  verificationStatusFromVerdict,
  type VerificationLockStats,
} from "./verification-lock-policy";

export type MainEventsSummaryAlignmentItem = {
  date: string;
  geminiLeaf: string;
  geminiEvent: string;
  dbSummary: string;
};

export type MainEventsSummaryAlignmentMismatch = {
  date: string;
  geminiLeaf: string;
  geminiLeafLabel: string;
  geminiEvent: string;
  dbSummaryPreview: string;
  confidence: "high" | "medium" | "low";
  reason: string;
  tokenOverlap: number;
};

export type MainEventsSummaryAlignmentReport = {
  scanned: number;
  aligned: number;
  mismatches: MainEventsSummaryAlignmentMismatch[];
  pending: number;
  skippedLeaves: string[];
  locked: number;
  unlocked: number;
  lockActions: VerificationLockStats["lockActions"];
  verificationMatched: number;
  verificationPending: number;
};

const BATCH_SIZE = 8;
const RULES_MATCH_THRESHOLD = 0.14;

function shuffleArray<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}

function collectMatchedSummaryItemsForLeaf(
  leaf: string,
  allRows: Awaited<ReturnType<typeof loadAnalysisIndex>>,
  cacheByLeaf: Awaited<ReturnType<typeof loadAllValidMainEventsCacheEntries>>,
): MainEventsSummaryAlignmentItem[] {
  const entry = cacheByLeaf.get(normalizeTopicValue(leaf));
  if (!entry) return [];

  const preview = buildCachedCoverageResult(leaf, allRows, entry.payload, entry.dismissals);

  return preview.matched.map((row) => ({
    date: row.date,
    geminiLeaf: leaf,
    geminiEvent: row.event,
    dbSummary: row.summary,
  }));
}

function rulesVerdict(item: MainEventsSummaryAlignmentItem): {
  sameStory: boolean;
  confidence: "high" | "medium" | "low";
  reason: string;
  tokenOverlap: number;
} {
  const tokenOverlap = summaryTokenJaccardForDuplicateCheck(item.geminiEvent, item.dbSummary);
  if (tokenOverlap >= RULES_MATCH_THRESHOLD) {
    return {
      sameStory: true,
      confidence: tokenOverlap >= 0.28 ? "high" : "medium",
      reason: "Keyword overlap between Gemini event and DB summary",
      tokenOverlap,
    };
  }
  if (tokenOverlap <= 0.05) {
    return {
      sameStory: false,
      confidence: "medium",
      reason: "Little overlap between Gemini event label and DB summary",
      tokenOverlap,
    };
  }
  return {
    sameStory: true,
    confidence: "low",
    reason: "Weak keyword overlap — needs manual review",
    tokenOverlap,
  };
}

async function verifySummaryBatch(
  leaf: string,
  items: MainEventsSummaryAlignmentItem[],
): Promise<
  Array<{
    item: MainEventsSummaryAlignmentItem;
    sameStory: boolean;
    confidence: "high" | "medium" | "low";
    reason: string;
    tokenOverlap: number;
  }>
> {
  if (items.length === 0) return [];

  if (!process.env.GOOGLE_API_KEY && !process.env.GEMINI_API_KEY) {
    return items.map((item) => {
      const verdict = rulesVerdict(item);
      return { item, ...verdict };
    });
  }

  const group = topicGroupForLeaf(leaf);
  const groupMeta = TOPIC_HIERARCHY.find((entry) => entry.name === group);
  const gemini = aiService.getProvider("gemini");

  const itemLines = items
    .map(
      (item) =>
        `- ${item.date} | gemini_event="${item.geminiEvent}" | db_summary="${item.dbSummary.slice(0, 320).replace(/"/g, "'")}"`,
    )
    .join("\n");

  const systemPrompt = `You compare Gemini's canonical main-event label with the editorial summary stored in our database for the same calendar date.

The date match and storyline leaf may already be correct — your job is only to decide whether the DB summary describes the SAME story as Gemini's event label.

Mark same_story=true when they clearly refer to the same historical event (wording may differ).
Mark same_story=false when the DB summary is about a different event, a vague/unrelated story, or only loosely related background.

Respond ONLY with JSON matching the schema. One verdict per input date.`;

  const userPrompt = `Storyline leaf: ${leaf}
Group: ${group ?? "Unknown"} — ${groupMeta?.description ?? ""}

Compare Gemini event labels vs DB summaries:
${itemLines}`;

  try {
    const raw = await gemini.generateJson({
      systemPrompt,
      prompt: userPrompt,
      model: resolveMainEventsGeminiModel(),
      temperature: 0.1,
      maxTokens: 4096,
      context: "main-events-check",
      purpose: `summary alignment for ${leaf}`,
      schema: mainEventsSummaryAlignmentBatchSchema,
    });

    const parsed = mainEventsSummaryAlignmentBatchSchema.parse(raw);
    const byDate = new Map(parsed.verdicts.map((verdict) => [verdict.date, verdict]));

    return items.map((item) => {
      const verdict = byDate.get(item.date);
      const tokenOverlap = summaryTokenJaccardForDuplicateCheck(item.geminiEvent, item.dbSummary);
      if (!verdict) {
        const fallback = rulesVerdict(item);
        return { item, ...fallback };
      }
      return {
        item,
        sameStory: verdict.same_story,
        confidence: verdict.confidence,
        reason: verdict.reason.trim() || "Gemini summary comparison",
        tokenOverlap,
      };
    });
  } catch {
    return items.map((item) => {
      const verdict = rulesVerdict(item);
      return { item, ...verdict };
    });
  }
}

function isSummaryMismatch(verdict: {
  sameStory: boolean;
  confidence: "high" | "medium" | "low";
}): boolean {
  if (verdict.sameStory) return false;
  return verdict.confidence === "high" || verdict.confidence === "medium";
}

export async function verifyMainEventsSummaryAlignment(opts?: {
  leaf?: string;
  maxItems?: number;
  applyLockPolicy?: boolean;
  persistResults?: boolean;
  shuffleLeaves?: boolean;
}): Promise<MainEventsSummaryAlignmentReport> {
  const maxItems = Math.min(Math.max(opts?.maxItems ?? 120, 1), 500);
  const applyLockPolicy = opts?.applyLockPolicy !== false;
  const persistResults = opts?.persistResults !== false;
  const [allRows, cacheByLeaf] = await Promise.all([
    loadAnalysisIndex(),
    loadAllValidMainEventsCacheEntries(),
  ]);

  let targetLeaves = opts?.leaf
    ? [resolveStorylineLeaf(opts.leaf)]
    : TOPIC_HIERARCHY_LEAVES.filter((leafName) => cacheByLeaf.has(normalizeTopicValue(leafName)));
  if (opts?.shuffleLeaves && !opts?.leaf) {
    targetLeaves = shuffleArray(targetLeaves);
  }

  const skippedLeaves: string[] = [];
  const itemsByLeaf = new Map<string, MainEventsSummaryAlignmentItem[]>();

  for (const leafName of targetLeaves) {
    const items = collectMatchedSummaryItemsForLeaf(leafName, allRows, cacheByLeaf);
    if (items.length === 0) {
      if (opts?.leaf) skippedLeaves.push(leafName);
      continue;
    }
    itemsByLeaf.set(leafName, items);
  }

  const mismatches: MainEventsSummaryAlignmentMismatch[] = [];
  const lockStats = emptyLockStats();
  let aligned = 0;
  let scanned = 0;
  let verificationMatched = 0;
  let verificationPending = 0;

  for (const [leafName, leafItems] of itemsByLeaf) {
    if (scanned >= maxItems) break;

    const remaining = maxItems - scanned;
    const slice = leafItems.slice(0, remaining);
    const verificationUpdates: Array<{ date: string; status: "matched" | "pending" }> = [];

    for (let i = 0; i < slice.length; i += BATCH_SIZE) {
      const batch = slice.slice(i, i + BATCH_SIZE);
      const results = await verifySummaryBatch(leafName, batch);

      for (const result of results) {
        scanned += 1;
        const correlated = result.sameStory;
        const action = lockActionFromVerdict({
          correlated,
          confidence: result.confidence,
        });
        const verificationStatus = verificationStatusFromVerdict({
          correlated,
          confidence: result.confidence,
        });

        verificationUpdates.push({ date: result.item.date, status: verificationStatus });
        if (verificationStatus === "matched") verificationMatched += 1;
        else verificationPending += 1;

        await recordVerificationLock(
          lockStats,
          result.item.date,
          action,
          result.reason,
          applyLockPolicy,
        );

        if (result.confidence === "low") {
          continue;
        }

        if (isSummaryMismatch(result)) {
          mismatches.push({
            date: result.item.date,
            geminiLeaf: result.item.geminiLeaf,
            geminiLeafLabel: formatTopicLeafWithGroup(result.item.geminiLeaf),
            geminiEvent: result.item.geminiEvent,
            dbSummaryPreview: result.item.dbSummary.slice(0, 220),
            confidence: result.confidence,
            reason: result.reason,
            tokenOverlap: Math.round(result.tokenOverlap * 1000) / 1000,
          });
        } else {
          aligned += 1;
        }
      }
    }

    if (persistResults && verificationUpdates.length > 0) {
      await applyMainEventsVerificationUpdates({ leaf: leafName, updates: verificationUpdates });
    }
  }

  return {
    scanned,
    aligned,
    mismatches,
    pending: lockStats.pending,
    skippedLeaves,
    locked: lockStats.locked,
    unlocked: lockStats.unlocked,
    lockActions: lockStats.lockActions,
    verificationMatched,
    verificationPending,
  };
}
