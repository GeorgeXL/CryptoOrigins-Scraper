import { aiService } from "../ai";
import { setDayLocked, isDayLocked } from "../day-lock";
import { storage } from "../../storage";
import { normalizeTopicValue, topicLabelsFromRow } from "../editorial-pipeline/tools";
import {
  isWithinLeafAgentCorpusRange,
  LEAF_AGENT_CORPUS_END_DATE,
  LEAF_AGENT_CORPUS_START_DATE,
  MAIN_EVENTS_CHECK_MAX_DATES,
  MAIN_EVENTS_CHECK_CACHE_VERSION,
} from "../../../shared/leaf-agent-config";
import {
  TOPIC_HIERARCHY,
  TOPIC_HIERARCHY_LEAVES,
  formatTopicLeafWithGroup,
  topicGroupForLeaf,
} from "../../../shared/topic-hierarchy";
import {
  getMainEventsGeminiCacheMeta,
  loadCachedMainEvents,
  loadMainEventsDismissals,
  resolveMainEventsGeminiModel,
  saveCachedMainEvents,
  updateMainEventsDismissal,
  type CachedMainEventsPayload,
} from "./cache";
import type { MainEventsDismissals, MainEventsDismissCategory } from "../../../shared/leaf-agent-config";
import {
  canonicalDatesSchema,
  type CanonicalDatesResponse,
  type ValidCanonicalDate,
} from "./coverage-schemas";

import { ISO_DATE } from "./coverage-constants";

export type { ValidCanonicalDate } from "./coverage-schemas";
export { ISO_DATE };

export type LeafCorpusRow = {
  date: string;
  summary: string;
  isLocked: boolean;
};

export type LeafCoverageMatched = {
  date: string;
  event: string;
  importance: ValidCanonicalDate["importance"];
  summary: string;
  wasLocked: boolean;
  newlyLocked: boolean;
};

export type LeafCoverageMissing = {
  date: string;
  event: string;
  importance: ValidCanonicalDate["importance"];
};

export type LeafCoverageMisplaced = {
  date: string;
  event: string;
  importance: ValidCanonicalDate["importance"];
  currentLeaf: string;
  currentLeafLabel: string;
  summary: string;
  isLocked: boolean;
};

export type LeafDatabaseRow = {
  date: string;
  summary: string;
  isLocked: boolean;
  topics: string[];
};

export type LeafCoverageResult = {
  leaf: string;
  leafLabel: string;
  group: string | null;
  notes?: string;
  corpusCount: number;
  canonicalCount: number;
  geminiSource: "cache" | "gemini";
  geminiFetchedAt: string | null;
  geminiModel: string | null;
  matched: LeafCoverageMatched[];
  /** Gemini expects this on the target leaf, but no row exists for this date. */
  missing: LeafCoverageMissing[];
  /** Row exists in the DB but is tagged with a different leaf (or untagged). */
  misplaced: LeafCoverageMisplaced[];
  extra: LeafCorpusRow[];
  skippedCanonical: CanonicalDatesResponse["canonical_dates"];
  newlyLockedCount: number;
  dismissed: {
    misplaced: LeafCoverageMisplaced[];
    missing: LeafCoverageMissing[];
    extra: LeafCorpusRow[];
  };
};

export function resolveStorylineLeaf(input: string): string {
  const exact = TOPIC_HIERARCHY_LEAVES.find((leaf) => leaf.toLowerCase() === input.toLowerCase());
  if (exact) return exact;
  const partial = TOPIC_HIERARCHY_LEAVES.filter((leaf) =>
    leaf.toLowerCase().includes(input.toLowerCase()),
  );
  if (partial.length === 1) return partial[0]!;
  throw new Error(
    partial.length > 1
      ? `Ambiguous leaf "${input}". Matches: ${partial.join(", ")}`
      : `Unknown storyline leaf "${input}". Use an exact leaf from TOPIC_HIERARCHY.`,
  );
}

