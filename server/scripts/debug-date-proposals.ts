import "dotenv/config";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { historicalNewsAnalyses } from "@shared/schema";
import { buildCorrectionProposals } from "../services/editorial-pipeline/proposals";
import { inferStorylineLabels } from "../services/editorial-pipeline/storyline-taxonomy";
import { invalidTopicReasons } from "../services/editorial-pipeline/topic-validation";
import { topicLabelsFromRow } from "../services/editorial-pipeline/tools";
import { findUngroundedTags } from "../services/editorial-pipeline/tag-grounding";
import { loadCanonicalTagIndex } from "../services/editorial-pipeline/tag-grounding";
import { evaluateSummaryQuality } from "../services/editorial-pipeline/editorial-quality";

import { evaluateSummaryQuality, isEditorialSummaryWeak } from "../services/editorial-pipeline/editorial-quality";

function collectArticleTextForGrounding(tieredArticles: unknown, analyzedArticles: unknown, cap = 20000): string {
  const out: string[] = [];
  let remaining = cap;
  const pushPart = (s: unknown) => {
    if (remaining <= 0) return;
    if (typeof s !== "string") return;
    const trimmed = s.trim();
    if (!trimmed) return;
    const slice = trimmed.slice(0, remaining);
    out.push(slice);
    remaining -= slice.length;
  };
  if (tieredArticles && typeof tieredArticles === "object") {
    for (const key of ["bitcoin", "crypto", "macro"] as const) {
      const arr = (tieredArticles as Record<string, unknown>)[key];
      if (!Array.isArray(arr)) continue;
      for (const a of arr) {
        if (!a || typeof a !== "object") continue;
        const o = a as Record<string, unknown>;
        pushPart(o.title);
        pushPart(o.summary);
        pushPart(o.text);
        if (remaining <= 0) break;
      }
    }
  }
  if (Array.isArray(analyzedArticles) && remaining > 0) {
    for (const a of analyzedArticles) {
      if (!a || typeof a !== "object") continue;
      const o = a as Record<string, unknown>;
      pushPart(o.title);
      pushPart(o.summary);
      pushPart(o.text);
      if (remaining <= 0) break;
    }
  }
  return out.join(" \n ");
}

async function debugDate(date: string) {
  const [row] = await db
    .select()
    .from(historicalNewsAnalyses)
    .where(eq(historicalNewsAnalyses.date, date))
    .limit(1);
  if (!row) {
    console.log("\n===", date, "NO ROW ===");
    return;
  }

  const v2 = Array.isArray(row.tagsVersion2) ? (row.tagsVersion2 as string[]) : [];
  const summary = row.summary ?? "";
  const topics = topicLabelsFromRow(row.topicCategories);

  console.log("\n===", date, "===");
  console.log("summary:", summary);
  console.log("summary quality:", evaluateSummaryQuality(summary));
  console.log("tags_version2:", v2);
  console.log("legacy tags:", JSON.stringify(row.tags));
  console.log("topic_categories:", JSON.stringify(row.topicCategories));
  console.log("topic issues:", invalidTopicReasons(topics));
  console.log("inferred topic:", inferStorylineLabels({ summary, tags: v2 }));

  const articleText = collectArticleTextForGrounding(row.tieredArticles, row.analyzedArticles);
  console.log("articleText len:", articleText.length);

  const index = await loadCanonicalTagIndex();
  const ungroundedSummary = findUngroundedTags(v2, [summary]);
  const ungroundedFull = findUngroundedTags(v2, [summary, articleText]);
  console.log("ungrounded (summary):", ungroundedSummary);
  console.log("ungrounded (summary+article):", ungroundedFull);
  console.log("summary weak:", isEditorialSummaryWeak(summary));

  const proposals = buildCorrectionProposals({
    date,
    summary: row.summary,
    topArticleId: row.topArticleId,
    isOrphan: row.isOrphan,
    isFlagged: row.isFlagged,
    tagsVersion2: v2,
    topicCategories: row.topicCategories,
    legacyTags: row.tags,
    articleText,
    canonicalTagIndex: index,
  });
  console.log(
    "proposals:",
    JSON.stringify(
      proposals.map((p) => ({
        kind: p.kind,
        ...( "proposedAdd" in p ? { proposedAdd: (p as { proposedAdd: string[] }).proposedAdd } : {}),
        ...( "proposedDrop" in p ? { proposedDrop: (p as { proposedDrop: string[] }).proposedDrop } : {}),
        ...( "proposed" in p ? { proposed: (p as { proposed: string[] }).proposed, current: (p as { current?: string[] }).current } : {}),
        ...( "merges" in p ? { merges: (p as { merges: unknown[] }).merges } : {}),
        rationale: p.rationale,
      })),
      null,
      2,
    ),
  );
}

const dates = process.argv.slice(2);
if (dates.length === 0) dates.push("2012-02-09", "2012-02-17", "2012-02-19", "2012-02-28");
for (const date of dates) await debugDate(date);
