/**
 * Dry run: homepage storyline fit check fixtures
 *
 * Usage:
 *   npx tsx server/scripts/dry-run-storyline-fit.ts
 *   npx tsx server/scripts/dry-run-storyline-fit.ts --with-llm
 *   npx tsx server/scripts/dry-run-storyline-fit.ts --leaf "Halving events"
 */

import "dotenv/config";

import { formatTopicLeafWithGroup } from "../../shared/topic-hierarchy";
import {
  runStorylineFitBatch,
  runStorylineFitHeuristicDryRun,
  type StorylineFitInputItem,
} from "../services/homepage-checks/storyline-fit";

type Fixture = StorylineFitInputItem & {
  expect: "ok" | "mismatch" | "uncertain";
  note?: string;
};

const INFLATION_FIXTURES: Fixture[] = [
  {
    date: "2022-10-12",
    summary:
      "Bitcoin hovers in a tight range as traders brace for inflation data that could spark a sharp move soon",
    expect: "mismatch",
    note: "BTC trading headline",
  },
  {
    date: "2022-09-13",
    summary:
      "Bitcoin margin longs at Bitfinex hit a record high as traders cut shorts, then hotter CPI sends Bitcoin lower",
    expect: "mismatch",
    note: "BTC + Bitfinex",
  },
  {
    date: "2022-08-30",
    summary:
      "Bitcoin and Ether fall as stocks slide, with U.S. job openings rising and Germany inflation hitting records",
    expect: "mismatch",
    note: "BTC/ETH move",
  },
  {
    date: "2022-02-10",
    summary:
      "Bitcoin briefly rebounds after US inflation spikes, then fades as rate hike fears weigh on crypto markets",
    expect: "mismatch",
    note: "BTC on CPI",
  },
  {
    date: "2020-04-16",
    summary:
      "Bitcoin investors focus on stimulus as prices stall, boosting the case for Bitcoin as an inflation hedge",
    expect: "mismatch",
    note: "BTC inflation hedge framing",
  },
  {
    date: "2016-11-28",
    summary:
      "Venezuela's bolivar plunges 60% on the black market, driving cash shortages and worsening inflation rates",
    expect: "ok",
    note: "Pure macro inflation shock",
  },
  {
    date: "2012-01-12",
    summary:
      "China's inflation cools as consumer prices slow, giving policymakers room to ease credit restrictions",
    expect: "ok",
    note: "CPI/inflation print",
  },
  {
    date: "2010-12-03",
    summary:
      "China signals tighter monetary policy as inflation climbs, raising expectations of higher interest rates",
    expect: "ok",
    note: "Borderline — inflation + policy (acceptable on Inflation)",
  },
  {
    date: "2010-01-20",
    summary:
      "Mervyn King warns UK deficit uncertainty constrains policy and urges structural cuts to lift savings",
    expect: "mismatch",
    note: "Fiscal/deficit — not inflation data",
  },
];

function parseArgs() {
  const args = process.argv.slice(2);
  let leaf = "Inflation";
  let withLlm = false;

  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--leaf" && args[i + 1]) {
      leaf = args[++i]!;
    } else if (args[i] === "--with-llm") {
      withLlm = true;
    }
  }

  return { leaf, withLlm };
}

function printReport(
  label: string,
  fixtures: Fixture[],
  report: Awaited<ReturnType<typeof runStorylineFitHeuristicDryRun>>,
) {
  console.log(`\n=== ${label} · ${formatTopicLeafWithGroup(report.topicLeaf)} ===`);
  console.log(
    `Scanned ${report.scanned} · ok ${report.ok} · mismatch ${report.mismatch} · uncertain ${report.uncertain}\n`,
  );

  let passed = 0;
  for (const fixture of fixtures) {
    const row = report.results[fixture.date];
    const got = row?.status ?? "missing";
    const ok = got === fixture.expect;
    if (ok) passed += 1;
    const mark = ok ? "✓" : "✗";
    const suggest =
      row?.suggestedLeaves?.length ? ` → ${row.suggestedLeaves.map(formatTopicLeafWithGroup).join(", ")}` : "";
    console.log(
      `${mark} ${fixture.date} · expect ${fixture.expect} · got ${got}${suggest}${fixture.note ? ` · ${fixture.note}` : ""}`,
    );
    if (!ok && row?.reason) console.log(`    ${row.reason}`);
  }

  console.log(`\nFixture accuracy: ${passed}/${fixtures.length}`);
  return passed === fixtures.length;
}

async function main() {
  const { leaf, withLlm } = parseArgs();
  const fixtures = leaf === "Inflation" ? INFLATION_FIXTURES : INFLATION_FIXTURES;

  const heuristicReport = runStorylineFitHeuristicDryRun(
    leaf,
    fixtures.map(({ date, summary, tags, topic_categories }) => ({ date, summary, tags, topic_categories })),
  );
  const heuristicOk = printReport("Heuristic dry run", fixtures, heuristicReport);

  if (!withLlm) {
    console.log("\nRun with --with-llm to test TopicValidatorAgent (requires OPENAI_API_KEY).");
    process.exit(heuristicOk ? 0 : 1);
  }

  const llmReport = await runStorylineFitBatch(
    leaf,
    fixtures.map(({ date, summary, tags, topic_categories }) => ({ date, summary, tags, topic_categories })),
  );
  const llmOk = printReport("LLM + heuristic", fixtures, llmReport);
  process.exit(heuristicOk && llmOk ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
