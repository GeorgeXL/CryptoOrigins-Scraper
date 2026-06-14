import { and, gte, lte } from "drizzle-orm";
import { db } from "../db";
import { historicalNewsAnalyses } from "@shared/schema";
import { evaluateTagConsistency, topicLabelsFromRow } from "../services/editorial-pipeline/tools";

const dateFrom = process.argv[2] ?? "2010-01-01";
const dateTo = process.argv[3] ?? new Date().toISOString().slice(0, 10);

function preview(text: string, max = 140): string {
  const out = text.replace(/\s+/g, " ").trim();
  return out.length > max ? `${out.slice(0, max)}…` : out;
}

async function main() {
  const rows = await db
    .select({
      date: historicalNewsAnalyses.date,
      summary: historicalNewsAnalyses.summary,
      tagsVersion2: historicalNewsAnalyses.tagsVersion2,
      topicCategories: historicalNewsAnalyses.topicCategories,
    })
    .from(historicalNewsAnalyses)
    .where(and(gte(historicalNewsAnalyses.date, dateFrom), lte(historicalNewsAnalyses.date, dateTo)));

  const mismatches = rows
    .map((row) => {
      const tags = Array.isArray(row.tagsVersion2) ? row.tagsVersion2.filter((t) => typeof t === "string") : [];
      const topics = topicLabelsFromRow(row.topicCategories);
      const evaluation = evaluateTagConsistency({ summary: row.summary ?? "", tags, topics });
      return { date: row.date, summary: row.summary ?? "", issues: evaluation.issues };
    })
    .filter((row) => row.issues.length > 0);

  if (!mismatches.length) {
    console.log(`No tag/topic mismatches between ${dateFrom} and ${dateTo}.`);
    return;
  }

  console.log(`Tag/topic mismatches (${mismatches.length}) between ${dateFrom} and ${dateTo}:`);
  for (const row of mismatches) {
    console.log(`- ${row.date}: ${preview(row.summary)}`);
    row.issues.forEach((issue) => console.log(`  • ${issue.message}`));
  }
}

main().catch((err) => {
  console.error("tag-mismatch-report failed:", err);
  process.exitCode = 1;
});
