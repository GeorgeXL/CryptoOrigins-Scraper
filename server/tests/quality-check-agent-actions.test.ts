import assert from "node:assert/strict";
import { test } from "node:test";

import {
  QUALITY_CHECK_AGENT_ACTIONS,
  QUALITY_CHECK_AGENT_TAB_IDS,
  clusterIsoDatesIntoWindows,
  filterQualityCheckAgentRows,
  getQualityCheckAgentAction,
  isEmptyQualityCheckSummary,
  monthPipelineWindow,
  resolveQualityCheckRunWindows,
  slicePipelineWindow,
} from "../../shared/quality-check-agent-actions";

test("every quality-check tab has an agent action", () => {
  const expectedTabs = [
    "empty-summary",
    "untagged",
    "flagged",
    "no-topic",
    "multi-topic",
    "missing-months",
    "too-short",
    "too-long",
    "ends-period",
    "has-hyphen",
    "truncated",
    "excessive-dots",
    "generic-fallback",
    "repeated-words",
    "placeholder-text",
    "duplicate-summary",
  ];
  assert.deepEqual([...QUALITY_CHECK_AGENT_TAB_IDS].sort(), [...expectedTabs].sort());
  for (const tab of expectedTabs) {
    const action = getQualityCheckAgentAction(tab);
    assert.ok(action, `missing action for ${tab}`);
    if (action.kind === "pipeline") {
      assert.ok(action.checkScopes?.length, `${tab} pipeline action needs scopes`);
    }
  }
});

test("clusterIsoDatesIntoWindows groups consecutive dates", () => {
  const windows = clusterIsoDatesIntoWindows(["2010-01-01", "2010-01-02", "2010-01-05"]);
  assert.equal(windows.length, 2);
  assert.deepEqual(windows[0], {
    dateFrom: "2010-01-01",
    dateTo: "2010-01-02",
    maxDays: 2,
    totalDays: 2,
  });
  assert.deepEqual(windows[1], {
    dateFrom: "2010-01-05",
    dateTo: "2010-01-05",
    maxDays: 1,
    totalDays: 1,
  });
});

test("monthPipelineWindow respects January 2009 start", () => {
  const jan2009 = monthPipelineWindow(2009, 1);
  assert.equal(jan2009.dateFrom, "2009-01-03");
  assert.equal(jan2009.dateTo, "2009-01-31");
});

test("resolveQualityCheckRunWindows expands incomplete months", () => {
  const windows = resolveQualityCheckRunWindows(
    "missing-months",
    [{ date: "2010-03-01", year: 2010, month: 3 }],
    new Set(),
  );
  assert.equal(windows.length, 1);
  assert.equal(windows[0]?.dateFrom, "2010-03-01");
  assert.equal(windows[0]?.dateTo, "2010-03-31");
});

test("slicePipelineWindow splits long ranges", () => {
  const slices = slicePipelineWindow({
    dateFrom: "2010-01-01",
    dateTo: "2010-03-15",
    maxDays: 74,
    totalDays: 74,
  });
  assert.ok(slices.length >= 3);
  assert.equal(slices[0]?.dateFrom, "2010-01-01");
  assert.equal(slices.at(-1)?.dateTo, "2010-03-15");
});

test("ends-period uses deterministic remove-periods kind", () => {
  assert.equal(QUALITY_CHECK_AGENT_ACTIONS["ends-period"]?.kind, "remove-periods");
});

test("isEmptyQualityCheckSummary treats blank text as empty", () => {
  assert.equal(isEmptyQualityCheckSummary(""), true);
  assert.equal(isEmptyQualityCheckSummary("   "), true);
  assert.equal(isEmptyQualityCheckSummary(null), true);
  assert.equal(isEmptyQualityCheckSummary("Bitcoin hits $100."), false);
});

test("filterQualityCheckAgentRows skips empty summaries except empty-summary tab", () => {
  const rows = [
    { date: "2010-01-01", summary: "" },
    { date: "2010-01-02", summary: "Bitcoin event on this day." },
  ];

  assert.equal(filterQualityCheckAgentRows("untagged", rows, new Set()).length, 1);
  assert.equal(filterQualityCheckAgentRows("empty-summary", rows, new Set()).length, 2);
  assert.equal(
    filterQualityCheckAgentRows("missing-months", [{ date: "2010-03-01", year: 2010, month: 3 }], new Set()).length,
    1,
  );
});

test("resolveQualityCheckRunWindows ignores empty-summary days for tag agent", () => {
  const windows = resolveQualityCheckRunWindows(
    "untagged",
    [
      { date: "2010-01-01", summary: "" },
      { date: "2010-01-02", summary: "Tagged day needs work." },
    ],
    new Set(),
  );
  assert.equal(windows.length, 1);
  assert.equal(windows[0]?.dateFrom, "2010-01-02");
  assert.equal(windows[0]?.dateTo, "2010-01-02");
});
