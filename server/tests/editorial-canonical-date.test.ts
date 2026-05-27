import assert from "node:assert/strict";
import test from "node:test";
import { detectCanonicalDateMismatch, getCanonicalDateHint } from "../services/editorial-pipeline/tools";

test("getCanonicalDateHint detects Pizza Day", () => {
  const hint = getCanonicalDateHint(
    "Laszlo Hanyecz buys two pizzas for 10,000 BTC, marking Bitcoin Pizza Day."
  );
  assert.ok(hint);
  assert.equal(hint?.date, "2010-05-22");
});

test("detectCanonicalDateMismatch rejects Pizza Day on wrong date", () => {
  const mismatch = detectCanonicalDateMismatch(
    "Laszlo Hanyecz buys two pizzas for 10,000 bitcoins, marking Bitcoin Pizza Day.",
    "2020-05-23"
  );
  assert.ok(mismatch);
  assert.equal(mismatch?.expectedDate, "2010-05-22");
});

test("detectCanonicalDateMismatch allows Pizza Day on canonical date", () => {
  const mismatch = detectCanonicalDateMismatch(
    "Laszlo Hanyecz buys two pizzas for 10,000 BTC, marking Bitcoin Pizza Day.",
    "2010-05-22"
  );
  assert.equal(mismatch, null);
});
