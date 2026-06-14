/**
 * Careful pass on awaiting_correction_approval queue:
 * - Reject off-topic junk (recipes, wellness, games, etc.)
 * - Deduplicate multiple pending rows for the same date
 * - Approve relevant rows with inferred topic when unambiguous
 *
 * Usage:
 *   npx tsx server/scripts/review-pending-corrections-careful.ts [--dry-run]
 */
import "dotenv/config";

import {
  buildCorrectionApprovePayload,
  summarizeCorrectionProposals,
} from "../../client/src/lib/correction-proposal-view";
import type { CorrectionProposal } from "../../client/src/lib/editorial-pipeline";
import { rankTopicCandidatesFromSummary } from "../services/editorial-pipeline/storyline-taxonomy";
import {
  APPROVE_BASE_URL,
  fetchDaySummary,
  fetchPendingCorrections,
  inferTopicFromSummary,
  reviewApiHeaders,
  type ReviewItem,
} from "./approve-pending-corrections-shared";

const dryRun = process.argv.includes("--dry-run");

function apiHeaders(): Record<string, string> {
  return { "Content-Type": "application/json", ...reviewApiHeaders() };
}

/** Calendar junk — not crypto/macro news worth a storyline assignment. */
export function isOffTopicSummary(summary: string): { offTopic: boolean; reason: string } {
  const s = summary.toLowerCase().trim();
  if (!s) return { offTopic: false, reason: "" };

  const rules: Array<{ reason: string; test: RegExp }> = [
    { reason: "recipe / cooking / wellness", test: /\b(recipe|recipes|cookbook|eat well|live well|wellness|diet tip|meal plan|kitchen|baking|chef|spaghetti squash|off the wheaten path)\b/i },
    { reason: "magic the gathering / collectible card game", test: /\b(magic: the gathering|mirrodin|mtg\b|trading card game|pokemon card|yugioh|dot-bit on namecoin)\b/i },
    { reason: "religious festival / observance only", test: /\b(easter sunday|good friday|ramadan|diwali|hanukkah|christmas mass|church service|san juan festival|saint john the baptist)\b/i },
    { reason: "mine rescue / disaster human interest", test: /\b(chilean miners|rescue capsule|trapped miners)\b/i },
    { reason: "economist / academic profile only", test: /\b(repec\/ideas|ideas profiles|listing research, affiliations)\b/i },
    { reason: "celebrity gossip / lifestyle", test: /\b(celebrity gossip|red carpet|fashion week|beauty tips|weight loss tip)\b/i },
    { reason: "sports score / game recap (non-market)", test: /\b(super bowl score|world cup final score|nba finals game \d|touchdown|home run)\b/i },
    { reason: "horoscope / astrology", test: /\b(horoscope|zodiac sign|astrology)\b/i },
    { reason: "coin collecting (physical coins, not crypto)", test: /\b(rare coin collection|numismatic|commemorative coin set|stamp collection|chain cent sells|gold eagles gain collector|eliasberg)\b/i },
    { reason: "generic obituary / profile (no market link)", test: /\b(obituary:|in memoriam|rest in peace)\b/i },
    { reason: "tech blog index / directory (not news)", test: /\b(technophilia launches as a tech blog index|blog index, organizing popular posts)\b/i },
  ];

  for (const { reason, test } of rules) {
    if (test.test(s)) return { offTopic: true, reason };
  }

  // Strong crypto/macro signals → keep
  if (/\b(bitcoin|btc\b|crypto|blockchain|ethereum|defi|sec\b|fed\b|inflation|recession|bank|etf|stablecoin|satoshi|halving|mining)\b/.test(s)) {
    return { offTopic: false, reason: "" };
  }

  // Weak macro-ish but no crypto — still allow if clearly financial news
  if (/\b(stock market|wall street|merger|gdp|unemployment|housing|mortgage|lawsuit|court|election|congress)\b/.test(s)) {
    return { offTopic: false, reason: "" };
  }

  return { offTopic: false, reason: "" };
}

