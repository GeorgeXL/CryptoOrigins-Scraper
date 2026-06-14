import assert from "node:assert/strict";
import test from "node:test";

import { EMPTY_MAIN_EVENTS_VERIFICATION_DATES, resolveMainEventsReviewStatus } from "../../shared/leaf-agent-config";
import { applyVerificationDecision, applyReviewDecisionToQueue, buildMainEventsReviewQueue } from "../../shared/main-events-review-build";
import { reviewDecisionRequiresDayLock } from "../../shared/main-events-verification-lock";

test("buildMainEventsReviewQueue assigns pending by default", () => {
  const queue = buildMainEventsReviewQueue({
    leaf: "Halving events",
    canonical: [
      { date: "2012-11-28", event: "First halving", importance: "landmark" },
      { date: "2016-07-09", event: "Second halving", importance: "landmark" },
    ],
    analyses: [
      {
        date: "2012-11-28",
        summary: "Bitcoin block reward halved",
        topicCategories: ["Halving events"],
        isLocked: false,
      },
    ],
    verification: { ...EMPTY_MAIN_EVENTS_VERIFICATION_DATES },
  });

  assert.equal(queue.counts.pending, 2);
  assert.equal(queue.items[0]?.dbStatus, "in_db");
  assert.equal(queue.items[1]?.dbStatus, "missing");
});

test("resolveMainEventsReviewStatus maps verification buckets", () => {
  const verification = {
    matched: ["2012-11-28"],
    pending: [],
    rejected: ["2016-07-09"],
  };
  assert.equal(resolveMainEventsReviewStatus("2012-11-28", verification), "accepted");
  assert.equal(resolveMainEventsReviewStatus("2016-07-09", verification), "rejected");
  assert.equal(resolveMainEventsReviewStatus("2020-05-11", verification), "pending");
});

test("buildMainEventsReviewQueue counts accepted and rejected", () => {
  const queue = buildMainEventsReviewQueue({
    leaf: "Halving events",
    canonical: [{ date: "2012-11-28", event: "First halving", importance: "landmark" }],
    analyses: [],
    verification: {
      matched: ["2012-11-28"],
      pending: [],
      rejected: [],
    },
  });

  assert.equal(queue.counts.accepted, 1);
  assert.equal(queue.counts.pending, 0);
  assert.equal(queue.items[0]?.reviewStatus, "accepted");
  assert.equal(queue.items[0]?.isLocked, true);
});

test("buildMainEventsReviewQueue marks rejected missing rows as locked", () => {
  const queue = buildMainEventsReviewQueue({
    leaf: "Halving events",
    canonical: [{ date: "2016-07-09", event: "Second halving", importance: "landmark" }],
    analyses: [],
    verification: {
      matched: [],
      pending: [],
      rejected: ["2016-07-09"],
    },
  });

  assert.equal(queue.items[0]?.reviewStatus, "rejected");
  assert.equal(queue.items[0]?.dbStatus, "missing");
  assert.equal(queue.items[0]?.isLocked, true);
});

test("applyReviewDecisionToQueue updates one item and counts", () => {
  const queue = buildMainEventsReviewQueue({
    leaf: "Halving events",
    canonical: [
      { date: "2012-11-28", event: "First halving", importance: "landmark" },
      { date: "2016-07-09", event: "Second halving", importance: "landmark" },
    ],
    analyses: [],
    verification: { ...EMPTY_MAIN_EVENTS_VERIFICATION_DATES },
  });

  const rejected = applyReviewDecisionToQueue(queue, "2012-11-28", "rejected");

  assert.equal(rejected.counts.pending, 1);
  assert.equal(rejected.counts.rejected, 1);
  assert.equal(rejected.items.find((item) => item.date === "2012-11-28")?.reviewStatus, "rejected");
  assert.equal(rejected.items.find((item) => item.date === "2012-11-28")?.isLocked, true);
  assert.equal(rejected.items.find((item) => item.date === "2016-07-09")?.reviewStatus, "pending");
});

test("applyVerificationDecision accepted marks date matched (Apply to database accept step)", () => {
  const verification = applyVerificationDecision(
    { matched: [], pending: ["2012-11-28"], rejected: [] },
    "2012-11-28",
    "accepted",
  );

  assert.deepEqual(verification.matched, ["2012-11-28"]);
  assert.deepEqual(verification.pending, []);
  assert.deepEqual(verification.rejected, []);
  assert.equal(reviewDecisionRequiresDayLock("accepted"), true);
});

test("buildMainEventsReviewQueue treats empty topic tag as untagged row", () => {
  const queue = buildMainEventsReviewQueue({
    leaf: "Bitcoin mining",
    canonical: [{ date: "2021-09-23", event: "Argo Blockchain goes public", importance: "notable" }],
    analyses: [
      {
        date: "2021-09-23",
        summary: "Bitcoin rises to $44,800 as Ether and AVAX gain",
        topicCategories: [],
        isLocked: false,
      },
    ],
    verification: { ...EMPTY_MAIN_EVENTS_VERIFICATION_DATES },
  });

  assert.equal(queue.items[0]?.dbStatus, "untagged");
  assert.match(queue.items[0]?.dbSummary ?? "", /Bitcoin rises/);
});
