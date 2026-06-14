import type { CorrectionProposal } from "../../client/src/lib/editorial-pipeline";

export const APPROVE_BASE_URL = process.env.APPROVE_BASE_URL ?? "http://localhost:3000";

export type ReviewItem = {
  id: string;
  eventDate: string;
  package: {
    phase?: string;
    proposals?: CorrectionProposal[];
  };
};

export function reviewApiHeaders(): Record<string, string> {
  const secret = process.env.ADMIN_AGENT_SECRET?.trim();
  const headers: Record<string, string> = {};
  if (secret) headers["X-Admin-Agent-Secret"] = secret;
  return headers;
}

export async function fetchPendingCorrections(): Promise<ReviewItem[]> {
  const all: ReviewItem[] = [];
  const pageSize = 100;
  for (let offset = 0; ; offset += pageSize) {
    const res = await fetch(
      `${APPROVE_BASE_URL}/api/agent/pipeline/review?status=pending&phase=awaiting_correction_approval&limit=${pageSize}&offset=${offset}`,
      { headers: reviewApiHeaders() },
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

export async function fetchDaySummary(date: string): Promise<{ summary: string; tags: string[] }> {
  const res = await fetch(`${APPROVE_BASE_URL}/api/analysis/date/${encodeURIComponent(date)}`);
  if (!res.ok) return { summary: "", tags: [] };
  const data = (await res.json()) as {
    analysis?: { summary?: string; tagsVersion2?: string[]; articleTags?: string[] };
  };
  return {
    summary: data.analysis?.summary?.trim() ?? "",
    tags: data.analysis?.tagsVersion2 ?? data.analysis?.articleTags ?? [],
  };
}

export function inferTopicFromSummary(summary: string): string | null {
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
    return "Smart contracts & L1s";
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
