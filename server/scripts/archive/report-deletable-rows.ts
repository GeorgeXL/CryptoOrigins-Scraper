/**
 * Report rows that are candidates for hard deletion (REPORT ONLY — no deletes).
 *
 * Categories:
 * 1. google_check no/uncertain AND no storyline topic
 * 2. No-topic rows flagged as junk by isOffTopicSummary heuristic
 *
 * Usage:
 *   npx tsx server/scripts/report-deletable-rows.ts
 */
import "dotenv/config";

import { sql } from "drizzle-orm";

import { analysisHasStorylineTopic } from "@shared/storyline-topic-eligibility";
import { db } from "../db";
import { isOffTopicSummary } from "./review-pending-corrections-careful";

type AnalysisRow = {
  date: string;
  google_check_happened: string | null;
  summary: string;
  topic_categories: unknown;
  is_locked: boolean;
};

const SAMPLE_LIMIT = 15;

async function fetchNoTopicRows(): Promise<AnalysisRow[]> {
  const result = await db.execute<AnalysisRow>(sql`
    SELECT
      date::text AS date,
      google_check_happened,
      summary,
      topic_categories,
      is_locked
    FROM historical_news_analyses
    WHERE topic_categories IS NULL
       OR jsonb_array_length(COALESCE(topic_categories, '[]'::jsonb)) = 0
    ORDER BY date ASC
  `);
  return result.rows as AnalysisRow[];
}

function sampleDates(rows: AnalysisRow[], limit = SAMPLE_LIMIT): string[] {
  if (rows.length <= limit) return rows.map((r) => r.date);
  const step = Math.max(1, Math.floor(rows.length / limit));
  const picked: string[] = [];
  for (let i = 0; i < rows.length && picked.length < limit; i += step) {
    picked.push(rows[i]!.date);
  }
  return picked;
}

async function main() {
  const noTopicRows = await fetchNoTopicRows();

  const googleNoUncertain = noTopicRows.filter(
    (r) => r.google_check_happened === "no" || r.google_check_happened === "uncertain",
  );
  const googleNo = googleNoUncertain.filter((r) => r.google_check_happened === "no");
  const googleUncertain = googleNoUncertain.filter((r) => r.google_check_happened === "uncertain");

  const junkRows: Array<{ date: string; reason: string; summaryPreview: string }> = [];
  for (const row of noTopicRows) {
    const { offTopic, reason } = isOffTopicSummary(row.summary ?? "");
    if (offTopic) {
      junkRows.push({
        date: row.date,
        reason,
        summaryPreview: String(row.summary ?? "").slice(0, 120),
      });
    }
  }

  const googleYesNoTopic = noTopicRows.filter((r) => r.google_check_happened === "yes");
  const otherNoTopic = noTopicRows.filter(
    (r) =>
      r.google_check_happened !== "yes" &&
      r.google_check_happened !== "no" &&
      r.google_check_happened !== "uncertain",
  );

  console.log("=== DELETION CANDIDATE REPORT (no rows deleted) ===\n");

  console.log(
    JSON.stringify(
      {
        totals: {
          allNoTopicRows: noTopicRows.length,
          googleNoOrUncertainNoTopic: googleNoUncertain.length,
          googleNo: googleNo.length,
          googleUncertain: googleUncertain.length,
          junkByIsOffTopicSummary: junkRows.length,
          googleYesStillNeedTopic: googleYesNoTopic.length,
          otherNoTopicNullGoogleCheck: otherNoTopic.length,
        },
      },
      null,
      2,
    ),
  );

  console.log("\n--- Category 1: google no/uncertain + no topic (hard-delete candidates) ---");
  console.log(`Count: ${googleNoUncertain.length}`);
  console.log(`Sample dates: ${sampleDates(googleNoUncertain).join(", ")}`);

  console.log("\n--- Category 2: junk by isOffTopicSummary + no topic ---");
  console.log(`Count: ${junkRows.length}`);
  for (const j of junkRows.slice(0, SAMPLE_LIMIT)) {
    console.log(
      JSON.stringify({
        date: j.date,
        reason: j.reason,
        summaryPreview: j.summaryPreview,
      }),
    );
  }
  if (junkRows.length > SAMPLE_LIMIT) {
    console.log(`... and ${junkRows.length - SAMPLE_LIMIT} more`);
  }

  console.log("\n--- Reference (not deletion candidates in this report) ---");
  console.log(`google_check=yes, no topic (need retag): ${googleYesNoTopic.length}`);
  console.log(`Sample: ${sampleDates(googleYesNoTopic, 10).join(", ")}`);

  // Cross-check: locked rows without topic (should be 0 per policy)
  const lockedNoTopic = noTopicRows.filter((r) => r.is_locked);
  if (lockedNoTopic.length > 0) {
    console.log(`\nWARN: ${lockedNoTopic.length} no-topic row(s) still locked`);
    console.log(`Dates: ${lockedNoTopic.map((r) => r.date).join(", ")}`);
  }

  // Sanity: storyline eligibility on no-topic set
  const falsePositiveTopics = noTopicRows.filter((r) => analysisHasStorylineTopic(r.topic_categories));
  if (falsePositiveTopics.length > 0) {
    console.log(`\nWARN: ${falsePositiveTopics.length} row(s) in no-topic query have topics`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
