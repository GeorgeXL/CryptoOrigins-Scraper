/** One-off generator for retag-protocol-upgrades TARGET_BY_DATE. */
import "dotenv/config";
import { storage } from "../storage";

const LEAF = "Protocol & upgrades";
const HALVING_DATES = new Set(["2012-11-28", "2016-07-09", "2020-05-11", "2024-04-20"]);

const STRONG_PROTOCOL =
  /\b(bitcoin core|bitcoin unlimited|bitcoin knots|bitcoin classic|bitcoin xt|btc1|btcd|bitcoinj|bitcoind|bitcoin-qt|v0\.\d|version 0\.|version \d+\.\d|bip[\s-]?\d|segwit|taproot|soft fork|hard fork|block size|fork|uasf|segwit2x|bitcoin cash|bitcoin gold|bitcoin sv|btg core|ordinals|brc-20|assumeutxo|utreexo|miniscript|mempoolfullrbf|release candidate|\brc\d\b|bug fix|bugfix|critical bug|value overflow|alert system|1mb block|consensus|eclipse attack|p2p transport|optech|pull request|daemon mode|rpc call|checkpoints|invalid btc|184 billion|block.?size war|bip91|bip141|bip340|covenant|ctv|drivechain|cltv|csv|p2sh|schnorr|ecdsa|openssl|protocol|reorgani[sz]|reorg|developer|developers|maintainer|van der laan|scaling dispute|governance|dlc|discreet log|mempool|fee bump|replace[- ]by[- ]fee|full rbf|spam attack|transaction spam|propagat|commit log|code update|patches?|upgrades?|releases?|mainnet launches|btcpy|signet|graftroot|op_eval|op_cat|forcenet|weak block|proof of burn|bloom filter|p2sh|checklocktimeverify|checksequenceverify|merkle|libsecp|bip65|bip148|bip8|bip101|bip100|bip37|bip34|bip16|emergent consensus|genesis hard fork|hash war|difficulty adjustment algorithm|inflation bug|mint extra coins|scriptless|bech32|psbt|asmap|v2 transport|ephemeral anchor|vault opcode|stratum v2 relay|not related to mining pools)\b/i;

const PRICE_LED =
  /\b(price (hits|rises|falls|surge|drop|crash|rally|tumble|slip|climb|holds|steadies)|trades (near|at)|bullish|bearish|all[- ]time high|\bath\b|market cap|sell[- ]?off|liquidat|drops? to \$|gains? \d+\.\d+%|falls below \$|slides? to \$|rebounds? to \$|investor confidence and price|market uncertainty and volatility|amid price fluctuations|traders anticipate)\b/i;

const MINING_ONLY =
  /\b(hash ?rate|hashrate|exahash|petahash|terahash|mining (pool|rig|farm|facility|company|hardware)|marathon digital|mines block 800,?000|stratum v2 upgrades for bitcoin mining pools|coingeek mining|taal|f2pool|antpool|bitmain|hash power|hashing power|51% attack by bitcoin unlimited supporters)\b/i;

const WALLET =
  /\b(wallet (software|product|app)|hardware wallet|trezor marks|exodus 1s|blockchain phone|zion vault|full bitcoin node on.*phone|btg core wallet)\b/i;

const EXCHANGE =
  /\b(exchange hack|withdrawal halt|insolvency|coinbase (ipo|listing|integrates)|bitfinex|mt\.?gox|kraken|binance|cex\.io|exchange abuses|exchanges pause trading)\b/i;

const LIGHTNING_L2 =
  /\b(lightning network|liquid hardfork|sidechain|l2 |layer 2|elements v0\.|used as a dependency in lightning)\b/i;

