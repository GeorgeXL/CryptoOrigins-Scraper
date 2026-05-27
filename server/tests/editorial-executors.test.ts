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
      requiredAgents: ["NewsManager", "DuplicateCheckerAgent", "DateConsistencyAgent", "TagConsistencyAgent", "FinalEditorAgent"],
      confidence: 0.75,
    },
  });
  assert.equal(out.status, "completed");
  assert.ok(out.output.findings.length >= 1);
});

test("DateConsistencyAgent skips when no analysis id is present", async () => {
  const prev = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  const out = await executeAgent("DateConsistencyAgent", {
    runId: "test-run",
    triageItem: {
      date: "2024-01-01",
      analysisId: null,
      route: "existing_ok",
      reasons: ["Quality checks passed for this day"],
      requiredAgents: ["NewsManager", "DuplicateCheckerAgent", "DateConsistencyAgent", "TagConsistencyAgent", "FinalEditorAgent"],
      confidence: 0.75,
    },
  });
  assert.equal(out.status, "skipped");
  if (prev !== undefined) process.env.OPENAI_API_KEY = prev;
});
