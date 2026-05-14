import assert from "node:assert/strict";
import test from "node:test";
import { executeAgent } from "../services/editorial-pipeline/executors";

test("NewsManager executor returns deterministic scaffold output", async () => {
  const out = await executeAgent("NewsManager", {
    runId: "test-run",
    triageItem: {
      date: "2024-01-01",
      analysisId: "77777777-7777-4777-8777-777777777777",
      route: "existing_ok",
      reasons: ["Quality checks passed for this day"],
      requiredAgents: ["NewsManager", "FinalEditorAgent"],
      confidence: 0.75,
    },
  });
  assert.equal(out.status, "completed");
  assert.ok(out.output.findings.length >= 1);
});
