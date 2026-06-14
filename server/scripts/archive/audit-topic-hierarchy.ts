import "dotenv/config";
import { sql } from "drizzle-orm";
import { db } from "../db";
import { topicLabelsFromRow } from "../services/editorial-pipeline/tools";
import { invalidTopicReasons } from "../services/editorial-pipeline/topic-validation";

const allCount = await db.execute(sql`
  SELECT
    COUNT(*)::int AS total,
    COUNT(*) FILTER (WHERE topic_categories IS NULL OR topic_categories = '[]'::jsonb)::int AS empty_topics,
    COUNT(*) FILTER (WHERE topic_categories IS NOT NULL AND jsonb_array_length(topic_categories) > 1)::int AS multi_topic,
    COUNT(*) FILTER (WHERE topic_categories IS NOT NULL AND jsonb_array_length(topic_categories) = 1)::int AS single_topic
  FROM historical_news_analyses
`);
console.log("COUNTS", allCount.rows[0]);

const rows = await db.execute(sql`
  SELECT date, topic_categories
  FROM historical_news_analyses
  WHERE topic_categories IS NOT NULL AND jsonb_array_length(topic_categories) > 0
  ORDER BY date DESC
  LIMIT 800
`);

let valid = 0;
let invalid = 0;
let multi = 0;
let legacy = 0;
let unreadable = 0;
const badSamples: string[] = [];
const legacySamples: string[] = [];

for (const row of rows.rows as { date: string; topic_categories: unknown }[]) {
  const topics = topicLabelsFromRow(row.topic_categories);
  const issues = invalidTopicReasons(topics);
  if (topics.length === 0) unreadable += 1;
  if (issues.some((i) => i.includes("More than one"))) multi += 1;
  if (issues.some((i) => i.includes("Old broad"))) legacy += 1;
  if (issues.length === 0) valid += 1;
  else {
    invalid += 1;
    if (badSamples.length < 12) {
      badSamples.push(`${row.date}: [${topics.join(" | ")}] -> ${issues.join("; ")}`);
    }
    if (legacySamples.length < 8 && issues.some((i) => i.includes("Old broad"))) {
      legacySamples.push(`${row.date}: [${topics.join(" | ")}]`);
    }
  }
}

console.log("SAMPLED", rows.rows.length, { valid, invalid, multi, legacy, unreadable });
console.log("BAD_SAMPLES");
for (const s of badSamples) console.log(" ", s);
console.log("LEGACY_SAMPLES");
for (const s of legacySamples) console.log(" ", s);

const samples = await db.execute(sql`
  SELECT date, topic_categories, jsonb_array_length(topic_categories) AS n
  FROM historical_news_analyses
  WHERE topic_categories IS NOT NULL AND jsonb_array_length(topic_categories) > 0
  ORDER BY date DESC
  LIMIT 6
`);
console.log("RAW_SAMPLES");
for (const row of samples.rows as { date: string; topic_categories: unknown; n: number }[]) {
  console.log(" ", row.date, "n=", row.n, JSON.stringify(row.topic_categories));
}
