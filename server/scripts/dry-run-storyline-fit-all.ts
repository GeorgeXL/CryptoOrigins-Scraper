/**
 * Dry run storyline fit check across one or all hierarchy leaves.
 *
 * Usage:
 *   npx tsx server/scripts/dry-run-storyline-fit-all.ts --all-leaves
 *   npx tsx server/scripts/dry-run-storyline-fit-all.ts --all-leaves --with-llm --samples 3
 *   npx tsx server/scripts/dry-run-storyline-fit-all.ts --leaf "Inflation" --with-llm
 *   npx tsx server/scripts/dry-run-storyline-fit-all.ts --leaves "Inflation,Halving events" --json
 */

import "dotenv/config";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import {
  TOPIC_HIERARCHY,
  TOPIC_HIERARCHY_LEAVES,
  formatTopicLeafWithGroup,
  topicGroupForLeaf,
} from "../../shared/topic-hierarchy";
import { storage } from "../storage";
import {
  runStorylineFitBatch,
  runStorylineFitHeuristicDryRun,
  type StorylineFitInputItem,
  type StorylineFitRowResult,
} from "../services/homepage-checks/storyline-fit";

type Expect = "ok" | "mismatch" | "uncertain" | "audit";

type Case = StorylineFitInputItem & {
  expect: Expect;
  note?: string;
};

export type LeafDryRunResult = {
  leaf: string;
  leafLabel: string;
  group: string | undefined;
  cases: number;
  heuristic: { ok: number; mismatch: number; uncertain: number; fixturePass: number; fixtureTotal: number };
  llm?: { ok: number; mismatch: number; uncertain: number; fixturePass: number; fixtureTotal: number };
  mismatches: Array<{ date: string; status: string; reason?: string; note?: string; source?: string }>;
  fixtureFailures: Array<{ date: string; expect: string; got: string; reason?: string; note?: string }>;
  error?: string;
};

const INFLATION_FIXTURES: Case[] = [
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
    note: "Borderline inflation + policy",
  },
  {
    date: "2010-01-20",
    summary:
      "Mervyn King warns UK deficit uncertainty constrains policy and urges structural cuts to lift savings",
    expect: "mismatch",
    note: "Fiscal/deficit",
  },
];

const MACRO_CRYPTO_NEGATIVES: Case[] = INFLATION_FIXTURES.filter((f) => f.expect === "mismatch").slice(0, 2);

const CURATED_BY_LEAF: Partial<Record<string, Case[]>> = {
  Inflation: INFLATION_FIXTURES,
};

function parseArgs() {
  const args = process.argv.slice(2);
  let leaves: string[] = [];
  let allLeaves = false;
  let withLlm = false;
  let samples = 3;
  let json = false;
  let outDir: string | null = null;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--all-leaves") allLeaves = true;
    else if (arg === "--with-llm") withLlm = true;
    else if (arg === "--json") json = true;
    else if (arg === "--leaf" && args[i + 1]) leaves = [args[++i]!];
    else if (arg === "--leaves" && args[i + 1]) {
      leaves = args[++i]!.split(",").map((s) => s.trim()).filter(Boolean);
    } else if (arg === "--samples" && args[i + 1]) {
      samples = Math.max(1, Number.parseInt(args[++i]!, 10) || 3);
    } else if (arg === "--out-dir" && args[i + 1]) {
      outDir = args[++i]!;
    }
  }

  if (allLeaves) leaves = [...TOPIC_HIERARCHY_LEAVES];
  if (leaves.length === 0) leaves = ["Inflation"];

  return { leaves, withLlm, samples, json, outDir };
}

function pickDbSamples<T extends { date: string; summary: string; topicCategories?: unknown; tagsVersion2?: string[] | null }>(
  rows: T[],
  max: number,
): T[] {
  if (rows.length <= max) return rows;
  const picked: T[] = [];
  const step = Math.max(1, Math.floor(rows.length / max));
  for (let i = 0; i < rows.length && picked.length < max; i += step) {
    picked.push(rows[i]!);
  }
  return picked;
}

