/**
 * Editorial-map generator for Crypto policy & regulation leaves.
 * Uses storyline taxonomy ranking; Legal cases adds editorial include/exclude rules.
 *
 * Usage: npx tsx server/scripts/_gen-policy-leaf-map.ts "Bitcoin regulation"
 */
import "dotenv/config";

import { rankTopicCandidatesFromSummary } from "../services/editorial-pipeline/storyline-taxonomy";
import { storage } from "../storage";

const LEAF = process.argv[2];
if (!LEAF) {
  console.error('Usage: npx tsx server/scripts/_gen-policy-leaf-map.ts "<leaf name>"');
  process.exit(1);
}

/** Date-specific editorial overrides from MAIN_EVENTS_LEAF_PROMPT_RULES review. */
const OVERRIDES: Record<string, Record<string, string | null>> = {
  "Tax policy": {
    "2011-11-04": null,
  },
  "Banking & prudential (crypto)": {
    "2011-02-08": null,
  },
  "Legal cases": {
    "2009-11-28": "Enforcement & crime",
    "2011-07-07": null,
    "2013-02-04": null,
    "2013-10-08": "Enforcement & crime",
    "2014-04-23": null,
    "2015-02-04": "Legal cases",
    "2015-02-18": "Enforcement & crime",
    "2015-06-18": "Legal cases",
    "2015-08-09": "Legal cases",
    "2017-07-31": "Enforcement & crime",
    "2018-05-19": null,
    "2018-08-17": null,
    "2019-05-21": "Satoshi identity",
    "2019-07-16": null,
    "2019-09-01": "Satoshi identity",
    "2019-11-23": null,
    "2021-11-09": "Enforcement & crime",
    "2022-09-01": "Bitcoin price & cycles",
    "2023-01-04": "Enforcement & crime",
    "2023-01-09": "Securities regulation",
    "2023-01-28": null,
    "2023-02-08": "Legal cases",
    "2023-04-08": null,
    "2023-05-12": null,
    "2023-06-08": "Legal cases",
    "2023-06-18": "Securities regulation",
    "2023-10-19": "Securities regulation",
    "2024-01-25": "Enforcement & crime",
    "2024-06-02": "Enforcement & crime",
    "2024-06-10": null,
    "2024-07-10": "Web3 industry and funding",
    "2024-08-12": null,
    "2024-09-03": "Stablecoins",
    "2024-09-27": null,
  },
  CBDCs: {
    "2016-03-13": "CBDCs",
    "2019-12-26": "CBDCs",
    "2020-04-15": "CBDCs",
    "2021-01-16": "CBDCs",
    "2021-09-04": "CBDCs",
    "2023-01-07": "CBDCs",
    "2019-12-21": "Government adoption",
  },
  "Securities regulation": {
    "2012-02-28": "Securities regulation",
    "2012-10-29": "Securities regulation",
    "2013-01-21": "Bitcoin adoption",
    "2015-09-11": "Securities regulation",
    "2017-09-04": "Securities regulation",
    "2018-06-06": "Securities regulation",
    "2010-12-28": "Securities regulation",
    "2024-01-01": "Securities regulation",
    "2024-09-21": "Legal cases",
  },
};

const CRYPTO_CONTEXT =
  /\b(bitcoin|btc|crypto(currency)?|blockchain|ethereum|defi|nft|web3|stablecoin|altcoin|binance|coinbase|ripple|terraform|celsius|mt\.?\s?gox|silk road|uniswap|tether|genesis|ftx|voyager|kraken|bitmain|bitinstant|coinye|hodlonaut|do kwon|cz zhao|changpeng|craig wright|satosh?i|kleiman|copa|telegram|dcg|gemini|swan bitcoin|riot platforms|rhodium|polychain|pleasrdao|shkreli|playboy|okcoin|bitmex|vinnik|karpeles|ulbricht|shrem|wright|unitedcorp|bit newsfeed)\b/i;

