import { eq } from "drizzle-orm";
import { db } from "../../db";
import { historicalNewsAnalyses, pageTopics, topics } from "@shared/schema";
import { TOPIC_HIERARCHY_LEAVES, TOPIC_HIERARCHY_ROOTS } from "@shared/topic-hierarchy";

type StorylineInput = {
  title?: string | null;
  summary?: string | null;
  articleText?: string | null;
  tags?: string[];
  modelTopics?: string[];
};

type TopicRow = typeof topics.$inferSelect;

const KNOWN_NEW_STORYLINES: Record<string, { parent: string; sortOrder: number }> = {
  "halving events": { parent: "Bitcoin", sortOrder: 95 },
};

const ROOT_STORYLINE_LABELS = new Set([
  ...TOPIC_HIERARCHY_ROOTS.map(canonicalLabel),
  "macroeconomics",
  "regulation & policy",
  "companies & infrastructure",
  "people",
  "culture & narrative",
  "security & crime",
  "web3 & other crypto",
]);

const KNOWN_LEAF_STORYLINE_LABELS = new Set(TOPIC_HIERARCHY_LEAVES.map(canonicalLabel));

const BROAD_MODEL_STORYLINE_LABELS = new Set([
  "adoption",
  "bitcoin",
  "company",
  "economic",
  "historical",
  "industry-news",
  "institutional",
  "investment",
  "market",
  "political",
  "regulation",
  "technology",
]);

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function canonicalLabel(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function addUnique(out: string[], label: string) {
  if (!label.trim()) return;
  const key = canonicalLabel(label);
  if (ROOT_STORYLINE_LABELS.has(key) || BROAD_MODEL_STORYLINE_LABELS.has(key)) return;
  if (!KNOWN_LEAF_STORYLINE_LABELS.has(key) && !KNOWN_NEW_STORYLINES[key]) return;
  if (!out.some((x) => canonicalLabel(x) === key)) out.push(label);
}

function corpusFrom(input: StorylineInput): string {
  return [
    input.title,
    input.summary,
    input.articleText?.slice(0, 1600),
    ...(input.tags ?? []),
    ...(input.modelTopics ?? []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

/** Summary + tags only — editorial ground truth for topic assignment. */
function summaryCorpusFrom(input: StorylineInput): string {
  return [input.title, input.summary, ...(input.tags ?? [])]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

const STORYLINE_LEAF_TRIGGERS: Partial<Record<(typeof TOPIC_HIERARCHY_LEAVES)[number], string[]>> = {
  "Politics and elections": [
    "politics",
    "political",
    "election",
    "elections",
    "presidential",
    "midterm",
    "campaign",
    "ballot",
    "congress",
    "senate",
    "republican",
    "democrat",
    "romney",
    "wall street",
    "contributions",
    "fundraising",
    "spending",
    "funding",
  ],
  "Bitcoin price action": ["price", "rally", "crash", "traders", "bitcoin", "btc", "bear", "bull"],
  "Banking stress": ["bank", "shares", "collapse", "bailout", "failure", "rescue"],
  "Labor market": ["unemployment", "strike", "union", "labor", "labour", "jobs"],
  "Housing": ["mortgage", "housing", "fannie", "freddie"],
  "Fraud and scams": ["fraud", "scam", "bribery", "corruption", "ponzi"],
  "Monetary policy": ["inflation", "interest", "federal reserve", "fed", "monetary"],
  "Payment processors": ["paypal", "bitpay", "merchant", "payment processor", "credit card"],
  "DeFi": ["defi", "uniswap", "aave", "lending protocol"],
  "Halving events": ["halving", "halvening", "block reward"],
  "Protocol development": ["bitcoin-qt", "bitcoind", "protocol", "client", "release", "bugfix", "bug fix"],
  "Wallet development": ["wallet", "bitcoin-qt", "self-custody", "custody"],
  "Trading activity": ["trading", "trade", "trades", "expansion", "euros", "pounds", "francs"],
  "Exchanges": ["exchange", "trading platform", "binance", "coinbase", "kraken"],
};

function pickBestStorylineLeaf(corpus: string): string | null {
  const text = corpus.toLowerCase();
  const tokens = new Set(text.split(/[^a-z0-9]+/g).filter((word) => word.length > 2));
  let best: { leaf: string; score: number } | null = null;

  for (const leaf of TOPIC_HIERARCHY_LEAVES) {
    const triggers = STORYLINE_LEAF_TRIGGERS[leaf as keyof typeof STORYLINE_LEAF_TRIGGERS]
      ?? leaf.toLowerCase().split(/[^a-z0-9]+/g).filter((word) => word.length > 2);
    let score = 0;
    for (const trigger of triggers) {
      const normalized = trigger.toLowerCase();
      if (tokens.has(normalized) || text.includes(normalized)) score += 1;
    }
    if (!best || score > best.score) best = { leaf, score };
  }

  return best && best.score >= 2 ? best.leaf : null;
}

function inferStorylineLabelsFromCorpus(corpus: string, modelTopics?: string[]): string[] {
  const out: string[] = [];

  if (/\b(presidential elections?|presidential race|white house race)\b/.test(corpus)) {
    addUnique(out, "Politics and elections");
  }
  if (
    /\b(wall street)\b/.test(corpus) &&
    /\b(romney|obama|biden|trump|mccain|palin|campaign|election|presidential|back|backing|donor|contributions?|nominee|candidacy|executives?)\b/.test(corpus)
  ) {
    addUnique(out, "Politics and elections");
  }
  if (/\b(bitcoin-qt|bitcoin qt|bitcoind)\b/.test(corpus)) {
    addUnique(out, "Protocol development");
  }
  if (
    /\b(critical fix|bug fix|bugfix|improvements?|stability|user experience)\b/.test(corpus) &&
    /\b(bitcoin-qt|bitcoin qt|bitcoind|v0\.|version \d+\.\d+)\b/.test(corpus)
  ) {
    addUnique(out, "Protocol development");
  }

  if (/\b(halving|halvening|block reward|subsidy)\b/.test(corpus)) {
    addUnique(out, "Halving events");
  }
  if (/\b(satoshi nakamoto|satoshi identity|craig wright|bitcoin creator|bitcoin's creator)\b/.test(corpus)) {
    addUnique(out, "Satoshi identity");
  }
  if (/\b(genesis block|first bitcoin block|first block mined|early bitcoin|bitcoin launched|satoshi warns|wikileaks)\b/.test(corpus)) {
    addUnique(out, "Early Bitcoin history");
  }
  if (/\b(canaan|bitmain|marathon|riot|mining company|mining companies)\b/.test(corpus)) {
    addUnique(out, "Mining companies");
  }
  if (
    /\b(bitcoin trading|trading in|allows? trading|trade bitcoin|trading platform|trading desk)\b/.test(corpus) ||
    (/\b(trading|trade|trades|expansion)\b/.test(corpus) && /\b(bitcoin|btc)\b/.test(corpus))
  ) {
    addUnique(out, "Trading activity");
  }
  if (
    /\b(mining|miner|miners|hashrate|difficulty|proof of work|proof-of-work)\b/.test(corpus) &&
    /\b(bitcoin|btc|hashrate|block reward|mining pool|asic|proof of work|proof-of-work)\b/.test(corpus) &&
    !/\b(police|parliamentary|inquiry|investigation|credit rating)\b/.test(corpus)
  ) {
    addUnique(out, "Mining evolution");
  }
  if (/\b(mining pool|poolin|antpool|f2pool|slush pool)\b/.test(corpus)) {
    addUnique(out, "Mining pools");
  }
  if (/\b(solana|cardano|avalanche|polkadot|cosmos|near protocol|algorand|tezos|layer 1|layer-1|l1 network)\b/.test(corpus)) {
    addUnique(out, "Layer 1 networks");
  }
  if (/\b(ethereum|smart contract|smart contracts)\b/.test(corpus) && !/\bbuy\b.{0,80}\bethereum\b/.test(corpus)) {
    addUnique(out, "Ethereum and smart contracts");
  }
  if (/\b(defi|decentralized finance|aave|uniswap|maker|compound|curve|yearn|andre cronje|portal|e-mode|emode|lending protocol)\b/.test(corpus)) {
    addUnique(out, "DeFi");
  }
  if (/\b(stablecoin|stablecoins|tether|usdc|ust|terra|luna)\b/.test(corpus)) {
    addUnique(out, "Stablecoins");
  }
  if (/\b(nft|nfts|blur|marketplace|gamefi|play-to-earn|video game|gaming token|metaverse game)\b/.test(corpus)) {
    addUnique(out, "NFTs and gaming");
  }
  if (/\b(futures|derivatives|open interest|funding rate|perpetual|options trading|bitcoin options|options market)\b/.test(corpus)) {
    addUnique(out, "Derivatives");
  }
  if (/\b(price|momentum|traders?|bottom|top|rally|crash|sell[- ]?off|breaks? down|downtrend|trading volume|market cap|all[- ]?time high|ath|bear market|bull market|whales?|moving average|bullish|bearish)\b/.test(corpus)) {
    addUnique(out, "Bitcoin price action");
  }
  if (/\b(bitcoin|btc)\b/.test(corpus) && /\b(support|resistance)\b/.test(corpus)) {
    addUnique(out, "Bitcoin price action");
  }
  if (/\b(cycle|post-halving|market cycle|four[- ]year|bottom indicator|classic bottom)\b/.test(corpus)) {
    addUnique(out, "Market cycles");
  }
  if (/\b(etf|exchange-traded|trust|fund|investment product|grayscale)\b/.test(corpus)) {
    addUnique(out, "ETFs and investment products");
  }
  if (/\b(liquidity|flows?|inflows?|outflows?)\b/.test(corpus)) {
    addUnique(out, "Liquidity and flows");
  }
  if (/\b(bitcoin core|core developer|maintainer)\b/.test(corpus)) {
    addUnique(out, "Bitcoin Core");
  }
  if (/\b(bip|taproot|segwit|soft fork|hard fork|upgrade|protocol|utreexo|utxo set|p2p encryption)\b/.test(corpus)) {
    addUnique(out, "BIPs and upgrades");
  }
  if (/\b(lightning|layer 2|layer-2|scaling|sidechain)\b/.test(corpus)) {
    addUnique(out, "Scaling and Layer 2");
  }
  if (/\b(node|nodes|full node|infrastructure|utreexo|utxo set|sync bitcoin)\b/.test(corpus)) {
    addUnique(out, "Node infrastructure");
  }
  if (/\b(wallet|self-custody|self custody|custody|private key|seed phrase)\b/.test(corpus)) {
    addUnique(out, "Wallet development");
  }
  if (/\b(paypal|bitpay|gocoin|merchant|merchants|retailer|retailers|store|stores|payment processor|payment processors|bitcoin atm|atm|cash purchases?|donations?|credit cards?|debit cards?|buy bitcoin|buy cryptocurrency|card purchases?)\b/.test(corpus)) {
    addUnique(out, "Payment processors");
  }
  if (/\b(exchange|binance|coinbase|kraken|bitfinex|ftx|mt\.?\s*gox|bitstamp|bitbank)\b/.test(corpus)) {
    addUnique(out, "Exchanges");
  }
  if (/\b(mortgage|housing|home loan|fannie mae|freddie mac)\b/.test(corpus)) {
    addUnique(out, "Housing");
  }
  if (/\b(blackrock|fidelity|jpmorgan|goldman|bank|building society|fannie mae|freddie mac|financial institution|institutional)\b/.test(corpus)) {
    addUnique(out, "Financial institutions");
  }
  if (/\b(bitlicense|money transmitter|licens(e|ing)|regulat|compliance|policy|law|legal|court|lawsuit)\b/.test(corpus)) {
    addUnique(out, "Securities regulation");
  }
  if (/\b(sec|securities|etf|investment trust)\b/.test(corpus)) {
    addUnique(out, "Securities regulation");
  }
  if (/\b(government|state|city council|council|municipal|public sector|property tax|tax payments?|country|el salvador|legal tender|nation-state|nations?)\b/.test(corpus)) {
    addUnique(out, "Government adoption");
  }
  if (/\b(midterm|general election|presidential elections?|election spending|election day|campaign spending|campaign finance|congressional|ballot|primary election|house race|senate race|politics|political)\b/.test(corpus)) {
    addUnique(out, "Politics and elections");
  }
  if (
    /\b(republicans?|democrats?|gop|dnc)\b/.test(corpus) &&
    /\b(elections?|midterm|campaign|contributions?|spending|funding|ballot|congress|senate|politics|political)\b/.test(corpus)
  ) {
    addUnique(out, "Politics and elections");
  }
  if (/\b(inflation|cpi|interest rate|federal reserve|fed|monetary policy)\b/.test(corpus)) {
    addUnique(out, "Monetary policy");
  }
  if (/\b(central bank|ecb|bank of england|boj|pboc)\b/.test(corpus)) {
    addUnique(out, "Central banks");
  }
  if (/\b(aib|bank shares?|shares collapse|shareholders?|banking crisis|bank rescue|bank bailout|failed bank|bank failure)\b/.test(corpus)) {
    addUnique(out, "Banking stress");
  }
  if (/\b(recession|growth|gdp|global economy)\b/.test(corpus)) {
    addUnique(out, "Global growth and recession");
  }
  if (/\b(unemployment|job losses?|labor market|labour market|labor reform|labour reform|unions?|general strike|strike)\b/.test(corpus)) {
    addUnique(out, "Labor market");
  }
  if (/\b(gold|commodity|commodities|oil|silver)\b/.test(corpus)) {
    addUnique(out, "Commodities");
  }
  if (/\b(dollar|yen|euro|sterling|currency|currencies|fx)\b/.test(corpus) && !/\b(bitcoin as currency|digital currency|cryptocurrency)\b/.test(corpus)) {
    addUnique(out, "FX and currencies");
  }
  if (/\b(hack|exploit|breach|stolen|theft|ronin|bridge exploit|bridge hack)\b/.test(corpus)) {
    addUnique(out, "Hacks and exploits");
  }
  if (/\b(fraud|scam|ponzi|corruption|anti-corruption|bribery|bribes?)\b/.test(corpus)) {
    addUnique(out, "Fraud and scams");
  }
  if (/\b(fake|counterfeit|forged|bogus)\b/.test(corpus) && /\b(bond|treasury|securities?|banknote)\b/.test(corpus)) {
    addUnique(out, "Fraud and scams");
  }
  if (/\b(mafia|counterfeit bonds?|fake bonds?|forged bonds?)\b/.test(corpus)) {
    addUnique(out, "Fraud and scams");
  }
  if (/\b(credit rating agencies?|rating agencies?|moody'?s|standard & poor|s&p|fitch ratings?)\b/.test(corpus)) {
    addUnique(out, "Securities regulation");
  }
  if (/\b(parliamentary inquiry|select committee|police investigation)\b/.test(corpus) && /\b(credit rating|downgrade|agency|agencies)\b/.test(corpus)) {
    addUnique(out, "Legal cases");
  }
  if (/\b(debt crisis|sovereign debt|eurozone debt|greek debt)\b/.test(corpus)) {
    addUnique(out, "Debt crises");
  }
  if (/\b(developer group|developers?|development|research|square crypto|optech)\b/.test(corpus)) {
    addUnique(out, "Developer ecosystem");
  }
  if (/\b(privacy|encryption|p2p encryption|self-custody|self custody)\b/.test(corpus)) {
    addUnique(out, "Privacy and self-custody");
  }
  if (/\b(wikileaks|censor|censorship|speech|free speech)\b/.test(corpus)) {
    addUnique(out, "Censorship resistance");
  }
  if (/\b(transaction features?|utxo|utxo set|time lock|timelock)\b/.test(corpus)) {
    addUnique(out, "Transaction features");
  }

  const modelLabels = modelTopics ?? [];
  for (const label of modelLabels) {
    const normalized = canonicalLabel(label);
    if (!normalized || ROOT_STORYLINE_LABELS.has(normalized) || BROAD_MODEL_STORYLINE_LABELS.has(normalized)) continue;
    if (!KNOWN_LEAF_STORYLINE_LABELS.has(normalized) && !KNOWN_NEW_STORYLINES[normalized]) continue;
    addUnique(out, label);
  }

  if (out.length === 0) {
    const fallback = pickBestStorylineLeaf(corpus);
    if (fallback) addUnique(out, fallback);
  }

  return out.slice(0, 1);
}

export function inferStorylineLabels(input: StorylineInput): string[] {
  const summaryCorpus = summaryCorpusFrom(input);
  if (summaryCorpus.trim()) {
    const fromSummary = inferStorylineLabelsFromCorpus(summaryCorpus, input.modelTopics);
    if (fromSummary.length > 0) return fromSummary;
  }
  return inferStorylineLabelsFromCorpus(corpusFrom(input), input.modelTopics);
}

/** Summary-only topic for correction flows — never overridden by article-bundle noise. */
export function inferTopicProposal(input: StorylineInput): string[] {
  const summaryCorpus = summaryCorpusFrom(input);
  if (!summaryCorpus.trim()) return [];
  const fromSummary = inferStorylineLabelsFromCorpus(summaryCorpus);
  if (fromSummary.length > 0) return fromSummary;
  const fallback = pickBestStorylineLeaf(summaryCorpus);
  return fallback ? [fallback] : [];
}

export function storedTopicMisaligned(storedTopics: string[], inferredTopics: string[]): boolean {
  if (inferredTopics.length === 0 || storedTopics.length === 0) return false;
  const stored = canonicalLabel(storedTopics[0]);
  const inferred = canonicalLabel(inferredTopics[0]);
  return stored !== inferred;
}

async function ensureStorylineTopic(label: string, existing: TopicRow[]): Promise<TopicRow | null> {
  const key = canonicalLabel(label);
  const direct = existing.find((t) => canonicalLabel(t.name) === key || canonicalLabel(t.slug ?? "") === slugify(label));
  if (direct) return direct;

  const known = KNOWN_NEW_STORYLINES[key];
  if (!known) return null;

  const parent = existing.find((t) => canonicalLabel(t.name) === canonicalLabel(known.parent));
  if (!parent) return null;

  const inserted = await db
    .insert(topics)
    .values({
      name: label,
      slug: `${slugify(parent.name)}-${slugify(label)}`,
      parentTopicId: parent.id,
      sortOrder: known.sortOrder,
    })
    .onConflictDoNothing()
    .returning();

  if (inserted[0]) return inserted[0];

  const refreshed = await db.select().from(topics);
  return refreshed.find((t) => canonicalLabel(t.name) === key) ?? null;
}

export async function syncStorylineAssignmentsForDate(date: string, labels: string[]): Promise<string[]> {
  const [analysis] = await db
    .select({ id: historicalNewsAnalyses.id })
    .from(historicalNewsAnalyses)
    .where(eq(historicalNewsAnalyses.date, date))
    .limit(1);
  if (!analysis) return [];

  const allTopics = await db.select().from(topics);
  const linked: TopicRow[] = [];
  for (const label of labels.slice(0, 1)) {
    const topic = await ensureStorylineTopic(label, [...allTopics, ...linked]);
    if (topic) linked.push(topic);
  }

  await db.delete(pageTopics).where(eq(pageTopics.analysisId, analysis.id));
  if (linked.length === 0) return [];

  await db.insert(pageTopics).values(
    linked.map((topic, index) => ({
      analysisId: analysis.id,
      topicId: topic.id,
      isPrimary: index === 0,
    })),
  );
  return linked.map((t) => t.name);
}

export async function ensureTopicCategoryAndStorylineLinks(date: string, labels: string[]): Promise<string[]> {
  const linked = await syncStorylineAssignmentsForDate(date, labels);
  return linked.length > 0 ? linked : labels;
}
