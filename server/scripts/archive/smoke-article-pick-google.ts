/**
 * Smoke test: verifyArticlePick against real pending article-pick queue items.
 *
 * Usage:
 *   npx tsx server/scripts/smoke-article-pick-google.ts
 *   npx tsx server/scripts/smoke-article-pick-google.ts --count 4
 *   npx tsx server/scripts/smoke-article-pick-google.ts --count 4 --skip-date 2022-12-27
 */

import "dotenv/config";
import { eq } from "drizzle-orm";

import { db } from "../db";
import { aiService } from "../services/ai";
import { isArticlePickPackage } from "../services/editorial-pipeline/review-package";
import { humanReviewQueue } from "@shared/schema";

function parseArgs() {
  const args = process.argv.slice(2);
  let count = 1;
  let skipDate: string | null = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--count" && args[i + 1]) {
      count = Math.max(1, Number.parseInt(args[i + 1]!, 10) || 1);
      i++;
    } else if (args[i] === "--skip-date" && args[i + 1]) {
      skipDate = args[i + 1]!.trim();
      i++;
    }
  }
  return { count, skipDate };
}

async function main() {
  const { count, skipDate } = parseArgs();
  console.log(`\n=== Article pick Google check smoke (${count} item${count === 1 ? "" : "s"}) ===\n`);

  if (!process.env.GOOGLE_API_KEY?.trim() && !process.env.GEMINI_API_KEY?.trim()) {
    console.error("❌ GOOGLE_API_KEY or GEMINI_API_KEY required");
    process.exit(1);
  }

  const rows = await db
    .select({
      id: humanReviewQueue.id,
      eventDate: humanReviewQueue.eventDate,
      package: humanReviewQueue.package,
    })
    .from(humanReviewQueue)
    .where(eq(humanReviewQueue.status, "pending"));

  const articlePickRows = rows
    .filter(
      (row) =>
        isArticlePickPackage(row.package) &&
        row.package.hasCandidates &&
        row.package.candidates.length > 0 &&
        row.eventDate !== skipDate,
    )
    .sort((a, b) => a.eventDate.localeCompare(b.eventDate));

  console.log(`Pending queue rows: ${rows.length}`);
  console.log(`Pending article-pick rows with candidates: ${articlePickRows.length}`);
  if (skipDate) console.log(`Skipping date: ${skipDate}`);

  const targets = articlePickRows.slice(0, count);
  if (targets.length === 0) {
    console.error("❌ No pending article-pick items in queue — nothing to smoke test");
    process.exit(1);
  }
  if (targets.length < count) {
    console.warn(`⚠️ Only ${targets.length} item(s) available (requested ${count})`);
  }

  const gemini = aiService.getProvider("gemini");
  if (!gemini.verifyArticlePick) {
    console.error("❌ verifyArticlePick not available on Gemini provider");
    process.exit(1);
  }

  const summary: Array<{
    date: string;
    scenario: string;
    elapsedMs: number;
    pickId: string | null;
    title: string | null;
  }> = [];

  for (let t = 0; t < targets.length; t++) {
    const target = targets[t]!;
    const pkg = target.package;
    const date = target.eventDate;
    const candidates = pkg.candidates.slice(0, 12);

    console.log(`\n--- Test ${t + 1}/${targets.length} ---`);
    console.log(`Queue item: ${target.id}`);
    console.log(`Date: ${date}`);
    console.log(`Scenario: ${pkg.scenario}`);
    console.log(`Candidates sent: ${candidates.length}`);
    candidates.slice(0, 3).forEach((c, i) => {
      console.log(`  ${i + 1}. [${c.tier}] ${c.title.slice(0, 80)}`);
    });
    if (candidates.length > 3) console.log(`  … +${candidates.length - 3} more`);

    const started = Date.now();
    const result = await gemini.verifyArticlePick({
      date,
      scenario: pkg.scenario,
      candidates: candidates.map((c) => ({
        id: c.id,
        title: c.title,
        publishedDate: c.publishedDate ?? null,
        tier: c.tier,
        summary: c.summary,
      })),
    });
    const elapsed = Date.now() - started;

    const picked = result.pickId ? candidates.find((c) => c.id === result.pickId) : null;
    console.log(`Result (${elapsed}ms): ${JSON.stringify(result)}`);
    if (picked) {
      console.log(`✅ ${picked.title.slice(0, 100)}`);
      console.log(`   Tier: ${picked.tier} · published: ${picked.publishedDate ?? "unknown"}`);
    } else {
      console.log("✅ pickId=null (no reliable match)");
    }

    summary.push({
      date,
      scenario: pkg.scenario,
      elapsedMs: elapsed,
      pickId: result.pickId,
      title: picked?.title ?? null,
    });
  }

  console.log("\n=== Summary ===");
  for (const row of summary) {
    console.log(
      `${row.date} (${row.scenario}) · ${row.elapsedMs}ms · ${row.pickId ? row.title?.slice(0, 70) ?? row.pickId : "null"}`,
    );
  }
}

main().catch((err) => {
  console.error("Smoke crashed:", err);
  process.exit(1);
});
