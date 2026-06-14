/**
 * Assign storyline leaves to no-topic rows (summary present, empty topic_categories).
 * Junk/off-topic summaries stay cleared; valid crypto/macro news get the best matching leaf.
 *
 * Usage:
 *   npx tsx server/scripts/assign-no-topic-rows.ts --list
 *   npx tsx server/scripts/assign-no-topic-rows.ts --dry-run
 *   npx tsx server/scripts/assign-no-topic-rows.ts --apply
 *   npx tsx server/scripts/assign-no-topic-rows.ts --dry-run --offset 0 --limit 50
 */

import "dotenv/config";

import { eq } from "drizzle-orm";

import { historicalNewsAnalyses } from "@shared/schema";
import {
  CANONICAL_BITCOIN_HALVING_DATE_SET,
  HALVING_EVENTS_LEAF,
} from "@shared/halving-events-policy";
import { TOPIC_HIERARCHY_LEAVES, topicGroupForLeaf } from "@shared/topic-hierarchy";
import { evaluateStorylineFitHeuristic } from "@shared/storyline-fit-heuristics";
import {
  isStorylineTopicEligible,
  storylineTopicBlockReason,
  type GoogleCheckHappened,
} from "@shared/storyline-topic-eligibility";
import { db } from "../db";
import { queryNoTopicRows } from "./perplexity-cleanup-shared";
import { isOffTopicSummary } from "./review-pending-corrections-careful";
import {
  rankTopicCandidatesFromSummary,
  type TopicRankingResult,
} from "../services/editorial-pipeline/storyline-taxonomy";
import { syncStorylineAssignmentsForDate } from "../services/editorial-pipeline/storyline-taxonomy";
import { storage } from "../storage";

const VALID_LEAVES = new Set<string>(TOPIC_HIERARCHY_LEAVES);

const CRYPTO_CONTEXT =
  /\b(bitcoin|btc|crypto(currency)?|blockchain|ethereum|defi|nft|web3|stablecoin|altcoin|binance|coinbase|satoshi|halving|mining pool|lightning network|mt\.?\s?gox|silk road|uniswap|tether|ftx|digital asset|bitcoind|ripple labs|cbdc|silkroad)\b/i;

const MACRO_FIN_SIGNAL =
  /\b(fed\b|federal reserve|inflation|cpi\b|gdp|unemployment|recession|treasury|bailout|stimulus|interest rate|central bank|ecb\b|imf\b|deficit|debt ceiling|housing|mortgage|wall street|stock market|bank of america|goldman sachs|jpmorgan|earnings|ipo\b|merger|lawsuit|court|election|congress|senate|president|obama|trump|supreme court|bank stress|banking crisis|monetary policy|fiscal|austerity|bond yield|credit rating|downgrade|sec\b|cftc|derivatives|financial reform)\b/i;