async function buildCasesForLeaf(leaf: string, sampleCount: number): Promise<Case[]> {
  const cases: Case[] = [...(CURATED_BY_LEAF[leaf] ?? [])];
  const seenDates = new Set(cases.map((c) => c.date));

  try {
    const rows = await storage.getAnalysesForStorylineLeaf(leaf);
    for (const row of pickDbSamples(rows, sampleCount)) {
      if (!row.summary?.trim() || seenDates.has(row.date)) continue;
      seenDates.add(row.date);
      cases.push({
        date: row.date,
        summary: row.summary,
        tags: row.tagsVersion2 ?? [],
        topic_categories: row.topicCategories,
        expect: "audit",
        note: "DB tagged sample",
      });
    }
  } catch {
    // DB unavailable — curated fixtures only
  }

  if (topicGroupForLeaf(leaf) === "Macroeconomy") {
    for (const neg of MACRO_CRYPTO_NEGATIVES) {
      if (seenDates.has(`neg-${neg.date}`)) continue;
      seenDates.add(`neg-${neg.date}`);
      cases.push({
        ...neg,
        date: `neg-${neg.date}`,
        expect: "mismatch",
        note: `Macro exclude probe · ${neg.note ?? ""}`.trim(),
      });
    }
  }

  return cases;
}

function scoreFixtures(cases: Case[], results: Record<string, StorylineFitRowResult>) {
  const fixtures = cases.filter((c) => c.expect !== "audit");
  let fixturePass = 0;
  const fixtureFailures: LeafDryRunResult["fixtureFailures"] = [];

  for (const fixture of fixtures) {
    const got = results[fixture.date]?.status ?? "missing";
    if (got === fixture.expect) {
      fixturePass += 1;
    } else {
      fixtureFailures.push({
        date: fixture.date,
        expect: fixture.expect,
        got,
        reason: results[fixture.date]?.reason,
        note: fixture.note,
      });
    }
  }

  return { fixturePass, fixtureTotal: fixtures.length, fixtureFailures };
}

function collectMismatches(
  cases: Case[],
  results: Record<string, StorylineFitRowResult>,
): LeafDryRunResult["mismatches"] {
  return cases
    .map((c) => {
      const row = results[c.date];
      if (!row || row.status === "ok") return null;
      return {
        date: c.date,
        status: row.status,
        reason: row.reason,
        note: c.note,
        source: row.source,
      };
    })
    .filter((x): x is NonNullable<typeof x> => Boolean(x));
}

export async function dryRunStorylineFitLeaf(
  leaf: string,
  opts: { withLlm: boolean; samples: number },
): Promise<LeafDryRunResult> {
  const cases = await buildCasesForLeaf(leaf, opts.samples);
  const heuristicReport = runStorylineFitHeuristicDryRun(
    leaf,
    cases.map(({ date, summary, tags, topic_categories }) => ({ date, summary, tags, topic_categories })),
  );
  const heuristicFixtures = scoreFixtures(cases, heuristicReport.results);

  const result: LeafDryRunResult = {
    leaf,
    leafLabel: formatTopicLeafWithGroup(leaf),
    group: topicGroupForLeaf(leaf),
    cases: cases.length,
    heuristic: {
      ok: heuristicReport.ok,
      mismatch: heuristicReport.mismatch,
      uncertain: heuristicReport.uncertain,
      fixturePass: heuristicFixtures.fixturePass,
      fixtureTotal: heuristicFixtures.fixtureTotal,
    },
    mismatches: collectMismatches(cases, heuristicReport.results),
    fixtureFailures: heuristicFixtures.fixtureFailures,
  };

  if (opts.withLlm) {
    try {
      const llmReport = await runStorylineFitBatch(
        leaf,
        cases.map(({ date, summary, tags, topic_categories }) => ({ date, summary, tags, topic_categories })),
      );
      const llmFixtures = scoreFixtures(cases, llmReport.results);
      result.llm = {
        ok: llmReport.ok,
        mismatch: llmReport.mismatch,
        uncertain: llmReport.uncertain,
        fixturePass: llmFixtures.fixturePass,
        fixtureTotal: llmFixtures.fixtureTotal,
      };
      result.mismatches = collectMismatches(cases, llmReport.results);
      result.fixtureFailures = llmFixtures.fixtureFailures;
    } catch (error) {
      result.error = error instanceof Error ? error.message : String(error);
    }
  }

  return result;
}

