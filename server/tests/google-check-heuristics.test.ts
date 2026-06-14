import assert from "node:assert/strict";
import test from "node:test";

import { evaluateGoogleCheckRetrospectiveHeuristic } from "../../shared/google-check-heuristics";
import { buildHomepageGoogleCheckPrompt } from "../../shared/google-check-prompts";
import {
  isGoogleCheckAlreadyDone,
  getGoogleCheckProviderType,
  partitionGoogleCheckItems,
} from "../services/homepage-checks/google-check";
import { parseHomepageGoogleCheckJson } from "../services/ai/openai-provider";

test("retrospective heuristic flags anniversary and revisit coverage", () => {
  const cases = [
    "NYT revisits Laszlo Hanyecz's 10,000 BTC pizza buy from 2010",
    "Laszlo Hanyecz marks his pizza buy on Bitcoin Pizza Day",
    "Bitcoin Pizza Day celebrated worldwide ten years on",
    "Media looks back at the first real-world Bitcoin transaction",
    "On this day in 2010, Bitcoin was used to buy pizza",
    "10 years since the famous pizza transaction",
  ];

  for (const summary of cases) {
    const result = evaluateGoogleCheckRetrospectiveHeuristic(summary);
    assert.equal(result.isRetrospective, true, `expected retrospective: ${summary}`);
  }
});

test("retrospective heuristic does not flag original-event summaries", () => {
  const cases = [
    "Laszlo Hanyecz buys two pizzas for 10,000 BTC in the first real-world Bitcoin transaction",
    "Developer trades 10,000 BTC for two pizzas, establishing Bitcoin Pizza Day",
    "Bitcoin reaches a new all-time high above $60,000",
    "SEC approves spot Bitcoin ETF applications",
  ];

  for (const summary of cases) {
    const result = evaluateGoogleCheckRetrospectiveHeuristic(summary);
    assert.equal(result.isRetrospective, false, `expected not retrospective: ${summary}`);
  }
});

test("homepage Google check prompt requires substantive event on calendar date", () => {
  const prompt = buildHomepageGoogleCheckPrompt(
    "Laszlo Hanyecz buys two pizzas for 10,000 BTC",
    "2010-05-22",
  );

  assert.match(prompt, /substantive event/i);
  assert.match(prompt, /anniversary/i);
  assert.match(prompt, /retrospective/i);
  assert.match(prompt, /2010-05-22/);
  assert.match(prompt, /2013-12-22/);
  assert.match(prompt, /2020-05-22/);
  assert.match(prompt, /revisits/i);
});

test("partitionGoogleCheckItems skips already-checked rows", () => {
  const items = [
    { date: "2010-05-22", summary: "Pizza buy" },
    { date: "2013-12-22", summary: "NYT revisits pizza" },
  ];
  const existing = new Map<string, string | null>([
    ["2010-05-22", "yes"],
    ["2013-12-22", null],
  ]);

  const { toCheck, skipped } = partitionGoogleCheckItems(items, existing);
  assert.equal(toCheck.length, 1);
  assert.equal(toCheck[0]!.date, "2013-12-22");
  assert.equal(skipped.length, 1);
  assert.equal(skipped[0]!.happened, "yes");
  assert.equal(isGoogleCheckAlreadyDone("uncertain"), true);
});

test("getGoogleCheckProviderType defaults to openai", () => {
  const previous = process.env.GOOGLE_CHECK_PROVIDER;
  delete process.env.GOOGLE_CHECK_PROVIDER;
  try {
    assert.equal(getGoogleCheckProviderType(), "openai");
  } finally {
    if (previous === undefined) delete process.env.GOOGLE_CHECK_PROVIDER;
    else process.env.GOOGLE_CHECK_PROVIDER = previous;
  }
});

test("getGoogleCheckProviderType respects env override", () => {
  const previous = process.env.GOOGLE_CHECK_PROVIDER;
  process.env.GOOGLE_CHECK_PROVIDER = "gemini";
  try {
    assert.equal(getGoogleCheckProviderType(), "gemini");
  } finally {
    if (previous === undefined) delete process.env.GOOGLE_CHECK_PROVIDER;
    else process.env.GOOGLE_CHECK_PROVIDER = previous;
  }
});

test("parseHomepageGoogleCheckJson extracts JSON from fenced or trailing text", () => {
  assert.deepEqual(parseHomepageGoogleCheckJson('```json\n{"happened":"yes"}\n```'), {
    happened: "yes",
  });
  assert.deepEqual(
    parseHomepageGoogleCheckJson('{"happened":"no"} [1] https://example.com'),
    { happened: "no" },
  );
  assert.throws(() => parseHomepageGoogleCheckJson("not json"), /No JSON object found/);
});
