/**
 * Tag wiki milestone manual entries with 1–2 keyword tags (Bitcoin, exchange names, etc.).
 *
 * Usage:
 *   npx tsx server/scripts/tag-wiki-milestone-manual-entries.ts --dry-run
 *   npx tsx server/scripts/tag-wiki-milestone-manual-entries.ts --apply
 *   npx tsx server/scripts/tag-wiki-milestone-manual-entries.ts --apply --date 2010-07-17
 */
import "dotenv/config";
import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";

import { extractWikiMilestoneKeywordTags } from "../../shared/wiki-milestone-keyword-tags";
import { storage } from "../storage";

dotenv.config({ path: path.resolve("client/.env") });

const CSV_PATH = path.resolve("tmp/bitcoin-wiki-milestone-crosscheck.csv");
const WIKI_SOURCE_URL = "https://en.bitcoin.it/wiki/Category:History";

type CrosscheckRow = {
  date: string;
  wikiMilestone: string;
  dbSummary: string;
  verdict: string;
};

function parseArgs() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const dryRun = args.includes("--dry-run") || !apply;
  const dateIdx = args.indexOf("--date");
  const singleDate = dateIdx >= 0 ? args[dateIdx + 1] : undefined;
  if (singleDate && !/^\d{4}-\d{2}-\d{2}$/.test(singleDate)) {
    throw new Error(`Invalid --date value: ${singleDate}`);
  }
  return { dryRun, singleDate };
}

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ",") {
      fields.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  fields.push(current);
  return fields;
}

function loadCrosscheckRows(): CrosscheckRow[] {
  const raw = fs.readFileSync(CSV_PATH, "utf8").trim();
  return raw.split(/\r?\n/).slice(1).map((line) => {
    const [date, wikiMilestone, dbSummary, verdict] = parseCsvLine(line);
    return {
      date: date?.trim() ?? "",
      wikiMilestone: wikiMilestone?.trim() ?? "",
      dbSummary: dbSummary?.trim() ?? "",
      verdict: verdict?.trim() ?? "",
    };
  });
}

async function syncTagsForAnalysis(date: string, tagNames: string[]): Promise<void> {
  const analysis = await storage.getAnalysisByDate(date);
  if (!analysis) throw new Error(`No analysis row for ${date}`);

  const existingTags = await storage.getTagsForAnalysis(analysis.id);
  for (const tag of existingTags) {
    await storage.removeTagFromAnalysis(analysis.id, tag.id);
  }

  await storage.updateAnalysis(date, { tagsVersion2: tagNames });

  for (const tagName of tagNames) {
    const tag = await storage.findOrCreateTag({
      name: tagName,
      category: "miscellaneous",
    });
    await storage.addTagToAnalysis(analysis.id, tag.id);
    await storage.updateTagUsageCount(tag.id);
  }
}

async function main() {
  const { dryRun, singleDate } = parseArgs();
  const rows = loadCrosscheckRows().filter((row) => {
    if (!["partial", "mismatch"].includes(row.verdict)) return false;
    if (singleDate && row.date !== singleDate) return false;
    return true;
  });

  console.log(
    dryRun
      ? `=== Wiki milestone tagging (DRY RUN) — ${rows.length} row(s) ===`
      : `=== Wiki milestone tagging (APPLY) — ${rows.length} row(s) ===`,
  );

  let applied = 0;
  const failures: Array<{ date: string; error: string }> = [];

  console.log(`${"date".padEnd(12)} | tags`);
  console.log("-".repeat(60));

  for (const row of rows) {
    try {
      const analysis = await storage.getAnalysisByDate(row.date);
      const summary = analysis?.summary ?? row.dbSummary;
      const tags = extractWikiMilestoneKeywordTags(row.wikiMilestone, summary);
      console.log(`${row.date.padEnd(12)} | ${tags.join(", ")}`);

      if (!dryRun) {
        if (!analysis) throw new Error("Missing analysis row (run apply-wiki-milestone first)");
        if (analysis.topArticleId !== WIKI_SOURCE_URL && !analysis.isManualOverride) {
          throw new Error("Row is not a wiki manual override");
        }
        await syncTagsForAnalysis(row.date, tags);
        applied += 1;
      }
    } catch (error) {
      failures.push({
        date: row.date,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  console.log("\n---");
  console.log(`Tagged: ${dryRun ? 0 : applied}`);
  console.log(`Failed: ${failures.length}`);

  if (failures.length) {
    for (const f of failures) console.log(`  ${f.date}: ${f.error}`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
