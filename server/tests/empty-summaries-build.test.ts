import assert from "node:assert/strict";
import { test } from "node:test";

import { buildEmptySummaryEntries } from "../../shared/empty-summaries-build";

test("buildEmptySummaryEntries tags DB rows vs calendar gaps", () => {
  const entries = buildEmptySummaryEntries([
    { date: "2013-01-02", summary: "" },
    { date: "2013-01-04", summary: "Bitcoin event on Jan 4." },
    { date: "2013-03-04", summary: "Another day." },
  ]);

  const byDate = Object.fromEntries(entries.map((e) => [e.date, e.kind]));
  assert.equal(byDate["2013-01-02"], "empty-summary");
  assert.equal(byDate["2013-01-01"], "missing-day");
  assert.equal(byDate["2013-03-03"], "missing-day");
  assert.equal(byDate["2013-01-04"], undefined);
  assert.equal(byDate["2013-03-04"], undefined);
});

test("buildEmptySummaryEntries detects Oct 31 gaps (UK DST-safe walk)", () => {
  const dates: { date: string; summary: string }[] = [];
  for (let d = 1; d <= 30; d++) {
    dates.push({ date: `2010-10-${String(d).padStart(2, "0")}`, summary: "event" });
  }
  dates.push({ date: "2010-11-01", summary: "event" });
  dates.push({ date: "2024-12-31", summary: "event" });

  const entries = buildEmptySummaryEntries(dates);
  const byDate = Object.fromEntries(entries.map((e) => [e.date, e.kind]));
  assert.equal(byDate["2010-10-31"], "missing-day");
});
