/** One-off generator for retag-institutional-bitcoin-flows TARGET_BY_DATE. */
import "dotenv/config";
import { storage } from "../storage";

const LEAF = "Institutional Bitcoin & flows";

const STRONG_INST =
  /\b(institutional (bitcoin|btc|crypto|investor|custody|flow|demand|interest|allocation|inflow|outflow)|corporate treasur(y|ies)|corporate treasury (buy|purchase|add|hold)|microstrategy (buys|adds|purchase|hold|announces|reports|acquire|tops)|buys? (over )?\$?\d+[\d,.]* (million|billion).*btc|adds? [\d,]+ btc|holdings? (reach|hit|top|exceed) [\d,]+ btc|tesla (buys|invests|holds|adds|keeps|sells).*bitcoin|square (buys|adds|invests).*bitcoin|marathon (holds|adds|buys).*btc|coinbase custody|fidelity (digital assets|custody|fund|launch)|nydig|bitgo (custody|institutional)|anchorage (digital|custody)|fireblocks|copper (custody|launch)|kingdom trust|northern trust.*crypto|goldman.*(bitcoin|crypto custody|trading desk)|jpmorgan.*(bitcoin|crypto custody|fund)|blackrock.*(bitcoin|btc).*(fund|interest|allocation|tokenized|trading)|bank (launch|offer|expand).*(bitcoin|btc|crypto custody|trading)|tradfi.*(bitcoin|btc)|custody (launch|service|platform|solution).*(bitcoin|btc)|cryptocurrency custody|digital asset custody|bitcoin custody|btc custody|institutional (buy|sell|accumulation|distribution)|whale (buy|accumulation|move|transfer).*\d+.*btc|100,?000 btc leave exchange|leave exchanges.*btc|corporate (buy|purchase|hold).*bitcoin|public company.*(bitcoin|btc)|balance sheet.*bitcoin|treasury (reserve|allocation).*bitcoin|liquidity (provider|landmark).*bitcoin|institutional-grade.*bitcoin|bitcoin (fund|trust).*launch|grayscale buys [\d,]+ bitcoin|grayscale.*(holdings|aum)|digital asset fund|crypto fund launch.*bitcoin|bitcoin.*(fund launch|investment fund)|sovereign wealth.*bitcoin|pension fund.*bitcoin|endowment.*bitcoin|family office.*bitcoin|hedge fund.*bitcoin|asset manager.*bitcoin|needham values bitcoin|second-largest bitcoin whale|long-dormant.*whale|satoshi-era.*whale|wallet moves? \d+ btc|seller[s]? exhaust|short-term.*holder.*add|accumulation begin|spacex holds bitcoin|metaplanet buys|hut 8 buys)\b/i;

const ETF_PRIMARY =
  /\b(spot (bitcoin )?etfs?|bitcoin etfs?|etf (inflows?|outflows?|approval|filing|launch|listing|convert|hit|record|attract|options?|draw)|ibit|fbtc|bitb|arkb|hodl|gbtc|grayscale.*etf|bitcoin etns?|london stock exchange.*(bitcoin|ether|crypto).*etn|bitcoin investment trust|sec approv.*etf|exchange-traded (fund|note)|etfs? buy more btc|etfs? see|bitwise.*etf filing|goldman sachs.*bitcoin etfs?)\b/i;

const TREASURY_PRIMARY =
  /\b(microstrategy (buys|adds|purchase|announce|acquire|tops|plans)|corporate treasury|adds? [\d,]+ btc|buys? \$?[\d,.]+ (million|billion).*bitcoin|tesla (buys|holds|keeps|sells|officially announces).*bitcoin|metaplanet buys|hut 8 buys|custody (launch|service|platform)|cryptocurrency custody|digital asset custody|spacex holds bitcoin|grayscale buys [\d,]+ bitcoin|nydig (raises|partners)|bny mellon launches|u\.s\. bancorp launches|blackrock opens crypto trading|blackrock launches a bitcoin private trust|fidelity weighs bitcoin trading|paradigm secures.*institutional|coinbase expands.*custody|fasb lets companies mark crypto)\b/i;

