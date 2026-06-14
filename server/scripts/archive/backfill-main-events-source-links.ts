/**
 * Backfill source URLs for cached main-events Gemini lists.
 *
 * Usage:
 *   npx tsx server/scripts/backfill-main-events-source-links.ts
 *   npx tsx server/scripts/backfill-main-events-source-links.ts --leaf "Halving events"
 */

import "dotenv/config";

import { formatTopicLeafWithGroup } from "../../shared/topic-hierarchy";
import {
  backfillAllMainEventsSourceUrls,
  backfillMainEventsSourceUrls,
  resolveStorylineLeaf,
} from "../services/leaf-agent/coverage";

function parseArgs() {
  const args = process.argv.slice(2);
  let leaf: string | null = null;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--leaf" && args[i + 1]) {
      leaf = args[++i]!;
    }
  }

  return { leaf };
}

async function main() {
  const { leaf } = parseArgs();

  if (leaf) {
    const resolved = resolveStorylineLeaf(leaf);
    console.log(`Backfilling source links for ${formatTopicLeafWithGroup(resolved)}…`);
    const result = await backfillMainEventsSourceUrls(resolved);
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log("Backfilling source links for all cached storyline leaves…");
  const results = await backfillAllMainEventsSourceUrls();
  let updatedTotal = 0;
  let failed = 0;

  for (const result of results) {
    updatedTotal += result.updated;
    if (result.error) failed += 1;
    const label = formatTopicLeafWithGroup(result.leaf);
    if (result.error) {
      console.log(`✗ ${label} — ${result.error}`);
    } else if (result.updated > 0) {
      console.log(`✓ ${label} — ${result.updated} link(s) added (${result.stillMissing} still missing)`);
    } else {
      console.log(`· ${label} — already complete (${result.total} events)`);
    }
  }

  console.log("");
  console.log(
    `Done · ${results.length} cached leaves · ${updatedTotal} links added · ${failed} failed`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
