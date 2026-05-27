import assert from "node:assert/strict";
import test from "node:test";
import { determineApprovedAction } from "../services/editorial-pipeline/approved-writer";

test("determineApprovedAction routes missing day to reanalyze", () => {
  const out = determineApprovedAction({
    triage: {
      date: "2024-01-01",
      route: "missing_day",
    },
  });
  assert.equal(out.ok, true);
  assert.equal(out.action?.kind, "reanalyze_date");
  assert.equal(out.action?.date, "2024-01-01");
});

test("determineApprovedAction routes correction to apply_corrections", () => {
  const out = determineApprovedAction({
    triage: {
      date: "2024-01-02",
      route: "existing_needs_correction",
    },
  });
  assert.equal(out.ok, true);
  assert.equal(out.action?.kind, "apply_corrections");
  assert.equal(out.action?.date, "2024-01-02");
});

test("determineApprovedAction routes existing_ok to noop_review", () => {
  const out = determineApprovedAction({
    triage: {
      date: "2024-01-03",
      route: "existing_ok",
    },
  });
  assert.equal(out.ok, true);
  assert.equal(out.action?.kind, "noop_review");
});

test("determineApprovedAction fails without triage date", () => {
  const out = determineApprovedAction({ triage: { route: "empty_day" } });
  assert.equal(out.ok, false);
  assert.match(out.message || "", /Missing triage payload date/);
});