/** Extra junk beyond review-pending-corrections-careful.ts */
const EXTRA_JUNK_PATTERNS: Array<{ reason: string; test: RegExp }> = [
  { reason: "tunnel / infrastructure", test: /\b(hotthard|gotthard base tunnel|base tunnel)\b/i },
  { reason: "academic profile", test: /\b(repec\/ideas|ideas\.repec|author profile|working paper series)\b/i },
  { reason: "shell company filing", test: /\b(remains a nevada shell company|nevada shell)\b/i },
  { reason: "insurance-linked securities", test: /\b(insurance-linked securities|cat bond issuance)\b/i },
  { reason: "pirate bay twitter hub", test: /\b(pirate bay founders turn trial coverage)\b/i },
  { reason: "scientology opening", test: /\b(church of scientology)\b/i },
  { reason: "swine flu / health scare", test: /\b(swine flu cases)\b/i },
  { reason: "pharma waste", test: /\b(drugmakers release massive pharma waste)\b/i },
  { reason: "nature sanctuary donation", test: /\b(donates petty island)\b/i },
  { reason: "may day protests", test: /\b(may day protests turn violent)\b/i },
  { reason: "climate study only", test: /\b(study warns warming could nearly double)\b/i },
  { reason: "celebrity / white house liaison", test: /\b(kal penn joins the white house|jon stewart's takedown of jim cramer)\b/i },
  { reason: "farm harvest / agriculture", test: /\b(farms suffer harsh harvest|rye yields)\b/i },
];

const MACRO_LEAF_ORDER = [
  "Bailouts and stimulus",
  "Banking stress",
  "Debt crises",
  "Inflation",
  "Monetary policy & rates",
  "Labor market",
  "Housing",
  "Global growth and recession",
  "Politics and elections",
  "Securities regulation",
  "Tax policy",
  "Legal cases",
  "Enforcement & crime",
  "Sanctions and enforcement",
] as const;

export type NoTopicResolution = {
  action: "assign" | "clear" | "skip";
  target: string | null;
  reason: string;
};

function parseArgs() {
  const args = process.argv.slice(2);
  let list = false;
  let dryRun = true;
  let offset = 0;
  let limit: number | null = null;

  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--list") list = true;
    else if (args[i] === "--apply") dryRun = false;
    else if (args[i] === "--dry-run") dryRun = true;
    else if (args[i] === "--offset" && args[i + 1]) offset = Number.parseInt(args[++i]!, 10) || 0;
    else if (args[i] === "--limit" && args[i + 1]) limit = Number.parseInt(args[++i]!, 10) || null;
  }

  return { list, dryRun, offset, limit };
}

function isJunkSummary(summary: string): { junk: boolean; reason: string } {
  const off = isOffTopicSummary(summary);
  if (off.offTopic) return { junk: true, reason: off.reason };

  for (const { reason, test } of EXTRA_JUNK_PATTERNS) {
    if (test.test(summary)) return { junk: true, reason };
  }

  return { junk: false, reason: "" };
}

function isCryptoLedHeadline(summary: string): boolean {
  const s = summary.trim();
  if (!CRYPTO_CONTEXT.test(s)) return false;
  if (/^(Bitcoin|BTC|Ethereum|Ether|Crypto)\b/i.test(s)) return true;
  if (
    /\b(bitcoin|btc) (hovers|climbs|drops|falls|surges|rallies|rebounds|tumbles|slides|gains|loses|trades|price|margin longs|investors focus|faces pressure|stalls|experiences|rises as|drops to|dips to|and (ether|major crypto)|briefly rebounds)\b/i.test(
      s,
    )
  ) {
    return true;
  }
  if (
    /\b(crypto markets?|cryptocurrency markets?|bitcoin (policy|rules?|industry|ecosystem|donations?|conference)|blockchain caucus)\b/i.test(
      s,
    )
  ) {
    return true;
  }
  return CRYPTO_CONTEXT.test(s);
}

function cryptoTarget(summary: string): string {
  const s = summary.toLowerCase();
  if (/\b(exchange|bitfinex|binance|coinbase|mt\.?gox|hack|insolvency|withdrawal)\b/.test(s)) {
    return "Exchanges";
  }
  if (/\b(etf|grayscale|investment product|trust)\b/.test(s)) return "ETFs and investment products";
  if (/\b(mining|hash ?rate|miner)\b/.test(s)) return "Bitcoin mining";
  if (/\b(adoption|merchant|payment|accept|bitpay|paypal.*bitcoin|strike|lightning payment)\b/.test(s)) {
    return "Bitcoin adoption";
  }
  if (/\b(regulation|sec |cftc|ban crypto|crypto ban)\b/.test(s)) return "Bitcoin regulation";
  if (/\b(stablecoin|luna|ust|usdc|usdt)\b/.test(s)) return "Stablecoins";
  if (/\b(defi|uniswap|protocol launch)\b/.test(s)) return "DeFi";
  if (/\b(nft|gaming|magic eden)\b/.test(s)) return "NFTs and gaming";
  if (/\b(ethereum|solana|smart contract|altcoin|cardano|polkadot)\b/.test(s)) {
    return "Smart contracts & L1s";
  }
  if (/\b(government adoption|legal tender|el salvador)\b/.test(s)) return "Government adoption";
  if (/\b(institutional|microstrategy|corporate treasury|grayscale)\b/.test(s)) {
    return "Institutional Bitcoin & flows";
  }
  if (/\b(wallet|custody|self-custody|trezor|ledger)\b/.test(s)) return "Wallets & self-custody";
  if (/\b(cbdc|central bank digital)\b/.test(s)) return "CBDCs";
  if (/\b(enforcement|crime|prosecution|seizure|fraud|ponzi)\b/.test(s)) return "Enforcement & crime";
  if (/\b(web3|vc round|funding round)\b/.test(s)) return "Web3 industry and funding";
  if (/\b(cross-chain|bridge)\b/.test(s)) return "Cross-chain and bridges";
  if (/\b(scaling|layer 2|lightning network)\b/.test(s)) return "Scaling and Layer 2";
  if (/\b(protocol upgrade|bip|segwit|taproot|soft fork|hard fork)\b/.test(s)) {
    return "Protocol & upgrades";
  }
  if (/\b(securities regulation|sec charges)\b/.test(s)) return "Securities regulation";
  if (/\b(election|president|congress|parliament|referendum|impeach|campaign|vote|political)\b/.test(s)) {
    return "Politics and elections";
  }
  return "Bitcoin price & cycles";
}

function matchesMacroLeafInclude(leaf: string, summary: string): boolean {
  const s = summary.toLowerCase();
  switch (leaf) {
    case "Inflation":
      return /\b(inflation|cpi|consumer price|deflation|hyperinflation|price (index|level|rise|surge|shock)|purchasing power)\b/.test(
        s,
      );
    case "Monetary policy & rates":
      return /\b(federal reserve|fed |ecb |central bank|interest rate|rate (decision|cut|hike|rise|hold)|quantitative easing|\bqe\b|taper|monetary policy|discount window|libor|bond buying|balance sheet|powell|yellen|bernanke|draghi|lagarde)\b/.test(
        s,
      );
    case "Banking stress":
      return /\b(bank (fail|failure|rescue|bailout|insolv|collapse|stress|run|crisis)|lehman|svb|silicon valley|credit suisse|bear stearns|aig |lloyds|hbos|rbs |fortis|bankia|jpmorgan.*(loss|trading)|deposit (haircut|freeze)|banking (crisis|stress|sector)|recapitali[sz]|toxic (asset|loan)|emergency (fund|lending|funding)|bank of america|goldman sachs|wells fargo|citigroup)\b/.test(
        s,
      );
    case "Debt crises":
      return /\b(debt (crisis|ceiling|default|restructur|swap|limit|standoff)|sovereign debt|bond yield|credit (rating|downgrade|outlook)|greek (debt|bailout|crisis)|eurozone debt|deficit (fear|crisis|ceiling)|national debt|junk status)\b/.test(
        s,
      );
    case "Labor market":
      return /\b(unemployment|jobless|jobs (report|data|cut|loss|gain|add)|payroll|labor market|strike|union|layoff|hiring|workforce|employment (rate|data|report))\b/.test(
        s,
      );
    case "Housing":
      return /\b(housing (market|crisis|finance|bubble|slump|boom|price)|mortgage|foreclosure|fannie mae|freddie mac|home (loan|ownership|price|building)|subprime)\b/.test(
        s,
      );
    case "Bailouts and stimulus":
      return /\b(stimulus|bailout|rescue (plan|fund|package)|recovery (plan|act)|tarp|emergency (economic|relief|program)|fiscal (stimulus|package|bailout)|economic (rescue|program)|spending (deal|bill|cut)|government shutdown|austerity (package|plan)|repay bailout funds)\b/.test(
        s,
      );
    case "Global growth and recession":
      return /\b(recession|economic (growth|slowdown|recovery|crisis|outlook)|gdp|global growth|growth (shock|slow|weak|forecast)|financial crisis|eurozone crisis|market (selloff|turmoil|rally)|imf warn|stagflation)\b/.test(
        s,
      );
    case "Politics and elections":
      return /\b(election|president|prime minister|congress|parliament|senate|referendum|impeach|campaign|vote|ballot|inaugur|coalition government|brexit|government (form|collapse|shutdown)|political (turmoil|turning|shift)|minister (resign|appoint)|midterm|governor race|presidential|obama|trump)\b/.test(
        s,
      );
    case "Securities regulation":
      return /\b(sec (charges|sues|probe|subpoena|approves|proposes|rule|rules|settlement)|cftc|finra|derivatives (rules|trade|regulation|reform)|dodd-frank|financial reform|credit rating agenc|money fund rules|short-selling rules|flash crash|broker[- ]dealer)\b/.test(
        s,
      );
    case "Tax policy":
      return /\b(tax (policy|reform|amnesty|evasion|fraud|haven|rate|cut|hike)|irs |vat |value added tax)\b/.test(
        s,
      );
    case "Legal cases":
      return /\b(court|lawsuit|sues?|sued|trial|judge|ruling|appeal|verdict|jury|litigation|settlement|class[- ]action|bankruptcy court)\b/.test(
        s,
      );
    case "Enforcement & crime":
      return /\b(arrested|indicted|found guilty|pleads guilty|sentenced to|prison sentence|money laundering|seized.*bitcoin|forfeit(s|ed)? \d+.*bitcoin|extradited)\b/.test(
        s,
      );
    case "Sanctions and enforcement":
      return /\b(sanction[s]?|ofac|embargo|blacklist|export ban)\b/.test(s);
    default:
      return false;
  }
}

function macroEditorialExclude(leaf: string, summary: string): string | null | undefined {
  const s = summary.toLowerCase();
  if (leaf === "Inflation" && /\b(deficit|debt ceiling|fiscal cut)\b/.test(s) && !/\binflation\b/.test(s)) {
    return "Debt crises";
  }
  if (leaf === "Global growth and recession" && /\b(insurance-linked securities|geneva association)\b/.test(s)) {
    return null;
  }
  if (
    leaf === "Politics and elections" &&
    /\b(quarterly profit|earnings|stock (rise|fall))\b/.test(s) &&
    !/\b(election|congress|parliament|president|political|campaign|vote)\b/.test(s)
  ) {
    return null;
  }
  return undefined;
}

function inferMacroOrPolicyLeaf(summary: string, ranking: TopicRankingResult): string | null {
  for (const leaf of MACRO_LEAF_ORDER) {
    if (!matchesMacroLeafInclude(leaf, summary)) continue;
    const excluded = macroEditorialExclude(leaf, summary);
    if (excluded === null) continue;
    if (excluded) return excluded;
    return leaf;
  }

  const macroCandidates = ranking.candidates.filter((c) => {
    const group = topicGroupForLeaf(c.leaf);
    return group === "Macroeconomy" || group === "Crypto policy & regulation";
  });

  const best = macroCandidates[0];
  if (!best) return null;
  if (best.leaf === HALVING_EVENTS_LEAF) return null;
  if (best.score >= 6) return best.leaf;
  return null;
}

function blockHalving(date: string, leaf: string, summary: string): string {
  if (leaf !== HALVING_EVENTS_LEAF) return leaf;
  if (CANONICAL_BITCOIN_HALVING_DATE_SET.has(date)) return leaf;
  if (/\b(price|trades|surge|fall|rally|ath|market|cycle)\b/i.test(summary)) {
    return "Bitcoin price & cycles";
  }
  return "Bitcoin mining";
}

function isBitcoinOrWeb3Leaf(leaf: string): boolean {
  const group = topicGroupForLeaf(leaf);
  return group === "Bitcoin" || group === "Web3 & DeFi";
}

function shouldAssignCrypto(summary: string, ranking: TopicRankingResult): boolean {
  const top = ranking.candidates[0]?.score ?? 0;
  const second = ranking.candidates[1]?.score ?? 0;
  if (!ranking.primary) return false;
  if (ranking.confidence === "high") return true;
  if (top >= 8 && top - second >= 2) return true;
  if (CRYPTO_CONTEXT.test(summary) && top >= 6) return true;
  return false;
}

function shouldAssignMacro(summary: string, leaf: string, ranking: TopicRankingResult): boolean {
  const top = ranking.candidates[0]?.score ?? 0;
  if (matchesMacroLeafInclude(leaf, summary)) return true;
  if (ranking.confidence === "high" && topicGroupForLeaf(leaf) === "Macroeconomy") return true;
  if (MACRO_FIN_SIGNAL.test(summary) && top >= 6) return true;
  return false;
}

/** Build TARGET_BY_DATE entry for one no-topic row. */
export function resolveNoTopicTarget(
  date: string,
  summary: string,
  tags: string[],
  googleCheckHappened: GoogleCheckHappened = undefined,
): NoTopicResolution {
  const verificationBlock = storylineTopicBlockReason(googleCheckHappened);
  if (verificationBlock) {
    return { action: "clear", target: null, reason: verificationBlock };
  }
  if (!isStorylineTopicEligible(googleCheckHappened)) {
    return { action: "skip", target: null, reason: "google_check not yes" };
  }

  const junk = isJunkSummary(summary);
  if (junk.junk) {
    return { action: "clear", target: null, reason: junk.reason };
  }

  const ranking = rankTopicCandidatesFromSummary({ summary, tags }, 5);

  if (isCryptoLedHeadline(summary)) {
    if (!shouldAssignCrypto(summary, ranking)) {
      const fallback = cryptoTarget(summary);
      if (CRYPTO_CONTEXT.test(summary)) {
        return { action: "assign", target: blockHalving(date, fallback, summary), reason: "crypto fallback" };
      }
      return { action: "skip", target: null, reason: "ambiguous crypto" };
    }

    let leaf = ranking.primary ?? cryptoTarget(summary);
    if (isBitcoinOrWeb3Leaf(leaf) && ranking.confidence !== "high") {
      leaf = cryptoTarget(summary);
    }
    leaf = blockHalving(date, leaf, summary);
    const fit = evaluateStorylineFitHeuristic(leaf, summary);
    if (fit.conflict && fit.suggestedLeaf) {
      leaf = blockHalving(date, fit.suggestedLeaf, summary);
    }
    if (!VALID_LEAVES.has(leaf)) {
      return { action: "skip", target: null, reason: "invalid leaf" };
    }
    return { action: "assign", target: leaf, reason: ranking.confidence };
  }

  const macroLeaf = inferMacroOrPolicyLeaf(summary, ranking);
  if (macroLeaf) {
    if (!shouldAssignMacro(summary, macroLeaf, ranking)) {
      return { action: "skip", target: macroLeaf, reason: "weak macro match" };
    }
    const fit = evaluateStorylineFitHeuristic(macroLeaf, summary);
    let leaf = macroLeaf;
    if (fit.conflict && fit.suggestedLeaf && !isBitcoinOrWeb3Leaf(fit.suggestedLeaf)) {
      leaf = fit.suggestedLeaf;
    }
    if (!VALID_LEAVES.has(leaf) || leaf === HALVING_EVENTS_LEAF) {
      return { action: "skip", target: null, reason: "invalid macro leaf" };
    }
    return { action: "assign", target: leaf, reason: "macro match" };
  }

  if (!CRYPTO_CONTEXT.test(summary) && !MACRO_FIN_SIGNAL.test(summary)) {
    return { action: "clear", target: null, reason: "off-topic noise" };
  }

  if (ranking.primary && shouldAssignCrypto(summary, ranking) && CRYPTO_CONTEXT.test(summary)) {
    let leaf = blockHalving(date, ranking.primary, summary);
    if (isBitcoinOrWeb3Leaf(leaf)) {
      return { action: "skip", target: leaf, reason: "crypto signal but not crypto-led" };
    }
    const fit = evaluateStorylineFitHeuristic(leaf, summary);
    if (fit.conflict && fit.suggestedLeaf) leaf = blockHalving(date, fit.suggestedLeaf, summary);
    if (VALID_LEAVES.has(leaf) && leaf !== HALVING_EVENTS_LEAF) {
      return { action: "assign", target: leaf, reason: "policy/crypto hybrid" };
    }
  }

  return { action: "skip", target: ranking.primary, reason: "ambiguous" };
}

export async function buildTargetByDate(): Promise<Record<string, string | null>> {
  const rows = await queryNoTopicRows();
  const analyses = await storage.getAllAnalyses();
  const googleByDate = new Map(analyses.map((row) => [row.date, row.googleCheckHappened]));
  const map: Record<string, string | null> = {};
  for (const row of rows) {
    const resolution = resolveNoTopicTarget(
      row.date,
      row.summary,
      row.tags,
      googleByDate.get(row.date),
    );
    if (resolution.action === "assign") map[row.date] = resolution.target;
    else if (resolution.action === "clear") map[row.date] = null;
    // skip: omit from map
  }
  return map;
}

async function applyTarget(date: string, target: string | null, dryRun: boolean) {
  if (dryRun) return;

  if (!target) {
    await syncStorylineAssignmentsForDate(date, []);
    await db
      .update(historicalNewsAnalyses)
      .set({ topicCategories: [], isLocked: false })
      .where(eq(historicalNewsAnalyses.date, date));
    return;
  }

  await db
    .update(historicalNewsAnalyses)
    .set({ topicCategories: [target] })
    .where(eq(historicalNewsAnalyses.date, date));
  await syncStorylineAssignmentsForDate(date, [target]);
}

async function main() {
  const { list, dryRun, offset, limit } = parseArgs();
  const rows = await queryNoTopicRows();
  const backlogBefore = rows.length;

  if (list) {
    for (const row of rows) {
      console.log(
        JSON.stringify({
          date: row.date,
          summary: row.summary.slice(0, 120),
          tags: row.tags,
        }),
      );
    }
    console.error(JSON.stringify({ mode: "list", total: rows.length }));
    return;
  }

  const slice = limit != null ? rows.slice(offset, offset + limit) : rows.slice(offset);
  const analyses = await storage.getAllAnalyses();
  const googleByDate = new Map(analyses.map((row) => [row.date, row.googleCheckHappened]));
  const stats = {
    assign: 0,
    clear: 0,
    skip: 0,
    halvingBlocked: 0,
    byLeaf: {} as Record<string, number>,
    byReason: {} as Record<string, number>,
  };

  console.log(
    JSON.stringify({
      mode: dryRun ? "dry-run" : "apply",
      backlogBefore,
      batchOffset: offset,
      batchSize: slice.length,
    }),
  );

  for (const row of slice) {
    const ranking = rankTopicCandidatesFromSummary({ summary: row.summary, tags: row.tags }, 3);
    if (ranking.primary === HALVING_EVENTS_LEAF && !CANONICAL_BITCOIN_HALVING_DATE_SET.has(row.date)) {
      stats.halvingBlocked += 1;
    }

    const resolution = resolveNoTopicTarget(
      row.date,
      row.summary,
      row.tags,
      googleByDate.get(row.date),
    );
    stats.byReason[resolution.reason] = (stats.byReason[resolution.reason] ?? 0) + 1;

    if (resolution.action === "assign" && resolution.target) {
      stats.assign += 1;
      stats.byLeaf[resolution.target] = (stats.byLeaf[resolution.target] ?? 0) + 1;
      console.log(
        JSON.stringify({
          date: row.date,
          action: dryRun ? "WOULD_ASSIGN" : "ASSIGN",
          target: resolution.target,
          reason: resolution.reason,
          summary: row.summary.slice(0, 80),
        }),
      );
      await applyTarget(row.date, resolution.target, dryRun);
      continue;
    }

    if (resolution.action === "clear") {
      stats.clear += 1;
      console.log(
        JSON.stringify({
          date: row.date,
          action: dryRun ? "WOULD_CLEAR" : "CLEAR",
          reason: resolution.reason,
          summary: row.summary.slice(0, 80),
        }),
      );
      await applyTarget(row.date, null, dryRun);
      continue;
    }

    stats.skip += 1;
    console.log(
      JSON.stringify({
        date: row.date,
        action: "SKIP",
        reason: resolution.reason,
        candidate: resolution.target,
        summary: row.summary.slice(0, 80),
      }),
    );
  }

  const backlogAfter = dryRun ? backlogBefore : (await queryNoTopicRows()).length;

  console.log(
    JSON.stringify({
      stats,
      backlogBefore,
      backlogAfter,
      backlogDelta: backlogBefore - backlogAfter,
    }),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