function printLeafResult(r: LeafDryRunResult, verbose: boolean) {
  const mode = r.llm ? "LLM+heuristic" : "heuristic";
  const stats = r.llm ?? r.heuristic;
  const fixtureNote =
    stats.fixtureTotal > 0 ? ` · fixtures ${stats.fixturePass}/${stats.fixtureTotal}` : "";
  console.log(
    `${stats.fixtureTotal > 0 && stats.fixturePass === stats.fixtureTotal ? "✓" : r.fixtureFailures.length ? "✗" : "·"} ${r.leafLabel} [${mode}] · ${r.cases} cases · ok ${stats.ok} · mismatch ${stats.mismatch} · uncertain ${stats.uncertain}${fixtureNote}`,
  );
  if (r.error) console.log(`    ERROR: ${r.error}`);
  if (verbose && r.fixtureFailures.length) {
    for (const f of r.fixtureFailures) {
      console.log(`    ✗ ${f.date} expect ${f.expect} got ${f.got}${f.note ? ` · ${f.note}` : ""}`);
      if (f.reason) console.log(`      ${f.reason}`);
    }
  }
  if (verbose && r.mismatches.length) {
    for (const m of r.mismatches.slice(0, 8)) {
      console.log(`    ⚠ ${m.date} · ${m.status}${m.note ? ` · ${m.note}` : ""}`);
    }
    if (r.mismatches.length > 8) console.log(`    … +${r.mismatches.length - 8} more`);
  }
}

async function main() {
  const { leaves, withLlm, samples, json, outDir } = parseArgs();
  const results: LeafDryRunResult[] = [];

  for (const leaf of leaves) {
    results.push(await dryRunStorylineFitLeaf(leaf, { withLlm, samples }));
  }

  if (outDir) {
    mkdirSync(outDir, { recursive: true });
    for (const r of results) {
      writeFileSync(join(outDir, `${r.leaf.replace(/[^\w]+/g, "-")}.json`), JSON.stringify(r, null, 2));
    }
    writeFileSync(join(outDir, "_summary.json"), JSON.stringify(results, null, 2));
  }

  if (json) {
    console.log(JSON.stringify(results, null, 2));
    return;
  }

  console.log(`\nStoryline fit dry run · ${results.length} leaf/leaves · samples ${samples}${withLlm ? " · with LLM" : ""}\n`);
  for (const r of results) {
    printLeafResult(r, leaves.length <= 3);
  }

  const fixtureLeaves = results.filter((r) => (r.llm ?? r.heuristic).fixtureTotal > 0);
  const fixturePass = fixtureLeaves.filter(
    (r) => (r.llm ?? r.heuristic).fixturePass === (r.llm ?? r.heuristic).fixtureTotal,
  ).length;
  const auditMismatchRate = results.map((r) => {
    const auditCases = r.cases - (r.llm ?? r.heuristic).fixtureTotal;
    const auditMismatches = r.mismatches.filter((m) => m.note?.includes("DB tagged")).length;
    return auditCases > 0 ? auditMismatches / auditCases : 0;
  });

  console.log("\n--- Summary ---");
  console.log(`Leaves scanned: ${results.length}`);
  if (fixtureLeaves.length) {
    console.log(`Curated fixture leaves passing: ${fixturePass}/${fixtureLeaves.length}`);
  }
  const highAudit = results
    .filter((r, i) => auditMismatchRate[i]! > 0.5 && r.cases > 3)
    .map((r) => r.leaf);
  if (highAudit.length) {
    console.log(`High DB-sample mismatch rate (>50%): ${highAudit.join(", ")}`);
  }
  const failedFixtures = results.filter((r) => r.fixtureFailures.length > 0);
  if (failedFixtures.length) {
    console.log(`Fixture failures: ${failedFixtures.map((r) => r.leaf).join(", ")}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
