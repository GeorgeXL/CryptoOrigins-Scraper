import { eq } from "drizzle-orm";

import { db } from "../../db";
import { normalizeTopicValue } from "../editorial-pipeline/tools";
import { mainEventsCheckCache } from "@shared/schema";
import { MAIN_EVENTS_CHECK_CACHE_VERSION } from "../../../shared/leaf-agent-config";
import type {
  MainEventsDismissCategory,
  MainEventsDismissals,
  MainEventsVerificationDates,
  MainEventsVerificationStatus,
} from "../../../shared/leaf-agent-config";
import {
  EMPTY_MAIN_EVENTS_DISMISSALS,
  EMPTY_MAIN_EVENTS_VERIFICATION_DATES,
} from "../../../shared/leaf-agent-config";
import { verificationStatusRequiresDayLock } from "../../../shared/main-events-verification-lock";
import { tryLockDay } from "../day-lock";
import { readCanonicalSourceUrl } from "./coverage-constants";
import type { SkippedCanonicalDate, ValidCanonicalDate } from "./coverage-schemas";

export type CachedMainEventsPayload = {
  notes?: string;
  canonical: ValidCanonicalDate[];
  skippedCanonical: SkippedCanonicalDate[];
  geminiModel: string;
  fetchedAt: Date;
};

export type MainEventsGeminiCacheMeta = {
  cached: boolean;
  fetchedAt: string | null;
  geminiModel: string | null;
  canonicalCount: number;
  cacheVersion: string | null;
};

export type { MainEventsDismissCategory, MainEventsDismissals, MainEventsVerificationDates };

function parseDateList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (value): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value),
  );
}

function parseDismissals(raw: unknown): MainEventsDismissals {
  if (!raw || typeof raw !== "object") {
    return { ...EMPTY_MAIN_EVENTS_DISMISSALS };
  }
  const row = raw as Record<string, unknown>;
  const readDates = (key: MainEventsDismissCategory) =>
    Array.isArray(row[key])
      ? (row[key] as unknown[]).filter(
          (value): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value),
        )
      : [];

  return {
    misplaced: readDates("misplaced"),
    missing: readDates("missing"),
    extra: readDates("extra"),
  };
}

export function parseVerificationDates(raw: unknown): MainEventsVerificationDates {
  if (!raw || typeof raw !== "object") {
    return { ...EMPTY_MAIN_EVENTS_VERIFICATION_DATES };
  }
  const row = raw as Record<string, unknown>;
  return {
    matched: parseDateList(row.matched).sort((a, b) => a.localeCompare(b)),
    pending: parseDateList(row.pending).sort((a, b) => a.localeCompare(b)),
    rejected: parseDateList(row.rejected).sort((a, b) => a.localeCompare(b)),
  };
}

export async function loadMainEventsVerificationDates(leaf: string): Promise<MainEventsVerificationDates> {
  const normalizedLeaf = normalizeTopicValue(leaf);
  const [row] = await db
    .select({ verificationDates: mainEventsCheckCache.verificationDates })
    .from(mainEventsCheckCache)
    .where(eq(mainEventsCheckCache.normalizedLeaf, normalizedLeaf))
    .limit(1);

  if (!row) return { ...EMPTY_MAIN_EVENTS_VERIFICATION_DATES };
  return parseVerificationDates(row.verificationDates);
}