const SATOSHI_ID =
  /\b(craig wright (allegedly|says|declares)|claiming to be bitcoin's creator|satoshi identity|who is satoshi|court dispute.*gold)\b/i;

const EARLY =
  /\b(genesis block|pizza day|first (real|commercial)|whitepaper|satoshi (posts|mails|vanishes)|origin-era|bitcoin v0\.1\.0)\b/i;

const ADOPTION =
  /\b(merchant payment|payment processor|virgin galactic|gyft|walmart gift|bitpay backs bitcoin abc|coinbase supports both bitcoin chains|mainstream acceptance|bitcore 5\.0 preview.*apps)\b/i;

const MACRO_OFF =
  /\b(house approves sweeping financial|alistair darling|labour mishandled|stefan persson|carlos slim|wealthiest people gain)\b/i;

const ALT_L1 =
  /\b(eth docker|ethereum|monero community|litecoin miners|opensea adopts|huntercoin|smart contracts & l1s)\b/i;

const REGULATION =
  /\b(us regulators move to oversee bitcoin exchanges|treasury applies anti-money-laundering)\b/i;

function classify(date: string, summary: string): string | null {
  const s = summary.trim();
  if (!s) return null;

  if (HALVING_DATES.has(date)) return LEAF;

  const overrides: Record<string, string | null> = {
    "2009-12-11": null,
    "2010-03-01": "Smart contracts & L1s",
    "2010-08-17": null,
    "2011-01-02": LEAF,
    "2011-09-06": "Exchanges",
    "2011-09-28": null,
    "2011-10-02": LEAF,
    "2012-09-19": null,
    "2013-05-05": null,
    "2013-05-07": "Bitcoin regulation",
    "2015-07-08": "Exchanges",
    "2015-12-14": "Satoshi identity",
    "2016-03-06": LEAF,
    "2016-05-14": "Smart contracts & L1s",
    "2016-10-16": "Wallets & self-custody",
    "2017-01-08": LEAF,
    "2017-01-29": LEAF,
    "2017-04-21": "Smart contracts & L1s",
    "2011-11-18": "Smart contracts & L1s",
    "2012-08-24": LEAF,
    "2012-09-22": LEAF,
    "2018-04-23": LEAF,
    "2013-01-27": LEAF,
    "2014-12-13": LEAF,
    "2017-03-21": "Exchanges",
    "2017-05-22": "Bitcoin price & cycles",
    "2017-06-30": LEAF,
    "2017-07-15": "Bitcoin price & cycles",
    "2017-07-19": "Exchanges",
    "2017-10-14": "Bitcoin price & cycles",
    "2017-11-15": "Bitcoin price & cycles",
    "2017-07-30": "Bitcoin price & cycles",
    "2017-08-08": LEAF,
    "2017-08-29": LEAF,
    "2017-10-07": "Bitcoin adoption",
    "2018-02-21": "Exchanges",
    "2018-04-11": LEAF,
    "2018-11-11": "Bitcoin adoption",
    "2018-12-13": LEAF,
    "2019-05-11": "Wallets & self-custody",
    "2019-10-19": "Wallets & self-custody",
    "2020-01-15": "Bitcoin mining",
    "2020-05-03": "Bitcoin mining",
    "2021-01-20": LEAF,
    "2021-09-29": "Scaling and Layer 2",
    "2021-11-11": "Bitcoin price & cycles",
    "2022-01-27": null,
    "2022-04-19": "Smart contracts & L1s",
    "2022-06-14": "NFTs and gaming",
    "2022-10-05": LEAF,
    "2022-10-11": "Bitcoin mining",
    "2023-05-21": "Bitcoin mining",
    "2023-07-24": "Bitcoin mining",
    "2024-02-14": "Scaling and Layer 2",
  };

  if (overrides[date] !== undefined) return overrides[date];

  if (MACRO_OFF.test(s)) return null;
  if (SATOSHI_ID.test(s)) return "Satoshi identity";
  if (EARLY.test(s) && !STRONG_PROTOCOL.test(s)) return "Early Bitcoin history";
  if (REGULATION.test(s)) return "Bitcoin regulation";
  if (ALT_L1.test(s) && !STRONG_PROTOCOL.test(s)) return "Smart contracts & L1s";
  if (EXCHANGE.test(s) && !STRONG_PROTOCOL.test(s)) return "Exchanges";
  if (WALLET.test(s) && !STRONG_PROTOCOL.test(s)) return "Wallets & self-custody";
  if (LIGHTNING_L2.test(s) && !/\bsegwit activates|enabling innovations like the lightning/i.test(s)) {
    return "Scaling and Layer 2";
  }
  if (ADOPTION.test(s) && !STRONG_PROTOCOL.test(s)) return "Bitcoin adoption";
  if (MINING_ONLY.test(s) && !STRONG_PROTOCOL.test(s)) return "Bitcoin mining";
  if (PRICE_LED.test(s) && !STRONG_PROTOCOL.test(s)) return "Bitcoin price & cycles";

  if (STRONG_PROTOCOL.test(s)) return LEAF;

  // BCH/BSV/BTG fork governance stays protocol even with mining mentions
  if (/\b(bitcoin cash|bitcoin sv|bitcoin gold|bitcoin diamond|bitcoin atom|bchn|bitcoin abc)\b/i.test(s)) {
    return LEAF;
  }

  // Default: keep protocol-tagged rows that are clearly dev/release news
  if (/\b(bitcoin|btc|satoshi|bitcoind)\b/i.test(s)) return LEAF;

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

  console.log(JSON.stringify({ total: rows.length, stats, moves }, null, 2));

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
