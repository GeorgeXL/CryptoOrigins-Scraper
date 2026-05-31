import assert from "node:assert/strict";
import test from "node:test";

import { buildKnownEventContext } from "../services/editorial-pipeline/known-event-context";
import { triageExistingDay } from "../services/editorial-pipeline/triage";

test("milestone days are treated as known events without article winner", () => {
  const ctx = buildKnownEventContext({
    topArticleId: null,
    milestone: { label: "Bitcoin genesis block", description: "Satoshi mines block 0 on 2009-01-03." },
  });
  assert.equal(ctx.isKnownEvent, true);
  assert.equal(ctx.kind, "milestone");
  assert.match(ctx.explanation ?? "", /No news article is required/i);
});

test("triage skips missing top_article_id for milestone days with taxonomy", () => {
  const triage = triageExistingDay({
    date: "2009-01-03",
    analysisId: "00000000-0000-4000-8000-000000000001",
    summary: "The Bitcoin genesis block is mined by Satoshi, embedding a UK bank bailout headline as a historic timestamp",
    topArticleId: null,
    isManualOverride: false,
    isFlagged: false,
    isOrphan: false,
    totalArticlesFetched: 0,
    confidenceScore: 90,
    tagsVersion2: ["Bitcoin", "Satoshi", "UK"],
    topicCategories: ["Early Bitcoin history"],
    tags: [],
    manualEntryCount: 0,
    milestoneLabel: "Bitcoin genesis block",
  });
  assert.equal(triage.route, "existing_ok");
  assert.ok(!triage.reasons.some((r) => /winning article/i.test(r)));
});

test("manual override builds known-event explanation", () => {
  const ctx = buildKnownEventContext({
    topArticleId: null,
    isManualOverride: true,
    manualEntryTitle: "Lehman collapse",
  });
  assert.equal(ctx.kind, "manual_override");
  assert.match(ctx.explanation ?? "", /Manual override/i);
});
