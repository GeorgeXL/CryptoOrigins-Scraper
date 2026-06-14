/**
 * Smoke test: homepage Google check (substantive event on calendar date).
 *
 * Usage:
 *   npx tsx server/scripts/smoke-google-check.ts
 *   npx tsx server/scripts/smoke-google-check.ts --heuristics-only
 *   npx tsx server/scripts/smoke-google-check.ts --live
 *
 * Default: runs heuristic fixtures (no API) then live OpenAI checks if OPENAI_API_KEY is set.
 * --heuristics-only: deterministic pre-checks only.
 * --live: force live OpenAI calls (requires OPENAI_API_KEY; uses GOOGLE_CHECK_PROVIDER, default openai).
 */

import "dotenv/config";

import { evaluateGoogleCheckRetrospectiveHeuristic } from "../../shared/google-check-heuristics";
import { runGoogleCheckSingle } from "../services/homepage-checks/google-check";

type Fixture = {
  date: string;
  summary: string;
  expect: "yes" | "no" | "uncertain";
  mode: "heuristic" | "live";
};

const FIXTURES: Fixture[] = [
  {
    date: "2010-05-22",
    summary:
      "Laszlo Hanyecz buys two pizzas for 10,000 BTC in the first real-world Bitcoin transaction",
    expect: "yes",
    mode: "live",
  },
  {
    date: "2010-05-17",
    summary: "Laszlo Hanyecz offers 10,000 BTC for pizza on the Bitcoin Talk forum",
    expect: "yes",
    mode: "live",
  },
  {
    date: "2013-12-22",
    summary: "NYT revisits Laszlo Hanyecz's 10,000 BTC pizza buy from 2010",
    expect: "no",
    mode: "heuristic",
  },
  {
    date: "2020-05-22",
    summary: "Laszlo Hanyecz marks his pizza buy on Bitcoin Pizza Day",
    expect: "no",
    mode: "heuristic",
  },
  {
    date: "2020-05-22",
    summary: "Bitcoin Pizza Day celebrated worldwide ten years on",
    expect: "no",
    mode: "heuristic",
  },
];

function parseArgs() {
  const args = process.argv.slice(2);
  return {
    heuristicsOnly: args.includes("--heuristics-only"),
    liveOnly: args.includes("--live"),
  };
}

async function runHeuristicFixtures(): Promise<{ passed: number; failed: number }> {
  console.log("\n=== Heuristic fixtures (no API) ===");
  let passed = 0;
  let failed = 0;

  for (const fixture of FIXTURES.filter((f) => f.mode === "heuristic")) {
    const result = evaluateGoogleCheckRetrospectiveHeuristic(fixture.summary);
    const actual: "yes" | "no" = result.isRetrospective ? "no" : "yes";
    const ok = actual === fixture.expect;
    const mark = ok ? "✓" : "✗";
    console.log(
      `  ${mark} ${fixture.date} · expect=${fixture.expect} · got=${actual}${result.reason ? ` · ${result.reason}` : ""}`,
    );
    console.log(`      ${fixture.summary.slice(0, 90)}${fixture.summary.length > 90 ? "…" : ""}`);
    if (ok) passed += 1;
    else failed += 1;
  }

  return { passed, failed };
}

async function runLiveFixtures(): Promise<{ passed: number; failed: number }> {
  console.log("\n=== Live homepage verify fixtures ===");
  let passed = 0;
  let failed = 0;

  for (const fixture of FIXTURES.filter((f) => f.mode === "live")) {
    const started = Date.now();
    const result = await runGoogleCheckSingle({
      date: fixture.date,
      summary: fixture.summary,
    });
    const elapsed = Date.now() - started;
    const ok = result.happened === fixture.expect;
    const mark = ok ? "✓" : "✗";
    console.log(
      `  ${mark} ${fixture.date} · expect=${fixture.expect} · got=${result.happened} (${elapsed}ms)`,
    );
    console.log(`      ${fixture.summary.slice(0, 90)}${fixture.summary.length > 90 ? "…" : ""}`);
    if (ok) passed += 1;
    else failed += 1;
  }

  return { passed, failed };
}

async function main() {
  const { heuristicsOnly, liveOnly } = parseArgs();
  const hasApiKey = Boolean(process.env.OPENAI_API_KEY?.trim());

  console.log("=== Google check smoke test ===");
  console.log(`Heuristics only: ${heuristicsOnly ? "yes" : "no"}`);
  console.log(`Live only: ${liveOnly ? "yes" : "no"}`);
  console.log(`API key present: ${hasApiKey ? "yes" : "no"}`);

  let totalPassed = 0;
  let totalFailed = 0;

  if (!liveOnly) {
    const heuristic = await runHeuristicFixtures();
    totalPassed += heuristic.passed;
    totalFailed += heuristic.failed;
  }

  const runLive = liveOnly || (!heuristicsOnly && hasApiKey);
  if (runLive) {
    if (!hasApiKey) {
      console.error("\n❌ OPENAI_API_KEY required for live fixtures (GOOGLE_CHECK_PROVIDER=openai by default).");
      process.exit(1);
    }
    const live = await runLiveFixtures();
    totalPassed += live.passed;
    totalFailed += live.failed;
  } else if (!heuristicsOnly) {
    console.log("\n⚠️ Skipping live fixtures (no API key). Use --live to require them.");
  }

  console.log(`\n=== Summary: ${totalPassed} passed, ${totalFailed} failed ===`);
  if (totalFailed > 0) {
    process.exit(1);
  }
  console.log("✅ Google check smoke complete.");
}

main().catch((error) => {
  console.error("❌ Smoke test failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
