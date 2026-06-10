/**
 * Smoke test: Main events check (CLI wrapper)
 *
 * Usage:
 *   npx tsx server/scripts/smoke-storyline-coverage-guardian.ts
 *   npx tsx server/scripts/smoke-storyline-coverage-guardian.ts --leaf "Halving events"
 *   npx tsx server/scripts/smoke-storyline-coverage-guardian.ts --leaf "ETFs and investment products" --max 12
 *   npx tsx server/scripts/smoke-storyline-coverage-guardian.ts --corpus-only --leaf "Halving events"
 *   npx tsx server/scripts/smoke-storyline-coverage-guardian.ts --no-lock --leaf "Halving events"
 */

import "dotenv/config";

import { formatTopicLeafWithGroup } from "../../shared/topic-hierarchy";
import {
  crossCheckLeafCoverage,
  loadAnalysisIndex,
  loadCorpusForLeaf,
  resolveStorylineLeaf,
  runLeafCoverageCheck,
} from "../services/leaf-agent/coverage";

function parseArgs() {
  const args = process.argv.slice(2);
  let leaf = "Halving events";
  let corpusOnly = false;
  let autoLockMatches = true;
  let refreshFromGemini = false;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--leaf" && args[i + 1]) {
      leaf = args[++i]!;
    } else if (arg === "--corpus-only") {
      corpusOnly = true;
    } else if (arg === "--no-lock") {
      autoLockMatches = false;
    } else if (arg === "--refresh-gemini") {
      refreshFromGemini = true;
    }
  }

  return { leaf, corpusOnly, autoLockMatches, refreshFromGemini };
}

async function main() {
  const { leaf: leafArg, corpusOnly, autoLockMatches, refreshFromGemini } = parseArgs();
  const leaf = resolveStorylineLeaf(leafArg);

  if (!process.env.GOOGLE_API_KEY && !process.env.GEMINI_API_KEY && !corpusOnly) {
    console.error("❌ GOOGLE_API_KEY or GEMINI_API_KEY required (or pass --corpus-only).");
    process.exit(1);
  }

  if (corpusOnly) {
    const corpus = await loadCorpusForLeaf(leaf);
    const allRows = await loadAnalysisIndex();
    const { extra } = crossCheckLeafCoverage(leaf, allRows, []);
    console.log(`\n=== Main events check smoke (corpus only) ===`);
    console.log(`Leaf: ${formatTopicLeafWithGroup(leaf)}`);
    console.log(`Corpus days on this leaf: ${corpus.length}`);
    if (corpus.length === 0) {
      console.log("\n(no rows assigned to this leaf yet)");
    } else {
      console.log(`\nSample rows (${Math.min(8, extra.length)}):`);
      for (const row of extra.slice(0, 8)) {
        console.log(`  ${row.date} · ${row.summary.slice(0, 90)}${row.summary.length > 90 ? "…" : ""}`);
      }
    }
    return;
  }

  console.log(refreshFromGemini ? "\nRefreshing main events from Gemini…" : "\nRunning main events check…");
  const result = await runLeafCoverageCheck({ leaf, autoLockMatches, refreshFromGemini });
  console.log(`Gemini source: ${result.geminiSource}${result.geminiFetchedAt ? ` · ${result.geminiFetchedAt}` : ""}`);

  console.log(`\n=== Main events check smoke ===`);
  console.log(`Leaf: ${result.leafLabel}`);
  console.log(`Corpus days on this leaf: ${result.corpusCount}`);
  console.log(`Gemini canonical dates: ${result.canonicalCount}`);
  if (result.notes) console.log(`Notes: ${result.notes}`);
  if (result.newlyLockedCount > 0) {
    console.log(`Newly locked: ${result.newlyLockedCount}`);
  }

  if (result.matched.length > 0) {
    console.log(`\n✅ Matched (${result.matched.length})`);
    for (const entry of result.matched) {
      const lockNote = entry.newlyLocked ? " [locked now]" : entry.wasLocked ? " [already locked]" : "";
      console.log(`  ${entry.date} · ${entry.importance} · ${entry.event}${lockNote}`);
    }
  }

  if (result.misplaced.length > 0) {
    console.log(`\n↪️  Wrong leaf (${result.misplaced.length})`);
    for (const entry of result.misplaced) {
      console.log(`  ${entry.date} · ${entry.event} · currently ${entry.currentLeafLabel}`);
    }
  }

  if (result.missing.length > 0) {
    console.log(`\n⚠️  Not in DB (${result.missing.length})`);
    for (const entry of result.missing) {
      console.log(`  ${entry.date} · ${entry.importance} · ${entry.event}`);
    }
  }

  if (result.extra.length > 0) {
    console.log(`\nℹ️  Extra (${result.extra.length})`);
    for (const row of result.extra.slice(0, 8)) {
      console.log(`  ${row.date} · ${row.summary.slice(0, 90)}${row.summary.length > 90 ? "…" : ""}`);
    }
    if (result.extra.length > 8) console.log(`  … and ${result.extra.length - 8} more`);
  }
}

main().catch((error) => {
  console.error("❌ Smoke test failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
