/** One-off generator for retag-smart-contracts-l1s TARGET_BY_DATE. */
import "dotenv/config";
import { storage } from "../storage";

const LEAF = "Smart contracts & L1s";

const STRONG_L1 =
  /\b(ethereum (launch|launches|upgrade|hard fork|merge|transitions|transitions to|completes merge|byzantium|constantinople|homestead|london|shanghai|arrow glacier|muir glacier|tangerine whistle|ice age|difficulty bomb|eip-|proof-of-stake|pos\b)|eth docker|geth|besu|nimbus|parity|infura outage|solana (mainnet|outage|halts|network)|cardano (mainnet|hard fork|alonzo|shelley|vasil|byron|goguen|d=0|decentralization)|polkadot (whitepaper|mainnet|relay chain|parachain|agile coretime|np.?o.?s|proof of authority)|cosmos (launch|network)|binance (chain|smart chain|bnb chain)|tron (mainnet|launch)|filecoin mainnet|zcash (launch|delays|zk-snark|zcashd)|monero (launch|fork|hard fork|privacy)|litecoin (network launch|client|segwit activates|segwit adoption)|dogecoin (create|creation|merge-mining|auxpow)|ripple.*codius|xrp ledger|eosio|iota (release|beta|library)|avalanche (whitepaper|partners)|chainlink (mainnet|oracle)|ens protocol|namecoin|primecoin|quark (launch|core)|decred|lisk|golem|expanse|huntercoin|komodo|ergo platform|shibarium|dydx chain|zksync|zkevm|fraxtal|starknet|snapshot x|rollux|sharded|sharding roadmap|daico|vitalik.*(supply cap|buterin proposes)|polkadot.*ico|web3 foundation.*polkadot|bram cohen.*cryptocurrency|chia\b|coti.*trustchain|algorand.*clarity|blockstack.*clarity|syscoin.*rollux|polygon (migrat|launch|zkevm)|matic to pol|pepe.*mog|agile coretime)\b/i;

const BITCOIN_PROTOCOL =
  /\b(bitcoin (core|protocol|hash rate|hashrate|halving|whale|dominance|mining difficulty|cash halv|sv halv|rebounds)|quasar protocol upgrade|bip-|segwit2x|taproot|bitcoind|bitcoin-qt|mimblewimble extension blocks|rsK labs.*bitcoin smart contract|bithalo.*bitcoin)\b/i;