export function normalizeCanonicalDates(
  entries: CanonicalDatesResponse["canonical_dates"],
  maxDates: number,
): { valid: ValidCanonicalDate[]; skipped: CanonicalDatesResponse["canonical_dates"] } {
  const valid: ValidCanonicalDate[] = [];
  const skipped: CanonicalDatesResponse["canonical_dates"] = [];

  for (const entry of entries) {
    if (!ISO_DATE.test(entry.date)) {
      skipped.push(entry);
      continue;
    }
    if (!isWithinLeafAgentCorpusRange(entry.date)) {
      skipped.push(entry);
      continue;
    }
    valid.push(entry as ValidCanonicalDate);
  }

  return {
    valid: valid.sort((a, b) => a.date.localeCompare(b.date)).slice(0, maxDates),
    skipped,
  };
}

export function displayLeafFromNormalized(normalizedTopic: string | undefined): string {
  if (!normalizedTopic) return "Untagged";
  return (
    TOPIC_HIERARCHY_LEAVES.find((leaf) => normalizeTopicValue(leaf) === normalizedTopic) ??
    normalizedTopic
  );
}

export async function loadAnalysisIndex(): Promise<LeafDatabaseRow[]> {
  const analyses = await storage.getAllAnalyses();
  return analyses
    .map((row) => ({
      date: row.date,
      summary: (row.summary ?? "").trim(),
      isLocked: Boolean(row.isLocked),
      topics: topicLabelsFromRow(row.topicCategories),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function corpusForLeaf(allRows: LeafDatabaseRow[], leaf: string): LeafCorpusRow[] {
  const normalizedLeaf = normalizeTopicValue(leaf);
  return allRows
    .filter((row) => row.topics.includes(normalizedLeaf))
    .map(({ date, summary, isLocked }) => ({ date, summary, isLocked }));
}

export function crossCheckLeafCoverage(
  targetLeaf: string,
  allRows: LeafDatabaseRow[],
  canonical: ValidCanonicalDate[],
): Pick<LeafCoverageResult, "matched" | "missing" | "misplaced" | "extra"> {
  const normalizedTarget = normalizeTopicValue(targetLeaf);
  const corpus = corpusForLeaf(allRows, targetLeaf);
  const corpusByDate = new Map(corpus.map((row) => [row.date, row]));
  const dbByDate = new Map(allRows.map((row) => [row.date, row]));
  const canonicalDates = new Set<string>(canonical.map((entry) => entry.date));

  const matched: LeafCoverageMatched[] = [];
  const missing: LeafCoverageMissing[] = [];
  const misplaced: LeafCoverageMisplaced[] = [];

  for (const entry of canonical) {
    const onLeaf = corpusByDate.get(entry.date);
    if (onLeaf) {
      matched.push({
        date: entry.date,
        event: entry.event,
        importance: entry.importance,
        summary: onLeaf.summary,
        wasLocked: onLeaf.isLocked,
        newlyLocked: false,
      });
      continue;
    }

    const dbRow = dbByDate.get(entry.date);
    if (!dbRow) {
      missing.push(entry);
      continue;
    }

    const currentNormalized = dbRow.topics[0];
    if (currentNormalized === normalizedTarget) {
      matched.push({
        date: entry.date,
        event: entry.event,
        importance: entry.importance,
        summary: dbRow.summary,
        wasLocked: dbRow.isLocked,
        newlyLocked: false,
      });
      continue;
    }

    const currentLeaf = displayLeafFromNormalized(currentNormalized);
    misplaced.push({
      date: entry.date,
      event: entry.event,
      importance: entry.importance,
      currentLeaf,
      currentLeafLabel: currentNormalized ? formatTopicLeafWithGroup(currentLeaf) : "Untagged",
      summary: dbRow.summary,
      isLocked: dbRow.isLocked,
    });
  }

  const extra = corpus.filter((row) => !canonicalDates.has(row.date));

  return { matched, missing, misplaced, extra };
}

export function splitCoverageByDismissals(
  crossCheck: Pick<LeafCoverageResult, "misplaced" | "missing" | "extra">,
  dismissals: MainEventsDismissals,
): Pick<LeafCoverageResult, "misplaced" | "missing" | "extra" | "dismissed"> {
  const dismissedMisplaced = new Set(dismissals.misplaced);
  const dismissedMissing = new Set(dismissals.missing);
  const dismissedExtra = new Set(dismissals.extra);

  const misplacedActive: LeafCoverageMisplaced[] = [];
  const misplacedDismissed: LeafCoverageMisplaced[] = [];
  for (const entry of crossCheck.misplaced) {
    if (entry.isLocked) {
      continue;
    }
    (dismissedMisplaced.has(entry.date) ? misplacedDismissed : misplacedActive).push(entry);
  }

  const missingActive: LeafCoverageMissing[] = [];
  const missingDismissed: LeafCoverageMissing[] = [];
  for (const entry of crossCheck.missing) {
    (dismissedMissing.has(entry.date) ? missingDismissed : missingActive).push(entry);
  }

  const extraActive: LeafCorpusRow[] = [];
  const extraDismissed: LeafCorpusRow[] = [];
  for (const entry of crossCheck.extra) {
    (dismissedExtra.has(entry.date) ? extraDismissed : extraActive).push(entry);
  }

  return {
    misplaced: misplacedActive,
    missing: missingActive,
    extra: extraActive,
    dismissed: {
      misplaced: misplacedDismissed,
      missing: missingDismissed,
      extra: extraDismissed,
    },
  };
}

function buildCachedCoverageResult(
  leaf: string,
  allRows: LeafDatabaseRow[],
  cached: CachedMainEventsPayload,
  dismissals: MainEventsDismissals,
): LeafCoverageResult {
  const corpus = corpusForLeaf(allRows, leaf);
  const crossCheck = crossCheckLeafCoverage(leaf, allRows, cached.canonical);
  const filtered = splitCoverageByDismissals(crossCheck, dismissals);

  return {
    leaf,
    leafLabel: formatTopicLeafWithGroup(leaf),
    group: topicGroupForLeaf(leaf) ?? null,
    notes: cached.notes,
    corpusCount: corpus.length,
    canonicalCount: cached.canonical.length,
    geminiSource: "cache",
    geminiFetchedAt: cached.fetchedAt.toISOString(),
    geminiModel: cached.geminiModel,
    matched: crossCheck.matched,
    misplaced: filtered.misplaced,
    missing: filtered.missing,
    extra: filtered.extra,
    skippedCanonical: cached.skippedCanonical,
    newlyLockedCount: 0,
    dismissed: filtered.dismissed,
  };
}

export type MainEventsCheckSnapshot = {
  stats: {
    leaf: string;
    leafLabel: string;
    corpusCount: number;
    lockedCount: number;
    geminiCache: Awaited<ReturnType<typeof getMainEventsGeminiCacheMeta>>;
  };
  preview: LeafCoverageResult | null;
};

export async function getMainEventsCheckSnapshot(leafInput: string): Promise<MainEventsCheckSnapshot> {
  const leaf = resolveStorylineLeaf(leafInput);
  const [cached, dismissals, allRows] = await Promise.all([
    loadCachedMainEvents(leaf),
    loadMainEventsDismissals(leaf),
    loadAnalysisIndex(),
  ]);
  const corpus = corpusForLeaf(allRows, leaf);
  const geminiCache = cached
    ? {
        cached: true as const,
        fetchedAt: cached.fetchedAt.toISOString(),
        geminiModel: cached.geminiModel,
        canonicalCount: cached.canonical.length,
        cacheVersion: MAIN_EVENTS_CHECK_CACHE_VERSION,
      }
    : {
        cached: false as const,
        fetchedAt: null,
        geminiModel: null,
        canonicalCount: 0,
        cacheVersion: null,
      };

  return {
    stats: {
      leaf,
      leafLabel: formatTopicLeafWithGroup(leaf),
      corpusCount: corpus.length,
      lockedCount: corpus.filter((row) => row.isLocked).length,
      geminiCache,
    },
    preview: cached ? buildCachedCoverageResult(leaf, allRows, cached, dismissals) : null,
  };
}

export async function loadCorpusForLeaf(leaf: string): Promise<LeafCorpusRow[]> {
  return corpusForLeaf(await loadAnalysisIndex(), leaf);
}

async function fetchCanonicalDatesFromGemini(
  leaf: string,
  maxDates: number,
): Promise<CanonicalDatesResponse> {
  const group = topicGroupForLeaf(leaf);
  const groupMeta = TOPIC_HIERARCHY.find((g) => g.name === group);
  const gemini = aiService.getProvider("gemini");

  const systemPrompt = `You are a Bitcoin/crypto timeline curator. List historically important calendar dates for ONE homepage storyline leaf.
Use web search when helpful to verify exact dates (YYYY-MM-DD).
Only include dates from ${LEAF_AGENT_CORPUS_START_DATE} through ${LEAF_AGENT_CORPUS_END_DATE} inclusive — this corpus ends in 2024; do not include 2025+ or estimated future dates.
Every date MUST be an exact calendar day in YYYY-MM-DD form — never use XX placeholders or month-only dates.
Prefer landmark moments editors would expect on a daily timeline — not every minor news item.
Respond ONLY with valid JSON matching the schema.`;

  const userPrompt = `Storyline group: ${group ?? "Unknown"}
Group description: ${groupMeta?.description ?? ""}
Storyline leaf: ${leaf}

Return the main canonical dates for this leaf (between ${LEAF_AGENT_CORPUS_START_DATE} and ${LEAF_AGENT_CORPUS_END_DATE} only). Include every landmark you can verify, up to ${maxDates} dates if needed.
JSON shape:
{
  "storyline_leaf": "${leaf}",
  "canonical_dates": [
    { "date": "YYYY-MM-DD", "event": "short label (max 120 chars)", "importance": "landmark"|"major"|"notable" }
  ],
  "notes": "optional one sentence"
}`;

  const raw = await gemini.generateJson<CanonicalDatesResponse>({
    systemPrompt,
    prompt: userPrompt,
    model: resolveMainEventsGeminiModel(),
    temperature: 0.2,
    maxTokens: maxDates > 40 ? 8192 : 4096,
    context: "main-events-check",
    purpose: `canonical dates for ${leaf}`,
    schema: canonicalDatesSchema,
  });

  return canonicalDatesSchema.parse(raw);
}

export type MainEventsGeminiCacheResult = {
  leaf: string;
  skipped: boolean;
  canonicalCount: number;
  fetchedAt: string | null;
  geminiModel: string | null;
};

export async function cacheMainEventsGeminiForLeaf(
  leafInput: string,
  opts?: { force?: boolean },
): Promise<MainEventsGeminiCacheResult> {
  const leaf = resolveStorylineLeaf(leafInput);
  const maxDates = MAIN_EVENTS_CHECK_MAX_DATES;

  if (!opts?.force) {
    const existing = await loadCachedMainEvents(leaf);
    if (existing) {
      return {
        leaf,
        skipped: true,
        canonicalCount: existing.canonical.length,
        fetchedAt: existing.fetchedAt.toISOString(),
        geminiModel: existing.geminiModel,
      };
    }
  }

  if (!process.env.GOOGLE_API_KEY && !process.env.GEMINI_API_KEY) {
    throw new Error("GOOGLE_API_KEY or GEMINI_API_KEY is required to refresh main events from Gemini");
  }

  const geminiModel = resolveMainEventsGeminiModel();
  const response = await fetchCanonicalDatesFromGemini(leaf, maxDates);
  const normalized = normalizeCanonicalDates(response.canonical_dates, maxDates);
  const fetchedAt = new Date();

  await saveCachedMainEvents(leaf, {
    notes: response.notes?.trim() || undefined,
    canonical: normalized.valid,
    skippedCanonical: normalized.skipped,
    geminiModel,
    fetchedAt,
  });

  return {
    leaf,
    skipped: false,
    canonicalCount: normalized.valid.length,
    fetchedAt: fetchedAt.toISOString(),
    geminiModel,
  };
}

export async function getMainEventsCacheOverview(): Promise<{
  totalLeaves: number;
  cachedCount: number;
  uncachedLeaves: string[];
}> {
  const uncachedLeaves: string[] = [];
  let cachedCount = 0;

  for (const leaf of TOPIC_HIERARCHY_LEAVES) {
    const cached = await loadCachedMainEvents(leaf);
    if (cached) {
      cachedCount += 1;
    } else {
      uncachedLeaves.push(leaf);
    }
  }

  return {
    totalLeaves: TOPIC_HIERARCHY_LEAVES.length,
    cachedCount,
    uncachedLeaves,
  };
}

async function lockMatchedDates(
  matched: LeafCoverageMatched[],
): Promise<{ matched: LeafCoverageMatched[]; newlyLockedCount: number }> {
  let newlyLockedCount = 0;
  const updated = await Promise.all(
    matched.map(async (entry) => {
      if (entry.wasLocked) {
        return entry;
      }
      const locked = await isDayLocked(entry.date);
      if (locked) {
        return { ...entry, wasLocked: true, newlyLocked: false };
      }
      await setDayLocked(entry.date, true);
      newlyLockedCount += 1;
      return { ...entry, wasLocked: true, newlyLocked: true };
    }),
  );
  return { matched: updated, newlyLockedCount };
}

export async function runLeafCoverageCheck(opts: {
  leaf: string;
  autoLockMatches?: boolean;
  refreshFromGemini?: boolean;
  requireCache?: boolean;
}): Promise<LeafCoverageResult> {
  const leaf = resolveStorylineLeaf(opts.leaf);
  const autoLockMatches = opts.autoLockMatches !== false;
  const refreshFromGemini = opts.refreshFromGemini === true;
  const requireCache = opts.requireCache === true;

  const allRows = await loadAnalysisIndex();
  const corpus = corpusForLeaf(allRows, leaf);

  let notes: string | undefined;
  let canonical: ValidCanonicalDate[];
  let skippedCanonical: CanonicalDatesResponse["canonical_dates"];
  let geminiSource: "cache" | "gemini";
  let geminiFetchedAt: string | null;
  let geminiModel: string | null;

  const cached = refreshFromGemini ? null : await loadCachedMainEvents(leaf);

  if (cached) {
    canonical = cached.canonical;
    skippedCanonical = cached.skippedCanonical;
    notes = cached.notes;
    geminiSource = "cache";
    geminiFetchedAt = cached.fetchedAt.toISOString();
    geminiModel = cached.geminiModel;
  } else if (requireCache) {
    throw new Error("No cached main events list for this leaf");
  } else {
    const cachedFromGemini = await cacheMainEventsGeminiForLeaf(leaf, {
      force: refreshFromGemini,
    });
    const loaded = await loadCachedMainEvents(leaf);
    if (!loaded) {
      throw new Error(`Failed to cache main events for ${leaf}`);
    }
    canonical = loaded.canonical;
    skippedCanonical = loaded.skippedCanonical;
    notes = loaded.notes;
    geminiSource = cachedFromGemini.skipped ? "cache" : "gemini";
    geminiFetchedAt = cachedFromGemini.fetchedAt;
    geminiModel = cachedFromGemini.geminiModel;
  }

  let { matched, missing, misplaced, extra } = crossCheckLeafCoverage(leaf, allRows, canonical);
  let newlyLockedCount = 0;

  if (autoLockMatches && matched.length > 0) {
    const lockResult = await lockMatchedDates(matched);
    matched = lockResult.matched;
    newlyLockedCount = lockResult.newlyLockedCount;
  }

  const dismissals = await loadMainEventsDismissals(leaf);
  const filtered = splitCoverageByDismissals({ misplaced, missing, extra }, dismissals);

  return {
    leaf,
    leafLabel: formatTopicLeafWithGroup(leaf),
    group: topicGroupForLeaf(leaf) ?? null,
    notes,
    corpusCount: corpus.length,
    canonicalCount: canonical.length,
    geminiSource,
    geminiFetchedAt,
    geminiModel,
    matched,
    missing: filtered.missing,
    misplaced: filtered.misplaced,
    extra: filtered.extra,
    skippedCanonical,
    newlyLockedCount,
    dismissed: filtered.dismissed,
  };
}

export async function setMainEventsDismissal(opts: {
  leaf: string;
  category: MainEventsDismissCategory;
  date: string;
  dismissed: boolean;
}): Promise<LeafCoverageResult> {
  const leaf = resolveStorylineLeaf(opts.leaf);
  await updateMainEventsDismissal({ ...opts, leaf });
  return previewLeafCoverageCheck(leaf);
}

export async function previewLeafCoverageCheck(leafInput: string): Promise<LeafCoverageResult> {
  const leaf = resolveStorylineLeaf(leafInput);
  const [cached, dismissals] = await Promise.all([
    loadCachedMainEvents(leaf),
    loadMainEventsDismissals(leaf),
  ]);
  if (!cached) {
    throw new Error("No cached main events list for this leaf");
  }
  const allRows = await loadAnalysisIndex();
  return buildCachedCoverageResult(leaf, allRows, cached, dismissals);
}

export async function getLeafCorpusStats(leafInput: string): Promise<MainEventsCheckSnapshot["stats"]> {
  const { stats } = await getMainEventsCheckSnapshot(leafInput);
  return stats;
}
