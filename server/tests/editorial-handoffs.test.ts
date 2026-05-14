import assert from "node:assert/strict";
import test from "node:test";
import { buildHandoffChain } from "../services/editorial-pipeline/contracts";

test("buildHandoffChain creates multiple unique handoffs", () => {
  const chain = buildHandoffChain({
    fromAgent: "NewsManager",
    toAgents: [
      "NewsManager", // should be filtered out
      "VerificationAgent",
      "SummaryAgent",
      "VerificationAgent", // duplicate should collapse
      "FinalEditorAgent",
    ],
    analysisId: "99999999-9999-4999-8999-999999999999",
    date: "2024-01-10",
    confidence: 0.91,
    reasons: ["Low confidence score", "Summary appears weak or empty"],
    route: "existing_needs_correction",
    sourceStepId: "step-123",
  });

  assert.equal(chain.length, 3);
  assert.deepEqual(
    chain.map((x) => x.toAgent),
    ["VerificationAgent", "SummaryAgent", "FinalEditorAgent"]
  );
});

test("buildHandoffChain preserves shared payload metadata", () => {
  const [handoff] = buildHandoffChain({
    fromAgent: "NewsManager",
    toAgents: ["VerificationAgent"],
    analysisId: null,
    date: "2010-05-22",
    confidence: 0.98,
    reasons: ["No analysis exists for this day"],
    route: "missing_day",
    sourceStepId: "triage-step",
  });

  assert.equal(handoff.fromAgent, "NewsManager");
  assert.equal(handoff.payload.nextAgent, "VerificationAgent");
  assert.equal(handoff.payload.metadata.route, "missing_day");
  assert.equal(handoff.payload.metadata.sourceStepId, "triage-step");
  assert.equal(handoff.payload.reason, "No analysis exists for this day");
});