const DEFI =
  /\b(\bthe dao\b|dao (launch|raises|attack|exploit|theft)|defichain|uniswap|aave|compound|flash loan|liquidity mining|yield farming|chainlink'?s link hits|link hits a record|grand central hard fork|tornado|lending protocol|liquidity pool|governance token launch)\b/i;

const PRICE_MARKET =
  /\b(price (hits|rises|falls|surge|drop|crash|rally|tumble|slip|climb|holds|steadies|reject)|trades (near|at)|market cap|sell[- ]?off|liquidat|drops? (below|to) \$|gains? \d+|falls sharply|post(s)? (slight )?gains|crypto market|market (loses|turmoil|dynamics|selloff)|all top \d+ crypto|top 20 crypto|bullish momentum|record high.*matic|pepe and mog hit record|investor confidence|traders (sell|anticipate)|amid market|rebounds? \d+%|surges past \$|slips (near|to|from)|holds near \$|withdrawn from exchanges|withdrawals from exchanges|dominance rises|weakest top asset|combined as defi activity drives)\b/i;

const HALVING =
  /\b(litecoin (undergoes|halving|second halving)|bitcoin cash halv|bitcoin sv.*halving|block reward (from|to) \d+ ltc|cutting the block reward)\b/i;

const MINING =
  /\b(hash ?rate|hashrate|mining (difficulty|revenue|rig|pool)|mines block|core scientific shuts|mobile mining|optimizations for litecoin mining|51% attack)\b/i;

const WALLET =
  /\b(metamask|wallet (launch|desktop|mobile app)|browser wallet|coinomi|viacoin.*wallet|argent secures.*wallet|gateway.*dapps without a full node)\b/i;

const EXCHANGE =
  /\b(coinbase adds|exchange|listing|creditor payout|exits bankruptcy|genesis completes restructuring|celsius (wins|exits|swap))\b/i;

const ETF_INSTITUTIONAL =
  /\b(etf (approv|launch|race|near launch|filings)|spot ethereum etf|solana etf|nasdaq lists|institutional (interest|crypto adoption)|wall street firms pour|goldman joins etf|fund flows|record \$.*outflows)\b/i;

const REGULATION =
  /\b(sec (keeps|pressure|lawsuit|scrutiny)|fasb lets firms|arizona senate|belarus recognizes|facebook lifts.*blockchain ad|nevada issues.*marriage|tax(es)? on tezos|stakers must update software.*tax)\b/i;

const ENFORCEMENT =
  /\b(arrests? ethereum researcher|bankman-fried pleads|do kwon faces|interpol red notice)\b/i;

const WEB3_FUNDING =
  /\b(raises \$\d|secures \$\d|venture capital|vc|a16z|index ventures|invests \$\d|funding round|open-sources.*corda|consensys acquires|binance labs invests|avalanche partners with aws|overstock ceo invests|opencoin secures|mit launches a digital currency initiative|gensyn raises|grant.*parity|optimism after a \$100 million funding)\b/i;

const NFT_GAMING =
  /\b(cryptokitties|nft-minting|peacebridge.*game|fide partners.*chess|goat coin.*meme|musicOS launches.*web3 music)\b/i;

const BITCOIN_ADOPTION =
  /\b(payment processor|crypto payments|merchant|rakuten expands|wix adds|wedbush says bitcoin|jamaican bobsled|community raises)\b/i;

const NOT_L1 =
  /\b(dogecoin foundation relaunch|dogecoin foundation launches a \d+ million|charlie lee sells|putin meets|discord halts|tim draper predicts|quantum-resistant|researchers develop|plc ultima|quarkchain partners|lykke adds|wien energie|shadow|health-care|lobby congress)\b/i;

const OVERRIDES: Record<string, string | null> = {
  "2010-03-01": LEAF,
  "2010-03-05": null,
  "2010-05-06": "Web3 industry and funding",
  "2011-09-07": null,
  "2011-10-07": LEAF,
  "2011-10-13": LEAF,
  "2012-01-02": LEAF,
  "2012-04-07": null,
  "2013-01-05": "Bitcoin price & cycles",
  "2013-05-20": "Web3 industry and funding",
  "2013-08-31": LEAF,
  "2013-09-14": LEAF,
  "2013-10-28": LEAF,
  "2013-11-24": null,
  "2013-12-06": LEAF,
  "2014-01-02": "Bitcoin adoption",
  "2014-01-20": null,
  "2014-04-18": LEAF,
  "2014-07-21": LEAF,
  "2014-07-22": LEAF,
  "2014-08-04": LEAF,
  "2014-08-08": "Protocol & upgrades",
  "2015-04-19": "Web3 industry and funding",
  "2015-07-30": LEAF,
  "2015-08-14": LEAF,
  "2015-08-25": "Halving events",
  "2015-09-28": null,
  "2015-10-11": null,
  "2015-12-28": LEAF,
  "2016-03-14": LEAF,
  "2016-03-23": "Protocol & upgrades",
  "2016-04-30": "DeFi",
  "2016-05-14": null,
  "2016-05-17": "DeFi",
  "2016-05-22": LEAF,
  "2016-06-10": LEAF,
  "2016-06-16": LEAF,
  "2016-06-17": "DeFi",
  "2016-06-18": "DeFi",
  "2016-06-19": "DeFi",
  "2016-07-16": LEAF,
  "2016-07-24": LEAF,
  "2016-07-30": LEAF,
  "2016-08-30": "Bitcoin price & cycles",
  "2016-09-20": LEAF,
  "2016-10-06": LEAF,
  "2016-10-18": LEAF,
  "2016-10-22": "Web3 industry and funding",
  "2016-10-28": LEAF,
  "2016-11-01": LEAF,
  "2016-11-09": "Bitcoin price & cycles",
  "2016-11-11": "Web3 industry and funding",
  "2016-11-14": LEAF,
  "2016-11-15": LEAF,
  "2016-12-18": null,
  "2017-03-29": LEAF,
  "2017-04-02": "Securities regulation",
  "2017-04-21": LEAF,
  "2017-04-24": LEAF,
  "2017-05-04": LEAF,
  "2017-05-10": LEAF,
  "2017-06-04": null,
  "2017-09-29": LEAF,
  "2017-10-15": LEAF,
  "2017-10-16": LEAF,
  "2017-12-03": "NFTs and gaming",
  "2017-12-21": null,
  "2017-12-26": "Bitcoin regulation",
  "2018-01-13": LEAF,
  "2018-02-24": "Web3 industry and funding",
  "2018-03-09": "Wallets & self-custody",
  "2018-03-17": null,
  "2018-04-01": LEAF,
  "2018-04-08": LEAF,
  "2018-05-16": LEAF,
  "2018-05-30": LEAF,
  "2018-06-01": LEAF,
  "2018-06-12": null,
  "2018-08-13": LEAF,
  "2018-08-19": "Bitcoin adoption",
  "2018-08-26": LEAF,
  "2018-09-01": LEAF,
  "2018-09-08": LEAF,
  "2018-09-11": "Bitcoin price & cycles",
  "2018-09-21": LEAF,
  "2018-11-20": "Web3 industry and funding",
  "2018-12-29": null,
  "2019-01-07": LEAF,
  "2019-01-09": "Web3 industry and funding",
  "2019-01-24": LEAF,
  "2019-02-23": null,
  "2019-02-27": "Bitcoin price & cycles",
  "2019-02-28": LEAF,
  "2019-03-03": "ETFs and investment products",
  "2019-03-09": "Bitcoin price & cycles",
  "2019-03-25": "Wallets & self-custody",
  "2019-04-18": LEAF,
  "2019-04-19": LEAF,
  "2019-05-08": "Securities regulation",
  "2019-05-30": LEAF,
  "2019-05-31": "Exchanges",
  "2019-06-08": "Bitcoin price & cycles",
  "2019-07-20": "Bitcoin price & cycles",
  "2019-07-24": "Protocol & upgrades",
  "2019-08-04": "Bitcoin price & cycles",
  "2019-08-05": "Halving events",
  "2019-11-01": null,
  "2019-11-24": LEAF,
  "2019-11-30": "Enforcement & crime",
  "2019-12-08": "Bitcoin price & cycles",
  "2019-12-10": LEAF,
  "2020-01-02": LEAF,
  "2020-01-04": "Bitcoin mining",
  "2020-03-16": LEAF,
  "2020-04-07": "Halving events",
  "2020-04-10": "Halving events",
  "2020-05-06": LEAF,
  "2020-05-26": LEAF,
  "2020-05-27": LEAF,
  "2020-06-10": LEAF,
  "2020-06-18": LEAF,
  "2020-07-07": "DeFi",
  "2020-07-29": LEAF,
  "2020-08-17": LEAF,
  "2020-08-25": "Web3 industry and funding",
  "2020-09-01": LEAF,
  "2020-09-03": "Wallets & self-custody",
  "2020-10-12": "DeFi",
  "2020-10-15": LEAF,
  "2020-10-17": LEAF,
  "2020-11-11": LEAF,
  "2020-12-17": "Web3 industry and funding",
  "2021-01-15": LEAF,
  "2021-03-15": "Bitcoin price & cycles",
  "2021-03-31": LEAF,
  "2021-04-10": "Bitcoin price & cycles",
  "2021-05-10": null,
  "2021-05-26": "Tax policy",
  "2021-07-02": "Bitcoin price & cycles",
  "2021-07-22": LEAF,
  "2021-08-05": LEAF,
  "2021-08-07": LEAF,
  "2021-08-18": null,
  "2021-08-28": LEAF,
  "2021-09-12": LEAF,
  "2021-09-14": LEAF,
  "2021-09-18": "Bitcoin price & cycles",
  "2021-11-12": null,
  "2021-12-09": LEAF,
  "2021-12-18": LEAF,
  "2021-12-21": "Bitcoin price & cycles",
  "2021-12-28": "Bitcoin price & cycles",
  "2022-02-14": LEAF,
  "2022-02-15": LEAF,
  "2022-03-20": LEAF,
  "2022-04-19": LEAF,
  "2022-05-01": LEAF,
  "2022-05-13": "Bitcoin price & cycles",
  "2022-05-19": LEAF,
  "2022-06-24": "Bitcoin mining",
  "2022-07-28": "Bitcoin adoption",
  "2022-09-14": LEAF,
  "2022-09-15": LEAF,
  "2022-09-17": LEAF,
  "2022-09-22": LEAF,
  "2022-11-05": "Bitcoin mining",
  "2022-11-21": null,
  "2022-11-24": LEAF,
  "2022-12-08": "DeFi",
  "2022-12-20": "Bitcoin price & cycles",
  "2022-12-21": LEAF,
  "2022-12-23": "NFTs and gaming",
  "2022-12-31": null,
  "2023-01-04": "Enforcement & crime",
  "2023-01-11": "Web3 industry and funding",
  "2023-02-25": "Bitcoin price & cycles",
  "2023-02-26": "Enforcement & crime",
  "2023-03-14": LEAF,
  "2023-03-24": LEAF,
  "2023-03-27": LEAF,
  "2023-04-12": LEAF,
  "2023-04-14": "Bitcoin price & cycles",
  "2023-06-10": "Bitcoin price & cycles",
  "2023-06-11": "Bitcoin price & cycles",
  "2023-07-01": null,
  "2023-07-28": LEAF,
  "2023-08-25": LEAF,
  "2023-09-07": "Securities regulation",
  "2023-10-26": LEAF,
  "2024-01-05": "ETFs and investment products",
  "2024-01-12": LEAF,
  "2024-01-26": "Bitcoin price & cycles",
  "2024-02-03": null,
  "2024-02-06": LEAF,
  "2024-02-07": LEAF,
  "2024-03-12": "Halving events",
  "2024-04-09": "ETFs and investment products",
  "2024-04-19": "Stablecoins",
  "2024-05-27": "Bitcoin price & cycles",
  "2024-06-11": "Web3 industry and funding",
  "2024-06-16": "ETFs and investment products",
  "2024-07-01": LEAF,
  "2024-08-03": "Exchanges",
  "2024-08-18": "Institutional Bitcoin & flows",
  "2024-08-20": "ETFs and investment products",
  "2024-09-01": LEAF,
  "2024-09-04": LEAF,
  "2024-09-09": LEAF,
  "2014-05-31": "Exchanges",
  "2016-07-15": "Web3 industry and funding",
  "2017-06-24": "Web3 industry and funding",
  "2018-06-09": LEAF,
  "2018-10-12": "Bitcoin price & cycles",
  "2019-05-28": null,
  "2019-11-27": "Exchanges",
  "2020-08-16": "Bitcoin price & cycles",
  "2020-10-01": "Bitcoin price & cycles",
  "2021-07-16": "DeFi",
  "2021-09-27": "Bitcoin price & cycles",
  "2021-10-03": "Bitcoin price & cycles",
  "2022-01-17": "DeFi",
  "2023-01-29": "Bitcoin price & cycles",
  "2023-12-20": LEAF,
  "2024-07-01": LEAF,
  "2024-07-23": LEAF,
  "2024-09-01": "DeFi",
  "2024-11-15": "DeFi",
  "2024-09-19": LEAF,
};

function classify(date: string, summary: string): string | null {
  const s = summary.trim();
  if (!s) return null;

  if (OVERRIDES[date] !== undefined) return OVERRIDES[date];

  if (NOT_L1.test(s)) return null;
  if (ENFORCEMENT.test(s)) return "Enforcement & crime";
  if (ETF_INSTITUTIONAL.test(s)) return "ETFs and investment products";
  if (REGULATION.test(s)) return "Securities regulation";
  if (BITCOIN_PROTOCOL.test(s)) return "Protocol & upgrades";
  if (HALVING.test(s)) return "Halving events";
  if (DEFI.test(s)) return "DeFi";
  if (NFT_GAMING.test(s)) return "NFTs and gaming";
  if (WALLET.test(s)) return "Wallets & self-custody";
  if (EXCHANGE.test(s)) return "Exchanges";
  if (BITCOIN_ADOPTION.test(s)) return "Bitcoin adoption";
  if (WEB3_FUNDING.test(s)) return "Web3 industry and funding";
  if (MINING.test(s) && !STRONG_L1.test(s)) return "Bitcoin mining";
  if (PRICE_MARKET.test(s) && !STRONG_L1.test(s)) return "Bitcoin price & cycles";

  if (STRONG_L1.test(s)) return LEAF;

  if (/\b(ethereum|solana|cardano|polkadot|cosmos|altcoin|blockchain network|mainnet|hard fork|smart contract|layer 1|l1\b)\b/i.test(s)) {
    return LEAF;
  }

  return null;
}

async function main() {
  const rows = await storage.getAnalysesForStorylineLeaf(LEAF);
  const map: Record<string, string | null> = {};
  const stats = { keep: 0, moved: 0, cleared: 0 };
  const moves: Record<string, number> = {};
  const review: Array<{ date: string; summary: string; target: string | null }> = [];

  for (const row of rows) {
    const target = classify(row.date, row.summary ?? "");
    map[row.date] = target;
    if (target === LEAF) stats.keep += 1;
    else if (target === null) {
      stats.cleared += 1;
      review.push({ date: row.date, summary: row.summary ?? "", target });
    } else {
      stats.moved += 1;
      moves[target] = (moves[target] ?? 0) + 1;
      review.push({ date: row.date, summary: row.summary ?? "", target });
    }
  }

  console.log(JSON.stringify({ total: rows.length, stats, moves }, null, 2));
  console.log("\n--- REVIEW (non-keep) ---");
  for (const item of review) {
    console.log(JSON.stringify({ date: item.date, target: item.target, summary: item.summary.slice(0, 90) }));
  }

  const lines = Object.entries(map)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, target]) => {
      const val = target === null ? "null" : `"${target}"`;
      return `  "${date}": ${val},`;
    });

  console.log("\nconst TARGET_BY_DATE: Record<string, string | null> = {");
  console.log(lines.join("\n"));
  console.log("};");
}

main().catch(console.error);
