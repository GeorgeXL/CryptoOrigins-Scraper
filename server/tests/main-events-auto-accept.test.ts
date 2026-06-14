import assert from "node:assert/strict";
import test from "node:test";

import {
  findAutoAcceptCandidates,
  summarizeAutoAcceptBatch,
} from "../../shared/main-events-auto-accept";
import { buildMainEventsReviewQueue } from "../../shared/main-events-review-build";
import { EMPTY_MAIN_EVENTS_VERIFICATION_DATES } from "../../shared/leaf-agent-config";

function buildQueue(
  overrides: Partial<Parameters<typeof buildMainEventsReviewQueue>[0]> = {},
) {
  return buildMainEventsReviewQueue({
    leaf: "Halving events",
    canonical: [{ date: "2012-11-28", event: "First halving", importance: "landmark" }],
    analyses: [
      {
        date: "2012-11-28",
        summary: "Bitcoin block reward halved",
        topicCategories: ["Halving events"],
        isLocked: false,
      },
    ],
    verification: { ...EMPTY_MAIN_EVENTS_VERIFICATION_DATES },
    ...overrides,
  });
}

test("findAutoAcceptCandidates accepts pending in_db unlocked rows", () => {
  const queue = buildQueue();
  const candidates = findAutoAcceptCandidates(queue);

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]?.date, "2012-11-28");
});

test("findAutoAcceptCandidates skips already accepted rows", () => {
  const queue = buildQueue({
    verification: {
      matched: ["2012-11-28"],
      pending: [],
      rejected: [],
    },
  });

  assert.equal(findAutoAcceptCandidates(queue).length, 0);
});

test("findAutoAcceptCandidates skips missing, untagged, and wrong_leaf", () => {
  const base = {
    leaf: "Bitcoin mining",
    canonical: [
      { date: "2020-05-11", event: "Third halving", importance: "landmark" },
      { date: "2021-09-23", event: "Untagged day", importance: "notable" },
      { date: "2022-06-13", event: "Wrong leaf day", importance: "notable" },
    ],
    analyses: [
      {
        date: "2021-09-23",
        summary: "No tag yet",
        topicCategories: [],
        isLocked: false,
      },
      {
        date: "2022-06-13",
        summary: "On another leaf",
        topicCategories: ["Halving events"],
        isLocked: false,
      },
    ],
    verification: { ...EMPTY_MAIN_EVENTS_VERIFICATION_DATES },
  };

  const queue = buildMainEventsReviewQueue(base);
  assert.equal(findAutoAcceptCandidates(queue).length, 0);
  assert.equal(queue.items.find((i) => i.date === "2020-05-11")?.dbStatus, "missing");
});

test("findAutoAcceptCandidates skips locked rows", () => {
  const queue = buildQueue({
    analyses: [
      {
        date: "2012-11-28",
        summary: "Bitcoin block reward halved",
        topicCategories: ["Halving events"],
        isLocked: true,
      },
    ],
  });

  assert.equal(findAutoAcceptCandidates(queue).length, 0);
});

test("findAutoAcceptCandidates skips dates assigned to another leaf", () => {
  const queue = buildMainEventsReviewQueue({
    leaf: "Halving events",
    canonical: [{ date: "2012-11-28", event: "First halving", importance: "landmark" }],
    analyses: [
      {
        date: "2012-11-28",
        summary: "Bitcoin block reward halved",
        topicCategories: ["Halving events"],
        isLocked: false,
      },
    ],
    verification: { ...EMPTY_MAIN_EVENTS_VERIFICATION_DATES },
    crossLeafAssignments: new Map([["2012-11-28", "Bitcoin mining"]]),
  });

  assert.equal(queue.items.length, 0);
  assert.equal(findAutoAcceptCandidates(queue).length, 0);
});

test("summarizeAutoAcceptBatch aggregates per-leaf results", () => {
  const summary = summarizeAutoAcceptBatch(
    [
      { leaf: "Halving events", candidates: ["2012-11-28"], accepted: 1, skipped: 2 },
      { leaf: "Bitcoin mining", candidates: [], accepted: 0, skipped: 5 },
    ],
    { dryRun: false },
  );

  assert.equal(summary.totals.leavesProcessed, 2);
  assert.equal(summary.totals.leavesWithCandidates, 1);
  assert.equal(summary.totals.candidateDates, 1);
  assert.equal(summary.totals.accepted, 1);
  assert.equal(summary.totals.skipped, 7);
  assert.equal(summary.dryRun, false);
});

test("summarizeAutoAcceptBatch reports zero accepted when dryRun", () => {
  const summary = summarizeAutoAcceptBatch(
    [{ leaf: "Halving events", candidates: ["2012-11-28", "2016-07-09"], accepted: 0, skipped: 0 }],
    { dryRun: true },
  );

  assert.equal(summary.totals.candidateDates, 2);
  assert.equal(summary.totals.accepted, 0);
  assert.equal(summary.dryRun, true);
});
