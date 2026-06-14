/** One-off generator for retag-exchanges TARGET_BY_DATE. */
import "dotenv/config";

import { storage } from "../storage";
import { rankTopicCandidatesFromSummary } from "../services/editorial-pipeline/storyline-taxonomy";

const LEAF = "Exchanges";
const HALVING_DATES = new Set(["2012-11-28", "2016-07-09", "2020-05-11", "2024-04-20"]);

const EXCHANGE =
  /\b(exchange (launch|launches|launched|found|founds|founded|opens|opening|shuts? down|shutdown|collapse|collapses|insolvency|insolvent|bankrupt|bankruptcy|hack|hacked|breach|breached|theft|stolen|withdrawal halt|withdrawals? halt|pause[s]? trading|trading halt|resume[s]? (service|trading)|rebrand|rebrands|license[d]?|licensing|approval|approved|regulated|broker|brokerage|acquire[s]?|acquisition|migrat(e|es|ion)|reverse takeover|goes public)|#bitcoin-otc|over-the-counter peer|bitcoinmarket|bitcoin market|mt\.? ?gox|bitstamp|coinbase (launch|launches|opens|ipo|unveils|exchange|trading|resume|bans|adds)|kraken|gemini|bitfinex|binance|kucoin|poloniex|bittrex|okcoin|btcc|btc china|huobi|bitflyer|itbit|cex\.io|camp bx|mybitcoin|bitcoinica|tradehill|bitfloor|bit2me|coinsetter|cavirtex|quadriga|shapeshift|igot|cointrader|banx\.io|bter|egopay|buttercoin|melotic|coinffeine|blinktrade|surbitcoin|urdubit|btc vietnam|btc xindia|ccedk|bitx|sf ox|zipconf|exchb|bitcoin-central|bitinstant|bitomat|bitcoin\.de|ringcoin|coinpal|coinad|localbitcoins|hot wallet breach|cold wallet hack|suffers major hack|major hack|trading engine offline|first (official|cryptocurrency) bitcoin exchange|primary global hub|bitcoin exchange focused|safer.*crypto exchange|exchange up for sale|luxembourg approves bitstamp|fully licensed bitcoin exchange|regulated us bitcoin exchange|regulated bitcoin exchange|pakistan'?s first bitcoin exchange|trinidad.*bitcoin exchange|denmark'?s first.*exchange|canadian bitcoin trading|interac.*kraken|coinbase opens bitcoin trading|coinbase launch.*exchange|gemini launch|itbit launch|winklevoss.*gemini|bitstamp halt|bitstamp breach|bitstamp resume|france shuts down.*exchange|yuan deposit|bank account close|banking issue|order book|trading pair|fiat pair|api key|lastpass password|linode servers|social engineering|unencrypted wallet backup|ddos attack|phishing attack|account block|account freeze|market fall and exchange|exchange activity shift|trust fears in exchanges|trust crisis|market confidence|receivership|wind up the exchange|missing fund|customer fund|withdrawal delay|suspicious login|french banking rules|payment partner|licensed payment|euro transfer|polish zloty|integrates users|japanese yen|xbt\/jpy|ringgit bank|merchant payment service enabling bitcoin|robinhood buys bitstamp|btc-e operator|blockpriority|creditor repayments|mt\. ?gox delays|exchange hacks|exchange cooperation|resumes.*trading after deposit)\b/i;

const PRICE_ONLY =
  /\b(price (rises|falls|surge|drop|crash|rally|tumble|slip|climb|holds|gain|slide|rebound|momentum|pressure|plummet)|trades (near|at|above|below)|bullish|bearish|all[- ]time high|\bath\b|market cap|sell[- ]?off|liquidat|drops? to \$|gains? \d+\.\d+%|falls below \$|slides? to \$|rebounds? to \$|from \$17\.5 to mere pennies|bitcoin'?s price|btc price|price volatility|fueling fears over security and price volatility)\b/i;

const ADOPTION =
  /\b(merchant payment|payment processor|accept[s]? bitcoin|accepting bitcoin|bitpay|square market partner|shop with bitcoin|donation[s]? via|paid in bitcoin|pay with bitcoin|opennode|lightning payment|checkout|debit card|gift card|bitcoin atm|buy bitcoin with (card|cash)|spend bitcoin|spending bitcoin|retailer accept|store accept|virgin galactic|gyft|overstock|newegg|pick n pay|remittance app|abra remittance|bitpesa|bitsoko|campus atm|coinsource atm|university accept|wikileaks donat|simplecoin card|netflix.*bitcoin payment|microsoft.*bitpay|bitpay.*merchant|payment option|checkout option|crypto checkout|on-ramp|off-ramp|hedgeable offers free bitcoin|free bitcoin to american investors|plus program through coinbase partnership|square market partners with coinbase allowing users to shop|37coins shuts down.*sms wallet|sms wallet balance|bitcoin remittance startup|bitcoin helps mexicans bypass remittance|sending money home through localbitcoins and atms)\b/i;

const INSTITUTIONAL =
  /\b(microstrategy|corporate treasury|treasury (buy|purchase|hold|add)|grayscale|blackrock|nydig|fidelity.*(custody|fund|launch)|institutional (investor|adoption|custody|flow)|corporate (buy|purchase|hold)|whale (buy|add|move)|etf approval|spot etf|bitcoin etf|bitcoin investment trust|spot trust|etf inflow|xapo secures \$40 million|digital currency group acquires|nasdaq powers noble|teraexchange public|mgt capital takes teraexchange|needham values bitcoin|accumulation begin|100,?000 btc leave exchange|leave exchanges.*\d+.*btc|addresses with over|wallet addresses top|dormant.*whale|satoshi-era.*whale|second-largest bitcoin whale|long-dormant.*whale|block reward.*move|wallet moves? \d+ btc|kiyosaki.*buy|Robert Kiyosaki.*buy|holders? exhaust|seller[s]? exhaust|record sales.*trezor|trezor achieve|coinbase launches an api with oauth2|bitcoin worth.*leaves coinbase as reserves|reserves hit a 2017 low|government moves.*bitcoin.*coinbase prime|seized assets toward sale via coinbase prime)\b/i;

const PROTOCOL =
  /\b(bitcoin core|bitcoin-qt|bitcoind|bip[\s-]?\d|segwit|taproot|soft fork|hard fork|block size|segwit2x|bitcoin cash|bitcoin gold|bitcoin sv|ordinals protocol|brc-20|assumeutxo|utreexo|miniscript|mempool|replace-by-fee|full node|developer funding|blockchain maintenance|pull request|release candidate|v0\.\d|version 0\.|bitcoin fix|sync instead leaves a flaw|invalid block|bitcoin core urge[s]? upgrade|miner[s]? create invalid block|scaling dispute|governance|namecoin|counterparty|dot-bit|smart contract[s]? & l1|programmability.*smart contract|enhance[s]? blockchain|bitcoin foundation suspend|governance concern|decred.*launch|former bitcoin developers launch|21 inc.*asic|21 bitcoin computer|bitfury.*light bulb|bitfury.*mine|coinlab.*mines bitcoin|mining competition|coinconnect.*mining|btcmsg|message service.*blockchain|wikipedia article|trademark bitcoin|developer[s]? discuss|irc chat logs.*developer|bitcoin magazine launch.*buterin|buterin co-founding|fuelcoin|encrypted labs ceo predicts.*digital gold|kernel\.org breach|diginotar breach|certificate authority|bitcointalk\.org.*security breach|forum shutdown|cosby images|hackers breach bitcointalk|bitcoin developers review api|fully support segwit)\b/i;

const MINING =
  /\b(hash ?rate|hashrate|mining (pool|rig|farm|company|hardware|difficulty)|miner[s]? (buy|ship|expand|sell|halt)|antminer|bitmain|marathon|f2pool|51%|asic\b|gpu mining|mines bitcoin|self[- ]mining|bitcoin mining expand|mining with solar|mining gear|shell backs bitcoin mining|duke energy explores bitcoin mining|btc china launches a mining pool|mining pool and merchant payment|cloud mining|g hash|ghash\.io)\b/i;

const WALLET =
  /\b(wallet software|hardware wallet|self-custody tool|trezor|ledger|seed phrase|multisig patent|bitgo patent|blockchain updates bitcoin wallet|android users to theft|metamask|phantom or slope|venmo crypto transfer|external and hardware wallet|wallet bug|blockchain\.info login|wallet id|wallet backup|unencrypted wallet|instawallet|mybitcoin.*wallet|bitcoin vault exploit|blockchain hits 3 million wallets|coinbase trails with 2\.5 million wallets|rogue tor node hijacks blockchain\.info)\b/i;

const ENFORCEMENT =
  /\b(silk road|drug sales|dark web|islamic state|abu ahmed|scam claim|fined for promoting silk|esquire editor.*silk|ransomware appears|encrypts files|demands \d+ bitcoin ransom|school district.*hostage.*hackers demanding|armada collective targets email|extortion|ross ulbricht defense|ulbricht defense fund|pc lock ransomware|new jersey school district|hackers demanding 500 bitcoins|dark web markets|itom to target|twitter hack leads|coinbase announces sale of its analysis software to dea|crypto crime investigations)\b/i;

const REGULATION =
  /\b(regulator move to oversee bitcoin exchange|treasury applies anti-money-laundering|fca rules|sec charges|legal case|court rules|crypto ban|nigeria lifts.*ban|bitcoin regulation|us judge.*fraud claim.*hashfast|fraud claims proceed against bankrupt bitcoin miner)\b/i;

const EARLY =
  /\b(pizza day|10,?000 btc for two pizza|genesis block day|genesis block|bitcoin whitepaper|first (real|commercial)|bitcoin launched|satoshi (posts|mails|vanishes)|origin-era|bitcoin reaches parity|parity with the u\.s\. dollar|good wife feature[s]? bitcoin|bitcoin magazine launches its inaugural|bitcoin foundation launches to support|bitcoin irc users introduce bitbot|freenet chatter|bitbot.*mt gox updates)\b/i;

const SATOSHI =
  /\b(craig wright|satoshi identity|claimed to be satoshi|who is satoshi|satoshi nakamoto identity|satoshi warns|jeronimus offer.*identify mtgox cold wallet)\b/i;

const GOVERNMENT =
  /\b(legal tender|el salvador|central african republic|government adoption|nation[- ]state|official currency|bitcoin law|bitcoin valley)\b/i;

const ETF =
  /\b(etf approval|spot etf|bitcoin etf|etf optimism|exchange-traded fund|sec approv.*etf|grayscale.*etf|etf launch)\b/i;

const DERIVATIVES =
  /\b(futures launch|bitcoin futures|options launch|perp launch|derivatives trading|derivatives milestone|teraexchange.*derivatives|mgt capital.*derivatives|noble markets.*derivatives|bitcoin derivatives trading)\b/i;

const SMART_CONTRACTS =
  /\b(ethereum|solana|cardano|polkadot|defi |uniswap|nft market|web3|altcoin|litecoin|monero|namecoin launch|counterparty launch|magic eden|terra |luna |coinkite adds blackcoin|blackcoin support|blk listing|genesis completes restructuring)\b/i;

const TAX =
  /\b(crypto tax tool|consolidates exchange data.*tax|file bitcoin taxes|ernst & young launches caat)\b/i;

const MACRO_OFF =
  /\b(icma and hong kong|fasb lets banks|james purnell resigns|belfast laptops|obama speaks in cairo|china'?s foreign exchange reserves|cit group files for chapter|conservatives seek to revive fox|japan intervenes in forex|g-20 ministers|german stocks fall|deutsche borse|eu leaders sign fiscal|eurozone deficit|austerity widens|wall street prospers|industrial america|pharma waste|imf offers kosovo|credit card curbs|community way dollar|white house projects|microsoft bing|senator dodd|saudi maaden|chinese collector|massachusetts pulls|egyptian markets|chancellor cuts corporation|audit commission|us treasuries act|eur\/usd swings|bitcoin conference links highlight brazil|i0coin copycat|singularity institute|techcrunch profiles|bitcoin ecosystem matures as options markets|bitcoin and ven spark|bitcoin's decentralized nature raises|bitcoin deflation fears|bitcoin gains recognition being listed|bitcoin allows instant global|bitcoin inspires i0coin|bitcoin traveler gets turned|bitcoin rebounds after a crash|bitcoin gains traction as an alternative|bitcoin draws attention as|bitcoin turns 14 as microstrategy|michael saylor says charlie|wences casares shares|us dollar marks 231 years|mohnish pabrai|trader says retail|cryptoquant ceo says|reddit stays|jpmorgan rates|canaccord says|coronavirus delays|tesla sells bitcoin|southland cu offers|card firm struggles|pick n pay expands.*39 stores.*all tills|buenos aires stock exchange hosts.*vcs|transformative impact on finance|meeting for vcs to discuss bitcoin|coinad rewards chatters|micro payout|spendabit launches|usaa explores blockchain|switzerland warns about bitcoin extortion|melotic shuts down.*wallet services|halsey minor.*wallet services|hashfast|bankrupt bitcoin miner|coinbase cbbtc|wbtc|blockchain phone|zion vault|full bitcoin node on.*phone|nyse euronext agrees to merge|reddit ceo steve huffman visits coinbase)\b/i;

function hasBitcoinContext(text: string) {
  return /\b(bitcoin|btc|mt\.? ?gox|coinbase|bitstamp|kraken|gemini|bitfinex|binance|exchange|crypto)\b/i.test(text);
}

const OVERRIDES: Record<string, string | null> = {
  "2010-01-05": LEAF,
  "2010-03-17": LEAF,
  "2010-07-18": LEAF,
  "2010-10-14": "Early Bitcoin history",
  "2010-10-17": LEAF,
  "2011-01-07": LEAF,
  "2011-01-26": LEAF,
  "2011-02-15": null,
  "2011-04-30": LEAF,
  "2011-06-01": LEAF,
  "2011-06-19": LEAF,
  "2011-07-10": LEAF,
  "2011-07-12": LEAF,
  "2011-07-28": LEAF,
  "2011-07-30": LEAF,
  "2011-08-01": LEAF,
  "2011-08-05": LEAF,
  "2011-08-11": LEAF,
  "2011-08-30": LEAF,
  "2011-09-06": "Protocol & upgrades",
  "2011-09-12": "Protocol & upgrades",
  "2011-09-13": LEAF,
  "2011-10-17": LEAF,
  "2011-11-16": LEAF,
  "2011-12-14": LEAF,
  "2012-01-06": LEAF,
  "2012-01-10": LEAF,
  "2012-02-01": "Protocol & upgrades",
  "2012-02-13": LEAF,
  "2012-02-25": null,
  "2012-03-01": LEAF,
  "2012-03-06": LEAF,
  "2012-05-01": LEAF,
  "2012-05-11": LEAF,
  "2012-05-14": LEAF,
  "2012-05-29": LEAF,
  "2012-06-05": LEAF,
  "2012-06-23": LEAF,
  "2012-07-15": LEAF,
  "2012-07-16": LEAF,
  "2012-07-30": LEAF,
  "2012-08-13": LEAF,
  "2012-08-16": LEAF,
  "2012-08-29": LEAF,
  "2012-09-03": "Institutional Bitcoin & flows",
  "2012-09-04": LEAF,
  "2012-09-05": LEAF,
  "2012-09-25": LEAF,
  "2012-12-09": LEAF,
  "2013-02-27": LEAF,
  "2013-03-02": null,
  "2013-03-08": LEAF,
  "2013-03-10": LEAF,
  "2013-04-03": LEAF,
  "2013-04-04": LEAF,
  "2013-04-17": "Protocol & upgrades",
  "2013-04-18": LEAF,
  "2013-04-19": LEAF,
  "2013-04-21": LEAF,
  "2013-05-17": LEAF,
  "2013-06-01": LEAF,
  "2013-06-17": LEAF,
  "2013-08-25": LEAF,
  "2013-09-12": "Protocol & upgrades",
  "2013-09-13": LEAF,
  "2013-09-29": LEAF,
  "2014-02-16": LEAF,
  "2014-03-20": LEAF,
  "2014-03-30": LEAF,
  "2014-03-31": "Bitcoin adoption",
  "2014-04-02": LEAF,
  "2014-04-03": LEAF,
  "2014-05-06": LEAF,
  "2014-05-15": LEAF,
  "2014-05-24": LEAF,
  "2014-05-31": "Smart contracts & L1s",
  "2014-06-12": LEAF,
  "2014-07-09": LEAF,
  "2014-07-12": LEAF,
  "2014-08-23": LEAF,
  "2014-09-24": LEAF,
  "2014-10-11": LEAF,
  "2014-10-12": "Enforcement & crime",
  "2014-10-19": "Bitcoin mining",
  "2014-10-29": null,
  "2014-10-30": LEAF,
  "2014-11-04": LEAF,
  "2014-11-29": "Enforcement & crime",
  "2014-12-19": "Institutional Bitcoin & flows",
  "2014-12-22": LEAF,
  "2015-01-04": "Enforcement & crime",
  "2015-01-07": LEAF,
  "2015-01-09": LEAF,
  "2015-01-17": LEAF,
  "2015-01-23": LEAF,
  "2015-01-25": LEAF,
  "2015-02-07": LEAF,
  "2015-02-15": LEAF,
  "2015-02-17": LEAF,
  "2015-02-23": "Wallets & self-custody",
  "2015-02-27": "Derivatives",
  "2015-03-05": LEAF,
  "2015-03-19": LEAF,
  "2015-03-22": LEAF,
  "2015-03-23": LEAF,
  "2015-03-26": LEAF,
  "2015-03-27": LEAF,
  "2015-03-28": "Enforcement & crime",
  "2015-04-06": LEAF,
  "2015-04-08": LEAF,
  "2015-04-17": LEAF,
  "2015-04-22": LEAF,
  "2015-05-04": LEAF,
  "2015-05-10": LEAF,
  "2015-05-22": LEAF,
  "2015-05-24": LEAF,
  "2015-06-29": LEAF,
  "2015-07-08": LEAF,
  "2015-07-26": LEAF,
  "2015-08-01": LEAF,
  "2015-08-11": "Bitcoin adoption",
  "2015-08-18": "Legal cases",
  "2015-08-31": LEAF,
  "2015-09-14": LEAF,
  "2015-09-15": LEAF,
  "2015-10-07": LEAF,
  "2015-10-09": LEAF,
  "2015-10-12": LEAF,
  "2015-11-11": "Enforcement & crime",
  "2015-11-20": LEAF,
  "2015-12-20": LEAF,
  "2016-01-06": LEAF,
  "2016-01-13": "Web3 industry and funding",
  "2016-01-19": LEAF,
  "2016-01-27": LEAF,
  "2016-02-13": LEAF,
  "2016-02-20": LEAF,
  "2016-03-30": LEAF,
  "2016-04-09": LEAF,
  "2016-04-11": LEAF,
  "2016-04-13": "Bitcoin adoption",
  "2016-04-24": LEAF,
  "2016-04-25": LEAF,
  "2016-07-14": null,
  "2017-07-29": LEAF,
  "2019-03-05": "Tax policy",
  "2019-04-17": LEAF,
  "2020-06-06": "Enforcement & crime",
  "2020-07-15": "Enforcement & crime",
  "2023-09-13": LEAF,
  "2024-02-20": "Institutional Bitcoin & flows",
  "2024-06-09": LEAF,
  "2024-08-03": "Smart contracts & L1s",
  "2024-10-11": LEAF,
  "2024-12-03": "Institutional Bitcoin & flows",
  "2016-05-28": LEAF,
  "2020-09-27": LEAF,
  "2013-10-23": LEAF,
  "2013-12-17": LEAF,
  "2019-11-27": LEAF,
};

function classify(date: string, summary: string): string | null {
  const s = summary.trim();
  if (!s) return null;

  if (OVERRIDES[date] !== undefined) return OVERRIDES[date];

  if (HALVING_DATES.has(date)) return "Halving events";
  if (MACRO_OFF.test(s) && !EXCHANGE.test(s)) {
    if (hasBitcoinContext(s)) {
      const ranking = rankTopicCandidatesFromSummary({ summary: s }, 3);
      if (ranking.confidence === "high" && ranking.primary) return ranking.primary;
    }
    return null;
  }

  if (SATOSHI.test(s)) return "Satoshi identity";
  if (GOVERNMENT.test(s)) return "Government adoption";
  if (ETF.test(s)) return "ETFs and investment products";
  if (TAX.test(s)) return "Tax policy";

  const exchange = EXCHANGE.test(s);

  if (INSTITUTIONAL.test(s) && !exchange) return "Institutional Bitcoin & flows";
  if (DERIVATIVES.test(s) && !exchange) return "Derivatives";
  if (ENFORCEMENT.test(s) && !exchange) return "Enforcement & crime";
  if (ADOPTION.test(s) && !exchange) return "Bitcoin adoption";
  if (MINING.test(s) && !exchange) return "Bitcoin mining";
  if (WALLET.test(s) && !exchange) return "Wallets & self-custody";
  if (PROTOCOL.test(s) && !exchange) return "Protocol & upgrades";
  if (SMART_CONTRACTS.test(s) && !exchange) return "Smart contracts & L1s";
  if (EARLY.test(s) && !exchange) return "Early Bitcoin history";

  if (REGULATION.test(s) && !exchange) {
    if (/\b(licensed.*exchange|exchange.*licensed|fully licensed bitcoin exchange|regulated.*exchange|new york approval.*exchange|new york review.*exchange)\b/i.test(s)) {
      return LEAF;
    }
    return "Bitcoin regulation";
  }

  if (
    PRICE_ONLY.test(s) &&
    !exchange &&
    !/\b(hack|breach|collapse|insolvency|withdrawal halt|shuts down|shutdown|launch|launches|resume|rebrand|license|approval|regulated exchange)\b/i.test(s)
  ) {
    return "Bitcoin price & cycles";
  }

  if (exchange) return LEAF;

  if (!hasBitcoinContext(s)) {
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
