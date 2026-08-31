/**
 * Test Gemini + Google Search day research for a single date.
 * Usage:
 *   npx tsx server/scripts/test-google-day-fill.ts 2009-04-05
 *   npx tsx server/scripts/test-google-day-fill.ts 2009-04-05 --raw
 */

import dotenv from "dotenv";
dotenv.config();

async function main() {
  const args = process.argv.slice(2);
  const raw = args.includes("--raw");
  const date = args.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a)) ?? "2009-04-05";

  if (!process.env.GOOGLE_API_KEY && !process.env.GEMINI_API_KEY) {
    console.error("GOOGLE_API_KEY or GEMINI_API_KEY required");
    process.exit(1);
  }

  if (raw) {
    const { aiService } = await import("../services/ai");
    const {
      RESEARCH_TIER_ORDER,
      buildTierPrompt,
      TIER_SYSTEM_PROMPT,
      evaluateResearchAcceptance,
      pickBestCitationUrl,
    } = await import("../services/homepage-checks/perplexity-day-research");
    const { z } = await import("zod");

    const tierResponseSchema = z.object({
      found: z.boolean(),
      eventDate: z.string().nullable().optional(),
      eventTitle: z.string().nullable().optional(),
      sourceUrl: z.string().nullable().optional(),
      sourceTitle: z.string().nullable().optional(),
      eventSnippet: z.string().nullable().optional(),
      confidence: z.enum(["high", "medium", "low"]).optional(),
      reasoning: z.string().optional(),
      citations: z.array(z.string()).optional(),
    });

    const gemini = aiService.getProvider("gemini");
    if (!("generateJson" in gemini)) throw new Error("Gemini generateJson unavailable");

    console.log(`Raw tier responses for ${date}:\n`);
    for (const tier of RESEARCH_TIER_ORDER) {
      const parsed = await gemini.generateJson<z.infer<typeof tierResponseSchema>>({
        prompt: buildTierPrompt(date, tier),
        systemPrompt: `${TIER_SYSTEM_PROMPT} Use Google Search to verify dates and sources.`,
        maxTokens: 900,
        temperature: 0.1,
        context: "google-day-research-tier",
        purpose: `Google research ${tier} tier event for ${date}`,
        grounding: true,
        schema: tierResponseSchema,
      });

      const citations: string[] = [];
      if (parsed.sourceUrl) citations.push(parsed.sourceUrl);
      if (Array.isArray(parsed.citations)) citations.push(...parsed.citations);
      const sourceUrl = pickBestCitationUrl(citations);
      const acceptance = evaluateResearchAcceptance({
        targetDate: date,
        found: parsed.found,
        confidence: parsed.confidence ?? "low",
        eventDate: parsed.eventDate ?? null,
        eventTitle: parsed.eventTitle ?? null,
        eventSnippet: parsed.eventSnippet ?? null,
        reasoning: parsed.reasoning ?? null,
        sourceUrl,
      });

      console.log(`--- ${tier} ---`);
      console.log(JSON.stringify({ parsed, citations, pickedUrl: sourceUrl, acceptance }, null, 2));
      console.log();
    }
    return;
  }

  const { researchSignificantEventForDateWithGoogle } = await import(
    "../services/homepage-checks/google-day-research"
  );

  console.log(`Researching ${date} with Gemini + Google Search...\n`);
  const result = await researchSignificantEventForDateWithGoogle(date);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
