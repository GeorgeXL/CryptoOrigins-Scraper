import assert from "node:assert/strict";
import test from "node:test";
import { buildHandoffPayload, buildStepOutput, rejectionSchema } from "../services/editorial-pipeline/contracts";

test("buildHandoffPayload enforces confidence bounds", () => {
  assert.throws(
    () =>
      buildHandoffPayload({
        analysisId: null,
        date: "2024-01-01",
        status: "accepted",
        confidence: 2,
      }),
    /confidence/i
  );
});

test("buildStepOutput accepts structured handoff", () => {
  const out = buildStepOutput({
    summary: "Triage complete",
    findings: ["Low confidence", "Needs verification"],
    handoff: {
      analysisId: "66666666-6666-4666-8666-666666666666",
      date: "2024-01-01",
      status: "needs_review",
      confidence: 0.82,
      nextAgent: "VerificationAgent",
    },
  });
  assert.equal(out.handoff?.nextAgent, "VerificationAgent");
});

test("rejection schema enforces canonical action values", () => {
  assert.throws(
    () =>
      rejectionSchema.parse({
        status: "rejected",
        agent: "VerificationAgent",
        reason: "Date mismatch",
        confidence: 0.9,
        suggestedAction: "invent_new_fact",
        returnTo: "NewsManager",
      }),
    /suggestedAction/i
  );
});
