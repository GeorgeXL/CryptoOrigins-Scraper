/**
 * Bulk-approve pending awaiting_summary_approval review items (post article-pick).
 * Usage: npx tsx server/scripts/approve-pending-summary-approvals.ts [--dry-run]
 */
import { TOPIC_HIERARCHY_LEAVES } from "../../shared/topic-hierarchy";

const BASE = process.env.APPROVE_BASE_URL ?? "http://localhost:3000";
const dryRun = process.argv.includes("--dry-run");
const VALID_LEAVES = new Set<string>(TOPIC_HIERARCHY_LEAVES);

type ReviewItem = {
  id: string;
  eventDate: string;
  summaryApproval?: {
    generatedSummary?: string;
    proposedTags?: string[];
    proposedTopics?: string[];
  } | null;
};

function inferTopicFromSummary(summary: string): string {
  const s = summary.toLowerCase();
  if (/\b(bitcoin|btc\b|satoshi|halving|mining pool)\b/.test(s)) {
    if (/\b(mine|mining|hash|halving)\b/.test(s)) return "Bitcoin mining";
    if (/\b(price|trading|rally|crash|\$[\d,]+)\b/.test(s)) return "Bitcoin price & cycles";
    return "Early Bitcoin history";
  }
  if (/\b(crypto|blockchain|ethereum|defi|nft|stablecoin|web3|grayscale|etf)\b/.test(s)) {
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
  if (/\b(bank failure|bank run|stress test|lehman|banking crisis|fdic|indymac)\b/.test(s)) {
    return "Banking stress";
  }
  if (/\b(inflation|cpi|consumer prices|deflation)\b/.test(s)) return "Inflation";
  if (/\b(debt default|sovereign debt|bond yield|debt crisis)\b/.test(s)) return "Debt crises";
  if (/\b(lawsuit|settle|charges|court|sec enforcement|indictment|fraud trial|supreme court)\b/.test(s)) {
    return "Legal cases";
  }
  if (/\b(housing|mortgage|foreclosure|home prices)\b/.test(s)) return "Housing";
  if (/\b(recession|gdp|trade deficit|unemployment|jobs report|economic growth|imf)\b/.test(s)) {
    return "Global growth and recession";
  }
  return "Global growth and recession";
}

async function fetchPending(): Promise<ReviewItem[]> {
  const all: ReviewItem[] = [];
  for (let offset = 0; ; offset += 100) {
    const res = await fetch(
      `${BASE}/api/agent/pipeline/review?status=pending&phase=awaiting_summary_approval&limit=100&offset=${offset}`,
    );
    if (!res.ok) throw new Error(await res.text());
    const data = (await res.json()) as { items?: ReviewItem[]; total?: number };
    all.push(...(data.items ?? []));
    if ((data.items ?? []).length < 100) break;
    if (typeof data.total === "number" && all.length >= data.total) break;
  }
  return all;
}

async function approveItem(id: string, body: Record<string, unknown>) {
  const res = await fetch(`${BASE}/api/agent/pipeline/review/${id}/approve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reviewer: "bulk-summary-approval-script", ...body }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(text || `HTTP ${res.status}`);
  return text ? JSON.parse(text) : null;
}

async function main() {
  const items = await fetchPending();
  console.log(`Found ${items.length} summary approval item(s)${dryRun ? " (dry run)" : ""}.`);

  let approved = 0;
  const failures: Array<{ date: string; error: string }> = [];

  for (const item of items.sort((a, b) => a.eventDate.localeCompare(b.eventDate))) {
    const payload = item.summaryApproval;
    const summary = payload?.generatedSummary?.trim() ?? "";
    const len = summary.length;
    if (!summary || len < 100 || len > 110) {
      failures.push({ date: item.eventDate, error: `Summary length ${len} outside 100–110` });
      continue;
    }

    let topics = (payload?.proposedTopics ?? []).filter((t) => VALID_LEAVES.has(t)).slice(0, 1);
    if (!topics.length) topics = [inferTopicFromSummary(summary)];

    const body = {
      editedSummary: summary,
      editedTags: payload?.proposedTags ?? [],
      editedTopics: topics,
    };

    if (dryRun) {
      console.log(`[dry-run] ${item.eventDate} (${len} chars) topic=${topics[0]}`);
      approved += 1;
      continue;
    }

    try {
      const result = await approveItem(item.id, body);
      approved += 1;
      console.log(`✓ ${item.eventDate} → ${topics[0]} (${(result?.execution?.message ?? "ok").slice(0, 80)})`);
    } catch (error) {
      failures.push({
        date: item.eventDate,
        error: error instanceof Error ? error.message : String(error),
      });
      console.error(`✗ ${item.eventDate}: ${failures[failures.length - 1]!.error.slice(0, 120)}`);
    }
  }

  const remaining = (await fetchPending()).length;
  console.log("\n---");
  console.log(`Approved: ${approved}`);
  console.log(`Failed: ${failures.length}`);
  console.log(`Remaining: ${remaining}`);
  if (failures.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
