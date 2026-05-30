import assert from "node:assert/strict";
import test from "node:test";

import { triageItemSchema } from "../services/editorial-pipeline/contracts";
import { triageExistingDay } from "../services/editorial-pipeline/triage";

const analysisId = "11111111-1111-4111-8111-111111111111";
const validSummary = "x".repeat(105);

test("Jan 2026 M scenario: missing day routes to article pick gate", () => {
  const item = triageItemSchema.parse({
    date: "2026-01-01",
    analysisId: null,
    route: "missing_day",
    reasons: ["No analysis exists for this day"],
    requiredAgents: [
      "MilestoneAgent",
      "SourceFinderAgent",
      "RelevanceCheckerAgent",
      "VerificationAgent",
      "SummaryAgent",
      "DuplicateCheckerAgent",
      "DateConsistencyAgent",
      "TagConsistencyAgent",
      "FinalEditorAgent",
    ],
    confidence: 0.98,
  });

  assert.equal(item.route, "missing_day");
  assert.ok(item.requiredAgents.includes("SourceFinderAgent"));
});

test("Jan 2026 E-FETCH scenario: zero corpus without manual event routes empty_day", () => {
  const item = triageExistingDay({
    date: "2026-01-05",
    analysisId,
    summary: validSummary,
    topArticleId: null,
    isFlagged: false,
    isOrphan: false,
    totalArticlesFetched: 0,
    confidenceScore: 90,
    tagsVersion2: ["Bitcoin"],
    topicCategories: ["Bitcoin price action"],
    tagLinkCount: 1,
  });

  assert.equal(item.route, "empty_day");
});

test("Jan 2026 E-SUM scenario: invalid summary with valid article and taxonomy routes correction", () => {
  const item = triageExistingDay({
    date: "2026-01-06",
    analysisId,
    summary: "Too short",
    topArticleId: "article-1",
    isFlagged: false,
    isOrphan: false,
    totalArticlesFetched: 4,
    confidenceScore: 90,
    tagsVersion2: ["Bitcoin"],
    topicCategories: ["Bitcoin price action"],
    tagLinkCount: 1,
  });

  assert.equal(item.route, "existing_needs_correction");
  assert.equal(item.requiredAgents.includes("SourceFinderAgent"), false);
  assert.ok(item.requiredAgents.includes("SummaryAgent"));
});

test("Jan 2026 O scenario: valid summary, article, tags, and topic routes existing_ok", () => {
  const item = triageExistingDay({
    date: "2026-01-07",
    analysisId,
    summary: validSummary,
    topArticleId: "article-1",
    isFlagged: false,
    isOrphan: false,
    totalArticlesFetched: 4,
    confidenceScore: 90,
    tagsVersion2: ["Bitcoin"],
    topicCategories: ["Bitcoin price action"],
    tagLinkCount: 1,
  });

  assert.equal(item.route, "existing_ok");
});

test("Jan 2026 C-FLAG/C-TAX/C-CONF scenarios route existing_needs_correction", () => {
  const flagged = triageExistingDay({
    date: "2026-01-08",
    analysisId,
    summary: validSummary,
    topArticleId: "article-1",
    isFlagged: true,
    isOrphan: false,
    totalArticlesFetched: 4,
    confidenceScore: 90,
    tagsVersion2: ["Bitcoin"],
    topicCategories: ["Bitcoin price action"],
    tagLinkCount: 1,
  });
  const noTaxonomy = triageExistingDay({
    date: "2026-01-12",
    analysisId,
    summary: validSummary,
    topArticleId: "article-1",
    isFlagged: false,
    isOrphan: false,
    totalArticlesFetched: 4,
    confidenceScore: 90,
    tagsVersion2: [],
    topicCategories: [],
    tags: [],
    tagLinkCount: 0,
  });
  const lowConfidence = triageExistingDay({
    date: "2026-01-28",
    analysisId,
    summary: validSummary,
    topArticleId: "article-1",
    isFlagged: false,
    isOrphan: false,
    totalArticlesFetched: 4,
    confidenceScore: 42,
    tagsVersion2: ["Bitcoin"],
    topicCategories: ["Bitcoin price action"],
    tagLinkCount: 1,
  });

  assert.equal(flagged.route, "existing_needs_correction");
  assert.equal(noTaxonomy.route, "existing_needs_correction");
  assert.equal(lowConfidence.route, "existing_needs_correction");
});

test("Jan 2026 C-TOP scenario: malformed winner id routes existing_needs_correction", () => {
  const item = triageExistingDay({
    date: "2026-01-10",
    analysisId,
    summary: validSummary,
    topArticleId: "bad-top-id-shape",
    isFlagged: false,
    isOrphan: false,
    totalArticlesFetched: 3,
    confidenceScore: 88,
    tagsVersion2: ["Bitcoin"],
    topicCategories: ["Bitcoin price action"],
    tagLinkCount: 1,
  });

  assert.equal(item.route, "existing_needs_correction");
});

test("Jan 2026 E-SUM refetch scenario: invalid summary without usable event source routes empty_day", () => {
  const item = triageExistingDay({
    date: "2026-01-16",
    analysisId,
    summary: "Too short",
    topArticleId: "none",
    isFlagged: false,
    isOrphan: false,
    totalArticlesFetched: 3,
    confidenceScore: 90,
    tagsVersion2: [],
    topicCategories: [],
    tags: [],
    tagLinkCount: 0,
  });

  assert.equal(item.route, "empty_day");
  assert.ok(item.requiredAgents.includes("SourceFinderAgent"));
});

test("Known/manual event scenario: no fetched articles can still be clean", () => {
  const item = triageExistingDay({
    date: "2026-01-20",
    analysisId,
    summary: validSummary,
    topArticleId: null,
    isManualOverride: true,
    isFlagged: false,
    isOrphan: false,
    totalArticlesFetched: 0,
    confidenceScore: 90,
    tagsVersion2: ["Bitcoin"],
    topicCategories: ["Bitcoin adoption"],
    tagLinkCount: 1,
  });

  assert.equal(item.route, "existing_ok");
});
