/**
 * Smoke test: Main events verification agents (topic + summary alignment)
 *
 * Usage:
 *   npx tsx server/scripts/smoke-main-events-verification-agents.ts
 *   npx tsx server/scripts/smoke-main-events-verification-agents.ts --leaf "Halving events"
 *   npx tsx server/scripts/smoke-main-events-verification-agents.ts --leaf "Halving events" --max 24
 *   npx tsx server/scripts/smoke-main-events-verification-agents.ts --topics-only
 *   npx tsx server/scripts/smoke-main-events-verification-agents.ts --summaries-only
 *   npx tsx server/scripts/smoke-main-events-verification-agents.ts --no-lock
 *   npx tsx server/scripts/smoke-main-events-verification-agents.ts --no-persist
 *   npx tsx server/scripts/smoke-main-events-verification-agents.ts --random 30
 *   npx tsx server/scripts/smoke-main-events-verification-agents.ts --random 30 --persist
 */

import "dotenv/config";

import { formatTopicLeafWithGroup } from "../../shared/topic-hierarchy";
import { resolveStorylineLeaf } from "../services/leaf-agent/coverage";
import { verifyMainEventsSummaryAlignment } from "../services/leaf-agent/summary-alignment-agent";
import { verifyMainEventsTopicAlignment } from "../services/leaf-agent/topic-alignment-agent";
import { lockActionFromVerdict } from "../services/leaf-agent/verification-lock-policy";

function parseArgs() {
  const args = process.argv.slice(2);
  let leaf = "Halving events";
  let maxItems = 12;
  let applyLockPolicy = true;
  let persistResults = true;
  let runTopics = true;
  let runSummaries = true;
  let policyOnly = false;
  let randomSample: number | null = null;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--leaf" && args[i + 1]) {
      leaf = args[++i]!;
    } else if (arg === "--max" && args[i + 1]) {
      maxItems = Math.max(1, Number.parseInt(args[++i]!, 10) || 12);
    } else if (arg === "--random" && args[i + 1]) {
      randomSample = Math.max(1, Number.parseInt(args[++i]!, 10) || 30);
      maxItems = randomSample;
      applyLockPolicy = false;
      persistResults = false;
    } else if (arg === "--persist") {
      persistResults = true;
      applyLockPolicy = true;
    } else if (arg === "--no-lock") {
      applyLockPolicy = false;
    } else if (arg === "--no-persist") {
      persistResults = false;
    } else if (arg === "--topics-only") {
      runSummaries = false;
    } else if (arg === "--summaries-only") {
      runTopics = false;
    } else if (arg === "--policy-only") {
      policyOnly = true;
    }
  }

  return { leaf, maxItems, applyLockPolicy, persistResults, runTopics, runSummaries, policyOnly, randomSample };
}

function printLockPolicyChecks() {
  console.log("\n=== Verification lock policy ===");
  const cases = [
    { correlated: true, confidence: "high" as const, expect: "locked" },
    { correlated: true, confidence: "medium" as const, expect: "locked" },
    { correlated: false, confidence: "high" as const, expect: "unlocked" },
    { correlated: false, confidence: "medium" as const, expect: "unlocked" },
    { correlated: true, confidence: "low" as const, expect: "pending" },
    { correlated: false, confidence: "low" as const, expect: "pending" },
  ];

  for (const entry of cases) {
    const action = lockActionFromVerdict(entry);
    const ok = action === entry.expect ? "✓" : "✗";
    console.log(
      `  ${ok} correlated=${entry.correlated} confidence=${entry.confidence} → ${action} (expected ${entry.expect})`,
    );
    if (action !== entry.expect) {
      throw new Error(`Lock policy mismatch for ${JSON.stringify(entry)}`);
    }
  }
}

