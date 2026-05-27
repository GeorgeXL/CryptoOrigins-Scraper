import { eq } from "drizzle-orm";
import { db } from "../../db";
import { historicalNewsAnalyses, pageTopics, topics } from "@shared/schema";

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

export function inferStorylineLabels(input: StorylineInput): string[] {
  const out: string[] = [];
  const corpus = corpusFrom(input);

  if (/\b(halving|halvening|block reward|subsidy)\b/.test(corpus)) {
    addUnique(out, "Halving events");
  }
  if (/\b(canaan|bitmain|marathon|riot|miner|miners|mining company|mining companies)\b/.test(corpus)) {
    addUnique(out, "Mining companies");
  }
  if (/\b(mining|miner|miners|hashrate|difficulty|proof of work|proof-of-work)\b/.test(corpus)) {
    addUnique(out, "Mining evolution");
  }
  if (/\b(mining pool|poolin|antpool|f2pool|slush pool)\b/.test(corpus)) {
    addUnique(out, "Mining pools");
  }
  if (/\b(futures|derivatives|open interest|funding rate|perpetual|options trading|bitcoin options|options market)\b/.test(corpus)) {
    addUnique(out, "Derivatives");
  }
  if (/\b(price|bottom|top|rally|crash|sell[- ]?off|breaks? down|downtrend|trading volume|market cap|all[- ]?time high|ath|bear market|bull market|whales?|moving average|bullish|bearish)\b/.test(corpus)) {
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
  if (/\b(blackrock|fidelity|jpmorgan|goldman|bank|financial institution|institutional)\b/.test(corpus)) {
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
  if (/\b(inflation|cpi|interest rate|federal reserve|fed|monetary policy)\b/.test(corpus)) {
    addUnique(out, "Monetary policy");
  }
  if (/\b(central bank|ecb|bank of england|boj|pboc)\b/.test(corpus)) {
    addUnique(out, "Central banks");
  }
  if (/\b(recession|growth|gdp|global economy)\b/.test(corpus)) {
    addUnique(out, "Global growth and recession");
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
  if (/\b(fraud|scam|ponzi)\b/.test(corpus)) {
    addUnique(out, "Fraud and scams");
  }
  if (/\b(ethereum|smart contract|smart contracts)\b/.test(corpus)) {
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
  if (/\b(developer group|developers?|development|research|square crypto|optech)\b/.test(corpus)) {
    addUnique(out, "Developer ecosystem");
  }
  if (/\b(privacy|encryption|p2p encryption|self-custody|self custody)\b/.test(corpus)) {
    addUnique(out, "Privacy and self-custody");
  }
  if (/\b(transaction features?|utxo|utxo set|time lock|timelock)\b/.test(corpus)) {
    addUnique(out, "Transaction features");
  }

  const modelLabels = input.modelTopics ?? [];
  for (const label of modelLabels) {
    const normalized = canonicalLabel(label);
    if (!normalized || normalized === "industry-news" || normalized === "market" || normalized === "company") continue;
    addUnique(out, label);
  }

  if (out.length === 0 && /\bbitcoin|btc\b/.test(corpus)) {
    addUnique(out, "Bitcoin culture");
  }
  return out.slice(0, 4);
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
  for (const label of labels) {
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
