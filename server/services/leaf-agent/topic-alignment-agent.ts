import { aiService } from "../ai";
import {
  TOPIC_HIERARCHY,
  TOPIC_HIERARCHY_LEAVES,
  formatTopicLeafWithGroup,
  topicGroupForLeaf,
} from "@shared/topic-hierarchy";
import { mainEventsLeafPromptRules, buildTopicHierarchyAgentPromptBlock } from "@shared/main-events-leaf-prompts";
import { canonicalTopicLeaf } from "../editorial-pipeline/topic-agent";
import { normalizeTopicValue } from "../editorial-pipeline/tools";
import { rankTopicCandidatesFromSummary } from "../editorial-pipeline/storyline-taxonomy";
import {
  loadAllValidMainEventsCacheEntries,
  resolveMainEventsGeminiModel,
  applyMainEventsVerificationUpdates,
} from "./cache";
import { buildCachedCoverageResult, loadAnalysisIndex, resolveStorylineLeaf } from "./coverage";
import { mainEventsAlignmentBatchSchema } from "./coverage-schemas";
import {
  emptyLockStats,
  lockActionFromVerdict,
  recordVerificationLock,
  verificationStatusFromVerdict,
  type VerificationLockStats,
} from "./verification-lock-policy";

export type MainEventsAlignmentItem = {
  date: string;
  kind: "matched" | "misplaced";
  geminiLeaf: string;
  geminiEvent: string;
  dbLeaf: string;
  dbLeafLabel: string;
  summary: string;
};

export type MainEventsAlignmentMismatch = {
  date: string;
  kind: "matched" | "misplaced";
  geminiLeaf: string;
  geminiLeafLabel: string;
  geminiEvent: string;
  dbLeaf: string;
  dbLeafLabel: string;
  recommendedLeaf: string | null;
  recommendedLeafLabel: string | null;
  confidence: "high" | "medium" | "low";
  reason: string;
  summaryPreview: string;
};

export type MainEventsAlignmentReport = {
  scanned: number;
  aligned: number;
  mismatches: MainEventsAlignmentMismatch[];
  pending: number;
  skippedLeaves: string[];
  locked: number;
  unlocked: number;
  lockActions: VerificationLockStats["lockActions"];
  verificationMatched: number;
  verificationPending: number;
};

const BATCH_SIZE = 6;

function shuffleArray<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}

function hierarchyPromptBlock(): string {
  return buildTopicHierarchyAgentPromptBlock();
}

function collectAlignmentItemsForLeaf(
  leaf: string,
  allRows: Awaited<ReturnType<typeof loadAnalysisIndex>>,
  cacheByLeaf: Awaited<ReturnType<typeof loadAllValidMainEventsCacheEntries>>,
): MainEventsAlignmentItem[] {
  const entry = cacheByLeaf.get(normalizeTopicValue(leaf));
  if (!entry) return [];

  const preview = buildCachedCoverageResult(leaf, allRows, entry.payload, entry.dismissals);
  const items: MainEventsAlignmentItem[] = [];

  for (const row of preview.matched) {
    items.push({
      date: row.date,
      kind: "matched",
      geminiLeaf: leaf,
      geminiEvent: row.event,
      dbLeaf: leaf,
      dbLeafLabel: formatTopicLeafWithGroup(leaf),
      summary: row.summary,
    });
  }

  for (const row of preview.misplaced) {
    items.push({
      date: row.date,
      kind: "misplaced",
      geminiLeaf: leaf,
      geminiEvent: row.event,
      dbLeaf: row.currentLeaf,
      dbLeafLabel: row.currentLeafLabel,
      summary: row.summary,
    });
  }

  return items;
}

function rulesVerdict(item: MainEventsAlignmentItem): {
  agreesWithGemini: boolean;
  recommendedLeaf: string | null;
  confidence: "high" | "medium" | "low";
  reason: string;
} {
  const ranking = rankTopicCandidatesFromSummary({ summary: item.summary, tags: [] });
  const recommended = ranking.primary ? canonicalTopicLeaf(ranking.primary) ?? ranking.primary : null;
  const agreesWithGemini = recommended === item.geminiLeaf;
  return {
    agreesWithGemini,
    recommendedLeaf: recommended,
    confidence: ranking.confidence === "high" ? "high" : "medium",
    reason: agreesWithGemini ? "Keyword rules agree with Gemini leaf" : "Keyword rules prefer a different leaf",
  };
}

function isContentMismatch(
  item: MainEventsAlignmentItem,
  verdict: {
    agreesWithGemini: boolean;
    recommendedLeaf: string | null;
    confidence: "high" | "medium" | "low";
  },
): boolean {
  const recommended = verdict.recommendedLeaf
    ? canonicalTopicLeaf(verdict.recommendedLeaf) ?? verdict.recommendedLeaf
    : null;

  if (item.kind === "matched") {
    if (!verdict.agreesWithGemini) return true;
    return recommended !== null && recommended !== item.geminiLeaf;
  }

  if (recommended && recommended === item.dbLeaf) return true;
  if (recommended && recommended !== item.geminiLeaf && verdict.confidence !== "low") return true;
  return !verdict.agreesWithGemini && verdict.confidence === "high";
}