const LEGAL_CASE_SIGNAL =
  /\b(court|lawsuit|sues?|sued|trial|judge|ruling|appeal|verdict|jury|litigation|settlement|class[- ]action|arbitration|bankruptcy court|civil rehabilitation|subpoena|dismiss(es|al)|proceeds? against|blocks sec|oversteps.*authority|opposes dismissal|freeze.*assets|compensation claim|legal tender|not money|is money|protects bitcoin as property|copyright.*bitcoin|bitcoin.*copyright|legal battle|legal expenses|due[- ]process|rehabilitation plan|creditors? (receive|secure)|contract breach|breach of contract|forfeiture complaint|asset freeze|dealer rule|convicted|landmark.*case|default judgment)\b/i;

const CRIMINAL_ENFORCEMENT =
  /\b(arrested|indicted|found guilty|pleads guilty|pleaded guilty|sentenced to|prison sentence|life in prison|six years in prison|two years in prison|four-month prison|marshals? (are )?auction|seized.*bitcoin|seizes bitcoin|forfeit(s|ed)? \d+.*bitcoin|extradited|re-arrest|money laundering tied|drug sales|dark web marketplace|dread pirate|pleads not guilty|plans to sell.*seized)\b/i;

const SEC_REGulatory =
  /\b(sec (charges|probe|probes|subpoena|serves|delays|drops its charges)|doj and sec probe|regulatory pressure)\b/i;

const SATOSHI_IDENTITY =
  /\b(satoshi identity|who is satoshi|registers the bitcoin code|white paper.*copyright|500,?000 btc|half his bitcoin|1\.1 million bitcoin|train wreck.*copa|bitcoin falls.*craig wright)\b/i;

function hasCryptoContext(summary: string): boolean {
  return CRYPTO_CONTEXT.test(summary.trim());
}

function matchesLegalCasesInclude(summary: string): boolean {
  const s = summary.trim();
  if (!hasCryptoContext(s)) return false;
  return LEGAL_CASE_SIGNAL.test(s);
}

