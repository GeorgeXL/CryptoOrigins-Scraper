import assert from "node:assert/strict";
import test from "node:test";

import { inferStorylineLabels, inferTopicProposal, rankTopicCandidatesFromSummary, storedTopicConflictsWithSummary } from "../services/editorial-pipeline/storyline-taxonomy";

test("maps halving stories to the granular Bitcoin halving storyline", () => {
  const labels = inferStorylineLabels({
    title: "Bitcoin Halving Cuts Block Rewards as Miners Brace for Revenue Shift",
    summary: "Bitcoin completes another halving as block rewards fall and miners prepare for tighter economics.",
    tags: ["Bitcoin"],
  });
  assert.deepEqual(labels, ["Halving events"]);
});

test("maps Canaan mining update to concrete mining storylines", () => {
  const labels = inferStorylineLabels({
    title: "Canaan Inc. Provides December 2025 Bitcoin Production and Mining Operation Updates",
    summary: "Canaan boosts deployed bitcoin mining capacity to 9.91 EH/s, mines 86 BTC, and grows holdings to 1,750 BTC",
    tags: ["Canaan", "Bitcoin"],
  });
  assert.deepEqual(labels, ["Mining companies"]);
  assert.ok(!labels.includes("industry-news"));
});

test("maps futures and bottom signals to market sub-storylines", () => {
  const labels = inferStorylineLabels({
    title: "Bitcoin Bottom Indicators Predicts the Bottom Is in",
    summary: "Bitcoin whales move BTC to futures exchanges, signaling a classic bottom as prices sink and hedging rises",
    tags: ["Bitcoin"],
  });
  assert.deepEqual(labels, ["Derivatives"]);
});


test("maps Aave V3 launch to DeFi storyline", () => {
  const labels = inferStorylineLabels({
    title: "Aave V3 launches, introducing Portal for cross-chain liquidity and E-Mode for enhanced capital efficiency",
    summary: "Aave V3 launches with Portal and E-Mode for DeFi users.",
    tags: ["Aave"],
  });
  assert.ok(labels.includes("DeFi"));
});

test("maps Terra reserve story to stablecoin storyline", () => {
  const labels = inferStorylineLabels({
    title: "Terra founders plan to purchase $2.5 billion in Bitcoin reserves",
    summary: "Terra and UST deepen their reserve strategy with a large Bitcoin purchase plan.",
    tags: ["Bitcoin", "Terra"],
  });
  assert.ok(labels.includes("Stablecoins"));
});


test("does not infer derivatives from generic fee management options", () => {
  const labels = inferStorylineLabels({
    summary: "Samourai Wallet releases version 0.99 with a redesigned interface and improved fee management options",
    tags: ["Samourai Wallet"],
  });

  assert.ok(labels.includes("Wallet development"));
  assert.equal(labels.includes("Derivatives"), false);
});

test("maps exchange card purchases to exchanges and payment processors", () => {
  const labels = inferStorylineLabels({
    summary: "Binance allows users to buy Bitcoin, Ethereum, Litecoin, and XRP with credit or debit cards, enhancing access",
    tags: ["Binance", "Bitcoin", "Ethereum", "Litecoin"],
  });

  assert.deepEqual(labels, ["Payment processors"]);
});

test("rejects broad model topics and keeps only hierarchy leaves", () => {
  const labels = inferStorylineLabels({
    summary:
      "Satoshi Nakamoto warns WikiLeaks not to use Bitcoin, fearing it could damage the project's early stage",
    tags: ["Bitcoin", "Satoshi Nakamoto", "WikiLeaks"],
    modelTopics: ["historical", "bitcoin", "economic", "institutional"],
  });

  assert.deepEqual(labels, ["Satoshi identity"]);
  assert.equal(labels.includes("historical"), false);
  assert.equal(labels.includes("bitcoin"), false);
  assert.equal(labels.includes("economic"), false);
  assert.equal(labels.includes("institutional"), false);
});

