import assert from "node:assert/strict";
import test from "node:test";

import { evaluateCandidateStorySanity } from "../services/editorial-pipeline/source-finder-v2";

test("blocks question-style discussion posts as article-pick candidates", () => {
  const result = evaluateCandidateStorySanity({
    targetDate: "2021-03-10",
    title: "What was 2020 like for Bitcoin forks? - All about cloud Bitcoin mining",
    summary: "A discussion of Bitcoin forks, mining, and prior-year ecosystem trends.",
    text: "This post explains what 2020 was like for Bitcoin forks and cloud Bitcoin mining.",
  });
  assert.equal(result.ok, false);
  assert.ok(result.notes.some((n) => /discussion|question-style/i.test(n)));
});

test("blocks newsletter and technical discussion posts without a concrete action", () => {
  const result = evaluateCandidateStorySanity({
    targetDate: "2021-03-10",
    title: "Bitcoin Optech Newsletter #139",
    summary: "The newsletter discusses Taproot activation proposals and time locks.",
    text: "The community discusses proposals and technical details.",
  });
  assert.equal(result.ok, false);
  assert.ok(result.notes.some((n) => /discussion|roundup|technical topic/i.test(n)));
});

test("blocks Bitcoin history listicles as dated event candidates", () => {
  const result = evaluateCandidateStorySanity({
    targetDate: "2019-02-26",
    title: "17 moments that defined Bitcoin's history",
    summary: "A retrospective list of historic Bitcoin moments.",
    text: "This article reviews moments that defined Bitcoin's history across many years.",
  });
  assert.equal(result.ok, false);
  assert.ok(result.notes.some((n) => /history|listicle/i.test(n)));
});

test("blocks broad annual roundup candidates", () => {
  const result = evaluateCandidateStorySanity({
    targetDate: "2019-02-26",
    title: "4 Things You Should Not Miss in 2019 for Cryptocurrencies",
    summary: "A broad annual roundup of cryptocurrency themes.",
    text: "This roundup lists things to watch in 2019.",
  });
  assert.equal(result.ok, false);
  assert.ok(result.notes.some((n) => /roundup|listicle/i.test(n)));
});

test("blocks semicolon-separated multi-headline roundups", () => {
  const result = evaluateCandidateStorySanity({
    targetDate: "2019-08-18",
    title: "NZ legalizes crypto salaries; China builds digital currency; AWS expands blockchain tools",
    summary: "Three crypto headlines from around the world on one page.",
    text: "New Zealand legalizes crypto salaries. China builds a two-layer digital currency. AWS expands blockchain tools.",
  });
  assert.equal(result.ok, false);
  assert.ok(result.notes.some((n) => /semicolon|multiple stories/i.test(n)));
});

test("blocks speculative analyst calls as replacements when no event happened", () => {
  const result = evaluateCandidateStorySanity({
    targetDate: "2019-02-26",
    title: "The Only Way Is Down For Bitcoin, Say Analysts",
    summary: "Analysts predict Bitcoin may fall further.",
    text: "The article discusses analyst forecasts and speculation.",
  });
  assert.equal(result.ok, false);
  assert.ok(result.notes.some((n) => /Prediction|speculation/i.test(n)));
});

test("allows concrete dated actions", () => {
  const result = evaluateCandidateStorySanity({
    targetDate: "2021-03-10",
    title: "US House passes $1.9T COVID-19 relief as Bitcoin nears all-time high",
    summary: "The House passes stimulus while Bitcoin nears a record high on the same date.",
    text: "The U.S. House passed the COVID-19 relief bill on March 10, 2021.",
  });
  assert.equal(result.ok, true);
});
