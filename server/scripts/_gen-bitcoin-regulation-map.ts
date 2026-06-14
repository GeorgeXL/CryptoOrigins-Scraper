/** One-off generator for retag-bitcoin-regulation TARGET_BY_DATE. */
import "dotenv/config";

import { storage } from "../storage";
import { rankTopicCandidatesFromSummary } from "../services/editorial-pipeline/storyline-taxonomy";

const LEAF = "Bitcoin regulation";

const STRONG_REGULATION =
  /\b(bitcoin (regulation|regulatory|ban|banned|outlaw|license|licensing|legal framework|legal status|protection bill)|regulate[s]? bitcoin|regulating bitcoin|anti[- ]money[- ]laundering|aml rule|aml compliance|kyc|fincen|bitlicense|money transmission|money transmitter|cease and desist|bafin|mica regulation|fit21|crypto market structure bill|crypto executive order|comprehensive bitcoin law|comprehensive crypto law|virtual currency regulation|vasp rule|crypto regulation bill|crypto asset declaration|first country to outlaw|complete ban on cryptocurrency|ban all cryptocurrency|ban digital asset payment|strategic bitcoin reserve|debt deal drops crypto tax|close[s]? (domestic )?bitcoin exchange|exchange ban|ban.*bitcoin exchange|unlicensed bitcoin sales|blockchain caucus|fintech rules.*bitcoin|recogniz(e|ing|es) virtual currenc|regulator[s]? (move|tighten|probe|investigat|scrutin|oversee|mandate|require|issue|clarif)|regulatory (oversight|scrutiny|framework|approval|clarity|reform|concern|action|crackdown|licensing)|fca (rule|mandate|curb|tighten|crypto|bitcoin)|hmrc.*bitcoin|law passes|law signed|law approves|bill (pass|sign|introduc|approv)|classif(y|ies|ying) cryptocur)\b/i;

const MONETARY_NO_CRYPTO =
  /\b(fed(eral reserve)?|fomc|interest rate (decision|hike|cut)|monetary policy (meeting|decision)|quantitative easing|pboc deputy says china has room)\b/i;

