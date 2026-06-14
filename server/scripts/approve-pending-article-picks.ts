/**
 * Bulk-approve pending awaiting_article_pick review items.
 * Usage: npx tsx server/scripts/approve-pending-article-picks.ts [--dry-run]
 */
import type { ArticleCandidate } from "../../client/src/lib/editorial-pipeline";

const BASE = process.env.APPROVE_BASE_URL ?? "http://localhost:3000";
const dryRun = process.argv.includes("--dry-run");

type ReviewItem = {
  id: string;
  eventDate: string;
  createdAt?: string;
  package: {
    phase?: string;
    candidates?: ArticleCandidate[];
    scenario?: string;
  };
};

const GARBAGE_RE =
  /\b(memorial day|best buy|spaghetti squash|caramel pie|blizzcon|icecrown|inbreeding|pedigree size|statue of liberty|eve online|embezzles virtual|stiction|eid cover|print page|leveldb reliability|wormholes|guerilla style|slayer becomes|runs previous command|financial news2|where to find memorial)\b/i;

const STRONG_EVENT_RE =
  /\b(bitcoin|btc\b|satoshi|blockchain|crypto|ethereum|defi|grayscale|sec opts|etf|halving|mining|stablecoin|treasury|federal reserve|inflation|gdp|trade deficit|bailout|stimulus|imf|fed\b|congress|senate|election|regulation|enforcement|lawsuit|settlement|protocol upgrade|taproot|segwit|exchange|binance|coinbase|microstrategy|soros|price briefly|price drops|annual report)\b/i;

const TIER_RANK: Record<string, number> = { bitcoin: 3, crypto: 2, macro: 1 };

function candidateText(candidate: ArticleCandidate): string {
  return `${candidate.title}\n${candidate.summary ?? ""}`.toLowerCase();
}

function scoreCandidate(candidate: ArticleCandidate): number {
  const text = candidateText(candidate);
  let score = candidate.relevanceScore ?? 0;
  score += (TIER_RANK[candidate.tier] ?? 0) * 0.05;
  if (candidate.recommended) score += 0.05;
  if (candidate.calendarSanityOk === false) score -= 2;
  if (GARBAGE_RE.test(text)) score -= 1.25;
  if (STRONG_EVENT_RE.test(text)) score += 0.45;
  if (/\b(roundup|weekly|what happened this week|wtf has happened)\b/.test(text) && !STRONG_EVENT_RE.test(text)) {
    score -= 0.35;
  }
  return score;
}

function pickCandidate(candidates: ArticleCandidate[]): {
  candidate: ArticleCandidate;
  forceOverride: boolean;
} | null {
  if (!candidates.length) return null;
  const ranked = [...candidates].sort((a, b) => scoreCandidate(b) - scoreCandidate(a));
  const bestSane = ranked.find((c) => c.calendarSanityOk !== false);
  if (bestSane) return { candidate: bestSane, forceOverride: false };
  const best = ranked[0];
  return best ? { candidate: best, forceOverride: true } : null;
}

async function fetchPendingArticlePicks(): Promise<ReviewItem[]> {
  const all: ReviewItem[] = [];
  const pageSize = 100;
  for (let offset = 0; ; offset += pageSize) {
    const res = await fetch(
      `${BASE}/api/agent/pipeline/review?status=pending&phase=awaiting_article_pick&limit=${pageSize}&offset=${offset}`,
    );
    if (!res.ok) throw new Error(`Failed to load queue: ${res.status} ${await res.text()}`);
    const data = (await res.json()) as { items?: ReviewItem[]; total?: number };
    const page = data.items ?? [];
    all.push(...page);
    if (page.length < pageSize) break;
    if (typeof data.total === "number" && all.length >= data.total) break;
  }
  return all;
}