function printTopicReport(report: Awaited<ReturnType<typeof verifyMainEventsTopicAlignment>>) {
  console.log(`\n=== Topic alignment agent ===`);
  console.log(
    `Scanned ${report.scanned} · aligned ${report.aligned} · mismatches ${report.mismatches.length} · pending ${report.pending}`,
  );
  console.log(
    `Saved · ${report.verificationMatched} matched · ${report.verificationPending} pending · locks ${report.locked} locked / ${report.unlocked} unlocked`,
  );

  if (report.skippedLeaves.length > 0) {
    console.log(`Skipped leaves: ${report.skippedLeaves.join(", ")}`);
  }

  if (report.mismatches.length > 0) {
    console.log(`\nTopic mismatches (${Math.min(6, report.mismatches.length)} shown):`);
    for (const entry of report.mismatches.slice(0, 6)) {
      console.log(
        `  ${entry.date} · ${entry.kind} · Gemini ${entry.geminiLeafLabel} · DB ${entry.dbLeafLabel} · ${entry.confidence}`,
      );
    }
  }

  const lockSample = report.lockActions.filter((entry) => entry.action !== "pending").slice(0, 4);
  if (lockSample.length > 0) {
    console.log(`\nLock actions (${lockSample.length} shown):`);
    for (const entry of lockSample) {
      console.log(`  ${entry.date} · ${entry.action} · ${entry.reason.slice(0, 100)}`);
    }
  }
}

function printSummaryReport(report: Awaited<ReturnType<typeof verifyMainEventsSummaryAlignment>>) {
  console.log(`\n=== Summary alignment agent ===`);
  console.log(
    `Scanned ${report.scanned} · aligned ${report.aligned} · mismatches ${report.mismatches.length} · pending ${report.pending}`,
  );
  console.log(
    `Saved · ${report.verificationMatched} matched · ${report.verificationPending} pending · locks ${report.locked} locked / ${report.unlocked} unlocked`,
  );

  if (report.skippedLeaves.length > 0) {
    console.log(`Skipped leaves: ${report.skippedLeaves.join(", ")}`);
  }

  if (report.mismatches.length > 0) {
    console.log(`\nSummary mismatches (${Math.min(6, report.mismatches.length)} shown):`);
    for (const entry of report.mismatches.slice(0, 6)) {
      console.log(`  ${entry.date} · ${entry.geminiEvent.slice(0, 80)} · ${entry.confidence}`);
    }
  }

  const lockSample = report.lockActions.filter((entry) => entry.action !== "pending").slice(0, 4);
  if (lockSample.length > 0) {
    console.log(`\nLock actions (${lockSample.length} shown):`);
    for (const entry of lockSample) {
      console.log(`  ${entry.date} · ${entry.action} · ${entry.reason.slice(0, 100)}`);
    }
  }
}

async function main() {
  const { leaf: leafArg, maxItems, applyLockPolicy, persistResults, runTopics, runSummaries, policyOnly, randomSample } =
    parseArgs();

  printLockPolicyChecks();
  if (policyOnly) {
    console.log("\n✅ Policy checks passed (--policy-only).");
    return;
  }

  if (!process.env.GOOGLE_API_KEY && !process.env.GEMINI_API_KEY) {
    console.error("❌ GOOGLE_API_KEY or GEMINI_API_KEY required (or pass --policy-only).");
    process.exit(1);
  }

  const leaf = randomSample ? undefined : resolveStorylineLeaf(leafArg);
  console.log(`\n=== Main events verification smoke ===`);
  if (randomSample) {
    console.log(`Random sample: ${randomSample} items across prepared leaves (dry run — no DB writes)`);
  } else {
    console.log(`Leaf: ${formatTopicLeafWithGroup(resolveStorylineLeaf(leafArg))}`);
  }
  console.log(`Max items per agent: ${maxItems}`);
  console.log(`Apply lock policy: ${applyLockPolicy ? "yes" : "no"}`);
  console.log(`Persist verification results: ${persistResults ? "yes" : "no (dry run)"}`);

  if (runTopics) {
    console.log("\nRunning topic alignment agent…");
    const topicReport = await verifyMainEventsTopicAlignment({
      leaf,
      maxItems,
      applyLockPolicy,
      persistResults,
      shuffleLeaves: Boolean(randomSample),
    });
    printTopicReport(topicReport);
  }

  if (runSummaries) {
    console.log("\nRunning summary alignment agent…");
    const summaryReport = await verifyMainEventsSummaryAlignment({
      leaf,
      maxItems,
      applyLockPolicy,
      persistResults,
      shuffleLeaves: Boolean(randomSample),
    });
    printSummaryReport(summaryReport);
  }

  console.log("\n✅ Verification agents smoke complete.");
}

main().catch((error) => {
  console.error("❌ Smoke test failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