test("maps macro and financial 2010 summaries into concrete leaves", () => {
  const bribery = inferStorylineLabels({
    summary:
      "Nigeria's anti-corruption agency probes $15M in alleged Daimler bribes, underscoring its corruption fight",
    tags: ["Nigeria", "Daimler"],
  });
  assert.ok(bribery.includes("Fraud and scams"));

  const labor = inferStorylineLabels({
    summary:
      "Spanish unions call a general strike after labor reform plans deepen fears over Spain's fragile recovery",
    tags: ["Spain", "Labor Reform"],
  });
  assert.ok(labor.includes("Labor market"));

  const housing = inferStorylineLabels({
    summary:
      "Fannie Mae and Freddie Mac lose political support as the U.S. moves to overhaul the mortgage finance system",
    tags: ["Fannie Mae", "Freddie Mac"],
  });
  assert.deepEqual(housing, ["Housing"]);

  const banking = inferStorylineLabels({
    summary:
      "The Church of Ireland loses over 17 million euros as AIB shares collapse affecting major shareholders",
    tags: ["AIB", "Church of Ireland"],
  });
  assert.deepEqual(banking, ["Banking stress"]);
});

test("maps midterm election spending to elections and campaign finance", () => {
  const labels = inferStorylineLabels({
    summary:
      "Midterm election spending reaches $4 billion as Republicans outpace Democrats in funding contributions",
    tags: ["Republicans", "Democrats"],
  });
  assert.deepEqual(labels, ["Politics and elections"]);
});

test("maps presidential election and Wall Street backing to politics", () => {
  const labels = inferStorylineLabels({
    summary:
      "Wall Street executives heavily back Mitt Romney influencing the dynamics of the US presidential elections",
    tags: ["Mitt Romney", "U.S."],
  });
  assert.deepEqual(labels, ["Politics and elections"]);
});

test("maps Bitcoin-Qt client releases to protocol development under Bitcoin", () => {
  const labels = inferStorylineLabels({
    summary:
      "Bitcoin-Qt v0.5.3 introduces critical fixes and improvements to enhance user experience and stability",
    tags: ["Bitcoin", "Bitcoin-Qt"],
  });
  assert.deepEqual(labels, ["Protocol development"]);
});

test("maps Satoshi doublespend explanation to protocol development", () => {
  const labels = inferTopicProposal({
    summary:
      "Satoshi explains Bitcoin relies on cryptographic proof, addressing the doublespend issue effectively",
    tags: ["Bitcoin", "Satoshi"],
  });
  assert.deepEqual(labels, ["Protocol development"]);
});

test("maps exchange expansion stories to trading activity from summary only", () => {
  const summary =
    "Ruxum announces expansion into Europe allowing Bitcoin trading in Euros Pounds and Swiss Francs starting soon";
  const noisyArticle =
    "ABC employee caught mining for Bitcoins on company servers An unrelated mining story with bitcoin mentions";

  assert.deepEqual(
    inferTopicProposal({ summary, tags: ["Bitcoin", "Ruxum"] }),
    ["Trading activity"],
  );
  assert.deepEqual(
    inferTopicProposal({ summary, articleText: noisyArticle, tags: ["Bitcoin", "Ruxum"] }),
    ["Trading activity"],
  );
  assert.deepEqual(
    inferStorylineLabels({ summary, articleText: noisyArticle, tags: ["Bitcoin", "Ruxum"] }),
    ["Trading activity"],
  );
});

test("G20 bailout summary ranks macro topics with low confidence", () => {
  const summary =
    "G20 leaders agree on a $1.1 trillion deal to combat the global economic crisis, boosting market optimism";
  const ranking = rankTopicCandidatesFromSummary({ summary, tags: ["G20"] });
  assert.equal(ranking.confidence, "low");
  assert.equal(ranking.primary, "Bailouts and stimulus");
  assert.ok(ranking.candidates.some((c) => c.leaf === "Global growth and recession"));
  assert.equal(inferTopicProposal({ summary, tags: ["G20"] }).length, 0);
});

test("flags bitcoin-group topics when summary has no bitcoin signals", () => {
  const summary =
    "G20 leaders agree on a $1.1 trillion deal to combat the global economic crisis, boosting market optimism";
  assert.equal(storedTopicConflictsWithSummary(["Early Bitcoin history"], summary), true);
  assert.equal(storedTopicConflictsWithSummary(["Global growth and recession"], summary), false);
});
