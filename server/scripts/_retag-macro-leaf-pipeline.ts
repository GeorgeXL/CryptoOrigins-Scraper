/**
 * Full retag pipeline for one Macroeconomy leaf: gen map → emit → apply → verify.
 * Usage: npx tsx server/scripts/_retag-macro-leaf-pipeline.ts "Inflation"
 */
import { execSync } from "node:child_process";
import "dotenv/config";
import { storage } from "../storage";

const LEAF = process.argv[2];
if (!LEAF) {
  console.error("Usage: npx tsx server/scripts/_retag-macro-leaf-pipeline.ts \"Inflation\"");
  process.exit(1);
}

const SLUG_MAP: Record<string, { slug: string; fileSlug: string }> = {
  Inflation: { slug: "inflation", fileSlug: "Inflation" },
  "Monetary policy & rates": { slug: "monetary-policy-rates", fileSlug: "Monetary-policy---rates" },
  "Banking stress": { slug: "banking-stress", fileSlug: "Banking-stress" },
  "Debt crises": { slug: "debt-crises", fileSlug: "Debt-crises" },
  "Labor market": { slug: "labor-market", fileSlug: "Labor-market" },
  Housing: { slug: "housing", fileSlug: "Housing" },
  "Bailouts and stimulus": { slug: "bailouts-stimulus", fileSlug: "Bailouts-and-stimulus" },
  "Global growth and recession": { slug: "global-growth-recession", fileSlug: "Global-growth-and-recession" },
  "Politics and elections": { slug: "politics-elections", fileSlug: "Politics-and-elections" },
};

async function main() {
  const meta = SLUG_MAP[LEAF];
  if (!meta) {
    console.error(`Unknown leaf: ${LEAF}`);
    process.exit(1);
  }
  const { slug, fileSlug } = meta;

  const start = await storage.getAnalysesForStorylineLeaf(LEAF);
  console.log(JSON.stringify({ phase: "start", leaf: LEAF, count: start.length }));

  execSync(
    `npx tsx server/scripts/_gen-macro-leaf-map.ts ${JSON.stringify(LEAF)} > tmp/macro-maps/${fileSlug}.map.ts`,
    { stdio: "inherit", shell: "/bin/bash" },
  );
  execSync("npx tsx server/scripts/_emit-macro-retag-scripts.ts", { stdio: "inherit" });

  const batches = [
    ["2009-01-01", "2012-12-31"],
    ["2013-01-01", "2016-12-31"],
    ["2017-01-01", "2020-12-31"],
    ["2021-01-01", "2025-12-31"],
  ];

  for (const [from, to] of batches) {
    console.log(JSON.stringify({ phase: "apply-batch", from, to }));
    execSync(`npx tsx server/scripts/retag-${slug}.ts --apply --from ${from} --to ${to}`, {
      stdio: "inherit",
    });
  }

  execSync(`npx tsx server/scripts/retag-${slug}.ts --apply`, { stdio: "inherit" });

  const end = await storage.getAnalysesForStorylineLeaf(LEAF);
  console.log(JSON.stringify({ phase: "done", leaf: LEAF, start: start.length, final: end.length }));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