function dedupeByDate(items: ReviewItem[]): { primary: ReviewItem[]; duplicates: ReviewItem[] } {
  const byDate = new Map<string, ReviewItem[]>();
  for (const item of items) {
    const list = byDate.get(item.eventDate) ?? [];
    list.push(item);
    byDate.set(item.eventDate, list);
  }
  const primary: ReviewItem[] = [];
  const duplicates: ReviewItem[] = [];
  for (const group of byDate.values()) {
    const sorted = [...group].sort((a, b) => {
      const aTime = a.createdAt ? Date.parse(a.createdAt) : 0;
      const bTime = b.createdAt ? Date.parse(b.createdAt) : 0;
      return aTime - bTime;
    });
    primary.push(sorted[0]!);
    duplicates.push(...sorted.slice(1));
  }
  return { primary, duplicates };
}

async function approveItem(id: string, body: Record<string, unknown>) {
  const res = await fetch(`${BASE}/api/agent/pipeline/review/${id}/approve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reviewer: "bulk-article-pick-script", ...body }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(text || `HTTP ${res.status}`);
  return text ? JSON.parse(text) : null;
}

async function deleteItem(id: string) {
  const res = await fetch(`${BASE}/api/agent/pipeline/review/${id}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok) throw new Error(await res.text());
}

async function main() {
  const items = await fetchPendingArticlePicks();
  const { primary, duplicates } = dedupeByDate(items);
  console.log(
    `Found ${items.length} article-pick item(s) across ${primary.length} date(s)` +
      `${duplicates.length ? ` (${duplicates.length} duplicate queue row(s))` : ""}` +
      `${dryRun ? " (dry run)" : ""}.`,
  );

  let approved = 0;
  let deleted = 0;
  const failures: Array<{ date: string; id: string; error: string }> = [];

  for (const item of primary.sort((a, b) => a.eventDate.localeCompare(b.eventDate))) {
    const candidates = item.package.candidates ?? [];
    const pick = pickCandidate(candidates);
    if (!pick) {
      failures.push({ date: item.eventDate, id: item.id, error: "No candidates in package" });
      continue;
    }

    const body: Record<string, unknown> = {
      selectedArticleId: pick.candidate.id,
    };
    if (pick.forceOverride) {
      body.forceLowQualityPick = true;
      body.overrideReason = "bulk-article-pick: no calendar-sane candidate; chose best-scored stored article";
    }

    if (dryRun) {
      console.log(
        `[dry-run] ${item.eventDate} → "${pick.candidate.title.slice(0, 60)}"` +
          `${pick.forceOverride ? " (override)" : ""} score=${scoreCandidate(pick.candidate).toFixed(2)}`,
      );
      approved += 1;
      continue;
    }

    try {
      const result = await approveItem(item.id, body);
      approved += 1;
      const msg = result?.execution?.message ?? "approved";
      console.log(`✓ ${item.eventDate} → ${pick.candidate.title.slice(0, 55)} (${msg.slice(0, 80)})`);
    } catch (error) {
      failures.push({
        date: item.eventDate,
        id: item.id,
        error: error instanceof Error ? error.message : String(error),
      });
      console.error(`✗ ${item.eventDate}: ${failures[failures.length - 1]!.error.slice(0, 140)}`);
    }
  }

  for (const dup of duplicates) {
    if (dryRun) {
      console.log(`[dry-run] delete duplicate queue row ${dup.eventDate} ${dup.id.slice(0, 8)}`);
      deleted += 1;
      continue;
    }
    try {
      await deleteItem(dup.id);
      deleted += 1;
      console.log(`🗑 duplicate removed ${dup.eventDate} ${dup.id.slice(0, 8)}`);
    } catch (error) {
      failures.push({
        date: dup.eventDate,
        id: dup.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const remaining = (await fetchPendingArticlePicks()).length;
  console.log("\n---");
  console.log(`Approved: ${approved}`);
  console.log(`Duplicates removed: ${deleted}`);
  console.log(`Failed: ${failures.length}`);
  console.log(`Remaining article picks: ${remaining}`);
  if (failures.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
