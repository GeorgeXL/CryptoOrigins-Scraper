import assert from "node:assert/strict";
import test from "node:test";

import {
  crossCheckLeafCoverage,
  normalizeCanonicalDates,
  resolveStorylineLeaf,
  splitCoverageByDismissals,
} from "../services/leaf-agent/coverage";
import {
  normalizeOptionalSourceUrl,
  readCanonicalSourceUrl,
} from "../services/leaf-agent/coverage-constants";
import {
  MAIN_EVENTS_CHECK_MAX_DATES,
} from "../../shared/leaf-agent-config";

test("resolveStorylineLeaf resolves exact and partial names", () => {
  assert.equal(resolveStorylineLeaf("halving events"), "Halving events");
  assert.equal(resolveStorylineLeaf("ETFs"), "ETFs and investment products");
});

test("normalizeCanonicalDates drops non-exact and out-of-range dates", () => {
  const { valid, skipped } = normalizeCanonicalDates(
    [
      { date: "2020-05-11", event: "Third halving", importance: "landmark" },
      { date: "2015-05-XX", event: "GBTC public", importance: "major" },
      { date: "2028-04-17", event: "Future halving", importance: "major" },
    ],
    10,
  );
  assert.equal(valid.length, 1);
  assert.equal(skipped.length, 2);
});

test("normalizeOptionalSourceUrl accepts http(s) URLs and rejects invalid values", () => {
  assert.equal(normalizeOptionalSourceUrl("https://example.com/a"), "https://example.com/a");
  assert.equal(normalizeOptionalSourceUrl("example.com/a"), "https://example.com/a");
  assert.equal(normalizeOptionalSourceUrl(""), undefined);
  assert.equal(normalizeOptionalSourceUrl("not a url"), undefined);
});

test("normalizeCanonicalDates preserves source URLs", () => {
  const { valid } = normalizeCanonicalDates(
    [
      {
        date: "2020-05-11",
        event: "Third halving",
        importance: "landmark",
        source_url: "https://example.com/halving",
      },
    ],
    10,
  );
  assert.equal(valid.length, 1);
  assert.equal(valid[0]?.sourceUrl, "https://example.com/halving");
});

test("readCanonicalSourceUrl reads camelCase and snake_case keys", () => {
  assert.equal(
    readCanonicalSourceUrl({ source_url: "https://example.com/a" }),
    "https://example.com/a",
  );
  assert.equal(
    readCanonicalSourceUrl({ sourceUrl: "https://example.com/b" }),
    "https://example.com/b",
  );
});

test("MAIN_EVENTS_CHECK_MAX_DATES is fixed for server-side Gemini asks", () => {
  assert.equal(MAIN_EVENTS_CHECK_MAX_DATES, 100);
});

test("splitCoverageByDismissals hides dismissed rows and locked misplaced rows", () => {
  const crossCheck = {
    misplaced: [
      {
        date: "2009-01-12",
        event: "First transaction",
        importance: "landmark" as const,
        currentLeaf: "Bitcoin price action",
        currentLeafLabel: "Bitcoin › Bitcoin price action",
        summary: "Satoshi sends BTC",
        isLocked: false,
      },
      {
        date: "2012-11-28",
        event: "First halving",
        importance: "landmark" as const,
        currentLeaf: "Halving events",
        currentLeafLabel: "Bitcoin › Halving events",
        summary: "Halving day",
        isLocked: true,
      },
    ],
    missing: [{ date: "2024-04-20", event: "Fourth halving", importance: "landmark" as const }],
    extra: [{ date: "2020-01-09", summary: "Halving chatter", isLocked: true }],
  };

  const split = splitCoverageByDismissals(crossCheck, {
    misplaced: ["2009-01-12"],
    missing: [],
    extra: ["2020-01-09"],
  });

  assert.equal(split.misplaced.length, 0);
  assert.equal(split.dismissed.misplaced.length, 1);
  assert.equal(split.dismissed.misplaced[0]?.date, "2009-01-12");
  assert.equal(split.missing.length, 1);
  assert.equal(split.extra.length, 0);
  assert.equal(split.dismissed.extra.length, 1);
});

test("crossCheckLeafCoverage splits matched, missing, misplaced, and extra", () => {
  const allRows = [
    {
      date: "2020-05-11",
      summary: "Third halving",
      isLocked: false,
      topics: ["halving events"],
    },
    {
      date: "2009-01-12",
      summary: "Satoshi sends 10 BTC to Hal Finney",
      isLocked: false,
      topics: ["bitcoin price action"],
    },
    {
      date: "2020-01-09",
      summary: "Halving chatter",
      isLocked: true,
      topics: ["halving events"],
    },
  ];
  const canonical = [
    {
      date: "2020-05-11",
      event: "Third halving",
      importance: "landmark" as const,
      sourceUrl: "https://example.com/halving",
    },
    { date: "2009-01-12", event: "First Bitcoin transaction", importance: "landmark" as const },
    { date: "2024-04-20", event: "Fourth halving", importance: "landmark" as const },
  ];

  const result = crossCheckLeafCoverage("Early Bitcoin history", allRows, canonical);
  assert.equal(result.matched.length, 0);
  assert.equal(result.misplaced.length, 2);
  assert.equal(result.misplaced.some((row) => row.date === "2009-01-12"), true);
  assert.equal(result.misplaced.find((row) => row.date === "2009-01-12")?.currentLeaf, "Bitcoin price action");
  assert.equal(result.missing.length, 1);
  assert.equal(result.missing[0]?.date, "2024-04-20");
  assert.equal(result.missing[0]?.sourceUrl, undefined);
  assert.equal(result.misplaced.find((row) => row.date === "2009-01-12")?.sourceUrl, undefined);
  assert.equal(result.extra.length, 0);
});
