/**
 * Dry-run the unified corpus cleaner on random days (no DB writes).
 *
 * Usage:
 *   npx tsx server/scripts/dry-run-corpus-clean.ts
 *   npx tsx server/scripts/dry-run-corpus-clean.ts --from 2010-01-01 --to 2020-12-31 --count 14
 *   npx tsx server/scripts/dry-run-corpus-clean.ts --seed 42
 */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { db } from "../db";
import { evaluateCorpusDay, applyCorpusDayAutoFixes } from "../services/editorial-pipeline/corpus-clean";

function parseArgs(argv: string[]) {
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  return {
    from: get("--from") ?? "2010-01-01",
    to: get("--to") ?? "2020-12-31",
    count: Number(get("--count") ?? "14"),
    seed: get("--seed") ?? String(Date.now()),
    apply: argv.includes("--apply"),
  };
}

/** Deterministic shuffle (Fisher-Yates) for reproducible samples when --seed is set. */
function seededShuffle<T>(items: T[], seedStr: string): T[] {
  const arr = [...items];
  let seed = 0;
  for (let i = 0; i < seedStr.length; i += 1) {
    seed = (seed * 31 + seedStr.charCodeAt(i)) >>> 0;
  }
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!Number.isFinite(args.count) || args.count < 1) {
    throw new Error("--count must be a positive number");
  }

  console.log(
    JSON.stringify(
      {
        from: args.from,
        to: args.to,
        count: args.count,
        seed: args.seed,
        mode: args.apply ? "apply-auto" : "dry-run",
        topicAgentEnabled: process.env.TOPIC_AGENT_DISABLED !== "1" && Boolean(process.env.OPENAI_API_KEY),
        dateLlmEnabled: process.env.EDITORIAL_V3_DATE_LLM !== "0" && Boolean(process.env.OPENAI_API_KEY),
      },
      null,
      2,
    ),
  );

  const pool = await db.execute(sql`
    SELECT date::text AS date
    FROM historical_news_analyses
    WHERE date >= ${args.from}::date AND date <= ${args.to}::date
    ORDER BY date ASC
  `);
  const allDates = (pool.rows as { date: string }[]).map((r) => r.date);
  if (allDates.length === 0) {
    console.log("\nNo rows in range.");
    return;
  }

  const picked = seededShuffle(allDates, args.seed).slice(0, args.count);
  console.log(`\nSampled ${picked.length} day(s) from ${allDates.length} in range.\n`);

  const phaseCounts: Record<string, number> = {};
  let autoTopicCount = 0;
  let manualTopicCount = 0;

  for (const date of picked) {
    const eval_ = await evaluateCorpusDay(date);
    if (!eval_) {
      console.log(JSON.stringify({ date, error: "row missing" }));
      continue;
    }

    phaseCounts[eval_.phase] = (phaseCounts[eval_.phase] ?? 0) + 1;
    if (eval_.wouldAutoApply.some((x) => x.startsWith("topic→"))) autoTopicCount += 1;
    if (eval_.wouldQueueForHuman.some((x) => x.startsWith("topic→") || x.includes("topic"))) manualTopicCount += 1;

    const topicProposal = eval_.proposals.find((p) => p.kind === "set_topic_categories");
    const line: Record<string, unknown> = {
      date: eval_.date,
      route: eval_.triageRoute,
      phase: eval_.phase,
      topicsBefore: eval_.topicsBefore,
      topicIssues: eval_.topicIssuesBefore,
      autoApply: eval_.wouldAutoApply,
      humanQueue: eval_.wouldQueueForHuman,
      topicAfterAuto: eval_.topicAfterAuto,
      topicAgent:
        topicProposal?.kind === "set_topic_categories"
          ? {
              source: topicProposal.topicAgentSource ?? null,
              confidence: topicProposal.topicAgentConfidence ?? null,
              options: topicProposal.proposed.slice(0, 3),
            }
          : null,
      summaryPreview: eval_.summaryPreview,
    };
    if (args.apply && eval_.autoProposals.length > 0) {
      line.applied = await applyCorpusDayAutoFixes(date, eval_.autoProposals);
    }
    console.log(JSON.stringify(line));
  }

  console.log("\n=== SUMMARY ===");
  console.log(JSON.stringify({ phaseCounts, autoTopicHighConfidence: autoTopicCount, manualTopicReview: manualTopicCount }, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
