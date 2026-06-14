/**
 * Bulk-approve pending awaiting_correction_approval review items using agent defaults.
 * Usage: npx tsx server/scripts/approve-pending-corrections.ts [--dry-run]
 */
import {
  buildCorrectionApprovePayload,
  summarizeCorrectionProposals,
} from "../../client/src/lib/correction-proposal-view";
import type { CorrectionProposal } from "../../client/src/lib/editorial-pipeline";
import { rankTopicCandidatesFromSummary } from "../services/editorial-pipeline/storyline-taxonomy";

const BASE = process.env.APPROVE_BASE_URL ?? "http://localhost:3000";
const dryRun = process.argv.includes("--dry-run");
const loopUntilEmpty = !process.argv.includes("--once");

type ReviewItem = {
  id: string;
  eventDate: string;
  package: {
    phase?: string;
    proposals?: CorrectionProposal[];
  };
};

async function fetchPendingCorrections(): Promise<ReviewItem[]> {
  const all: ReviewItem[] = [];
  const pageSize = 100;
  for (let offset = 0; ; offset += pageSize) {
    const res = await fetch(
      `${BASE}/api/agent/pipeline/review?status=pending&phase=awaiting_correction_approval&limit=${pageSize}&offset=${offset}`,
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

async function fetchDaySummary(date: string): Promise<{ summary: string; tags: string[] }> {
  const res = await fetch(`${BASE}/api/analysis/date/${encodeURIComponent(date)}`);
  if (!res.ok) return { summary: "", tags: [] };
  const data = (await res.json()) as {
    analysis?: { summary?: string; tagsVersion2?: string[]; articleTags?: string[] };
  };
  return {
    summary: data.analysis?.summary?.trim() ?? "",
    tags: data.analysis?.tagsVersion2 ?? data.analysis?.articleTags ?? [],
  };
}

function inferTopicFromSummary(summary: string): string | null {
  const s = summary.toLowerCase();
  if (/\b(bitcoin|btc\b|satoshi|halving|mining pool|lightning network)\b/.test(s)) {
    if (/\b(mine|mining|hash|halving)\b/.test(s)) return "Bitcoin mining";
    if (/\b(price|trading|rally|crash|\$[\d,]+)\b/.test(s)) return "Bitcoin price & cycles";
    return "Early Bitcoin history";
  }
  if (/\b(crypto|blockchain|ethereum|defi|nft|stablecoin|web3)\b/.test(s)) {
    if (/\b(defi|yield|liquidity pool|dex)\b/.test(s)) return "DeFi";
    if (/\b(stablecoin|usdt|usdc|tether)\b/.test(s)) return "Stablecoins";
    if (/\b(nft|gaming token)\b/.test(s)) return "NFTs and gaming";
    return "Smart-contracts L1s";
  }
  if (/\b(election|obama|biden|congress|senate|pelosi|campaign|presidential|white house)\b/.test(s)) {
    return "Politics and elections";
  }
  if (/\b(bailout|stimulus|tarp|fed aid|federal aid|government rescue)\b/.test(s)) {
    return "Bailouts and stimulus";
  }
  if (/\b(federal reserve|\bfed\b|interest rate|monetary policy|reserve currency|\bsdr\b)\b/.test(s)) {
    return "Monetary policy & rates";
  }
  if (/\b(bank failure|bank run|stress test|lehman|banking crisis|prudential)\b/.test(s)) {
    return "Banking stress";
  }
  if (/\b(inflation|cpi|consumer prices|deflation)\b/.test(s)) return "Inflation";
  if (/\b(debt default|sovereign debt|bond yield|debt crisis)\b/.test(s)) return "Debt crises";
  if (/\b(lawsuit|settle|charges|court|sec enforcement|indictment|fraud trial)\b/.test(s)) {
    return "Legal cases";
  }
  if (/\b(housing|mortgage|foreclosure|home prices)\b/.test(s)) return "Housing";
  if (/\b(recession|gdp|trade deficit|unemployment|jobs report|economic growth)\b/.test(s)) {
    return "Global growth and recession";
  }
  if (/\b(merger|acquisition|takeover bid|investor returns|wall street|trade deficit|imports)\b/.test(s)) {
    return "Global growth and recession";
  }
  return "Global growth and recession";
}

async function resolveTopicSelection(
  date: string,
  proposals: CorrectionProposal[],
  changeSummary: ReturnType<typeof summarizeCorrectionProposals>,
): Promise<string | null> {
  if (changeSummary.topicProposalDefault) return changeSummary.topicProposalDefault;
  if (changeSummary.topicOptions[0]) return changeSummary.topicOptions[0];
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

async function approveItem(id: string, body: Record<string, unknown>) {
  const res = await fetch(`${BASE}/api/agent/pipeline/review/${id}/approve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reviewer: "bulk-correction-script", ...body }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(text || `HTTP ${res.status}`);
  return text ? JSON.parse(text) : null;
}

async function processBatch(): Promise<{ approved: number; skipped: number; failed: number; remaining: number }> {
  const items = await fetchPendingCorrections();
  console.log(`Found ${items.length} pending correction item(s)${dryRun ? " (dry run)" : ""}.`);

  let approved = 0;
  let skipped = 0;
  const failures: Array<{ date: string; id: string; error: string }> = [];
  const skippedItems: Array<{ date: string; id: string; reason: string }> = [];

  for (const item of items.sort((a, b) => a.eventDate.localeCompare(b.eventDate))) {
    const proposals = item.package.proposals ?? [];
    const { summary, topicSelection, payload } = await buildDefaultApproveOpts(item.eventDate, proposals);

    if (summary.topicProposalId && !payload.proposalTopicSelections[summary.topicProposalId]?.length) {
      skipped += 1;
      skippedItems.push({
        date: item.eventDate,
        id: item.id,
        reason: summary.topicOptions.length > 1
          ? `Ambiguous topic (${summary.topicOptions.join(" | ")}) — needs manual pick`
          : topicSelection
            ? "Topic selection failed validation"
            : "Could not infer storyline leaf from summary",
      });
      continue;
    }

    if (!payload.acceptedProposalIds.length && proposals.length === 0) {
      if (dryRun) {
        console.log(`[dry-run] ${item.eventDate} → approve manual correction (no proposals)`);
        approved += 1;
        continue;
      }
      try {
        await approveItem(item.id, {});
        approved += 1;
        console.log(`✓ ${item.eventDate} (manual correction, no proposals)`);
      } catch (error) {
        failures.push({
          date: item.eventDate,
          id: item.id,
          error: error instanceof Error ? error.message : String(error),
        });
        console.error(`✗ ${item.eventDate}: ${failures[failures.length - 1]!.error.slice(0, 120)}`);
      }
      continue;
    }

    if (dryRun) {
      console.log(
        `[dry-run] ${item.eventDate} → accept ${payload.acceptedProposalIds.length} proposal(s)` +
          (topicSelection ? ` topic=${topicSelection}` : ""),
      );
      approved += 1;
      continue;
    }

    try {
      await approveItem(item.id, payload);
      approved += 1;
      console.log(
        `✓ ${item.eventDate} (${payload.acceptedProposalIds.join(", ") || "manual"}` +
          `${topicSelection ? ` → ${topicSelection}` : ""})`,
      );
    } catch (error) {
      failures.push({
        date: item.eventDate,
        id: item.id,
        error: error instanceof Error ? error.message : String(error),
      });
      console.error(`✗ ${item.eventDate}: ${failures[failures.length - 1]!.error.slice(0, 120)}`);
    }
  }

  const remaining = (await fetchPendingCorrections()).length;
  console.log("\n---");
  console.log(`Approved: ${approved}`);
  console.log(`Skipped: ${skipped}`);
  console.log(`Failed: ${failures.length}`);
  console.log(`Remaining corrections: ${remaining}`);
  if (skippedItems.length) {
    console.log("\nSkipped items:");
    for (const s of skippedItems) console.log(`  ${s.date}: ${s.reason}`);
  }
  if (failures.length) {
    console.log("\nFailures:");
    for (const f of failures) console.log(`  ${f.date}: ${f.error.slice(0, 200)}`);
  }

  return { approved, skipped, failed: failures.length, remaining };
}

async function main() {
  let pass = 0;
  do {
    pass += 1;
    if (loopUntilEmpty && pass > 1) console.log(`\n=== pass ${pass} ===`);
    const result = await processBatch();
    if (dryRun || !loopUntilEmpty || result.remaining === 0 || (result.approved === 0 && result.failed === 0)) {
      if (result.failed > 0) process.exitCode = 1;
      break;
    }
  } while (pass < 50);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