async function rejectItem(id: string, notes: string) {
  const res = await fetch(`${APPROVE_BASE_URL}/api/agent/pipeline/review/${id}/reject`, {
    method: "POST",
    headers: apiHeaders(),
    body: JSON.stringify({ reviewer: "careful-review-script", notes }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(text || `HTTP ${res.status}`);
  return text ? JSON.parse(text) : null;
}

async function approveItem(id: string, body: Record<string, unknown>) {
  const res = await fetch(`${APPROVE_BASE_URL}/api/agent/pipeline/review/${id}/approve`, {
    method: "POST",
    headers: apiHeaders(),
    body: JSON.stringify({ reviewer: "careful-review-script", ...body }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(text || `HTTP ${res.status}`);
  return text ? JSON.parse(text) : null;
}

async function resolveTopicSelection(
  date: string,
  proposals: CorrectionProposal[],
  changeSummary: ReturnType<typeof summarizeCorrectionProposals>,
): Promise<string | null> {
  if (changeSummary.topicProposalDefault) return changeSummary.topicProposalDefault;
  if (changeSummary.topicOptions.length === 1) return changeSummary.topicOptions[0] ?? null;
  if (changeSummary.topicOptions.length > 1) return null;
  if (!changeSummary.topicProposalId) return null;

  const { summary, tags } = await fetchDaySummary(date);
  if (!summary) return null;
  const ranking = rankTopicCandidatesFromSummary({ summary, tags });
  return ranking.primary ?? ranking.candidates[0]?.leaf ?? inferTopicFromSummary(summary);
}

async function buildDefaultApproveOpts(date: string, proposals: CorrectionProposal[]) {
  const summary = summarizeCorrectionProposals(proposals);
  const selectedAdds = new Set(summary.tagsToAdd);
  const selectedRemoves = new Set(summary.tagsToRemove);
  const selectedMisc = new Set(summary.misc.map((m) => m.id));
  const topicSelection = (await resolveTopicSelection(date, proposals, summary)) ?? "";
  const includeTopic = Boolean(summary.topicProposalId && topicSelection);
  const includeSummaryEdit = Boolean(summary.summaryEdit);

  return {
    summary,
    topicSelection,
    payload: buildCorrectionApprovePayload({
      proposals,
      summary,
      selectedAdds,
      selectedRemoves,
      includeTopic,
      topicSelection,
      selectedMisc,
      includeSummaryEdit,
      editedSummary: summary.summaryEdit?.currentSummary,
      summaryAction: "patch" as const,
    }),
  };
}

function dedupeByDate(items: ReviewItem[]): { keep: ReviewItem[]; duplicateRejects: ReviewItem[] } {
  const byDate = new Map<string, ReviewItem[]>();
  for (const item of items) {
    const list = byDate.get(item.eventDate) ?? [];
    list.push(item);
    byDate.set(item.eventDate, list);
  }
  const keep: ReviewItem[] = [];
  const duplicateRejects: ReviewItem[] = [];
  for (const [, group] of byDate) {
    const sorted = [...group].sort((a, b) => a.id.localeCompare(b.id));
    keep.push(sorted[sorted.length - 1]!);
    duplicateRejects.push(...sorted.slice(0, -1));
  }
  return { keep, duplicateRejects };
}

async function main() {
  const items = await fetchPendingCorrections();
  console.log(`Pending correction approvals: ${items.length}${dryRun ? " (dry run)" : ""}`);

  const { keep, duplicateRejects } = dedupeByDate(items);
  let rejected = 0;
  let approved = 0;
  let skipped = 0;
  const failures: string[] = [];

  for (const dup of duplicateRejects) {
    const note = "Duplicate pending item for same date — keeping newest queue row";
    if (dryRun) {
      console.log(`[dry-run] REJECT dup ${dup.eventDate} ${dup.id.slice(0, 8)}`);
      rejected += 1;
      continue;
    }
    try {
      await rejectItem(dup.id, note);
      rejected += 1;
      console.log(`✗ dup ${dup.eventDate} rejected`);
    } catch (error) {
      failures.push(`${dup.eventDate} dup: ${error instanceof Error ? error.message : error}`);
    }
  }

  for (const item of keep.sort((a, b) => a.eventDate.localeCompare(b.eventDate))) {
    const { summary: daySummary } = await fetchDaySummary(item.eventDate);
    const offTopic = isOffTopicSummary(daySummary);
    if (offTopic.offTopic) {
      const note = `Off-topic for calendar: ${offTopic.reason}`;
      if (dryRun) {
        console.log(`[dry-run] REJECT ${item.eventDate} — ${note}`);
        console.log(`          ${daySummary.slice(0, 90)}${daySummary.length > 90 ? "…" : ""}`);
        rejected += 1;
        continue;
      }
      try {
        await rejectItem(item.id, note);
        rejected += 1;
        console.log(`✗ ${item.eventDate} rejected (${offTopic.reason})`);
      } catch (error) {
        failures.push(`${item.eventDate} reject: ${error instanceof Error ? error.message : error}`);
      }
      continue;
    }

    const proposals = item.package.proposals ?? [];
    const { summary, topicSelection, payload } = await buildDefaultApproveOpts(item.eventDate, proposals);

    if (summary.topicProposalId && !payload.proposalTopicSelections[summary.topicProposalId]?.length) {
      skipped += 1;
      console.log(`? ${item.eventDate} skipped — ambiguous topic (${summary.topicOptions.join(" | ") || "none"})`);
      continue;
    }

    if (dryRun) {
      console.log(
        `[dry-run] APPROVE ${item.eventDate}` +
          (topicSelection ? ` → ${topicSelection}` : "") +
          ` · ${daySummary.slice(0, 70)}${daySummary.length > 70 ? "…" : ""}`,
      );
      approved += 1;
      continue;
    }

    try {
      await approveItem(item.id, payload.acceptedProposalIds.length ? payload : {});
      approved += 1;
      console.log(`✓ ${item.eventDate}${topicSelection ? ` → ${topicSelection}` : ""}`);
    } catch (error) {
      failures.push(`${item.eventDate} approve: ${error instanceof Error ? error.message : error}`);
      console.error(`✗ ${item.eventDate}: ${(error instanceof Error ? error.message : error).slice(0, 120)}`);
    }
  }

  const remaining = (await fetchPendingCorrections()).length;
  console.log(`\nApproved: ${approved} · Rejected: ${rejected} · Skipped (manual): ${skipped} · Failed: ${failures.length}`);
  console.log(`Remaining: ${remaining}`);
  if (failures.length) {
    for (const f of failures) console.log(`  ${f.slice(0, 200)}`);
    process.exitCode = 1;
  }
}

const isDirectRun = process.argv[1]?.includes("review-pending-corrections-careful");
if (isDirectRun) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
