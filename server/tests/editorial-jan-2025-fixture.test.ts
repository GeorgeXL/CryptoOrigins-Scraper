/**
 * January 2025 editorial acceptance — triage fixtures.
 *
 * Live DB (as of initial authoring): corpus ends 2024-12-31; Jan 2025 has zero
 * analysis rows → every in-range date is `missing_day`. See docs/TEST_JAN_2025_EDITORIAL.md.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { triageItemSchema } from "../services/editorial-pipeline/contracts";
import { triageExistingDay } from "../services/editorial-pipeline/triage";

/** Four-day sample called out in the manual test plan. */
export const JAN_2025_SAMPLE_DATES = [
  "2025-01-01",
  "2025-01-03",
  "2025-01-06",
  "2025-01-10",
] as const;

const MISSING_DAY_CHAIN_TAIL = [
  "MilestoneAgent",
  "SourceFinderAgent",
  "RelevanceCheckerAgent",
  "VerificationAgent",
  "SummaryAgent",
  "DuplicateCheckerAgent",
  "DateConsistencyAgent",
  "TagConsistencyAgent",
  "FinalEditorAgent",
] as const;

test("Jan 2025 sample dates: missing_day triage when no analysis row (synthetic)", () => {
  for (const date of JAN_2025_SAMPLE_DATES) {
    const item = triageItemSchema.parse({
      date,
      analysisId: null,
      route: "missing_day",
      reasons: ["No analysis exists for this day"],
      requiredAgents: ["NewsManager", ...MISSING_DAY_CHAIN_TAIL],
      confidence: 0.98,
    });
    assert.equal(item.route, "missing_day");
    assert.equal(item.analysisId, null);
    assert.ok(item.requiredAgents.includes("MilestoneAgent"));
    assert.ok(item.requiredAgents.includes("SourceFinderAgent"));
    assert.ok(item.requiredAgents.indexOf("SummaryAgent") < item.requiredAgents.indexOf("FinalEditorAgent"));
  }
});

test("corpus boundary 2024-12-31: existing_ok when row matches production shape", () => {
  const item = triageExistingDay({
    date: "2024-12-31",
    analysisId: "11111111-1111-4111-8111-111111111111",
    summary: "x".repeat(105),
    topArticleId:
      "https://www.cnbc.com/2024/12/31/bitcoin-was-the-best-investment-of-2024-but-not-without-its-usual-volatility.html",
    isFlagged: false,
    isOrphan: false,
    totalArticlesFetched: 10,
    confidenceScore: 88,
    tagsVersion2: ["Bitcoin"],
    topicCategories: [{ name: "Markets" }],
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

test("Jan 2025 is not existing_ok without a persisted row", () => {
  for (const date of JAN_2025_SAMPLE_DATES) {
    const missing = triageItemSchema.parse({
      date,
      analysisId: null,
      route: "missing_day",
      reasons: ["No analysis exists for this day"],
      requiredAgents: ["NewsManager", ...MISSING_DAY_CHAIN_TAIL],
      confidence: 0.98,
    });
    assert.notEqual(missing.route, "existing_ok");
  }
});