const SECURITIES =
  /\b(sec charges|sec sues|sec approv|sec delay[s]? (ark|spot|bitcoin etf|crypto etf)|sec review[s]? spot|sec'?s crypto accounting|sec accounting policy|fit21|market structure bill|cftc (rule|charge|sue|approv)|securities (rule|regulation|commission)|ripple (labs )?ruling|howey test|unregistered securities|investment contract)\b/i;

const TAX =
  /\b(tax (law|policy|guidance|rule|treatment|plan|reform|free|exempt)|irs (rule|guidance|tax|clarif)|hmrc (tax|says uk bitcoin).*tax|capital gains tax.*crypto|crypto tax (plan|provision)|tax-free btc|reporting requirement[s]? for crypto)\b/i;

const LEGAL_CASE =
  /\b(court (rules?|ruling|decision|order|case|dispute|appeal)|lawsuit|litigation|trademark (claim|for bitcoin)|craig wright.*(lawsuit|sue|court)|legal case|judicial|settlement with (sec|regulator))\b/i;

const GOVERNMENT_ADOPTION =
  /\b(legal tender|nation[- ]state|el salvador (adopt|bitcoin law|legal|president)|central african republic|ukraine legalizes cryptocurrency|strategic bitcoin reserve|government adoption|nation.*adopt.*bitcoin|state.*bitcoin reserve|official currency)\b/i;

const ENFORCEMENT =
  /\b(silk road|shut down (the )?bitcoin|drug (market|site|trade)|illicit activit|money laundering arrest|fbi arrest|criminal (charge|prosecut|investig)|sam bankman-fried|sbf goes to jail|hack(ed|ing) sec.*account|fake bitcoin etf tweet|dark web|illegal trade|crime citing|powers online drug)\b/i;

const SANCTIONS =
  /\b(sanction[s]? (on|against)|ofac|treasury sanctions|mixer promotion|wallet of satoshi exits.*u\.s|expand[s]? surveillance)\b/i;

const BANKING =
  /\b(banks close bitcoin exchange|banking (rule|prudential|capital treatment)|prudential|custody rule|dealer status|banks serve vasp|rbi (considers|ban))\b/i;

const MINING =
  /\b(bitcoin mining (permit|ban|environmental|impact|study|survey)|mining permit|pause new bitcoin mining|treasury to study bitcoin mining)\b/i;

const EXCHANGE =
  /\b(exchange (hack|launch|insolvency|withdrawal halt|closes|shuts down)|mt\.?gox|bitspend shuts|binance.*derivatives license|coinsquare dealer|banks freeze accounts.*shut)\b/i;

const ETF =
  /\b(etf approval|spot etf|bitcoin etf|grayscale.*etf|etf optimism|exchange-traded fund)\b/i;

const ADOPTION =
  /\b(merchant[s]? accept|payment processor|bitpay|accept[s]? bitcoin|bitcoin atm retail|paypal.*crypto buy)\b/i;

const CBDC =
  /\b(cbdc|central bank digital currency|digital ruble|digital yuan pilot)\b/i;

const PRICE_ONLY =
  /\b(price (rises|falls|surge|drop|crash|rally|tumble|slip|climb|holds|gain|slide|rebound)|trades (near|at|above|below)|bullish|bearish|all[- ]time high|\bath\b|market cap|sell[- ]?off|liquidat|drops? to \$|gains? \d+\.\d+%|spiking prices|boosting bitcoin prices)\b/i;

const OFF_TOPIC =
  /\b(news roundup|roundup spotlights|altcoin review expand|genius act.*legitimizes|jackybetman highlight|nacho in rio|world bank forum discuss|michael pascazi|gavin andresen meets congressional.*secure global currency|rfk jr backs bitcoin.*energy policy|kennedy.*fair crypto rules.*energy|debt deal.*lifts bitcoin \d+%|article page shows.*mining survey dispute)\b/i;

function hasBitcoinRegContext(text: string) {
  return /\b(bitcoin|btc|crypto|virtual currency|digital asset|fincen|fca|sec.*etf|bitlicense|mica)\b/i.test(text);
}

/** Date-specific editorial overrides (checked first). */
const OVERRIDES: Record<string, string | null> = {
  "2010-12-28": "Securities regulation",
  "2011-06-06": "Enforcement & crime",
  "2011-06-09": "Enforcement & crime",
  "2011-06-10": "Enforcement & crime",
  "2011-06-21": LEAF,
  "2011-06-29": LEAF,
  "2011-07-07": "Legal cases",
  "2011-12-06": "Banking & prudential (crypto)",
  "2012-04-18": LEAF,
  "2012-05-10": "Enforcement & crime",
  "2012-05-31": LEAF,
  "2012-09-16": LEAF,
  "2012-09-24": LEAF,
  "2013-04-27": "Banking & prudential (crypto)",
  "2013-06-04": LEAF,
  "2013-06-15": null,
  "2013-06-20": "Exchanges",
  "2013-06-24": LEAF,
  "2013-07-07": null,
  "2013-07-08": LEAF,
  "2013-07-12": LEAF,
  "2014-03-11": LEAF,
  "2014-05-10": LEAF,
  "2015-01-30": LEAF,
  "2015-09-26": LEAF,
  "2021-09-24": LEAF,
  "2022-01-23": "Bitcoin mining",
  "2022-01-30": null,
  "2022-03-11": LEAF,
  "2022-03-12": "Sanctions and enforcement",
  "2022-03-17": "Government adoption",
  "2022-04-06": null,
  "2022-05-21": LEAF,
  "2022-06-08": "Bitcoin mining",
  "2022-07-16": LEAF,
  "2022-07-18": LEAF,
  "2022-11-26": LEAF,
  "2023-04-06": LEAF,
  "2023-05-20": LEAF,
  "2023-05-31": LEAF,
  "2023-07-19": "Legal cases",
  "2023-07-20": LEAF,
  "2023-08-11": "Securities regulation",
  "2023-08-12": "Enforcement & crime",
  "2023-08-16": LEAF,
  "2023-09-01": "Securities regulation",
  "2023-11-25": "Sanctions and enforcement",
  "2023-12-10": "Sanctions and enforcement",
  "2023-12-25": LEAF,
  "2024-03-03": "Legal cases",
  "2024-05-08": "Securities regulation",
  "2024-05-22": LEAF,
  "2024-10-17": "Enforcement & crime",
  "2024-12-01": "Government adoption",
  "2013-09-05": LEAF,
  "2013-11-16": LEAF,
  "2014-01-04": LEAF,
  "2014-06-24": LEAF,
  "2015-05-15": LEAF,
  "2015-12-24": LEAF,
  "2017-08-10": LEAF,
  "2022-10-14": LEAF,
  "2014-12-04": LEAF,
  "2015-07-12": LEAF,
  "2016-09-26": LEAF,
  "2016-11-25": LEAF,
  "2017-03-07": LEAF,
  "2017-06-06": LEAF,
  "2017-09-08": LEAF,
  "2017-12-12": LEAF,
  "2021-06-15": LEAF,
  "2013-10-21": "Tax policy",
  "2013-12-15": "Tax policy",
  "2014-03-02": "Tax policy",
  "2014-08-20": "Tax policy",
  "2016-03-21": "Tax policy",
  "2018-02-10": "Banking & prudential (crypto)",
  "2019-02-04": "Legal cases",
};

function classify(date: string, summary: string): string | null {
  const s = summary.trim();
  if (!s) return null;

  if (OVERRIDES[date] !== undefined) return OVERRIDES[date];

  const strongReg = STRONG_REGULATION.test(s);

  if (MONETARY_NO_CRYPTO.test(s) && !hasBitcoinRegContext(s) && !strongReg) {
    return "Monetary policy & rates";
  }

  if (OFF_TOPIC.test(s) && !strongReg) {
    const ranking = rankTopicCandidatesFromSummary({ summary: s }, 3);
    if (ranking.confidence === "high" && ranking.primary) return ranking.primary;
    return null;
  }

  if (GOVERNMENT_ADOPTION.test(s) && !/\b(regulator|regulation|license|ban|fca|fincen|sec delay)\b/i.test(s)) {
    return "Government adoption";
  }

  if (ENFORCEMENT.test(s) && !strongReg && !/\b(regulat|license|ban|rule|law (pass|sign)|fincen|fca|mica|bitlicense)\b/i.test(s)) {
    return "Enforcement & crime";
  }

  if (SANCTIONS.test(s) && !strongReg) return "Sanctions and enforcement";

  if (CBDC.test(s) && !strongReg) return "CBDCs";

  if (MINING.test(s) && !strongReg) return "Bitcoin mining";

  if (BANKING.test(s) && !strongReg && !/\b(regulat|license|register|fincen|fca rule|mica|bitlicense|ban)\b/i.test(s)) {
    return "Banking & prudential (crypto)";
  }

  if (EXCHANGE.test(s) && !strongReg && !/\b(regulat|license|register|fincen|fca|cease and desist|ban)\b/i.test(s)) {
    return "Exchanges";
  }

  if (ETF.test(s) && !strongReg) return "ETFs and investment products";

  if (SECURITIES.test(s) && !/\b(bitcoin ban|outlaw|legal tender|comprehensive bitcoin law|mica regulation|fit21.*bipartisan|crypto market structure)\b/i.test(s)) {
    if (/\b(bitcoin ban|thailand ban|comprehensive bitcoin law|brazil.*bitcoin law)\b/i.test(s)) return LEAF;
    return "Securities regulation";
  }

  if (TAX.test(s) && !strongReg && !/\b(regulat|license|register|fincen|fca|mica|bitlicense|comprehensive.*law)\b/i.test(s)) {
    return "Tax policy";
  }

  if (LEGAL_CASE.test(s) && !strongReg && !/\b(regulat|license|register|fincen|fca rule|mica|bitlicense|law (pass|sign|approv))\b/i.test(s)) {
    return "Legal cases";
  }

  if (ADOPTION.test(s) && !strongReg) return "Bitcoin adoption";

  if (PRICE_ONLY.test(s) && !strongReg) return "Bitcoin price & cycles";

  if (strongReg) return LEAF;

  if (/\b(regulat|regulator|license|licensing|ban|fincen|fca|hmrc|compliance|oversight|legal framework|virtual currency)\b/i.test(s)) {
    return LEAF;
  }

  if (!hasBitcoinRegContext(s)) {
    const ranking = rankTopicCandidatesFromSummary({ summary: s }, 3);
    if (ranking.confidence === "high" && ranking.primary && ranking.primary !== LEAF) return ranking.primary;
    return null;
  }

  const ranking = rankTopicCandidatesFromSummary({ summary: s }, 5);
  if (ranking.primary && ranking.primary !== LEAF && ranking.confidence === "high") return ranking.primary;
  if (ranking.candidates[0] && ranking.candidates[0].leaf !== LEAF && ranking.candidates[0].score >= 14) {
    return ranking.candidates[0].leaf;
  }

  return LEAF;
}

async function main() {
  const rows = await storage.getAnalysesForStorylineLeaf(LEAF);
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

  console.error(JSON.stringify({ total: rows.length, stats, byTarget }, null, 2));

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
