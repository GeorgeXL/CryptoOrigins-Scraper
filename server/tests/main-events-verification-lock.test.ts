import assert from "node:assert/strict";
import test from "node:test";

import { applyVerificationDecision } from "../../shared/main-events-review-build";
import {
  assertReviewDecisionRevertAllowed,
  collectMainEventsCheckDates,
  collectMainEventsCheckDatesFromVerification,
  isMainEventsReviewDecisionFinal,
  resolveMainEventsReviewItemLocked,
  reviewDecisionRequiresDayLock,
  verificationStatusRequiresDayLock,
} from "../../shared/main-events-verification-lock";

test("verificationStatusRequiresDayLock is true for matched and rejected", () => {
  assert.equal(verificationStatusRequiresDayLock("matched"), true);
  assert.equal(verificationStatusRequiresDayLock("rejected"), true);
  assert.equal(verificationStatusRequiresDayLock("pending"), false);
});

test("reviewDecisionRequiresDayLock is true for accepted and rejected", () => {
  assert.equal(reviewDecisionRequiresDayLock("accepted"), true);
  assert.equal(reviewDecisionRequiresDayLock("rejected"), true);
  assert.equal(reviewDecisionRequiresDayLock("pending"), false);
});

test("isMainEventsReviewDecisionFinal is true for accepted and rejected review statuses", () => {
  assert.equal(isMainEventsReviewDecisionFinal("accepted"), true);
  assert.equal(isMainEventsReviewDecisionFinal("rejected"), true);
  assert.equal(isMainEventsReviewDecisionFinal("pending"), false);
});

test("resolveMainEventsReviewItemLocked is true for final decisions even without db row", () => {
  assert.equal(resolveMainEventsReviewItemLocked({ reviewStatus: "rejected" }), true);
  assert.equal(resolveMainEventsReviewItemLocked({ reviewStatus: "accepted" }), true);
  assert.equal(resolveMainEventsReviewItemLocked({ reviewStatus: "pending" }), false);
  assert.equal(resolveMainEventsReviewItemLocked({ isLocked: true, reviewStatus: "pending" }), true);
});

test("assertReviewDecisionRevertAllowed blocks moving accepted/rejected back to pending", () => {
  assert.doesNotThrow(() => assertReviewDecisionRevertAllowed("pending", "pending"));
  assert.doesNotThrow(() => assertReviewDecisionRevertAllowed("pending", "accepted"));
  assert.doesNotThrow(() => assertReviewDecisionRevertAllowed("pending", "rejected"));

  assert.throws(
    () => assertReviewDecisionRevertAllowed("accepted", "pending"),
    /Accepted and rejected review decisions are locked/,
  );
  assert.throws(
    () => assertReviewDecisionRevertAllowed("rejected", "pending"),
    /Accepted and rejected review decisions are locked/,
  );
});

test("applyVerificationDecision rejected marks date rejected and would trigger lock", () => {
  const verification = applyVerificationDecision(
    { matched: [], pending: ["2016-07-09"], rejected: [] },
    "2016-07-09",
    "rejected",
  );

  assert.deepEqual(verification.rejected, ["2016-07-09"]);
  assert.deepEqual(verification.pending, []);
  assert.equal(verificationStatusRequiresDayLock("rejected"), true);
});

test("collectMainEventsCheckDatesFromVerification includes all buckets by default", () => {
  const dates = collectMainEventsCheckDatesFromVerification({
    matched: ["2020-05-11"],
    pending: ["2019-06-26"],
    rejected: ["2018-01-01"],
  });
  assert.deepEqual(dates, ["2018-01-01", "2019-06-26", "2020-05-11"]);
});

test("collectMainEventsCheckDatesFromVerification excludes pending with includePending false", () => {
  const dates = collectMainEventsCheckDatesFromVerification(
    {
      matched: ["2020-05-11"],
      pending: ["2019-06-26"],
      rejected: ["2018-01-01"],
    },
    { includePending: false },
  );
  assert.deepEqual(dates, ["2018-01-01", "2020-05-11"]);
});

test("collectMainEventsCheckDates deduplicates across leaves", () => {
  const dates = collectMainEventsCheckDates([
    { matched: ["2020-05-11"], pending: [], rejected: [] },
    { matched: [], pending: ["2020-05-11", "2019-06-26"], rejected: [] },
    { matched: [], pending: [], rejected: ["2019-06-26"] },
  ]);
  assert.deepEqual(dates, ["2019-06-26", "2020-05-11"]);
});
