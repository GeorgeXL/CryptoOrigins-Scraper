/** One-off generator for retag-bitcoin-price-cycles TARGET_BY_DATE. */
import "dotenv/config";
import { storage } from "../storage";

const LEAF = "Bitcoin price & cycles";
const HALVING_DATES = new Set(["2012-11-28", "2016-07-09", "2020-05-11", "2024-04-20"]);

const STRONG_PRICE =
  /\b(bitcoin (price|market|trading|rally|crash|surge|drop|tumble|slide|rebound|momentum|volatility|correction|recovery|bubble|bear market|bull market|cycle|cycles)|btc (price|market|rally|crash|surge|drop)|price (rises|falls|surge|drop|crash|rally|tumble|slip|climb|holds|gain|slide|rebound|momentum|pressure|action|swing|swings|move|moves|target|forecast|prediction)|trades (near|at|above|below|around)|bullish|bearish|all[- ]time high|\bath\b|market cap|sell[- ]?off|liquidat|liquidation|drops? to \$|gains? \d+\.\d+%|falls below \$|slides? to \$|rebounds? to \$|parity with.*(dollar|usd)|reaches parity|crosses \$|breaks \$|tops \$|hits \$|surpasses \$|below \$|above \$|100,?000|90,?000|80,?000|70,?000|60,?000|50,?000|20,?000|10,?000|1,?000|\$100k|\$1 million per bitcoin|million-dollar bitcoin|capitulation|euphoria|fear and greed|greed index|fear index|investor confidence.*(bitcoin|btc|price)|market uncertainty.*(bitcoin|btc|price)|amid price|price fluctuations|price surge|price drop|price crash|price rally|price volatility|lower volatility|higher volatility|fees fall|transaction fees|mempool fees|hash price|mining profitability.*price|stock-to-flow|s2f|halving.*(price|bull|rally|run-up)|post[- ]halving.*(price|rally|surge)|pre[- ]halving.*(price|rally|surge)|cycle (top|bottom|peak|trough)|market cycle|four-year cycle|crypto winter|bitcoin winter|bull run|bear run|crypto rally|bitcoin rally|bitcoin crash|bitcoin surge|bitcoin tumble|bitcoin rebound|bitcoin sell-off|bitcoin sell off|short squeeze|long squeeze|leverage flush|overheated|overbought|oversold|support level|resistance level|technical (analysis|indicator)|golden cross|death cross|200-day|50-day|moving average|rsi|macd|chart pattern|cup and handle|head and shoulders|double top|double bottom|wyckoff|accumulation phase|distribution phase|whale (sell|dump|buy).*price|retail (fomo|panic)|fomo|panic sell|capitulation event|bottom signal|top signal|price discovery|price action|intrinsic value debate|digital gold narrative|store of value.*price|inflation hedge.*price|safe haven.*bitcoin.*price|correlation with (stocks|gold|nasdaq|sp500|equities)|decoupling from|bitcoin dominance|btc dominance|dominance (rises|falls)|altcoin season|bitcoin season|trading volume.*(surge|spike|record)|volume spike.*bitcoin|china.*(ban|crackdown).*price|regulatory.*(pressure|crackdown).*price|etf.*(optimism|speculation).*price|halving countdown.*price|fewer than \d+ blocks remaining.*price|surges in china.*70%.*trading volume|bitcoin regains momentum|bitcoin climbs|bitcoin sees.*leave exchange|eyes \$100|retail stays away|bearish case|dormant.*concern over price|ordinals.*trading volume|runes lose momentum|brc-20.*volume|inscriptions.*volume|wallet addresses top \d+ million|addresses with over \$1k|19\.8 million mined|surpasses 1 billion total transaction|transaction record.*927|seller[s]? exhaust|short-term.*holder.*add|accumulation begin|100,?000 btc leave exchange|leave exchanges.*btc|exchange outflow.*price|exchange inflow.*price|grayscale premium|gb.*tc premium|coinbase premium|kimchi premium|contango|backwardation.*bitcoin|funding rate|open interest.*(surge|record|spike).*bitcoin|futures.*(premium|basis).*bitcoin|options.*(volume|open interest).*bitcoin|miner (capitulation|sell pressure).*price|hash ribbon|puell multiple|mvrv|nupl|realized cap|thermocap|hodl waves|coin days destroyed|dormant supply|long-term holder|short-term holder|supply shock|supply squeeze|scarcity.*price|halving.*supply|stock to flow|rainbow chart|log chart|power law|s-curve adoption.*price)\b/i;

