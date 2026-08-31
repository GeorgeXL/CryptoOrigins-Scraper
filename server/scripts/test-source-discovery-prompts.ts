/**
 * Compare Exa prompt variants + backup search (Perplexity / Gemini) for empty days.
 * Usage: npx tsx server/scripts/test-source-discovery-prompts.ts
 */

import dotenv from "dotenv";
dotenv.config();

import { getExaService } from "../services/exa";
import { fetchCandidatesForDate } from "../services/editorial-pipeline/source-finder-v2";
import { researchSignificantEventForDate } from "../services/homepage-checks/perplexity-day-research";
import { aiService } from "../services/ai";

const DATES = ["2009-01-08", "2009-01-26", "2009-02-12"];

const BITCOIN_DOMAINS = [
  "coindesk.com",
  "cointelegraph.com",
  "theblock.co",
  "decrypt.co",
  "reuters.com",
  "bloomberg.com",
  "wsj.com",
  "nytimes.com",
  "bbc.com",
  "cnbc.com",
  "apnews.com",
  "news.bitcoin.com",
  "bitcointalk.org",
  "slashdot.org",
];

type PromptVariant = {
  name: string;
  query: string;
  systemPrompt: string;
  includeDomains?: string[];
};

function exaPromptVariants(date: string): PromptVariant[] {
  return [
    {
      name: "current-bitcoin",
      query: `Important Bitcoin news published on ${date}: protocol, mining, price, adoption, regulation`,
      systemPrompt: `Find news articles published exactly on ${date}. Scope: Bitcoin-only news. The event must have happened on ${date}, not before or after. Reject Wikipedia, YouTube, explainers, retrospectives, anniversary pieces, and "on this day" pages.`,
      includeDomains: BITCOIN_DOMAINS,
    },
    {
      name: "genesis-era-forums",
      query: `Bitcoin Satoshi Nakamoto genesis block mining forum discussion news on ${date}`,
      systemPrompt: `Find contemporaneous articles or forum posts from exactly ${date} about Bitcoin, cryptocurrency, peer-to-peer electronic cash, Satoshi Nakamoto, or early mining. Accept Bitcointalk, Slashdot, cryptography mailing lists if published on ${date}. Reject retrospectives and explainers.`,
      includeDomains: undefined,
    },
    {
      name: "event-what-happened",
      query: `What significant event happened in Bitcoin or cryptocurrency on ${date}?`,
      systemPrompt: `Return only articles published on ${date} describing a concrete event that occurred that day. Prefer Bitcoin, crypto exchanges, mining, regulation. Reject generic tech news unless directly about digital currency.`,
      includeDomains: undefined,
    },
    {
      name: "no-domain-filter",
      query: `Bitcoin BTC cryptocurrency news published ${date}`,
      systemPrompt: `News from exactly ${date} about Bitcoin, cryptocurrency, digital currency, blockchain, or Satoshi. Must be published on ${date}.`,
      includeDomains: undefined,
    },
    {
      name: "macro-fallback-only",
      query: `Major financial markets banking crisis news published on ${date} January 2009`,
      systemPrompt: `Find major financial or economic news published exactly on ${date} during the 2008-2009 financial crisis. Must be from ${date}.`,
      includeDomains: ["reuters.com", "apnews.com", "bbc.com", "nytimes.com", "wsj.com", "bloomberg.com", "cnbc.com"],
    },
  ];
}

function scoreTitle(title: string, summary: string): { crypto: boolean; macro: boolean; score: number } {
  const t = `${title} ${summary}`.toLowerCase();
  const crypto =
    /\b(bitcoin|btc|satoshi|blockchain|crypto|ethereum|mining|halving|bitcointalk)\b/.test(t);
  const macro =
    /\b(bank|fed|stimulus|bailout|market|stock|recession|crisis|sec |treasury)\b/.test(t);
  let score = 0;
  if (crypto) score += 3;
  if (macro) score += 1;
  if (/\b(scandal|pizza|windows 7|slumdog|producers guild|versionista)\b/.test(t)) score -= 2;
  return { crypto, macro, score };
}

