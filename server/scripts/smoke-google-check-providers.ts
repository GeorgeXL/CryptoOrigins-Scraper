/**
 * Smoke test: compare homepage Google check backends (configured provider vs Perplexity).
 *
 * Usage:
 *   npx tsx server/scripts/smoke-google-check-providers.ts
 *   npx tsx server/scripts/smoke-google-check-providers.ts --legacy-only
 *   npx tsx server/scripts/smoke-google-check-providers.ts --perplexity-only
 */

import "dotenv/config";

import { evaluateGoogleCheckRetrospectiveHeuristic } from "../../shared/google-check-heuristics";
import { aiService } from "../services/ai";
import { runGoogleCheckSingle, getGoogleCheckProviderType } from "../services/homepage-checks/google-check";

type Expect = "yes" | "no" | "uncertain";

type Fixture = {
  date: string;
  summary: string;
  expect: Expect;
  heuristic?: boolean;
};

const FIXTURES: Fixture[] = [
  {
    date: "2010-05-22",
    summary:
      "Laszlo Hanyecz buys two pizzas for 10,000 BTC in the first real-world Bitcoin transaction",
    expect: "yes",
  },
  {
    date: "2010-05-17",
    summary: "Laszlo Hanyecz offers 10,000 BTC for pizza on the Bitcoin Talk forum",
    expect: "yes",
  },
  {
    date: "2013-12-22",
    summary: "NYT revisits Laszlo Hanyecz's 10,000 BTC pizza buy from 2010",
    expect: "no",
    heuristic: true,
  },
  {
    date: "2020-05-22",
    summary: "Laszlo Hanyecz marks his pizza buy on Bitcoin Pizza Day",
    expect: "no",
    heuristic: true,
  },
  {
    date: "2020-05-22",
    summary: "Bitcoin Pizza Day celebrated worldwide ten years on",
    expect: "no",
    heuristic: true,
  },
  {
    date: "2017-08-01",
    summary: "Bitcoin Cash hard fork splits from Bitcoin after years of scaling debate",
    expect: "yes",
  },
  {
    date: "2024-01-10",
    summary: "SEC approves spot Bitcoin ETFs after years of rejections",
    expect: "yes",
  },
];

function parseArgs() {
  const args = process.argv.slice(2);
  return {
    legacyOnly: args.includes("--legacy-only") || args.includes("--gemini-only"),
    perplexityOnly: args.includes("--perplexity-only"),
  };
}

function perplexityToHappened(verdict: string): Expect {
  if (verdict === "verified") return "yes";
  if (verdict === "contradicted") return "no";
  return "uncertain";
}

async function runConfiguredProvider(date: string, summary: string): Promise<{ happened: Expect; ms: number }> {
  const started = Date.now();
  const result = await runGoogleCheckSingle({ date, summary });
  return { happened: result.happened ?? "uncertain", ms: Date.now() - started };
}

