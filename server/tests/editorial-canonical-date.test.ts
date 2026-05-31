import assert from "node:assert/strict";
import test from "node:test";
import { formatCalendarDecisionExplanation } from "../services/editorial-pipeline/date-consistency-llm";
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

test("formatCalendarDecisionExplanation keeps canonical rule copy", () => {
  const text = formatCalendarDecisionExplanation({
    ruleId: "bitcoin-pizza-day",
    currentDate: "2020-05-23",
    expectedDate: "2010-05-22",
    canonicalReason: "Bitcoin Pizza Day is the May 22, 2010 purchase of two pizzas for 10,000 BTC.",
  });
  assert.match(text, /Pizza Day/);
});

test("formatCalendarDecisionExplanation summarizes LLM duplicate slot with neighbor preview", () => {
  const text = formatCalendarDecisionExplanation({
    ruleId: "llm-duplicate-slot",
    currentDate: "2021-07-09",
    expectedDate: "2021-06-12",
    llmIssues: ["Taxonomy neighbor 2021-06-12 may be the canonical home for this story"],
    neighborSummaryPreview: "El Salvador passes law making Bitcoin legal tender nationwide.",
  });
  assert.match(text, /2021-06-12/);
  assert.match(text, /El Salvador/);
});

test("detectCanonicalDateMismatch allows Pizza Day on canonical date", () => {
  const mismatch = detectCanonicalDateMismatch(
    "Laszlo Hanyecz buys two pizzas for 10,000 BTC, marking Bitcoin Pizza Day.",
    "2010-05-22"
  );
  assert.equal(mismatch, null);
});
