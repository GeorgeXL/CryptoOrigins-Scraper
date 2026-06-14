/**
 * Mark calendar days as verified happened (Perplexity / Google check = yes).
 * Setting yes also locks the day (see storage.updateAnalysisGoogleCheck).
 *
 * Usage:
 *   npx tsx server/scripts/mark-dates-happened.ts 2010-03-24 2012-06-03
 *   npx tsx server/scripts/mark-dates-happened.ts --file tmp/dates.txt
 *   npx tsx server/scripts/mark-dates-happened.ts --dry-run 2010-03-24
 */

import "dotenv/config";
import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";

import { storage } from "../storage";

dotenv.config({ path: path.resolve("client/.env") });

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseArgs(): { dates: string[]; dryRun: boolean } {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const fileIdx = args.indexOf("--file");
  const dates: string[] = [];

  if (fileIdx >= 0) {
    const filePath = args[fileIdx + 1];
    if (!filePath) throw new Error("--file requires a path");
    const lines = fs
      .readFileSync(path.resolve(filePath), "utf-8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    dates.push(...lines);
  }

  for (const arg of args) {
    if (arg.startsWith("--")) continue;
    if (fileIdx >= 0 && args[fileIdx + 1] === arg) continue;
    if (DATE_RE.test(arg)) dates.push(arg);
  }

  return { dates: [...new Set(dates)].sort(), dryRun };
}

async function main() {
  const { dates, dryRun } = parseArgs();

  if (dates.length === 0) {
    console.error("No dates provided. Use YYYY-MM-DD args or --file path");
    process.exit(1);
  }

  const invalid = dates.filter((d) => !DATE_RE.test(d));
  if (invalid.length > 0) {
    console.error("Invalid dates (use YYYY-MM-DD):", invalid.join(", "));
    process.exit(1);
  }

  if (dryRun) console.log("DRY RUN — no DB writes\n");

  let updated = 0;
  let alreadyYes = 0;
  let missing = 0;

  for (const date of dates) {
    const existing = await storage.getAnalysisByDate(date);
    if (!existing) {
      console.log(`${date} — skip (no row)`);
      missing += 1;
      continue;
    }

    if (existing.googleCheckHappened === "yes" && existing.isLocked) {
      console.log(`${date} — already yes · locked`);
      alreadyYes += 1;
      continue;
    }

    if (dryRun) {
      console.log(`${date} — would set yes · lock (was ${existing.googleCheckHappened ?? "unchecked"})`);
      updated += 1;
      continue;
    }

    await storage.updateAnalysisGoogleCheck(date, {
      googleCheckHappened: "yes",
      googleCheckCheckedAt: new Date(),
    });

    console.log(`${date} — yes · locked ✓`);
    updated += 1;
  }

  console.log(
    `\nDone: ${updated} updated · ${alreadyYes} already yes · ${missing} missing · ${dates.length} total`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
