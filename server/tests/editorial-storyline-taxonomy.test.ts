import assert from "node:assert/strict";
import test from "node:test";

import { inferStorylineLabels } from "../services/editorial-pipeline/storyline-taxonomy";

test("maps halving stories to the granular Bitcoin halving storyline", () => {
  const labels = inferStorylineLabels({
    title: "Bitcoin Halving Cuts Block Rewards as Miners Brace for Revenue Shift",
    summary: "Bitcoin completes another halving as block rewards fall and miners prepare for tighter economics.",
    tags: ["Bitcoin"],
  });
  assert.ok(labels.includes("Halving events"));
  assert.ok(labels.includes("Mining evolution"));
});

test("maps Canaan mining update to concrete mining storylines", () => {
  const labels = inferStorylineLabels({
    title: "Canaan Inc. Provides December 2025 Bitcoin Production and Mining Operation Updates",
    summary: "Canaan boosts deployed bitcoin mining capacity to 9.91 EH/s, mines 86 BTC, and grows holdings to 1,750 BTC",
    tags: ["Canaan", "Bitcoin"],
  });
  assert.ok(labels.includes("Mining companies"));
  assert.ok(labels.includes("Mining evolution"));
  assert.ok(!labels.includes("industry-news"));
});

test("maps futures and bottom signals to market sub-storylines", () => {
  const labels = inferStorylineLabels({
    title: "Bitcoin Bottom Indicators Predicts the Bottom Is in",
    summary: "Bitcoin whales move BTC to futures exchanges, signaling a classic bottom as prices sink and hedging rises",
    tags: ["Bitcoin"],
  });
  assert.ok(labels.includes("Derivatives"));
  assert.ok(labels.includes("Bitcoin price action"));
  assert.ok(labels.includes("Market cycles"));
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

  assert.ok(labels.includes("Exchanges"));
  assert.ok(labels.includes("Payment processors"));
  assert.equal(labels.includes("Mining evolution"), false);
});
