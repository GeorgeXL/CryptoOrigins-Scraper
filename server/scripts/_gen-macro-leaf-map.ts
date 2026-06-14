/**
 * Draft TARGET_BY_DATE maps for Macroeconomy retags — editorial rules from main-events-leaf-prompts,
 * not storyline-fit-heuristics. Review output before committing to retag-*.ts scripts.
 *
 * Usage: npx tsx server/scripts/_gen-macro-leaf-map.ts "Inflation"
 */
import "dotenv/config";

import { mainEventsLeafPromptRules } from "@shared/main-events-leaf-prompts";
import { storage } from "../storage";
import { rankTopicCandidatesFromSummary } from "../services/editorial-pipeline/storyline-taxonomy";

const LEAF = process.argv[2] ?? "Inflation";

/** Headline is crypto-led — macro leaves exclude these per MAIN_EVENTS_LEAF_PROMPT_RULES. */
function isCryptoLedHeadline(summary: string): boolean {
  const s = summary.trim();
  if (!/\b(bitcoin|btc|ethereum|ether|crypto(currency)?|blockchain|defi|stablecoin|nft|web3|altcoin|solana|dogecoin)\b/i.test(s)) {
    return false;
  }
  if (/^(Bitcoin|BTC|Ethereum|Ether|Crypto)\b/i.test(s)) return true;
  if (/\b(bitcoin|btc) (hovers|climbs|drops|falls|surges|rallies|rebounds|tumbles|slides|gains|loses|trades|price|margin longs|investors focus|faces pressure|stalls|experiences|rises as|drops to|dips to|and (ether|major crypto)|briefly rebounds)\b/i.test(s)) {
    return true;
  }
  if (/\b(crypto markets?|cryptocurrency markets?|digital currency roles?|bitcoin jobs boom|bitcoin conference|bitcoin donations?|bitcoin policy|bitcoin rules?|bitcoin advocate|bitcoin as (a )?hedge|bitcoin usage surges|bitcoin evolves|bitcoin industry|bitcoin ecosystem|bitcoin allows|bitcoin gains traction|bitcoin and ven|liberland adopts bitcoin|cash app earns.*bitcoin|square.*bitcoin|huobi|okcoin|labitconf|bitso presents|abra'?s remittance|open whisper.*bitcoin|blockchain caucus|kalshi election markets)\b/i.test(s)) {
    return true;
  }
  if (/\b(trump (speaks|addresses).*bitcoin|rfk.*bitcoin|harris.*crypto regulatory|bessent|mulvaney.*bitcoin|perry.*bitcoin|paul.*bitcoin|macri.*bitcoin policy|politicians meet bitcoin|sundin.*bitcoin donations?)\b/i.test(s)) {
    return true;
  }
  return false;
}

function cryptoTarget(summary: string): string {
  const s = summary.toLowerCase();
  if (/\b(exchange|bitfinex|binance|coinbase|mt\.?gox|hack|insolvency|withdrawal)\b/.test(s)) return "Exchanges";
  if (/\b(etf|grayscale|investment product|trust)\b/.test(s)) return "ETFs and investment products";
  if (/\b(mining|hash ?rate|miner)\b/.test(s)) return "Bitcoin mining";
  if (/\b(adoption|merchant|payment|accept|bitpay|paypal.*bitcoin|strike|lightning payment)\b/.test(s)) return "Bitcoin adoption";
  if (/\b(regulation|sec |cftc|ban crypto|crypto ban)\b/.test(s)) return "Bitcoin regulation";
  if (/\b(stablecoin|luna|ust|usdc|usdt)\b/.test(s)) return "Stablecoins";
  if (/\b(defi|uniswap|protocol launch)\b/.test(s)) return "DeFi";
  if (/\b(nft|gaming|magic eden)\b/.test(s)) return "NFTs and gaming";
  if (/\b(ethereum|solana|smart contract|altcoin|cardano|polkadot)\b/.test(s)) return "Smart contracts & L1s";
  if (/\b(government adoption|legal tender|el salvador)\b/.test(s)) return "Government adoption";
  if (/\b(institutional|microstrategy|corporate treasury|grayscale)\b/.test(s)) return "Institutional Bitcoin & flows";
  if (/\b(wallet|custody|self-custody|trezor|ledger)\b/.test(s)) return "Wallets & self-custody";
  if (/\b(cbdc|central bank digital)\b/.test(s)) return "CBDCs";
  if (/\b(enforcement|crime|prosecution|seizure|fraud|ponzi)\b/.test(s)) return "Enforcement & crime";
  if (/\b(web3|vc round|funding round)\b/.test(s)) return "Web3 industry and funding";
  if (/\b(cross-chain|bridge)\b/.test(s)) return "Cross-chain and bridges";
  if (/\b(scaling|layer 2|lightning network)\b/.test(s)) return "Scaling and Layer 2";
  if (/\b(protocol upgrade|bip|segwit|taproot|soft fork|hard fork)\b/.test(s)) return "Protocol & upgrades";
  if (/\b(securities regulation|sec charges)\b/.test(s)) return "Securities regulation";
  if (/\b(election|president|congress|parliament|referendum|impeach|campaign|vote|political)\b/.test(s) && /\b(bitcoin|crypto|blockchain)\b/.test(s)) {
    return "Politics and elections";
  }
  return "Bitcoin price & cycles";
}

/** Per-leaf editorial keep signals derived from include rules (not heuristic classifiers). */
function matchesLeafInclude(leaf: string, summary: string): boolean {
  const s = summary.toLowerCase();
  switch (leaf) {
    case "Inflation":
      return /\b(inflation|cpi|consumer price|deflation|hyperinflation|price (index|level|rise|surge|shock)|purchasing power|bolivar.*inflation|inflation (climb|cool|hit|target|print|rate|data|woes|pressure))\b/.test(s);
    case "Monetary policy & rates":
      return /\b(federal reserve|fed |ecb |central bank|interest rate|rate (decision|cut|hike|rise|hold)|quantitative easing|\bqe\b|taper|monetary policy|reserve requirement|discount window|libor|euribor|bond buying|treasury (buy|purchase)|balance sheet|zero interest|negative rate|yellen|bernanke|powell|draghi|lagarde|boj |bank of england|bank of japan|bank of canada|swiss national bank|rate near zero|average inflation targeting)\b/.test(s);
    case "Banking stress":
      return /\b(bank (fail|failure|rescue|bailout|insolv|collapse|stress|run|crisis)|lehman|svb|silicon valley|credit suisse|bear stearns|aig |lloyds|hbos|rbs |fortis|bankia|cyprus (bank|bailout|deposit)|libor rig|jpmorgan.*(loss|trading)|deposit (haircut|freeze)|banking (crisis|stress|sector)|recapitali[sz]|toxic (asset|loan)|emergency (fund|lending|funding))\b/.test(s);
    case "Debt crises":
      return /\b(debt (crisis|ceiling|default|restructur|swap|limit|standoff)|sovereign debt|bond yield|credit (rating|downgrade|outlook)|bailout (fund|package)|greek (debt|bailout|crisis)|eurozone debt|portugal.*bailout|ireland.*bailout|spain.*bailout|italy.*(debt|borrowing)|dubai world|deficit (fear|crisis|ceiling)|national debt|debt commission|efsf|esm |fiscal compact|junk status|debt payment delay)\b/.test(s);
    case "Labor market":
      return /\b(unemployment|jobless|jobs (report|data|cut|loss|gain|add)|payroll|labor market|strike|union|layoff|hiring|workforce|employment (rate|data|report)|general strike|collective bargaining|wage (gap|inequality|cut)|postal service.*(job|cut|buyout)|apprenticeship)\b/.test(s);
    case "Housing":
      return /\b(housing (market|crisis|finance|bubble|slump|boom|price)|mortgage|foreclosure|fannie mae|freddie mac|home (loan|ownership|price|building)|property (tax|market)|real estate (lender|crisis)|subprime|fhfa|homeowner)\b/.test(s);
    case "Bailouts and stimulus":
      return /\b(stimulus|bailout|rescue (plan|fund|package)|recovery (plan|act)|tarp|emergency (economic|relief|program)|fiscal (stimulus|package|bailout)|economic (rescue|program)|ppp extension|spending (deal|bill|cut)|government shutdown|sequester|austerity (package|plan)|capital injection|recapitali[sz].*bank)\b/.test(s);
    case "Global growth and recession":
      return /\b(recession|economic (growth|slowdown|recovery|crisis|outlook)|gdp|global growth|growth (shock|slow|weak|forecast)|recovery (path|prospect)|financial crisis|eurozone crisis|austerity fear|market (selloff|turmoil|rally)|imf warn|lost decade|double dip|stagflation)\b/.test(s);
    case "Politics and elections":
      return /\b(election|president|prime minister|congress|parliament|senate|referendum|impeach|campaign|vote|ballot|geopolit|inaugur|coalition government|regime change|arab spring|brexit|independence (referendum|vote)|fiscal cliff|government (form|collapse|shutdown)|political (turmoil|turning|shift)|minister (resign|appoint)|legislative|midterm|governor race|presidential)\b/.test(s);
    default:
      return false;
  }
}

/** Per-leaf editorial exclude — mis-tagged macro sibling or off-topic. */
function editorialExclude(leaf: string, summary: string): string | null {
  const s = summary.toLowerCase();
  if (leaf === "Inflation" && /\b(deficit|debt ceiling|fiscal cut)\b/.test(s) && !/\binflation\b/.test(s)) {
    return "Debt crises";
  }
  if (leaf === "Monetary policy & rates" && /\b(bitcoin|crypto|blockchain|cbdc)\b/.test(s) && !matchesLeafInclude(leaf, summary)) {
    return cryptoTarget(summary);
  }
  if (leaf === "Banking stress" && /\b(crypto exchange|bitcoin exchange|ftx|binance hack)\b/.test(s) && !/\b(bank|banking)\b/.test(s)) {
    return "Exchanges";
  }
  if (leaf === "Global growth and recession" && /\b(michael jackson|insurance-linked securities|rednano|red hat|ibm cut|pharma|geneva association)\b/.test(s)) {
    return null;
  }
  if (leaf === "Politics and elections" && /\b(quarterly profit|earnings|stock (rise|fall)|bp profit)\b/.test(s) && !/\b(election|congress|parliament|president|political|campaign|vote)\b/.test(s)) {
    return null;
  }
  return null;
}

function classify(date: string, summary: string): string | null {
  const rules = mainEventsLeafPromptRules(LEAF);

  if (isCryptoLedHeadline(summary)) {
    return cryptoTarget(summary);
  }

  const excluded = editorialExclude(LEAF, summary);
  if (excluded !== null) return excluded;

  if (matchesLeafInclude(LEAF, summary)) {
    return LEAF;
  }

  const ranking = rankTopicCandidatesFromSummary({ summary }, 5);
  if (ranking.primary && ranking.primary !== LEAF) {
    if (ranking.confidence === "high" || (ranking.candidates[0]?.score ?? 0) >= 10) {
      return ranking.primary;
    }
  }

  if (ranking.candidates.some((c) => c.leaf === LEAF && c.score >= 8)) {
    return LEAF;
  }

  // Weak fit — clear or second-best sibling
  if (ranking.primary && ranking.primary !== LEAF) return ranking.primary;
  return null;
}

async function main() {
  const rows = await storage.getAnalysesForStorylineLeaf(LEAF);
  const rules = mainEventsLeafPromptRules(LEAF);
  const map: Record<string, string | null> = {};
  const stats = { keep: 0, moved: 0, cleared: 0 };
  const byTarget: Record<string, number> = {};

  for (const row of rows) {
    const target = classify(row.date, row.summary ?? "");
    map[row.date] = target;
    const key = target ?? "(clear)";
    byTarget[key] = (byTarget[key] ?? 0) + 1;
    if (target === LEAF) stats.keep += 1;
    else if (target === null) stats.cleared += 1;
    else stats.moved += 1;
  }

  console.error(JSON.stringify({ leaf: LEAF, total: rows.length, stats, byTarget, rules }, null, 2));

  const lines = Object.entries(map)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, target]) => {
      const val = target === null ? "null" : `"${target}"`;
      return `  "${date}": ${val},`;
    });

  console.log("const TARGET_BY_DATE: Record<string, string | null> = {");
  console.log(lines.join("\n"));
  console.log("};");
}

main().catch(console.error);
