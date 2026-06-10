import assert from "node:assert/strict";
import test from "node:test";
import { prioritizeTriage, triageExistingDay } from "../services/editorial-pipeline/triage";
import type { TriageItem } from "../services/editorial-pipeline/contracts";

test("triageExistingDay marks empty day for low-content records", () => {
  const item = triageExistingDay({
    date: "2020-05-11",
    analysisId: "11111111-1111-4111-8111-111111111111",
    summary: "",
    isFlagged: false,
    isOrphan: true,
    totalArticlesFetched: 0,
    confidenceScore: 42,
  });

  assert.equal(item.route, "empty_day");
  assert.ok(item.requiredAgents.includes("SourceFinderAgent"));
  const sumIdx = item.requiredAgents.indexOf("SummaryAgent");
  const dupIdx = item.requiredAgents.indexOf("DuplicateCheckerAgent");
  const dIdx = item.requiredAgents.indexOf("DateConsistencyAgent");
  const tagIdx = item.requiredAgents.indexOf("TagConsistencyAgent");
  const fIdx = item.requiredAgents.indexOf("FinalEditorAgent");
  assert.ok(sumIdx >= 0 && dupIdx > sumIdx && dIdx > dupIdx && tagIdx > dIdx && fIdx > tagIdx);
  assert.ok(item.reasons.some((r) => r.includes("orphan")));
});

test("triageExistingDay flags missing winning article even when summary and taxonomy look fine", () => {
  const item = triageExistingDay({
    date: "2012-11-24",
    analysisId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    summary: "x".repeat(104),
    topArticleId: "none",
    isFlagged: false,
    isOrphan: false,
    totalArticlesFetched: 12,
    confidenceScore: 90,
    tagsVersion2: ["Bitcoin"],
    topicCategories: ["Bitcoin price action"],
    tagLinkCount: 1,
  });
  assert.equal(item.route, "existing_needs_correction");
  assert.ok(item.reasons.some((r) => r.toLowerCase().includes("winning article")));
});

test("triageExistingDay marks healthy record as existing_ok", () => {
  const item = triageExistingDay({
    date: "2024-01-10",
    analysisId: "22222222-2222-4222-8222-222222222222",
    summary: "x".repeat(105),
    topArticleId: "article-top-1",
    isFlagged: false,
    isOrphan: false,
    totalArticlesFetched: 8,
    confidenceScore: 88,
    tagsVersion2: ["Bitcoin", "ETF"],
    topicCategories: [{ name: "Bitcoin adoption" }],
    tagLinkCount: 2,
  });

  assert.equal(item.route, "existing_ok");
  assert.deepEqual(item.requiredAgents, [
    "NewsManager",
    "DuplicateCheckerAgent",
    "DateConsistencyAgent",
    "TagConsistencyAgent",
    "FinalEditorAgent",
  ]);
});

test("triageExistingDay routes weak summary to existing_needs_correction when article + taxonomy suffice (summary-only redo)", () => {
  const item = triageExistingDay({
    date: "2010-05-22",
    analysisId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    summary: "Short manual blurb.", // <80 chars → weak, but story is operator-curated
    topArticleId: "pizza-milestone-article",
    isFlagged: false,
    isOrphan: false,
    totalArticlesFetched: 4,
    confidenceScore: 90,
    tagsVersion2: ["Bitcoin"],
    topicCategories: [{ name: "Early Bitcoin history" }],
    tagLinkCount: 1,
  });
  assert.equal(item.route, "existing_needs_correction");
  assert.ok(item.reasons.some((r) => r.includes("too short")));
  assert.ok(item.reasons.some((r) => r.includes("redo_summary") || r.includes("100")));
  assert.ok(item.requiredAgents.includes("SummaryAgent"));
  assert.equal(item.requiredAgents.includes("SourceFinderAgent"), false);
});

test("triageExistingDay routes too-long summary to correction when article + taxonomy suffice", () => {
  const item = triageExistingDay({
    date: "2026-01-27",
    analysisId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    summary: "x".repeat(111),
    topArticleId: "article-1",
    isFlagged: false,
    isOrphan: false,
    totalArticlesFetched: 4,
    confidenceScore: 90,
    tagsVersion2: ["Bitcoin"],
    topicCategories: [{ name: "Bitcoin price action" }],
    tagLinkCount: 1,
  });
  assert.equal(item.route, "existing_needs_correction");
  assert.ok(item.reasons.some((r) => r.includes("too long")));
  assert.ok(item.requiredAgents.includes("SummaryAgent"));
  assert.equal(item.requiredAgents.includes("SourceFinderAgent"), false);
});

