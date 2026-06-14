/** One-off generator for retag-bitcoin-adoption TARGET_BY_DATE. */
import "dotenv/config";

import { storage } from "../storage";
import { rankTopicCandidatesFromSummary } from "../services/editorial-pipeline/storyline-taxonomy";

const LEAF = "Bitcoin adoption";
const HALVING_DATES = new Set(["2012-11-28", "2016-07-09", "2020-05-11", "2024-04-20"]);

const ADOPTION_SIGNAL =
  /\b(merchant[s]?|payment processor[s]?|bitpay|gocoin|accept[s]? (bitcoin|btc|crypto)|accepting (bitcoin|btc|crypto)|bitcoin (payment[s]?|checkout|pay|paid|donation[s]?|donate[s]?|atm[s]?|debit card|prepaid card|gift card|remittance|remittances)|pay with bitcoin|paid in bitcoin|paypal.*bitcoin|bitcoin.*paypal|donations? via bitpay|donate[s]? (bitcoin|btc|crypto)|retailer[s]?|store[s]? accept|shop[s]? accept|restaurant[s]? accept|airline[s]? accept|hotel[s]? accept|buy bitcoin (with|via|by) (card|cash|credit|debit|prepaid)|bitcoin atm|two-way bitcoin atm|cash to bitcoin|bitcoin for (pizza|tuition|rent|hosting|tickets|flights|meals|purchases?)|living on bitcoin|spend bitcoin|spending bitcoin|lightning (network )?(payment[s]?|checkout|accept)|opennode|strike (launch|add|enable|partner)|cash app.*lightning|pick n pay|mcdonald'?s accept|proton mail.*bitcoin|ferrari.*accept|hublot.*accept|familymart|living room of satoshi|pay anyone|bitgreet|bitinstant.*debit|coinify|coinzone|cubits|e-coin.*debit|shift.*debit|visa bitcoin debit|mastercard.*bitcoin|gyft|virgin galactic|overstock|newegg|lionsgate.*bitcoin|dewlance|glowhost.*bitcoin|meze grill|room 77|burger king.*bitcoin|lot polish|rakuten.*bitcoin|stripe.*opennode|launch cart.*opennode|bonafide|bitmesh|tixie|bitcoinblackfriday|payroll.*bitcoin|salary.*bitcoin|staff.*paid.*bitcoin|employees.*bitcoin|tuition.*bitcoin|rent.*bitcoin|bitcoin world tour|adopting bitcoin conference|bitcoin valley|built with bitcoin|bitcoin technology center|micro-econom|financial inclusion.*bitcoin|everyday (purchase|payment|spending)|mainstream.*(payment|accept|use)|real-world (utility|use|payment)|merchant fee|low-friction payment|peer-to-peer payment|p2p payment|remittance app|abra'?s remittance|bitpesa|bitsoko|localbitcoins.*atm|campus.*atm|coinsource.*atm|mike tyson.*atm|simon fraser.*bitcoin|university.*accept.*bitcoin|singularity institute.*donat|wikileaks.*donat|nyscf.*donat|nepal earthquake.*donat|lulzsec.*donat|free state project.*accept|simplecoin.*card|coinbase.*canad|coinbase.*singapore|circle.*london|circle.*payment|netflix.*bitcoin.*payment|microsoft.*bitpay|bitpay.*merchant|bitpay.*1,?000 merchant|bitpay.*exceed|bitpay.*staff|bitpay.*partner|coinbase.*trading.*canad|payment option|checkout option|crypto checkout|fiat-crypto on-ramp|on-ramp|off-ramp|buy.?sell.*atm|spend at millions of merchant)\b/i;

const GOVERNMENT =
  /\b(legal tender|nation[- ]state|nation state|national (bitcoin )?adoption|government adoption|el salvador (adopt|bitcoin law|legal|expands|hosts|wins|president)|central african republic|car (adopt|bitcoin|legal|sango|hub)|honduras.*bitcoin valley|pontinha adopt|indira kempis|samson mow.*nation|prince philip.*bitcoin adoption|jurisdiction.*official currency|official currency|e-passport|e-residency.*bitcoin|state.*bitcoin (law|policy|reserve))\b/i;