const ADOPTION =
  /\b(merchant|payment processor|accept[s]? bitcoin|accepting bitcoin|bitpay|donation[s]? via bitcoin|bitcoin atm|retail adoption|virgin galactic|overstock|gyft|paid in bitcoin|pay with bitcoin|restaurant accept|store accept|bitcoin rent|mcdonald'?s accepts bitcoin|kiyosaki.*buy|robert kiyosaki)\b/i;

const EXCHANGE =
  /\b(exchange (launch|hack|insolvency|listing|launches|withdrawal)|mt\.?gox|coinbase (ipo|listing|launches)|binance (launch|hack)|kraken launch|bitstamp launch)\b/i;

const DERIVATIVES =
  /\b(bitcoin futures (launch|market|contract)|cme bitcoin future|cboe bitcoin future|ledgerx|bitmex|deribit|icbit|bitcoin options (market|launch))\b/i;

const PRICE_ONLY =
  /\b(price (rises|falls|surge|drop|crash|rally|tumble|slip|climb|holds|gain|slide|rebound|momentum)|trades (near|at|above|below)|bullish|bearish|all[- ]time high|\bath\b|market cap|sell[- ]?off|liquidat|drops? to \$|gains? \d+\.\d+%|fees fall|lower volatility|eyes \$100,?000|retail stays away|bearish case|intrinsic value|transaction record|surpasses 1 billion total transaction|19\.8 million mined|ordinals see.*trading volume|runes lose momentum|programmability.*ordinals|brc-20|inscriptions slow)\b/i;

const WALLET =
  /\b(hardware wallet|wallet software|self-custody tool|trezor achieve|ledger launch|seed phrase|multisig|coinbase cbbtc|wbtc mint)\b/i;

const MINING =
  /\b(hash ?rate|hashrate|mining (pool|rig|farm|company|hardware)|antminer|bitmain|marathon digital mines|51% attack|asic\b|gpu mining)\b/i;

const MACRO_OFF =
  /\b(unemployment|housing market|recession|stimulus|healthcare|military aid|zimbabwe|barrick gold|cit group|icma|china's foreign exchange|james purnell|conservatives seek|g-20 ministers|japan intervenes|obama forecasts|aig posts|california anti-tax|may day protests|standard & poor|goldman sachs posts|liberty dollar halts|porsche offices|justice dept|kraft foods|world bank|saturn shuts|bank of america|bank of england|blackrock acquires barclays|fidelity introduces a block trading dark pool)\b/i;

/** Date-specific editorial overrides (checked first). */
const OVERRIDES: Record<string, string | null> = {
  "2014-07-27": LEAF,
  "2015-09-23": LEAF,
  "2012-09-03": null,
  "2014-12-19": null,
  "2016-03-09": null,
  "2016-04-29": LEAF,
  "2016-01-31": LEAF,
  "2016-04-02": LEAF,
  "2017-01-26": LEAF,
  "2018-05-25": LEAF,
  "2018-09-15": LEAF,
  "2018-10-01": LEAF,
  "2019-06-11": LEAF,
  "2020-05-11": "Bitcoin price & cycles",
  "2020-05-28": LEAF,
  "2020-09-29": null,
  "2021-02-17": LEAF,
  "2021-08-30": LEAF,
  "2021-02-08": LEAF,
  "2021-04-07": "Bitcoin adoption",
  "2021-07-21": LEAF,
  "2021-08-27": LEAF,
  "2021-10-07": LEAF,
  "2022-02-20": LEAF,
  "2022-07-04": LEAF,
  "2022-07-05": null,
  "2022-07-17": LEAF,
  "2022-07-25": LEAF,
  "2022-08-14": LEAF,
  "2022-08-16": LEAF,
  "2022-10-11": LEAF,
  "2022-10-19": LEAF,
  "2022-10-22": LEAF,
  "2023-01-08": LEAF,
  "2023-04-25": LEAF,
  "2023-10-01": LEAF,
  "2023-12-07": LEAF,
  "2023-12-13": LEAF,
  "2024-03-26": "ETFs and investment products",
  "2024-03-29": "ETFs and investment products",
  "2024-05-06": LEAF,
  "2024-05-26": "ETFs and investment products",
  "2024-08-16": "ETFs and investment products",
  "2024-02-20": LEAF,
  "2024-08-18": "ETFs and investment products",
  "2024-11-14": LEAF,
  "2024-08-29": "ETFs and investment products",
  "2024-09-28": "ETFs and investment products",
  "2024-10-01": LEAF,
  "2024-10-19": "ETFs and investment products",
  "2024-10-30": LEAF,
  "2024-11-10": null,
  "2024-12-25": null,
};

function classify(date: string, summary: string): string | null {
  const s = summary.trim();
  if (!s) return null;

  if (OVERRIDES[date] !== undefined) return OVERRIDES[date];

  if (MACRO_OFF.test(s) && !STRONG_INST.test(s) && !TREASURY_PRIMARY.test(s)) return null;
  if (ETF_PRIMARY.test(s) && !TREASURY_PRIMARY.test(s)) return "ETFs and investment products";
  if (ADOPTION.test(s) && !STRONG_INST.test(s) && !TREASURY_PRIMARY.test(s)) return "Bitcoin adoption";
  if (EXCHANGE.test(s) && !STRONG_INST.test(s)) return "Exchanges";
  if (DERIVATIVES.test(s) && !STRONG_INST.test(s)) return "Derivatives";
  if (WALLET.test(s) && !STRONG_INST.test(s)) return "Wallets & self-custody";
  if (MINING.test(s) && !STRONG_INST.test(s)) return "Bitcoin mining";
  if (PRICE_ONLY.test(s) && !STRONG_INST.test(s)) return "Bitcoin price & cycles";

  if (STRONG_INST.test(s)) return LEAF;

  if (
    /\b(bitcoin|btc)\b/i.test(s) &&
    /\b(custody|institutional|treasury|corporate|whale|fund|bank|tradfi|microstrategy|blackrock|fidelity|grayscale holdings|nydig|bancorp|mellon)\b/i.test(s)
  ) {
    return LEAF;
  }

  return null;
}

async function main() {
  const rows = await storage.getAnalysesForStorylineLeaf(LEAF);
  const map: Record<string, string | null> = {};
  const stats = { keep: 0, moved: 0, cleared: 0 };
  const moves: Record<string, number> = {};

  for (const row of rows) {
    const target = classify(row.date, row.summary ?? "");
    map[row.date] = target;
    if (target === LEAF) stats.keep += 1;
    else if (target === null) stats.cleared += 1;
    else {
      stats.moved += 1;
      moves[target] = (moves[target] ?? 0) + 1;
    }
  }

  console.error(JSON.stringify({ total: rows.length, stats, moves }, null, 2));

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