test("triageExistingDay accepts known manual event without fetched articles when summary and taxonomy pass", () => {
  const item = triageExistingDay({
    date: "2010-05-22",
    analysisId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    summary: "x".repeat(106),
    topArticleId: null,
    isManualOverride: true,
    isFlagged: false,
    isOrphan: false,
    totalArticlesFetched: 0,
    confidenceScore: 90,
    tagsVersion2: ["Bitcoin", "Pizza Day"],
    topicCategories: [{ name: "Bitcoin adoption" }],
    tagLinkCount: 1,
  });
  assert.equal(item.route, "existing_ok");
  assert.equal(item.reasons.some((r) => r.includes("No fetched articles")), false);
  assert.equal(item.reasons.some((r) => r.includes("winning article")), false);
});

test("triageExistingDay routes old broad topics to correction even when tags exist", () => {
  const item = triageExistingDay({
    date: "2010-10-27",
    analysisId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    summary: "x".repeat(106),
    topArticleId: "article-1",
    isFlagged: false,
    isOrphan: false,
    totalArticlesFetched: 4,
    confidenceScore: 90,
    tagsVersion2: ["Democrats"],
    topicCategories: ["economic", "institutional"],
    tagLinkCount: 1,
  });

  assert.equal(item.route, "existing_needs_correction");
  assert.ok(item.reasons.some((r) => r.includes("Topic hierarchy issue")));
  assert.ok(item.requiredAgents.includes("TopicValidatorAgent"));
});

test("triageExistingDay routes known manual event with invalid summary to correction, not article pick", () => {
  const item = triageExistingDay({
    date: "2010-05-22",
    analysisId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    summary: "Bitcoin Pizza Day",
    topArticleId: null,
    isManualOverride: true,
    isFlagged: false,
    isOrphan: false,
    totalArticlesFetched: 0,
    confidenceScore: 90,
    tagsVersion2: ["Bitcoin", "Pizza Day"],
    topicCategories: [{ name: "Bitcoin adoption" }],
    tagLinkCount: 1,
  });
  assert.equal(item.route, "existing_needs_correction");
  assert.ok(item.reasons.some((r) => r.includes("Known/manual event")));
  assert.equal(item.requiredAgents.includes("SourceFinderAgent"), false);
});

test("triageExistingDay routes to existing_needs_correction when summary ok but no taxonomy", () => {
  const item = triageExistingDay({
    date: "2010-05-22",
    analysisId: "33333333-3333-4333-8333-333333333333",
    summary: "x".repeat(104),
    topArticleId: "pizza-milestone-article",
    isFlagged: false,
    isOrphan: false,
    totalArticlesFetched: 1,
    confidenceScore: 90,
    tagsVersion2: [],
    topicCategories: [],
    tags: [],
    tagLinkCount: 0,
  });

  assert.equal(item.route, "existing_needs_correction");
  assert.ok(item.reasons.some((r) => r.includes("tags_version2") || r.includes("tags or topic categories")));
  assert.ok(item.requiredAgents.includes("TopicValidatorAgent"));
  assert.ok(item.requiredAgents.includes("TagManagerAgent"));
  const sumIdx = item.requiredAgents.indexOf("SummaryAgent");
  const dupIdx = item.requiredAgents.indexOf("DuplicateCheckerAgent");
  const dIdx = item.requiredAgents.indexOf("DateConsistencyAgent");
  const tagIdx = item.requiredAgents.indexOf("TagConsistencyAgent");
  const fIdx = item.requiredAgents.indexOf("FinalEditorAgent");
  assert.ok(sumIdx >= 0 && dupIdx > sumIdx && dIdx > dupIdx && tagIdx > dIdx && fIdx > tagIdx);
});

test("prioritizeTriage sorts missing/empty/correction/ok", () => {
  const ordered = prioritizeTriage([
    {
      date: "2024-01-04",
      analysisId: "33333333-3333-4333-8333-333333333333",
      route: "existing_ok",
      reasons: ["ok"],
      requiredAgents: [
        "NewsManager",
        "DuplicateCheckerAgent",
        "DateConsistencyAgent",
        "TagConsistencyAgent",
        "FinalEditorAgent",
      ],
      confidence: 0.8,
    },
    {
      date: "2024-01-03",
      analysisId: null,
      route: "missing_day",
      reasons: ["missing"],
      requiredAgents: ["MilestoneAgent", "FinalEditorAgent"],
      confidence: 0.9,
    },
    {
      date: "2024-01-02",
      analysisId: "44444444-4444-4444-8444-444444444444",
      route: "existing_needs_correction",
      reasons: ["flagged"],
      requiredAgents: ["VerificationAgent", "FinalEditorAgent"],
      confidence: 0.8,
    },
    {
      date: "2024-01-01",
      analysisId: "55555555-5555-4555-8555-555555555555",
      route: "empty_day",
      reasons: ["empty"],
      requiredAgents: ["SourceFinderAgent", "FinalEditorAgent"],
      confidence: 0.8,
    },
  ] satisfies TriageItem[]);

  assert.deepEqual(
    ordered.map((x) => x.route),
    ["missing_day", "empty_day", "existing_needs_correction", "existing_ok"]
  );
});