async function testExaVariant(date: string, variant: PromptVariant) {
  const exa = getExaService();
  const result = await exa.searchAndContents(
    variant.query,
    {
      category: "news",
      startPublishedDate: `${date}T00:00:00.000Z`,
      endPublishedDate: `${date}T23:59:59.999Z`,
      numResults: 5,
      includeDomains: variant.includeDomains,
      systemPrompt: variant.systemPrompt,
      summary: { query: `Summarise the dated event from ${date} in 40 words` },
    },
    { context: "prompt-test", purpose: variant.name, triggeredBy: `test ${date}` },
  );

  const top = (result.results ?? []).slice(0, 3).map((r) => {
    const s = scoreTitle(r.title ?? "", r.summary ?? "");
    return {
      title: (r.title ?? "").slice(0, 90),
      url: r.url,
      published: r.publishedDate?.slice(0, 10),
      crypto: s.crypto,
      score: s.score,
      summary: (r.summary ?? "").slice(0, 120),
    };
  });

  return { count: result.results?.length ?? 0, top };
}

async function testGeminiBackup(date: string) {
  if (!process.env.GOOGLE_API_KEY && !process.env.GEMINI_API_KEY) {
    return { skipped: true, reason: "no Gemini key" };
  }

  const prompt = `Find ONE concrete news article published on exactly ${date} about Bitcoin, cryptocurrency, or (only if none exist) major financial markets during the 2008-2009 crisis.

Return JSON:
{
  "found": boolean,
  "title": string | null,
  "url": string | null,
  "publishedDate": string | null,
  "isCrypto": boolean,
  "reason": string
}

Reject retrospectives, explainers, and articles not published on ${date}.`;

  try {
    const raw = await aiService.generateJson<{
      found: boolean;
      title: string | null;
      url: string | null;
      publishedDate: string | null;
      isCrypto: boolean;
      reason: string;
    }>({
      provider: "gemini",
      prompt,
      grounding: true,
      temperature: 0.1,
    });
    return { skipped: false, result: raw };
  } catch (error) {
    return { skipped: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function main() {
  console.log("\n=== Source discovery prompt comparison ===\n");

  for (const date of DATES) {
    console.log(`\n${"=".repeat(72)}\nDATE: ${date}\n${"=".repeat(72)}`);

    // Production path
    console.log("\n--- PRODUCTION (current fetchCandidatesForDate) ---");
    try {
      const pool = await fetchCandidatesForDate(date, { requestId: "test", source: "prompt-test" });
      const rec = pool.candidates.find((c) => c.recommended) ?? pool.candidates[0];
      console.log(
        JSON.stringify(
          {
            counts: pool.perTierCounts,
            total: pool.candidates.length,
            recommended: rec
              ? {
                  title: rec.title?.slice(0, 90),
                  tier: rec.tier,
                  score: rec.relevanceScore,
                  cryptoKeywords: scoreTitle(rec.title, rec.summary ?? "").crypto,
                  url: rec.url,
                }
              : null,
            top3: pool.candidates.slice(0, 3).map((c) => ({
              title: c.title?.slice(0, 70),
              tier: c.tier,
              score: c.relevanceScore,
              crypto: scoreTitle(c.title, c.summary ?? "").crypto,
            })),
          },
          null,
          2,
        ),
      );
    } catch (error) {
      console.log("production error:", error instanceof Error ? error.message : error);
    }

    // Exa variants (bitcoin-focused only to save calls — skip macro-fallback in loop for 2009)
    console.log("\n--- EXA PROMPT VARIANTS ---");
    for (const variant of exaPromptVariants(date)) {
      try {
        const out = await testExaVariant(date, variant);
        const best = out.top[0];
        const verdict =
          best?.crypto ? "✅ crypto-relevant"
          : best?.score >= 1 ? "⚠️ macro/weak"
          : best ? "❌ off-topic"
          : "— empty";
        console.log(`\n[${variant.name}] ${verdict} (${out.count} results)`);
        for (const row of out.top) {
          console.log(`  • [${row.crypto ? "BTC" : "—"}] ${row.title}`);
          console.log(`    ${row.url}`);
        }
      } catch (error) {
        console.log(`[${variant.name}] ERROR:`, error instanceof Error ? error.message : error);
      }
    }

    // Perplexity backup
    console.log("\n--- PERPLEXITY (web search backup) ---");
    if (!process.env.PERPLEXITY_API_KEY) {
      console.log("skipped — no PERPLEXITY_API_KEY");
    } else {
      try {
        const px = await researchSignificantEventForDate(date);
        console.log(JSON.stringify(px, null, 2));
      } catch (error) {
        console.log("perplexity error:", error instanceof Error ? error.message : error);
      }
    }

    // Gemini + Google grounding
    console.log("\n--- GEMINI + Google Search ---");
    const gem = await testGeminiBackup(date);
    console.log(JSON.stringify(gem, null, 2));
  }

  console.log("\nDone.\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
