import assert from "node:assert/strict";
import test from "node:test";

import {
  currentStorylineQuality,
  evaluateCandidateNeighborCollision,
  storedArticleToCandidate,
} from "../services/editorial-pipeline/run";

const targetDate = "2019-02-25";

test("keeps concrete market summaries from being forced into weak replacement review", () => {
  const result = currentStorylineQuality({
    summary: "Bitcoin holds its 50-week moving average as traders watch for bear market exhaustion",
    tagsVersion2: ["Bitcoin"],
    topicCategories: ["Bitcoin price action"],
  });

  assert.equal(result.acceptable, true);
  assert.ok(result.score >= 0.56);
});

test("marks discussion-style current summaries as vague even with Bitcoin protocol tags", () => {
  const result = currentStorylineQuality({
    summary: "Bitcoin community discusses Taproot activation proposals and infrastructure changes during Optech meeting",
    tagsVersion2: ["Bitcoin", "Taproot"],
    topicCategories: ["technology", "adoption"],
  });

  assert.equal(result.acceptable, false);
  assert.ok(result.reasons.some((r) => /Generic crypto\/macro phrasing/i.test(r)));
});

test("penalizes history and legal explainers below concrete dated Bitcoin events", () => {
  const history = storedArticleToCandidate({
    targetDate,
    tier: "bitcoin",
    rank: 0,
    currentTopArticleId: null,
    article: {
      id: "history",
      title: "The History of Bitcoin in China",
      url: "https://example.com/history-of-bitcoin-in-china",
      summary: "A retrospective article explains Bitcoin history in China.",
      text: "This is an explainer about the history of bitcoin in china.",
    },
  });
  const kraken = storedArticleToCandidate({
    targetDate,
    tier: "bitcoin",
    rank: 1,
    currentTopArticleId: null,
    article: {
      id: "kraken",
      title: "Kraken acquires Crypto Facilities in nine-figure Bitcoin derivatives deal",
      url: "https://example.com/kraken-acquires-crypto-facilities",
      summary: "Kraken acquires a derivatives venue in a concrete market infrastructure deal.",
      text: "Kraken acquires Crypto Facilities and expands Bitcoin futures infrastructure.",
    },
  });

  assert.ok(history);
  assert.ok(kraken);
  assert.ok((kraken.relevanceScore ?? 0) > (history.relevanceScore ?? 0));
});

test("marks stored Bitcoin history listicles as date/story warnings", () => {
  const listicle = storedArticleToCandidate({
    targetDate: "2019-02-26",
    tier: "bitcoin",
    rank: 0,
    currentTopArticleId: null,
    article: {
      id: "history-list",
      title: "17 moments that defined Bitcoin's history",
      url: "https://example.com/bitcoin-history-moments",
      summary: "A retrospective list of historic Bitcoin moments.",
      text: "This article reviews moments that defined Bitcoin's history across many years.",
    },
  });

  assert.ok(listicle);
  assert.equal(listicle.calendarSanityOk, false);
  assert.ok(listicle.calendarSanityNotes.some((n) => /history|listicle/i.test(n)));
});

test("keeps Argentina startup coverage eligible as a concrete local adoption story", () => {
  const argentina = storedArticleToCandidate({
    targetDate: "2019-02-26",
    tier: "bitcoin",
    rank: 6,
    currentTopArticleId: null,
    article: {
      id: "argentina",
      title: "There's No Crypto Winter in Argentina, Where Startups Ramp Up to Meet Demand",
      url: "https://example.com/no-crypto-winter-argentina",
      summary: "Argentina startups meet local crypto demand as inflation supports Bitcoin use.",
      text: "Argentina crypto startups ramp up to meet demand amid inflation and local payment needs.",
    },
  });

  assert.ok(argentina);
  assert.equal(argentina.calendarSanityOk, true);
});

test("demotes prediction/speculation compared with concrete network signals", () => {
  const prediction = storedArticleToCandidate({
    targetDate: "2019-02-23",
    tier: "bitcoin",
    rank: 0,
    currentTopArticleId: null,
    article: {
      id: "prediction",
      title: "Tim Draper predicts Bitcoin could surge",
      url: "https://example.com/draper-predicts-bitcoin",
      summary: "Tim Draper predicts a future Bitcoin price surge.",
      text: "Prediction and speculation about future bitcoin price.",
    },
  });
  const networkSignal = storedArticleToCandidate({
    targetDate: "2019-02-23",
    tier: "bitcoin",
    rank: 1,
    currentTopArticleId: null,
    article: {
      id: "network",
      title: "Bitcoin transactions per second approach all-time high",
      url: "https://example.com/bitcoin-transactions-per-second",
      summary: "Bitcoin transactions per second approach an all-time high on the network.",
      text: "Bitcoin transactions per second approach all-time high as network usage rises.",
    },
  });

  assert.ok(prediction);
  assert.ok(networkSignal);
  assert.ok((networkSignal.relevanceScore ?? 0) > (prediction.relevanceScore ?? 0));
});

test("detects replacement candidates that collide with a nearby saved storyline", () => {
  const result = evaluateCandidateNeighborCollision(
    {
      title: "JPMorgan launches JPM Coin for blockchain payments",
      summary: "JPMorgan launches JPM Coin to settle institutional blockchain payments.",
    },
    {
      date: "2019-02-14",
      summary: "JPMorgan unveils JPM Coin for institutional blockchain settlement clients",
    },
  );

  assert.equal(result.collides, true);
  assert.ok(result.sharedKeys.includes("jpmorgan"));
});

