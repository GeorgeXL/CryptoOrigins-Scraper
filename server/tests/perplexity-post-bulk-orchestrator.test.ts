import assert from "node:assert/strict";
import test from "node:test";

import {
  analysisHasNoTopic,
  isBulkFinished,
  isOrchestratorRunningPasses,
  passPhaseForNumber,
  TRIPLE_PASS_TOTAL,
  type OrchestratorState,
} from "../scripts/perplexity-cleanup-shared";

test("isBulkFinished when process stopped or all rows checked", () => {
  assert.equal(isBulkFinished(false, 100), true);
  assert.equal(isBulkFinished(false, 0), true);
  assert.equal(isBulkFinished(true, 0), true);
  assert.equal(isBulkFinished(true, 50), false);
});

test("passPhaseForNumber maps 1-3 to pass phases", () => {
  assert.equal(passPhaseForNumber(1), "pass_1");
  assert.equal(passPhaseForNumber(2), "pass_2");
  assert.equal(passPhaseForNumber(3), "pass_3");
  assert.throws(() => passPhaseForNumber(0), /Invalid pass number/);
  assert.throws(() => passPhaseForNumber(4), /Invalid pass number/);
});

test("TRIPLE_PASS_TOTAL defaults to 1 (CLEANUP_PASS_TOTAL can override)", () => {
  assert.equal(TRIPLE_PASS_TOTAL, 1);
});

test("analysisHasNoTopic matches quality-check no-topic rule", () => {
  assert.equal(
    analysisHasNoTopic({ summary: "Bitcoin hits new high", topicCategories: [] }),
    true,
  );
  assert.equal(
    analysisHasNoTopic({ summary: "Bitcoin hits new high", topicCategories: null }),
    true,
  );
  assert.equal(
    analysisHasNoTopic({ summary: "Bitcoin hits new high", topicCategories: ["Bitcoin price & cycles"] }),
    false,
  );
  assert.equal(analysisHasNoTopic({ summary: "  ", topicCategories: [] }), false);
  assert.equal(analysisHasNoTopic({ summary: null, topicCategories: [] }), false);
});

test("isOrchestratorRunningPasses detects active pass phases", () => {
  assert.equal(isOrchestratorRunningPasses({ phase: "waiting_for_bulk", currentPass: 0, totalPasses: 3, passes: [] }), false);
  assert.equal(isOrchestratorRunningPasses({ phase: "pass_1", currentPass: 1, totalPasses: 3, passes: [] }), true);
  assert.equal(isOrchestratorRunningPasses({ phase: "pass_2", currentPass: 2, totalPasses: 3, passes: [] }), true);
  assert.equal(isOrchestratorRunningPasses({ phase: "pass_3", currentPass: 3, totalPasses: 3, passes: [] }), true);
  assert.equal(isOrchestratorRunningPasses({ phase: "complete", currentPass: 3, totalPasses: 3, passes: [] }), false);
  assert.equal(isOrchestratorRunningPasses({ phase: "no_topic_fix", currentPass: 3, totalPasses: 3, passes: [] }), false);
  assert.equal(isOrchestratorRunningPasses({ phase: "failed", currentPass: 1, totalPasses: 3, passes: [] }), false);
});

test("triple pass sequence covers configured pass count", () => {
  const passes: number[] = [];
  for (let pass = 1; pass <= TRIPLE_PASS_TOTAL; pass += 1) {
    passes.push(pass);
    const state: OrchestratorState = {
      phase: passPhaseForNumber(pass),
      currentPass: pass,
      totalPasses: TRIPLE_PASS_TOTAL,
      passes: [],
    };
    assert.equal(isOrchestratorRunningPasses(state), true);
  }
  assert.deepEqual(
    passes,
    Array.from({ length: TRIPLE_PASS_TOTAL }, (_, i) => i + 1),
  );
});
