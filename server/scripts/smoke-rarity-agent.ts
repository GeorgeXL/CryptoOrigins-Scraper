/**
 * Smoke test: Rarity agent (gpt-5.4-mini) on known calendar rows.
 *
 * Usage:
 *   npx tsx server/scripts/smoke-rarity-agent.ts
 *   npx tsx server/scripts/smoke-rarity-agent.ts --dry-run
 *   npx tsx server/scripts/smoke-rarity-agent.ts --apply
 */
import "dotenv/config";

import { storage } from "../storage";
import {
  classifyRarityFromSummary,
  RARITY_AGENT_MODEL,
  runRarityBatch,
} from "../services/homepage-checks/rarity-check";
import { RARITY_LABELS, type Rarity } from "../../shared/rarity";

/** Editorial expectations for the five-tier story rarity scale. */
const FIXTURES: Array<{ date: string; expect: Rarity }> = [
  { date: "2009-01-03", expect: "artifact" },
  { date: "2010-05-22", expect: "artifact" },
  { date: "2020-05-11", expect: "landmark" },
  { date: "2014-02-24", expect: "infamous" },
  { date: "2024-01-10", expect: "landmark" },
  { date: "2009-10-08", expect: "chronicle" },
  { date: "2022-11-11", expect: "infamous" },
];

async function main() {
  const apply = process.argv.includes("--apply");
  const dryRun = process.argv.includes("--dry-run") || !apply;

  console.log(`Rarity agent smoke · model=${RARITY_AGENT_MODEL} · ${dryRun ? "dry-run" : "apply"}\n`);

  const items: { date: string; summary: string; expect: Rarity }[] = [];

  for (const fixture of FIXTURES) {
    const row = await storage.getAnalysisByDate(fixture.date);
    if (!row?.summary?.trim()) {
      console.log(`✗ ${fixture.date} — missing row/summary`);
      continue;
    }
    items.push({ date: fixture.date, summary: row.summary, expect: fixture.expect });
  }

  if (items.length === 0) {
    console.error("No fixture rows found — is DATABASE_URL configured?");
    process.exit(1);
  }

  let matches = 0;
  for (const item of items) {
    const label = await classifyRarityFromSummary(item.summary);
    const ok = label === item.expect;
    if (ok) matches += 1;
    console.log(
      `${ok ? "✓" : "✗"} ${item.date} → ${label ?? "null"} (expected ${item.expect} / ${RARITY_LABELS[item.expect]})`,
    );
  }

  console.log(`\nDirect classify: ${matches}/${items.length} matched expected label`);

  if (!dryRun) {
    const batch = await runRarityBatch(items.map(({ date, summary }) => ({ date, summary })));
    console.log(`Batch: assigned=${batch.assignedDays} failed=${batch.failedDays}`);
    for (const [date, row] of Object.entries(batch.results)) {
      if (row.rarity) {
        await storage.updateAnalysis(date, { rarity: row.rarity });
      }
    }
  }

  process.exit(matches === items.length ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