export async function applyMainEventsVerificationUpdates(opts: {
  leaf: string;
  updates: Array<{ date: string; status: MainEventsVerificationStatus }>;
}): Promise<MainEventsVerificationDates> {
  if (opts.updates.length === 0) {
    return loadMainEventsVerificationDates(opts.leaf);
  }

  for (const entry of opts.updates) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.date)) {
      throw new Error("Invalid date format. Use YYYY-MM-DD");
    }
  }

  const normalizedLeaf = normalizeTopicValue(opts.leaf);
  const [row] = await db
    .select()
    .from(mainEventsCheckCache)
    .where(eq(mainEventsCheckCache.normalizedLeaf, normalizedLeaf))
    .limit(1);

  if (!row) {
    throw new Error("No main events check saved for this leaf yet — run Prepare all first");
  }

  const current = parseVerificationDates(row.verificationDates);
  const matched = new Set(current.matched);
  const pending = new Set(current.pending);
  const rejected = new Set(current.rejected);

  for (const entry of opts.updates) {
    matched.delete(entry.date);
    pending.delete(entry.date);
    rejected.delete(entry.date);
    if (entry.status === "matched") {
      matched.add(entry.date);
    } else if (entry.status === "rejected") {
      rejected.add(entry.date);
    } else {
      pending.add(entry.date);
    }
  }

  const next: MainEventsVerificationDates = {
    matched: [...matched].sort((a, b) => a.localeCompare(b)),
    pending: [...pending].sort((a, b) => a.localeCompare(b)),
    rejected: [...rejected].sort((a, b) => a.localeCompare(b)),
  };

  await db
    .update(mainEventsCheckCache)
    .set({
      verificationDates: next,
      updatedAt: new Date(),
    })
    .where(eq(mainEventsCheckCache.normalizedLeaf, normalizedLeaf));

  for (const entry of opts.updates) {
    if (verificationStatusRequiresDayLock(entry.status)) {
      await tryLockDay(entry.date);
    }
  }

  return next;
}

export async function loadMainEventsDismissals(leaf: string): Promise<MainEventsDismissals> {
  const normalizedLeaf = normalizeTopicValue(leaf);
  const [row] = await db
    .select({ dismissedDates: mainEventsCheckCache.dismissedDates })
    .from(mainEventsCheckCache)
    .where(eq(mainEventsCheckCache.normalizedLeaf, normalizedLeaf))
    .limit(1);

  if (!row) return { ...EMPTY_MAIN_EVENTS_DISMISSALS };
  return parseDismissals(row.dismissedDates);
}

export async function updateMainEventsDismissal(opts: {
  leaf: string;
  category: MainEventsDismissCategory;
  date: string;
  dismissed: boolean;
}): Promise<MainEventsDismissals> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(opts.date)) {
    throw new Error("Invalid date format. Use YYYY-MM-DD");
  }

  const normalizedLeaf = normalizeTopicValue(opts.leaf);
  const [row] = await db
    .select()
    .from(mainEventsCheckCache)
    .where(eq(mainEventsCheckCache.normalizedLeaf, normalizedLeaf))
    .limit(1);

  if (!row) {
    throw new Error("No main events check saved for this leaf yet — run a check first");
  }

  const dismissals = parseDismissals(row.dismissedDates);
  const current = new Set(dismissals[opts.category]);
  if (opts.dismissed) {
    current.add(opts.date);
  } else {
    current.delete(opts.date);
  }

  const nextDismissals: MainEventsDismissals = {
    ...dismissals,
    [opts.category]: [...current].sort((a, b) => a.localeCompare(b)),
  };

  await db
    .update(mainEventsCheckCache)
    .set({
      dismissedDates: nextDismissals,
      updatedAt: new Date(),
    })
    .where(eq(mainEventsCheckCache.normalizedLeaf, normalizedLeaf));

  return nextDismissals;
}

export function resolveMainEventsGeminiModel(): string {
  return (
    process.env.LEAF_AGENT_GEMINI_MODEL?.trim() ||
    process.env.STORYLINE_GUARDIAN_GEMINI_MODEL?.trim() ||
    "gemini-2.5-flash"
  );
}

function parseStoredCanonicalDates(raw: unknown): ValidCanonicalDate[] {
  if (!Array.isArray(raw)) return [];
  const valid: ValidCanonicalDate[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;
    if (typeof row.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(row.date)) continue;
    if (typeof row.event !== "string" || row.event.length < 3) continue;
    if (row.importance !== "landmark" && row.importance !== "major" && row.importance !== "notable") continue;
    const sourceUrl = readCanonicalSourceUrl(row);
    valid.push({
      date: row.date as ValidCanonicalDate["date"],
      event: row.event,
      importance: row.importance,
      ...(sourceUrl ? { sourceUrl } : {}),
    });
  }
  return valid.sort((a, b) => a.date.localeCompare(b.date));
}

