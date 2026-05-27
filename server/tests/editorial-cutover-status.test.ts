import assert from "node:assert/strict";
import test from "node:test";
import { getEditorialCutoverStatus } from "../services/editorial-pipeline/run";

test("cutover status exposes required safety flags", () => {
  const status = getEditorialCutoverStatus();
  assert.equal(typeof status.featureFlagEnabled, "boolean");
  assert.equal(status.requiredHumanApproval, true);
  assert.equal(typeof status.defaultModel, "string");
  assert.equal(typeof status.shortCircuitOnReject, "boolean");
  assert.equal(status.cutoverReadyChecks.humanApprovalGatePresent, true);
  assert.equal(status.cutoverReadyChecks.parallelModeOnly, true);
  assert.equal(typeof status.cutoverReadyChecks.shortCircuitOnReject, "boolean");
});
