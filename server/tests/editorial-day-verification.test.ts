import assert from "node:assert/strict";
import test from "node:test";

import {
  EDITORIAL_SUMMARY_TARGET_MIN,
  evaluateSummaryQuality,
} from "../services/editorial-pipeline/editorial-quality";

test("evaluateSummaryQuality flags too-short summaries", () => {
  const issue = evaluateSummaryQuality("x".repeat(EDITORIAL_SUMMARY_TARGET_MIN - 1));
  assert.ok(issue);
  assert.equal(issue?.code, "too_short");
});

test("evaluateSummaryQuality accepts in-range summaries", () => {
  const summary = "x".repeat(100);
  assert.equal(evaluateSummaryQuality(summary), null);
});
