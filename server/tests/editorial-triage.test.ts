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
  assert.ok(item.reasons.some((r) => r.includes("orphan")));
});

test("triageExistingDay marks healthy record as existing_ok", () => {
  const item = triageExistingDay({
    date: "2024-01-10",
    analysisId: "22222222-2222-4222-8222-222222222222",
    summary: "Institutional demand supports Bitcoin ETF momentum as macro liquidity expectations improve significantly.",
    isFlagged: false,
    isOrphan: false,
    totalArticlesFetched: 8,
    confidenceScore: 88,
  });

  assert.equal(item.route, "existing_ok");
  assert.deepEqual(item.requiredAgents, ["NewsManager", "FinalEditorAgent"]);
});

test("prioritizeTriage sorts missing/empty/correction/ok", () => {
  const ordered = prioritizeTriage([
    {
      date: "2024-01-04",
      analysisId: "33333333-3333-4333-8333-333333333333",
      route: "existing_ok",
      reasons: ["ok"],
      requiredAgents: ["NewsManager", "FinalEditorAgent"],
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