const INSTITUTIONAL =
  /\b(microstrategy|corporate treasury|treasury (buy|purchase|hold|add)|buys? (over )?\$?\d+.*(million|billion).*btc|adds? \d+.*btc|holdings? (to|reach|hit) \d+|grayscale|blackrock.*(trust|fund|launch)|nydig|fidelity.*(custody|fund|launch)|institutional (investor|adoption|custody|flow)|corporate (buy|purchase|hold)|whale (buy|add|move)|second-largest bitcoin whale|dormant.*whale|long-dormant.*whale|satoshi-era.*whale|wallet moves? \d+ btc|block reward.*move|needham values bitcoin|bitcoin investment trust|spot trust|etf inflow|leave exchanges.*\d+.*btc|100,?000 btc leave exchange|accumulation begin|short-term.*holder.*add|addresses with over \$1k|wallet addresses top \d+ million|record sales.*trezor|trezor achieve|kiyosaki.*buy \d+ bitcoin|Robert Kiyosaki.*buy|whale activity|large-holder activity|holders? exhaust|seller[s]? exhaust)\b/i;

const ETF =
  /\b(etf approval|spot etf|bitcoin etf|etf optimism|exchange-traded fund|sec approv.*etf|grayscale.*etf|etf launch)\b/i;

const PRICE_ONLY =
  /\b(price (rises|falls|surge|drop|crash|rally|tumble|slip|climb|holds|gain|slide|rebound|momentum|pressure)|trades (near|at|above|below)|bullish|bearish|all[- ]time high|\bath\b|market cap|sell[- ]?off|liquidat|drops? to \$|gains? \d+\.\d+%|falls below \$|slides? to \$|rebounds? to \$|parity with.*dollar|reaches parity|surges in china.*70%.*trading volume|bitcoin regains momentum.*price surge|bitcoin climbs with tech|bitcoin sees.*leave exchange|fees fall|lower volatility|eyes \$100,?000|retail stays away|bearish case|intrinsic value|dormant.*concern over price|transaction record.*927,?000|surpasses 1 billion total transaction|19\.8 million mined|surpasses 19\.8 million|ordinals see.*trading volume|runes lose momentum|programmability.*ordinals|brc-20|inscriptions slow|wallet addresses top|addresses with over)\b/i;