test("does not treat generic Bitcoin market candidates as neighbor collisions by entity alone", () => {
  const result = evaluateCandidateNeighborCollision(
    {
      title: "Bitcoin transactions per second approach all-time high",
      summary: "Network throughput rises as Bitcoin transaction activity increases.",
    },
    {
      date: "2019-02-18",
      summary: "Bitcoin price rises as traders watch for a possible bear market reversal",
    },
  );

  assert.equal(result.collides, false);
});


test("keeps concrete company departure/adoption events from weak replacement review", () => {
  const result = currentStorylineQuality({
    summary: "Samson Mow departs Blockstream to promote Bitcoin adoption by nations and focus on his gaming company",
    tagsVersion2: ["Bitcoin", "Samson Mow", "Blockstream"],
    topicCategories: ["adoption", "political"],
  });

  assert.equal(result.acceptable, true);
  assert.ok(result.score >= 0.56);
});

test("penalizes AWS experimentation explainers below concrete dated Bitcoin business events", () => {
  const aws = storedArticleToCandidate({
    targetDate: "2022-03-01",
    tier: "bitcoin",
    rank: 3,
    currentTopArticleId: null,
    article: {
      id: "aws",
      title: "Experimenting with Bitcoin Blockchain on AWS | Amazon Web Services",
      url: "https://example.com/aws-bitcoin",
      summary: "A technical blog post explains an AWS Bitcoin node experiment.",
      text: "Experimenting with Bitcoin Blockchain on AWS demonstrates setup and general background on Bitcoin infrastructure.",
    },
  });
  const samson = storedArticleToCandidate({
    targetDate: "2022-03-01",
    tier: "bitcoin",
    rank: 2,
    currentTopArticleId: null,
    article: {
      id: "samson",
      title: "Samson Mow Exits Blockstream to Focus on Nation-State Bitcoin Adoption",
      url: "https://example.com/samson-mow",
      summary: "Samson Mow leaves Blockstream to focus on nation-state Bitcoin adoption.",
      text: "Samson Mow exits Blockstream after five years to focus on nation-state Bitcoin adoption.",
    },
  });

  assert.ok(aws);
  assert.ok(samson);
  assert.equal(aws.calendarSanityOk, false);
  assert.ok((samson.relevanceScore ?? 0) > (aws.relevanceScore ?? 0));
});

test("demotes multi-asset price roundups below concrete company events on the same date", () => {
  const roundup = storedArticleToCandidate({
    targetDate: "2022-03-01",
    tier: "bitcoin",
    rank: 0,
    currentTopArticleId: null,
    article: {
      id: "roundup",
      title: "Top cryptocurrency prices: Bitcoin, Shiba Inu, Ethereum rise up to 15%; Terra rallies 24%",
      url: "https://example.com/top-crypto-prices",
      summary: "Bitcoin rises with Shiba Inu, Ethereum, and Terra in a broad crypto market roundup.",
      text: "Top cryptocurrency prices: Bitcoin, Shiba Inu, Ethereum rise up to 15%; Terra rallies 24%.",
    },
  });
  const samson = storedArticleToCandidate({
    targetDate: "2022-03-01",
    tier: "bitcoin",
    rank: 1,
    currentTopArticleId: null,
    article: {
      id: "samson",
      title: "Samson Mow Exits Blockstream to Focus on Nation-State Bitcoin Adoption",
      url: "https://example.com/samson-mow",
      summary: "Samson Mow leaves Blockstream to focus on nation-state Bitcoin adoption.",
      text: "Samson Mow exits Blockstream after five years to focus on nation-state Bitcoin adoption.",
    },
  });

  assert.ok(roundup);
  assert.ok(samson);
  assert.ok((samson.relevanceScore ?? 0) > (roundup.relevanceScore ?? 0));
});


test("keeps concrete market drawdown summaries above the replacement threshold", () => {
  const result = currentStorylineQuality({
    summary: "Bitcoin slips under $41,500 amid geopolitical tensions while active supply reaches yearly high of 565,000",
    tagsVersion2: ["Bitcoin"],
    topicCategories: ["price", "economic"],
  });

  assert.equal(result.acceptable, true);
  assert.ok(result.score >= 0.44);
});

test("keeps concrete geopolitics-driven Bitcoin market summaries from replacement review", () => {
  const result = currentStorylineQuality({
    summary: "Bitcoin's daily trading volume tops $10 billion, fueled by Ukraine's crypto fundraising and Russian controls.",
    tagsVersion2: ["Bitcoin", "Ukraine", "Russia"],
    topicCategories: ["price", "adoption", "political"],
  });

  assert.equal(result.acceptable, true);
  assert.ok(result.score >= 0.68);
});

test("keeps concrete legal-tender proposal summaries from replacement review", () => {
  const result = currentStorylineQuality({
    summary: "Mexican Senator Indira Kempis announces plans to propose Bitcoin adoption as legal tender to Congress",
    tagsVersion2: ["Bitcoin", "Indira Kempis", "Congress"],
    topicCategories: ["adoption", "regulation"],
  });

  assert.equal(result.acceptable, true);
  assert.ok(result.score >= 0.68);
});
