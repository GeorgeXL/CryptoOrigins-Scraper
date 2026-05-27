import assert from "node:assert/strict";
import test from "node:test";
import { isEditorialSummaryWeak, isValidPipelineTopArticleId } from "../services/editorial-pipeline/editorial-quality";

test("isEditorialSummaryWeak treats short and failure placeholders as weak", () => {
  assert.equal(isEditorialSummaryWeak(null), true);
  assert.equal(isEditorialSummaryWeak(""), true);
  assert.equal(isEditorialSummaryWeak("Analysis failed"), true);
  assert.equal(isEditorialSummaryWeak("x".repeat(99)), true);
  assert.equal(isEditorialSummaryWeak("x".repeat(100)), false);
  assert.equal(isEditorialSummaryWeak("x".repeat(110)), false);
  assert.equal(isEditorialSummaryWeak("x".repeat(111)), true);
});

test("isValidPipelineTopArticleId rejects empty, none, and no-news placeholders", () => {
  assert.equal(isValidPipelineTopArticleId(null), false);
  assert.equal(isValidPipelineTopArticleId("none"), false);
  assert.equal(isValidPipelineTopArticleId("no-news-123"), false);
  assert.equal(isValidPipelineTopArticleId(" real-id "), true);
});