const EXCHANGE =
  /\b(exchange (hack|launch|launches|listing|listings|insolvency|withdrawal|abuses|pauses|pause)|mt\.?gox|bitfinex|binance (hack|launch|pauses|withdrawal|settle)|coinbase (ipo|listing|launches|unveils cbbtc)|kraken|bitstamp|cex\.io enter|trading platform launch|withdrawal halt|network congestion.*withdrawal|eToro.*trade|coinbase opens.*trading|coinbase launch.*trading|trade on etoro|#bitcoin-otc|over-the-counter peer|localbitcoins)\b/i;

const PROTOCOL =
  /\b(bitcoin core|bitcoin-qt|bitcoind|bip[\s-]?\d|segwit|taproot|soft fork|hard fork|block size|segwit2x|bitcoin cash|bitcoin gold|bitcoin sv|ordinals protocol|brc-20 token|runes token|assumeutxo|utreexo|miniscript|mempool|replace-by-fee|full node|developer funding|blockchain maintenance|programmability.*smart contract|enhance[s]? blockchain|pull request|release candidate|v0\.\d|version 0\.|bitcoin foundation suspend|governance concern|decred.*launch|former bitcoin developers launch|namecoin|dot-bit|anonymous launches dot|smart contract[s]? & l1|counterparty|blockchain chief says|nasdaq.*blockchain|mit.*digital currency initiative|21 inc.*asic|21 bitcoin computer|bitfury.*light bulb|bitfury.*mine|coinlab.*mines bitcoin|mining competition|coinconnect.*mining|btcmsg|message service.*blockchain|wikipedia article|trademark bitcoin|michael pascazi.*trademark|developer[s]? discuss|irc chat logs.*developer|bitcoin magazine launch.*buterin|buterin co-founding|fuelcoin|encrypted labs ceo predicts.*digital gold)\b/i;

const HALVING =
  /\b(halving (day|event|block|countdown)|block reward halving|reward halving|post[- ]halving|pre[- ]halving|ahead of the upcoming halving|fewer than \d+ blocks remaining)\b/i;

const SATOSHI =
  /\b(craig wright|satoshi identity|claimed to be satoshi|who is satoshi|satoshi nakamoto identity|satoshi warns)\b/i;

const EARLY =
  /\b(pizza day|10,?000 btc for two pizza|jeremy sturdivant|laszlo hanyecz|first bitcoin poker|genesis block|bitcoin whitepaper|first (real|commercial)|bitcoin launched|satoshi (posts|mails|vanishes)|early bitcoin|origin-era|bitcoin reaches parity|parity with the u\.s\. dollar|good wife feature[s]? bitcoin|bitcoin magazine launches its inaugural|bitcoin foundation launches to support)\b/i;

const MINING =
  /\b(hash ?rate|hashrate|mining (pool|rig|farm|company|hardware|difficulty)|miner[s]? (buy|ship|expand|sell|halt)|antminer|bitmain|marathon|f2pool|51%|asic\b|gpu mining|mines bitcoin|self[- ]mining|bitcoin mining expand|mining with solar|mining gear|shell backs bitcoin mining|duke energy explores bitcoin mining)\b/i;

const WALLET =
  /\b(wallet software|hardware wallet|self-custody tool|trezor achieve|ledger|seed phrase|multisig patent|bitgo patent|blockchain updates bitcoin wallet|android users to theft|metamask|phantom or slope|venmo crypto transfer|external and hardware wallet|wallet bug|coinbase cbbtc|wbtc)\b/i;

const SCALING =
  /\b(lightning network (research|protocol|expand|infrastructure)|layer 2 research|sidechain research)\b/i;

const SMART_CONTRACTS =
  /\b(ethereum|solana pay|solana link|cardano |polkadot|defi |uniswap|magic eden.*ordinals|nft market|web3 browsing|unstoppable domains|opera.*web3|paypal.*eth|paypal.*metamask|shopify.*usdc|terra |luna |altcoin)\b/i;

const ENFORCEMENT =
  /\b(silk road|drug sales|dark web|islamic state|abu ahmed|scam claim|fined for promoting silk|esquire editor.*silk|paypal shuts down coinpal|coinpal.*exchange account)\b/i;

const REGULATION =
  /\b(regulator|regulation|fca rules|sec charges|legal case|court rules|crypto ban|nigeria lifts.*ban)\b/i;

const OFF_TOPIC =
  /\b(pharma waste|imf offers kosovo|credit card curbs|community way dollar|white house projects|microsoft bing|senator dodd|saudi maaden|chinese collector|massachusetts pulls|egyptian markets|chancellor cuts corporation|audit commission|us treasuries act|eur\/usd swings|bitcoin conference links highlight brazil|i0coin copycat|singularity institute|techcrunch profiles|bitcoin ecosystem matures as options markets|bitcoin and ven spark|bitcoin's decentralized nature raises|bitcoin deflation fears|bitcoin gains recognition being listed|bitcoin allows instant global|bitcoin inspires i0coin|bitcoin traveler gets turned|bitcoin rebounds after a crash|bitcoin gains traction as an alternative|bitcoin draws attention as|bitcoin turns 14 as microstrategy|michael saylor says charlie|wences casares shares|us dollar marks 231 years|mohnish pabrai|trader says retail|cryptoquant ceo says|reddit stays|jpmorgan rates|canaccord says|coronavirus delays|tesla sells bitcoin|southland cu offers|card firm struggles|pick n pay expands.*39 stores.*all tills)\b/i;

function hasBitcoinContext(text: string) {
  return /\b(bitcoin|btc|bitpay|coinbase|lightning|satoshi|crypto)\b/i.test(text);
}

/** Date-specific editorial overrides (checked first). */
const OVERRIDES: Record<string, string | null> = {
  "2009-05-22": null,
  "2010-01-24": "Early Bitcoin history",
  "2010-05-17": "Early Bitcoin history",
  "2010-05-18": "Early Bitcoin history",
  "2010-05-20": "Early Bitcoin history",
  "2010-05-24": "Early Bitcoin history",
  "2011-02-09": "Bitcoin price & cycles",
  "2011-04-30": "Exchanges",
  "2011-06-11": "Enforcement & crime",
  "2011-06-24": LEAF,
  "2011-08-20": null,
  "2011-09-07": "Smart contracts & L1s",
  "2011-09-25": "Bitcoin mining",
  "2011-10-12": "Protocol & upgrades",
  "2011-11-18": "Protocol & upgrades",
  "2011-11-22": "Bitcoin mining",
  "2011-11-29": "Protocol & upgrades",
  "2012-03-20": "Enforcement & crime",
  "2012-04-04": "Government adoption",
  "2012-04-26": "Bitcoin mining",
  "2012-05-09": "Early Bitcoin history",
  "2012-09-03": "Exchanges",
  "2012-09-28": "Early Bitcoin history",
  "2012-09-29": "Bitcoin price & cycles",
  "2014-03-05": LEAF,
  "2014-03-24": LEAF,
  "2014-07-27": "Institutional Bitcoin & flows",
  "2015-04-19": "Smart contracts & L1s",
  "2015-05-01": "Bitcoin mining",
  "2015-06-01": "Wallets & self-custody",
  "2015-06-02": "Bitcoin mining",
  "2015-06-09": "Enforcement & crime",
  "2015-06-30": "Bitcoin price & cycles",
  "2015-07-03": LEAF,
  "2015-07-04": LEAF,
  "2015-08-22": "Bitcoin price & cycles",
  "2015-09-21": "Bitcoin mining",
  "2015-10-02": "Smart contracts & L1s",
  "2015-10-11": "Smart contracts & L1s",
  "2015-12-15": "Government adoption",
  "2015-12-21": "Protocol & upgrades",
  "2015-12-28": "Smart contracts & L1s",
  "2016-01-24": "Smart contracts & L1s",
  "2016-02-16": "Bitcoin mining",
  "2016-04-02": "Institutional Bitcoin & flows",
  "2016-04-08": LEAF,
  "2016-04-10": LEAF,
  "2020-03-03": LEAF,
  "2020-05-07": LEAF,
  "2020-05-24": LEAF,
  "2022-05-18": "Wallets & self-custody",
  "2022-07-03": "Government adoption",
  "2022-07-04": "Institutional Bitcoin & flows",
  "2022-07-10": "Bitcoin mining",
  "2022-07-17": "Institutional Bitcoin & flows",
  "2022-08-14": "Institutional Bitcoin & flows",
  "2022-08-16": "Institutional Bitcoin & flows",
  "2022-09-03": "Government adoption",
  "2022-10-01": LEAF,
  "2022-10-09": "Bitcoin mining",
  "2022-11-12": "Bitcoin mining",
  "2022-12-10": "Bitcoin mining",
  "2022-12-12": "Smart contracts & L1s",
  "2022-12-13": "Bitcoin mining",
  "2022-12-19": "Smart contracts & L1s",
  "2023-01-08": "Institutional Bitcoin & flows",
  "2023-02-03": null,
  "2023-02-12": LEAF,
  "2023-02-23": "Protocol & upgrades",
  "2023-03-22": "NFTs and gaming",
  "2023-04-25": "Institutional Bitcoin & flows",
  "2023-04-28": "Wallets & self-custody",
  "2023-05-07": "Exchanges",
  "2023-08-16": "Bitcoin regulation",
  "2023-08-24": "Stablecoins",
  "2023-09-03": "Bitcoin price & cycles",
  "2023-10-08": "Protocol & upgrades",
  "2023-10-28": "Smart contracts & L1s",
  "2023-11-06": "Bitcoin price & cycles",
  "2023-12-07": "Institutional Bitcoin & flows",
  "2023-12-23": "ETFs and investment products",
  "2024-03-31": "Protocol & upgrades",
  "2024-04-27": "Protocol & upgrades",
  "2024-05-05": "Early Bitcoin history",
  "2024-05-06": "Institutional Bitcoin & flows",
  "2024-05-14": "Protocol & upgrades",
  "2024-05-19": "Protocol & upgrades",
  "2024-05-25": null,
  "2024-06-01": "Bitcoin price & cycles",
  "2024-07-13": "Bitcoin price & cycles",
  "2024-08-14": "Smart contracts & L1s",
  "2024-10-27": LEAF,
  "2024-11-10": "Institutional Bitcoin & flows",
  "2024-11-30": "Wallets & self-custody",
  "2024-12-24": "Early Bitcoin history",
};

function classify(date: string, summary: string): string | null {
  const s = summary.trim();
  if (!s) return null;

  if (OVERRIDES[date] !== undefined) return OVERRIDES[date];

  const adoption = ADOPTION_SIGNAL.test(s);

  if (HALVING_DATES.has(date)) return "Halving events";
  if (SATOSHI.test(s) && !adoption) return "Satoshi identity";

  if (GOVERNMENT.test(s)) return "Government adoption";

  if (ETF.test(s) && !adoption) return "ETFs and investment products";

  if (INSTITUTIONAL.test(s) && !/\b(accept[s]?|payment[s]?|merchant|donat|atm|checkout|debit card|paid in|pay with|tuition|rent contract|hosting|tickets|flights|restaurant|store|retailer|airline|paypal.*merchant|bitpay)\b/i.test(s)) {
    return "Institutional Bitcoin & flows";
  }

  if (EXCHANGE.test(s) && !adoption) return "Exchanges";

  if (HALVING.test(s) && !adoption) return "Halving events";

  if (PROTOCOL.test(s) && !adoption) return "Protocol & upgrades";

  if (MINING.test(s) && !adoption) return "Bitcoin mining";

  if (WALLET.test(s) && !adoption) return "Wallets & self-custody";

  if (SCALING.test(s) && !adoption && !/\bpayment[s]?|accept[s]?|merchant|checkout|paid|spend\b/i.test(s)) {
    return "Scaling and Layer 2";
  }

  if (SMART_CONTRACTS.test(s) && !adoption) return "Smart contracts & L1s";

  if (ENFORCEMENT.test(s) && !adoption) {
    if (/\bdonat/i.test(s) && /\bbitcoin\b/i.test(s)) return LEAF;
    return "Enforcement & crime";
  }

  if (EARLY.test(s) && !adoption) return "Early Bitcoin history";

  if (PRICE_ONLY.test(s) && !adoption) return "Bitcoin price & cycles";
  if (
    PRICE_ONLY.test(s) &&
    adoption &&
    !/\b(accept[s]?|merchant|payment|donat|atm|checkout|debit card|paid in|pay with|tuition|rent|hosting|bitpay|paypal|opennode|strike|lightning payment|spend at|buy bitcoin with)\b/i.test(s) &&
    /\b(price surge|regains momentum|climbs with|surges in china|trading volume despite|bearish case|intrinsic value|retail stays away|eyes \$100|lower volatility|electronic cash as adoption)\b/i.test(s)
  ) {
    return "Bitcoin price & cycles";
  }

  if (REGULATION.test(s) && !adoption) {
    if (/\baccept[s]?|payment|merchant|donat|atm\b/i.test(s)) return LEAF;
    return "Bitcoin regulation";
  }

  if (OFF_TOPIC.test(s) && !hasBitcoinContext(s)) {
    const ranking = rankTopicCandidatesFromSummary({ summary: s }, 3);
    if (ranking.confidence === "high" && ranking.primary) return ranking.primary;
    return null;
  }

  if (!hasBitcoinContext(s)) {
    const ranking = rankTopicCandidatesFromSummary({ summary: s }, 3);
    if (ranking.confidence === "high" && ranking.primary && ranking.primary !== LEAF) return ranking.primary;
    if (ranking.primary && ranking.primary !== LEAF && ranking.candidates[0]?.score >= 12) return ranking.primary;
    return null;
  }

  if (adoption) return LEAF;

  // Weak bitcoin context — try taxonomy ranking
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