function parseCachedRow(row: typeof mainEventsCheckCache.$inferSelect): CachedMainEventsPayload | null {
  if (row.cacheVersion !== MAIN_EVENTS_CHECK_CACHE_VERSION) return null;

  const canonical = parseStoredCanonicalDates(row.canonicalDates);
  if (canonical.length === 0) return null;

  return {
    notes: row.notes?.trim() || undefined,
    canonical,
    skippedCanonical: Array.isArray(row.skippedCanonical)
      ? (row.skippedCanonical as SkippedCanonicalDate[])
      : [],
    geminiModel: row.geminiModel,
    fetchedAt: row.fetchedAt ?? row.updatedAt,
  };
}

export async function getMainEventsGeminiCacheMeta(leaf: string): Promise<MainEventsGeminiCacheMeta> {
  const normalizedLeaf = normalizeTopicValue(leaf);
  const [row] = await db
    .select()
    .from(mainEventsCheckCache)
    .where(eq(mainEventsCheckCache.normalizedLeaf, normalizedLeaf))
    .limit(1);

  if (!row) {
    return {
      cached: false,
      fetchedAt: null,
      geminiModel: null,
      canonicalCount: 0,
      cacheVersion: null,
    };
  }

  const payload = parseCachedRow(row);
  if (!payload) {
    return {
      cached: false,
      fetchedAt: row.fetchedAt?.toISOString() ?? null,
      geminiModel: row.geminiModel,
      canonicalCount: 0,
      cacheVersion: row.cacheVersion,
    };
  }

  return {
    cached: true,
    fetchedAt: payload.fetchedAt.toISOString(),
    geminiModel: payload.geminiModel,
    canonicalCount: payload.canonical.length,
    cacheVersion: row.cacheVersion,
  };
}

export async function loadCachedMainEvents(leaf: string): Promise<CachedMainEventsPayload | null> {
  const normalizedLeaf = normalizeTopicValue(leaf);
  const [row] = await db
    .select()
    .from(mainEventsCheckCache)
    .where(eq(mainEventsCheckCache.normalizedLeaf, normalizedLeaf))
    .limit(1);

  if (!row) return null;
  return parseCachedRow(row);
}

export type MainEventsCacheEntry = {
  leaf: string;
  payload: CachedMainEventsPayload;
  dismissals: MainEventsDismissals;
  verification: MainEventsVerificationDates;
};

/** All valid cache rows for the current cache version (single query). */
export async function loadAllValidMainEventsCacheEntries(): Promise<Map<string, MainEventsCacheEntry>> {
  const rows = await db.select().from(mainEventsCheckCache);
  const map = new Map<string, MainEventsCacheEntry>();

  for (const row of rows) {
    const payload = parseCachedRow(row);
    if (!payload) continue;
    map.set(row.normalizedLeaf, {
      leaf: row.storylineLeaf,
      payload,
      dismissals: parseDismissals(row.dismissedDates),
      verification: parseVerificationDates(row.verificationDates),
    });
  }

  return map;
}

export async function saveCachedMainEvents(
  leaf: string,
  payload: Omit<CachedMainEventsPayload, "fetchedAt"> & { fetchedAt?: Date },
): Promise<void> {
  const normalizedLeaf = normalizeTopicValue(leaf);
  const fetchedAt = payload.fetchedAt ?? new Date();

  await db
    .insert(mainEventsCheckCache)
    .values({
      storylineLeaf: leaf,
      normalizedLeaf,
      geminiModel: payload.geminiModel,
      cacheVersion: MAIN_EVENTS_CHECK_CACHE_VERSION,
      notes: payload.notes ?? null,
      canonicalDates: payload.canonical,
      skippedCanonical: payload.skippedCanonical,
      verificationDates: { ...EMPTY_MAIN_EVENTS_VERIFICATION_DATES },
      fetchedAt,
      updatedAt: fetchedAt,
    })
    .onConflictDoUpdate({
      target: mainEventsCheckCache.normalizedLeaf,
      set: {
        storylineLeaf: leaf,
        geminiModel: payload.geminiModel,
        cacheVersion: MAIN_EVENTS_CHECK_CACHE_VERSION,
        notes: payload.notes ?? null,
        canonicalDates: payload.canonical,
        skippedCanonical: payload.skippedCanonical,
        verificationDates: { ...EMPTY_MAIN_EVENTS_VERIFICATION_DATES },
        fetchedAt,
        updatedAt: fetchedAt,
      },
    });
}