const EXCHANGE =
  /\b(exchange (launch|launches|hack|insolvency|withdrawal halt|shutdown|listing|listings|pauses|pause)|mt\.?gox (launch|hack|collapse|bankruptcy)|coinbase (ipo|listing|launches|opens trading|integrates cbbtc)|binance (launch|hack|pauses|withdrawal|settle)|kraken launch|bitstamp launch|bitfinex hack|cex\.io enter|#bitcoin-otc|over-the-counter peer|bitcoinmarket|bitcoin market.*launch|trading platform launch|withdrawal halt|insolvency|chapter 11.*exchange)\b/i;

const ETF =
  /\b(spot etf|bitcoin etf approval|etf approval|exchange-traded fund|gbtc launch|grayscale.*(etf|convert)|sec approv.*etf|spot bitcoin etf|etf (filing|application|launch|listing|inflow|outflow))\b/i;

const INSTITUTIONAL =
  /\b(microstrategy (buys|adds|purchase|hold|announces|reports)|corporate treasury (buy|purchase|add)|buys? (over )?\$?\d+[\d,.]* (million|billion).*btc|adds? [\d,]+ btc|custody launch|institutional (custody|flow|investor)|nydig|fidelity custody|blackrock.*(fund|allocation).*bitcoin|corporate (buy|purchase|hold).*bitcoin|tesla (buys|invests|holds).*bitcoin)\b/i;

const DERIVATIVES =
  /\b(bitcoin futures (launch|market|contract|listing|approval)|cme bitcoin future|cboe bitcoin future|ledgerx|bitmex launch|deribit|icbit|bitcoin options (market|launch)|bakkt.*future)\b/i;

const HALVING_ONLY =
  /\b(halving (day|event|block|countdown)|block reward halving|reward halving|post[- ]halving|pre[- ]halving|ahead of the upcoming halving|fewer than \d+ blocks remaining|block subsidy halv)\b/i;

const ADOPTION =
  /\b(merchant|payment processor|accept[s]? bitcoin|bitpay|donation[s]? via bitcoin|bitcoin atm|retail adoption|virgin galactic|overstock|gyft|paid in bitcoin|pay with bitcoin|restaurant accept|store accept|lightning payment|opennode|strike.*payment)\b/i;

const PROTOCOL =
  /\b(bitcoin core|bip[\s-]?\d|segwit|taproot|soft fork|hard fork|block size|ordinals protocol|brc-20 token|runes token|assumeutxo|protocol upgrade|bitcoin cash|bitcoin sv)\b/i;

const MINING =
  /\b(hash ?rate|hashrate|mining (pool|rig|farm|company|hardware|difficulty)|antminer|bitmain|marathon digital mines|51% attack|asic launch|gpu mining)\b/i;

const EARLY =
  /\b(pizza day|10,?000 btc for two pizza|genesis block|bitcoin whitepaper|first (real|commercial)|satoshi (posts|mails|vanishes)|origin-era|bitcoin v0\.1|newlibertystandard sets first|first bitcoin sale|mailing list goes live)\b/i;

const SATOSHI =
  /\b(craig wright|satoshi identity|claimed to be satoshi|who is satoshi)\b/i;

const MACRO_OFF =
  /\b(obama forecasts|treasury tightens bailout|aig posts|california anti-tax|may day protests|standard & poor|unemployment jumps|financial crisis boosts confidence in euro|existing home sales|goldman sachs posts|liberty dollar halts|obama signals|federal prosecutors raid porsche|justice dept recommends|japan's democratic party|senator ben nelson|kraft foods|u\.s\. plans.*patriot missile|world bank says latin america|saturn shuts down|bank of america gets early|bank of england chief|senate releases half|bank of america receives|tony shearer|darling warns rbs|jpmorgan chase and citigroup suspend|anglo irish bank|uk banking act|bank of england injects|switzerland eases bank|vince cable warns|aig reveals|china's central bank calls|world bank boosts|handel's investing|white house says it will release|bailout firms spend|swiss postfinance|obama proposes tripling fdic|sri lankan stocks|mit study warns|california supreme court clears|blackrock acquires barclays|eu ministers agree|ge exploits banking|sec weighs cases against bailed|us judge rejects|us megabanks grow|goldman pauses pac|world bank chief says|foreign exchange reserves|china intervenes|fasb lets banks|icma and hong kong|cit group files|james purnell resigns|conservatives seek to revive fox|g-20 ministers|healthcare|health care overhaul|military aid to pakistan|zimbabwe marks|barrick gold raises|derivatives rules.*obama|brooksley born|house republicans delay|trade groups lobby|markit and dtcc|nyse euronext|deutsche boerse|oil and gas traders|us pledges.*military|pharma waste|imf offers|credit card curbs|white house projects|microsoft bing|senator dodd|saudi maaden|chinese collector|massachusetts pulls|egyptian markets|chancellor cuts corporation|audit commission|us treasuries act|eur\/usd swings|i0coin copycat|singularity institute|techcrunch profiles|mohnish pabrai|reddit stays|jpmorgan rates|canaccord says|coronavirus delays|southland cu offers|card firm struggles|house approves sweeping financial|alistair darling|labour mishandled|stefan persson|carlos slim|wealthiest people gain|eth docker|huntercoin|fuelcoin|namecoin|dot-bit|wikipedia article|trademark bitcoin|bitcoin magazine launch.*buterin|fuelcoin|encrypted labs ceo predicts)\b/i;

const SMART_CONTRACTS =
  /\b(ethereum|solana|cardano|polkadot|defi |uniswap|nft market|web3 browsing|terra |luna |altcoin rally|altcoin season without bitcoin price)\b/i;

export function classifyBitcoinPriceCyclesTarget(date: string, summary: string): string | null {
  const s = summary.trim();
  if (!s) return null;

  if (HALVING_DATES.has(date) && HALVING_ONLY.test(s) && !STRONG_PRICE.test(s)) return "Bitcoin mining";

  const overrides: Record<string, string | null> = {
    "2009-01-30": "Early Bitcoin history",
    "2009-10-05": "Early Bitcoin history",
    "2009-10-12": "Early Bitcoin history",
    "2011-02-09": LEAF,
    "2012-11-13": null,
    "2012-09-29": LEAF,
    "2015-06-30": LEAF,
    "2015-08-22": LEAF,
    "2017-05-22": LEAF,
    "2017-07-15": LEAF,
    "2017-07-30": LEAF,
    "2017-10-14": LEAF,
    "2017-11-15": LEAF,
    "2021-11-11": LEAF,
    "2022-10-18": LEAF,
    "2023-05-13": LEAF,
    "2023-08-14": LEAF,
    "2023-09-03": LEAF,
    "2023-11-06": LEAF,
    "2024-03-12": LEAF,
    "2024-06-01": LEAF,
    "2024-07-13": LEAF,
  };

  if (overrides[date] !== undefined) return overrides[date];

  if (MACRO_OFF.test(s) && !STRONG_PRICE.test(s) && !/\b(bitcoin|btc)\b/i.test(s)) return null;
  if (SATOSHI.test(s) && !STRONG_PRICE.test(s)) return "Satoshi identity";
  if (EARLY.test(s) && !STRONG_PRICE.test(s)) return "Early Bitcoin history";
  if (EXCHANGE.test(s) && !STRONG_PRICE.test(s)) return "Exchanges";
  if (ETF.test(s) && !STRONG_PRICE.test(s)) return "ETFs and investment products";
  if (INSTITUTIONAL.test(s) && !STRONG_PRICE.test(s)) return "Institutional Bitcoin & flows";
  if (DERIVATIVES.test(s) && !STRONG_PRICE.test(s)) return "Derivatives";
  if (PROTOCOL.test(s) && !STRONG_PRICE.test(s)) return "Protocol & upgrades";
  if (MINING.test(s) && !STRONG_PRICE.test(s)) return "Bitcoin mining";
  if (ADOPTION.test(s) && !STRONG_PRICE.test(s)) return "Bitcoin adoption";
  if (SMART_CONTRACTS.test(s) && !STRONG_PRICE.test(s)) return "Smart contracts & L1s";

  if (HALVING_ONLY.test(s) && !STRONG_PRICE.test(s)) return "Bitcoin mining";

  if (STRONG_PRICE.test(s)) return LEAF;

  // Bitcoin context with weak price signal — keep if clearly market/trading headline
  if (/\b(bitcoin|btc)\b/i.test(s)) {
    if (/\b(trad(e|ing)|market|investor|holder|volatility|liquidat|rally|crash|surge|drop|price|ath|capitulation|cycle)\b/i.test(s)) {
      return LEAF;
    }
    // Macro with incidental bitcoin mention
    if (MACRO_OFF.test(s)) return null;
    // Generic bitcoin mention without clear leaf — try to clear off-topic
    if (/\b(bitcoin traveler|bitcoin conference links|bitcoin ecosystem matures|bitcoin and ven|bitcoin's decentralized nature|bitcoin deflation fears|bitcoin gains recognition|bitcoin allows instant|bitcoin inspires|bitcoin rebounds after|bitcoin gains traction|bitcoin draws attention|bitcoin turns 14|wences casares|michael saylor says charlie|us dollar marks 231|trader says retail|cryptoquant ceo|tesla sells bitcoin)\b/i.test(s)) {
      if (/\b(price|market|trading|rally|crash|surge|drop|ath)\b/i.test(s)) return LEAF;
      if (/\b(tesla sells|microstrategy|treasury)\b/i.test(s)) return "Institutional Bitcoin & flows";
      return null;
    }
  }

  if (MACRO_OFF.test(s)) return null;

  return null;
}

async function main() {
  const rows = await storage.getAnalysesForStorylineLeaf(LEAF);
  const map: Record<string, string | null> = {};
  const stats = { keep: 0, moved: 0, cleared: 0 };
  const moves: Record<string, number> = {};

  for (const row of rows) {
    const target = classifyBitcoinPriceCyclesTarget(row.date, row.summary ?? "");
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