async function runPerplexity(date: string, summary: string): Promise<{ happened: Expect; ms: number; error?: string }> {
  const started = Date.now();
  try {
    const provider = aiService.getProvider("perplexity");
    if (!provider || !("factCheckEvent" in provider)) {
      return { happened: "uncertain", ms: Date.now() - started, error: "factCheckEvent unavailable" };
    }
    const result = await (
      provider as {
        factCheckEvent: (
          summary: string,
          date: string,
        ) => Promise<{ verdict: string }>;
      }
    ).factCheckEvent(summary, date);
    return { happened: perplexityToHappened(result.verdict), ms: Date.now() - started };
  } catch (error) {
    return {
      happened: "uncertain",
      ms: Date.now() - started,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function mark(ok: boolean) {
  return ok ? "✓" : "✗";
}

async function main() {
  const { legacyOnly, perplexityOnly } = parseArgs();
  const configuredProvider = getGoogleCheckProviderType();
  const runConfiguredChecks = !perplexityOnly;
  const runPerplexityChecks = !legacyOnly;

  const hasOpenAi = Boolean(process.env.OPENAI_API_KEY?.trim());
  const hasGemini = Boolean(process.env.GOOGLE_API_KEY?.trim() || process.env.GEMINI_API_KEY?.trim());
  const hasPerplexity = Boolean(process.env.PERPLEXITY_API_KEY?.trim());
  const hasConfiguredKey =
    configuredProvider === "openai"
      ? hasOpenAi
      : configuredProvider === "gemini"
        ? hasGemini
        : hasPerplexity;

  console.log("=== Google check provider smoke test ===");
  console.log(
    `Configured provider: ${configuredProvider} · OpenAI key: ${hasOpenAi ? "yes" : "no"} · Gemini key: ${hasGemini ? "yes" : "no"} · Perplexity key: ${hasPerplexity ? "yes" : "no"}`,
  );

  let heuristicPassed = 0;
  let heuristicFailed = 0;

  console.log("\n--- Heuristic fixtures (free) ---");
  for (const fixture of FIXTURES.filter((f) => f.heuristic)) {
    const result = evaluateGoogleCheckRetrospectiveHeuristic(fixture.summary);
    const actual: Expect = result.isRetrospective ? "no" : "yes";
    const ok = actual === fixture.expect;
    console.log(`  ${mark(ok)} ${fixture.date} expect=${fixture.expect} got=${actual}`);
    if (ok) heuristicPassed += 1;
    else heuristicFailed += 1;
  }

  const liveFixtures = FIXTURES.filter((f) => !f.heuristic);
  let configuredPassed = 0;
  let configuredFailed = 0;
  let perplexityPassed = 0;
  let perplexityFailed = 0;
  let agree = 0;
  let disagree = 0;

  if (runConfiguredChecks && hasConfiguredKey) {
    console.log(`\n--- ${configuredProvider} (runGoogleCheckSingle / GOOGLE_CHECK_PROVIDER) ---`);
    for (const fixture of liveFixtures) {
      const { happened, ms } = await runConfiguredProvider(fixture.date, fixture.summary);
      const ok = happened === fixture.expect;
      console.log(`  ${mark(ok)} ${fixture.date} expect=${fixture.expect} got=${happened} (${ms}ms)`);
      if (ok) configuredPassed += 1;
      else configuredFailed += 1;
    }
  } else if (runConfiguredChecks) {
    console.log(`\n--- ${configuredProvider} skipped (no API key for configured provider) ---`);
  }

  if (runPerplexityChecks && hasPerplexity) {
    console.log("\n--- Perplexity Sonar (factCheckEvent) ---");
    for (const fixture of liveFixtures) {
      const { happened, ms, error } = await runPerplexity(fixture.date, fixture.summary);
      const ok = happened === fixture.expect;
      const errSuffix = error ? ` · ERROR: ${error}` : "";
      console.log(`  ${mark(ok)} ${fixture.date} expect=${fixture.expect} got=${happened} (${ms}ms)${errSuffix}`);
      if (ok) perplexityPassed += 1;
      else perplexityFailed += 1;
    }
  } else if (runPerplexityChecks) {
    console.log("\n--- Perplexity skipped (no API key) ---");
  }

  if (runConfiguredChecks && runPerplexityChecks && hasConfiguredKey && hasPerplexity) {
    console.log(`\n--- ${configuredProvider} vs Perplexity agreement ---`);
    for (const fixture of liveFixtures) {
      const [configured, perplexity] = await Promise.all([
        runConfiguredProvider(fixture.date, fixture.summary),
        runPerplexity(fixture.date, fixture.summary),
      ]);
      const same = configured.happened === perplexity.happened;
      console.log(
        `  ${same ? "=" : "!"} ${fixture.date} ${configuredProvider}=${configured.happened} perplexity=${perplexity.happened}${perplexity.error ? ` · pplx err: ${perplexity.error}` : ""}`,
      );
      if (same) agree += 1;
      else disagree += 1;
    }
    console.log(`  Agreement: ${agree}/${liveFixtures.length}`);
  }

  console.log("\n=== Summary ===");
  console.log(`Heuristics: ${heuristicPassed} passed, ${heuristicFailed} failed`);
  if (runConfiguredChecks && hasConfiguredKey) {
    console.log(`${configuredProvider}: ${configuredPassed}/${liveFixtures.length} passed`);
  }
  if (runPerplexityChecks && hasPerplexity) {
    console.log(`Perplexity: ${perplexityPassed}/${liveFixtures.length} passed`);
  }

  const failed =
    heuristicFailed +
    (runConfiguredChecks && hasConfiguredKey ? configuredFailed : 0) +
    (runPerplexityChecks && hasPerplexity ? perplexityFailed : 0);

  if (failed > 0) {
    process.exit(1);
  }
  console.log("✅ Provider smoke test complete.");
}

main().catch((error) => {
  console.error("❌ Smoke test failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
