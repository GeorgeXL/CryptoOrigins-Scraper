import assert from "node:assert/strict";
import test from "node:test";
import { relevanceRequiresArticlePick } from "../services/editorial-pipeline/relevance-agent";
import { evaluateSummaryQuality } from "../services/editorial-pipeline/editorial-quality";

test("relevanceRequiresArticlePick flags off_topic with medium+ confidence", () => {
  assert.equal(
    relevanceRequiresArticlePick({
      source: "llm",
      classification: "off_topic",
      confidence: "high",
      suggestArticlePick: true,
      reason: "test",
    }),
    true,
  );
  assert.equal(
    relevanceRequiresArticlePick({
      source: "rules",
      classification: "insufficient",
      confidence: "high",
      suggestArticlePick: true,
      reason: "test",
    }),
    true,
  );
  assert.equal(
    relevanceRequiresArticlePick({
      source: "llm",
      classification: "macro_adjacent",
      confidence: "high",
      suggestArticlePick: false,
      reason: "test",
    }),
    false,
  );
});

test("evaluateSummaryQuality enforces 100-110 bounds", () => {
  assert.equal(evaluateSummaryQuality("x".repeat(99))?.code, "too_short");
  assert.equal(evaluateSummaryQuality("x".repeat(100)), null);
});
