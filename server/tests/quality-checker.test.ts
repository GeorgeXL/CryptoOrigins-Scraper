import assert from "node:assert/strict";
import test from "node:test";
import { QualityCheckerService, findTruncatedEnding } from "../services/quality-checker";

const checker = new QualityCheckerService();

test("trailing period is a quality issue even when length is valid", () => {
  const summary =
    "Hal Finney congratulates Satoshi on Bitcoin v0.1, praising its decentralization and fixed coin supply.";
  assert.equal(summary.length, 102);
  const issues = checker.checkSummaryQuality(summary);
  assert.equal(issues.some((issue) => issue.type === "TRAILING_PERIOD"), true);
});

test("summaries without a trailing period are not flagged for TRAILING_PERIOD", () => {
  const summary =
    "Hal Finney congratulates Satoshi on Bitcoin v0.1, praising its decentralization and fixed coin supply";
  const issues = checker.checkSummaryQuality(summary);
  assert.equal(issues.some((issue) => issue.type === "TRAILING_PERIOD"), false);
});

test("truncated ending flags dangling conjunctions and cut punctuation", () => {
  assert.equal(findTruncatedEnding("Markets rally after the Fed cuts rates and"), "Truncated ending");
  assert.equal(findTruncatedEnding("Markets rally after the Fed cuts rates,"), "Truncated ending");
  assert.equal(
    findTruncatedEnding("Hal Finney congratulates Satoshi on Bitcoin v0.1, praising its decentralization and fixed coin supply"),
    null,
  );
  const issues = checker.checkSummaryQuality(
    "Bitcoin network hash rate climbs as more miners join after the latest software and",
  );
  assert.equal(issues.some((issue) => issue.type === "TRUNCATED_ENDING"), true);
});

test("exactDuplicateIssues flags every date that shares a summary", () => {
  const issues = checker.exactDuplicateIssues([
    { date: "2010-01-01", summary: "Same event described in the same words for the timeline row" },
    { date: "2010-01-02", summary: "Same event described in the same words for the timeline row" },
    { date: "2010-01-03", summary: "A different summary that should not be grouped with the others" },
  ]);
  assert.equal(issues.has("2010-01-01"), true);
  assert.equal(issues.has("2010-01-02"), true);
  assert.equal(issues.has("2010-01-03"), false);
  assert.match(issues.get("2010-01-01")![0].message, /Duplicate summary/);
});