async function verifyAlignmentBatch(
  leaf: string,
  items: MainEventsAlignmentItem[],
): Promise<
  Array<{
    item: MainEventsAlignmentItem;
    agreesWithGemini: boolean;
    recommendedLeaf: string | null;
    confidence: "high" | "medium" | "low";
    reason: string;
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
  const leafRules = mainEventsLeafPromptRules(leaf);
  const gemini = aiService.getProvider("gemini");

  const itemLines = items
    .map(
      (item) =>
        `- ${item.date} | kind=${item.kind} | gemini_event="${item.geminiEvent}" | gemini_leaf="${item.geminiLeaf}" | db_leaf="${item.dbLeaf}" | summary="${item.summary.slice(0, 280).replace(/"/g, "'")}"`,
    )
    .join("\n");

  const systemPrompt = `You verify whether historical timeline days belong on the storyline leaf Gemini proposed in a Main events check.

Use ONLY leaves from the hierarchy below. Copy leaf names EXACTLY.

For kind=matched: the day is already tagged on gemini_leaf. Decide if the summary describes gemini_event on that leaf (agrees_with_gemini=true) or belongs elsewhere (agrees_with_gemini=false, set recommended_leaf).

For kind=misplaced: Gemini expects the day on gemini_leaf but DB has db_leaf. Decide which leaf fits the summary best.

Respond ONLY with JSON matching the schema. Include one verdict per input date.`;

  const userPrompt = `Storyline group: ${group ?? "Unknown"}
Group description: ${groupMeta?.description ?? ""}
Target leaf: ${leaf}
Leaf rules — include: ${leafRules.include}
Leaf rules — exclude: ${leafRules.exclude}

TOPIC HIERARCHY:
${hierarchyPromptBlock()}

Verify these items:
${itemLines}`;

  try {
    const raw = await gemini.generateJson({
      systemPrompt,
      prompt: userPrompt,
      model: resolveMainEventsGeminiModel(),
      temperature: 0.1,
      maxTokens: 4096,
      context: "main-events-check",
      purpose: `topic alignment for ${leaf}`,
      schema: mainEventsAlignmentBatchSchema,
    });

    const parsed = mainEventsAlignmentBatchSchema.parse(raw);
    const byDate = new Map(parsed.verdicts.map((verdict) => [verdict.date, verdict]));

    return items.map((item) => {
      const verdict = byDate.get(item.date);
      if (!verdict) return { item, ...rulesVerdict(item) };
      const recommended = verdict.recommended_leaf
        ? canonicalTopicLeaf(verdict.recommended_leaf) ?? verdict.recommended_leaf
        : null;
      return {
        item,
        agreesWithGemini: verdict.agrees_with_gemini,
        recommendedLeaf: recommended,
        confidence: verdict.confidence,
        reason: verdict.reason.trim() || "Gemini alignment check",
      };
    });
  } catch {
    return items.map((item) => {
      const verdict = rulesVerdict(item);
      return { item, ...verdict };
    });
  }
}

export async function verifyMainEventsTopicAlignment(opts?: {
  leaf?: string;
  maxItems?: number;
  applyLockPolicy?: boolean;
  persistResults?: boolean;
  shuffleLeaves?: boolean;
}): Promise<MainEventsAlignmentReport> {
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
  const itemsByLeaf = new Map<string, MainEventsAlignmentItem[]>();

  for (const leafName of targetLeaves) {
    const items = collectAlignmentItemsForLeaf(leafName, allRows, cacheByLeaf);
    if (items.length === 0) {
      if (opts?.leaf) skippedLeaves.push(leafName);
      continue;
    }
    itemsByLeaf.set(leafName, items);
  }

  const mismatches: MainEventsAlignmentMismatch[] = [];
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
      const results = await verifyAlignmentBatch(leafName, batch);

      for (const result of results) {
        scanned += 1;
        const correlated = !isContentMismatch(result.item, result);
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

        if (!correlated) {
          const recommended = result.recommendedLeaf
            ? canonicalTopicLeaf(result.recommendedLeaf) ?? result.recommendedLeaf
            : null;
          mismatches.push({
            date: result.item.date,
            kind: result.item.kind,
            geminiLeaf: result.item.geminiLeaf,
            geminiLeafLabel: formatTopicLeafWithGroup(result.item.geminiLeaf),
            geminiEvent: result.item.geminiEvent,
            dbLeaf: result.item.dbLeaf,
            dbLeafLabel: result.item.dbLeafLabel,
            recommendedLeaf: recommended,
            recommendedLeafLabel: recommended ? formatTopicLeafWithGroup(recommended) : null,
            confidence: result.confidence,
            reason: result.reason,
            summaryPreview: result.item.summary.slice(0, 160),
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