function classifyLegalCases(date: string, summary: string, tags: string[]): string | null {
  const overrides = OVERRIDES["Legal cases"];
  if (overrides?.[date] !== undefined) return overrides[date];

  const s = summary.trim();
  if (!s) return null;

  if (SATOSHI_IDENTITY.test(s) && !/\b(court|judge|jury|trial|ruling|appeal|lawsuit|sues?)\b/i.test(s)) {
    return "Satoshi identity";
  }

  if (CRIMINAL_ENFORCEMENT.test(s) && !/\b(judge rules|court rules|court approves|court dismisses|court blocks|court sides|court protects|court calls|court orders.*forfeit.*after)\b/i.test(s)) {
    return "Enforcement & crime";
  }

  if (SEC_REGulatory.test(s) && !/\b(judge|court|trial|jury|ruling|appeal|dismisses|blocks sec|approves.*settlement)\b/i.test(s)) {
    return "Securities regulation";
  }

  if (/\b(michael saylor faces.*tax fraud lawsuit)\b/i.test(s)) return "Tax policy";
  if (/\b(goldman sachs|kpmg|svb'?s collapse)\b/i.test(s) && !hasCryptoContext(s)) return null;
  if (/\b(malaysia seizes|bp off takeover|penn state|megaupload|lehman|madoff|lagarde|strauss-kahn|chevron|penn state|sandusky|rajat gupta|healthcare law|supreme court.*healthcare|acta|ebay win|tiffany|express scripts|medco|postfinance|wikileaks|bank of america mobilizes|siemens|greece sues|italy and greece push austerity|brazil fines|russian court cuts khodorkovsky|scene?torrents|book on the financial crisis|consumer groups urge|economist publishes)\b/i.test(s) && !hasCryptoContext(s)) {
    return null;
  }

  if (/\b(microsoft blocks fsf|htc executives are arrested|jersey regulators clear meinl|optiver settles|taxi official|whitehall faces scrutiny|barclays discloses|new york sues jpmorgan|jp morgan and credit suisse pay)\b/i.test(s) && !hasCryptoContext(s)) {
    return null;
  }

  if (matchesLegalCasesInclude(s)) return "Legal cases";

  if (!hasCryptoContext(s)) return null;

  const ranking = rankTopicCandidatesFromSummary({ summary, tags }, 5);
  if (ranking.primary && ranking.primary !== "Legal cases") {
    if (ranking.confidence === "high" || (ranking.candidates[0]?.score ?? 0) >= 10) {
      return ranking.primary;
    }
  }
  if (ranking.candidates.some((c) => c.leaf === "Legal cases" && c.score >= 8)) return "Legal cases";
  if (ranking.primary && ranking.primary !== "Legal cases") return ranking.primary;
  return null;
}

const SECURITIES_SIGNAL =
  /\b(sec (charges|sues|probe|probes|subpoena|approves|proposes|tightens|weighs|watchdog|wins|sends|delays|drops|settlement|rule|rules|tightens|blocks|action)|cftc (approv|reject|commissioner|gensler|approval)|asic (ruling|backs)|securities administrators|finra|securities (law|offering|rules|regulation)|unregistered (securities|offering)|token (is )?a security|ico.*(illegal|security|securities)|illegal security|howey|summary judgment.*terraform|staking investigation|accounting rule.*sec|target market determination|credit rating agenc|money fund rules|short-selling rules|flash crash|markopolos.*sec|madoff.*sec|asset-backed securities|dodd-frank|financial reform|derivatives (rules|trade|regulation|reform|oversight)|regulate derivatives|rein in derivatives|otc derivatives|naked short|insider trading.*sec|broker[- ]dealer|genius act|insurance-linked securities|financial services bill|markitserv|markit and dtcc|brooksley born|wall street reform|derivatives rule|sec fraud charges|sec and finra|sec chairman|sec chair|sec sues|sec's action|sec fight|sec crypto|sec probe|sec settlement|sec rule|sec approv|sec delays|sec sends|sec wins|amicus brief.*sec|clayton (says|backs)|jay clayton|kin sale|ripple labs|terraform labs|bitclave|bit trade|consensys sec|telegram.*sec|gram sale|kik over|binance and coinbase|kraken settles sec|ledgerx wins|cftc approval|swap execution facility|cross-border derivatives|angelList invest)\b/i;

const SECURITIES_EXCLUDE =
  /\b(obama signals a strong dollar|bonus tax for financial|patent reform|imf says credit crunch|cnn marks obama|india'?s election|energy reform as a job|chrysler asset sale|peter schiff signals a republican|fsb holds inaugural basel|aid bill for afghanistan|iceland submits eu|pfizer pays|medical device|delaware tops switzerland|gold climbs to a record|bill gates says wall street pay|u\.s\. stocks end strong|china investment corp|supreme court ruling letting corporations|colombia'?s court blocks|ukrainian hacker|tax amnesty|china holds yuan|hayek style calls for the ecb|us shares hit their highest|cme group earns|runescape items|zetas-linked bribes|moody'?s downgrades greece|tumult hype sale|bitcoin alliance india|colombia bars banks|uk treasury prepares bitcoin|texas embraces bitcoin|russian court reopens.*bitcoin|switzerland makes bitcoin vat|eu court.*vat|zimbabwe adopts the yuan|ukraine moves to define bitcoin|australia announces auction.*seized bitcoin|bitcoin association switzerland|uk police push law changes|islamic scholar declares|facebook lifts some blockchain|b21 secures gibraltar|cosmos launches|bitcoin community marks 13 years|bitcoin tops \$42|commerzbank seeks a crypto license|central banks shift from rescue)\b/i;

function classifySecuritiesRegulation(date: string, summary: string, tags: string[]): string | null {
  const overrides = OVERRIDES["Securities regulation"];
  if (overrides?.[date] !== undefined) return overrides[date];

  const s = summary.trim();
  if (!s) return null;

  if (SECURITIES_EXCLUDE.test(s)) {
    if (/\b(vat|tax amnesty|tax-free|value added tax)\b/i.test(s)) return "Tax policy";
    if (/\b(downgrades greece|debt swap|default risk)\b/i.test(s)) return "Debt crises";
    if (/\b(election|supreme court ruling|court blocks uribe|republican senate|eu membership|aid bill)\b/i.test(s)) {
      return "Politics and elections";
    }
    if (/\b(energy reform|stimulus)\b/i.test(s)) return "Bailouts and stimulus";
    if (/\b(imf|credit crunch|basel meeting|central banks shift)\b/i.test(s)) return "Banking stress";
    if (/\b(stocks end strong|shares hit their highest|gold climbs)\b/i.test(s)) return "Global growth and recession";
    if (/\b(hacker|zetas|bribes)\b/i.test(s)) return "Enforcement & crime";
    if (/\b(bitcoin.*pay|tumult hype|texas embraces|colombia bars|gibraltar dlt|uk treasury prepares|bitcoin alliance|ukraine moves to define|russian court reopens|switzerland makes bitcoin vat|eu court.*vat|uk police push law|commerzbank seeks a crypto license)\b/i.test(s)) {
      return "Bitcoin regulation";
    }
    if (/\b(tumult hype|pay about 3 bitcoin)\b/i.test(s)) return "Bitcoin adoption";
    if (/\b(bitcoin community marks|13 years since the first block)\b/i.test(s)) return "Early Bitcoin history";
    if (/\b(bitcoin tops \$|islamic scholar)\b/i.test(s)) return null;
    if (/\b(cosmos launches|facebook lifts.*blockchain ad)\b/i.test(s)) return "Smart contracts & L1s";
    if (/\b(australia announces auction.*seized bitcoin)\b/i.test(s)) return "Enforcement & crime";
    return null;
  }

  if (/\b(judge (rules|dismisses|blocks)|court (rules|blocks|backs|deems)|a u\.s\. judge rules)\b/i.test(s) && hasCryptoContext(s)) {
    return "Legal cases";
  }

  if (/\b(nasdaq weighs selling amex)\b/i.test(s)) return "Exchanges";

  if (SECURITIES_SIGNAL.test(s)) return "Securities regulation";

  if (/\b(sec|cftc|finra|derivatives rules|financial reform|dodd-frank|credit rating|short-selling|flash crash|markopolos|asset-backed securities|money fund)\b/i.test(s)) {
    return "Securities regulation";
  }

  const ranking = rankTopicCandidatesFromSummary({ summary, tags }, 5);
  if (ranking.primary && ranking.primary !== "Securities regulation") {
    if (ranking.confidence === "high" || (ranking.candidates[0]?.score ?? 0) >= 12) {
      return ranking.primary;
    }
  }

  return null;
}

function classify(date: string, summary: string, tags: string[]): string | null {
  const overrides = OVERRIDES[LEAF];
  if (overrides?.[date] !== undefined) return overrides[date];

  if (LEAF === "Legal cases") {
    return classifyLegalCases(date, summary, tags);
  }

  if (LEAF === "Securities regulation") {
    return classifySecuritiesRegulation(date, summary, tags);
  }

  const ranking = rankTopicCandidatesFromSummary({ summary, tags }, 5);
  const candidates = ranking.candidates.map((c) => c.leaf);

  if (ranking.confidence === "high" && ranking.primary) {
    return ranking.primary;
  }

  if (candidates.includes(LEAF)) return LEAF;
  if (ranking.primary) return ranking.primary;
  if (candidates.length > 0) return candidates[0];

  return null;
}

async function main() {
  const rows = await storage.getAnalysesForStorylineLeaf(LEAF);
  const map: Record<string, string | null> = {};
  const stats = { keep: 0, moved: 0, cleared: 0 };
  const moves: Record<string, number> = {};

  for (const row of rows) {
    const target = classify(row.date, row.summary ?? "", row.tagsVersion2 ?? []);
    map[row.date] = target;
    if (target === LEAF) stats.keep += 1;
    else if (target === null) stats.cleared += 1;
    else {
      stats.moved += 1;
      moves[target] = (moves[target] ?? 0) + 1;
    }
  }

  console.error(JSON.stringify({ leaf: LEAF, total: rows.length, stats, moves }, null, 2));

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
