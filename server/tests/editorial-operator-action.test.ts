import assert from "node:assert/strict";
import test from "node:test";

import { computeOperatorActionPlan } from "../services/editorial-pipeline/operator-action";

test("orphan-only flag => Approve enabled, auto-fix clear orphan", () => {
  const plan = computeOperatorActionPlan({
    route: "existing_needs_correction",
    reasons: ["Day marked as orphan"],
  });
  assert.equal(plan.approveEnabled, true);
  assert.equal(plan.manualFixes.length, 0);
  assert.equal(plan.autoFixes.length, 1);
  assert.equal(plan.autoFixes[0].code, "orphan_flag");
  assert.match(plan.approveSummary, /clear the orphan flag/i);
});

test("manual flag + weak summary => Approve disabled, lists both", () => {
  const plan = computeOperatorActionPlan({
    route: "existing_needs_correction",
    reasons: ["Day is flagged", "Summary appears weak or empty"],
  });
  assert.equal(plan.approveEnabled, false);
  assert.equal(plan.autoFixes.length, 1);
  assert.equal(plan.autoFixes[0].code, "flagged");
  assert.equal(plan.manualFixes.length, 1);
  assert.equal(plan.manualFixes[0].code, "weak_summary");
  assert.match(plan.approveSummary, /cannot finish/i);
});

test("no winning article alone => Approve disabled, points operator to Open day", () => {
  const plan = computeOperatorActionPlan({
    route: "existing_needs_correction",
    reasons: ["No winning article selected (top_article_id missing or placeholder)"],
  });
  assert.equal(plan.approveEnabled, false);
  assert.equal(plan.autoFixes.length, 0);
  assert.equal(plan.manualFixes.length, 1);
  assert.equal(plan.manualFixes[0].code, "no_winning_article");
});

test("existing_ok with no reasons => Approve is an 'I looked' no-op", () => {
  const plan = computeOperatorActionPlan({
    route: "existing_ok",
    reasons: ["Quality checks passed for this day"],
  });
  assert.equal(plan.approveEnabled, true);
  assert.equal(plan.manualFixes.length, 0);
  assert.equal(plan.autoFixes.length, 0);
  assert.match(plan.approveSummary, /nothing about the data changes/i);
});

test("unrecognised reason routes to manual unknown fix", () => {
  const plan = computeOperatorActionPlan({
    route: "existing_needs_correction",
    reasons: ["Something we have never seen before"],
  });
  assert.equal(plan.approveEnabled, false);
  assert.equal(plan.manualFixes.length, 1);
  assert.equal(plan.manualFixes[0].code, "unknown");
});
