import assert from "node:assert/strict";
import test from "node:test";

import { lockActionFromVerdict, verificationStatusFromVerdict } from "../services/leaf-agent/verification-lock-policy";

test("lockActionFromVerdict locks correlated high-confidence verdicts", () => {
  assert.equal(lockActionFromVerdict({ correlated: true, confidence: "high" }), "locked");
  assert.equal(lockActionFromVerdict({ correlated: true, confidence: "medium" }), "locked");
});

test("lockActionFromVerdict unlocks mismatched high-confidence verdicts", () => {
  assert.equal(lockActionFromVerdict({ correlated: false, confidence: "high" }), "unlocked");
  assert.equal(lockActionFromVerdict({ correlated: false, confidence: "medium" }), "unlocked");
});

test("lockActionFromVerdict keeps low-confidence verdicts pending", () => {
  assert.equal(lockActionFromVerdict({ correlated: true, confidence: "low" }), "pending");
  assert.equal(lockActionFromVerdict({ correlated: false, confidence: "low" }), "pending");
});

test("verificationStatusFromVerdict saves matched only for correlated high-confidence verdicts", () => {
  assert.equal(verificationStatusFromVerdict({ correlated: true, confidence: "high" }), "matched");
  assert.equal(verificationStatusFromVerdict({ correlated: true, confidence: "medium" }), "matched");
});

test("verificationStatusFromVerdict saves pending for mismatches and low confidence", () => {
  assert.equal(verificationStatusFromVerdict({ correlated: false, confidence: "high" }), "pending");
  assert.equal(verificationStatusFromVerdict({ correlated: false, confidence: "medium" }), "pending");
  assert.equal(verificationStatusFromVerdict({ correlated: true, confidence: "low" }), "pending");
});
