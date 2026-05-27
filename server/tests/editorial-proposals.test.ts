import assert from "node:assert/strict";
import test from "node:test";

import { buildCorrectionProposals } from "../services/editorial-pipeline/proposals";
import { buildCanonicalTagIndex } from "../services/editorial-pipeline/tag-grounding";

test("promotes v1 tags missing from v2 (Cboe case)", () => {
  const proposals = buildCorrectionProposals({
    date: "2024-11-24",
    summary: "Cboe announces launch of cash-settled Bitcoin index options.",
    topArticleId: "https://example.com/cboe",
    isOrphan: true,
    isFlagged: false,
    tagsVersion2: ["Bitcoin"],
    topicCategories: ["adoption", "price", "institutional"],
    legacyTags: [
      { name: "Cboe", category: "organizations" },
      { name: "Bitcoin", category: "bitcoin" },
      { name: "Bitcoin index options", category: "money-economics" },
    ],
  });

  const promote = proposals.find((p) => p.kind === "promote_v1_to_v2_tags");
  assert.ok(promote, "expected promote_v1_to_v2_tags proposal");
  if (promote && promote.kind === "promote_v1_to_v2_tags") {
    assert.ok(promote.proposed.includes("Cboe"));
    assert.ok(promote.proposed.includes("Bitcoin index options"));
    assert.ok(promote.proposed.includes("Bitcoin"));
  }

  const orphan = proposals.find((p) => p.kind === "clear_orphan_flag");
  assert.ok(orphan, "expected orphan flag proposal");
});

test("does not promote legacy tags that are unrelated to the current summary", () => {
  const proposals = buildCorrectionProposals({
    date: "2016-05-11",
    summary:
      "Venture capital investment in blockchain startups exceeds $1.1 billion, signaling a shift in market dynamics",
    topArticleId: "https://example.com/blockchain-vc",
    isOrphan: false,
    isFlagged: false,
    tagsVersion2: ["CoinDesk", "Bitcoin"],
    topicCategories: ["investment"],
    legacyTags: [
      { name: "Xinjiang", category: "markets-geography" },
      { name: "Bitbank", category: "organizations" },
      { name: "Bitcoin", category: "bitcoin" },
    ],
    articleText:
      "Venture capital investment in blockchain startups exceeds $1.1 billion, signaling a shift in market dynamics.",
  });

  assert.equal(proposals.find((p) => p.kind === "promote_v1_to_v2_tags"), undefined);
});

test("does not promote duplicate or abstract legacy price tags into v2", () => {
  const proposals = buildCorrectionProposals({
    date: "2019-02-07",
    summary:
      "Bitcoin price hits a local low around $3,379, marking a downturn in the market and investor confidence",
    topArticleId: "https://example.com/price-low",
    isOrphan: false,
    isFlagged: false,
    tagsVersion2: ["Bitcoin"],
    topicCategories: ["historical", "bitcoin"],
    legacyTags: [{ name: "Bitcoin" }, { name: "Bitcoin Price" }],
    articleText:
      "Bitcoin price hits a local low around $3,379, marking a downturn in the market and investor confidence.",
  });

  assert.equal(proposals.find((p) => p.kind === "promote_v1_to_v2_tags"), undefined);
});

test("does not promote stale legacy tags from an old storyline after summary changed", () => {
  const proposals = buildCorrectionProposals({
    date: "2019-02-04",
    summary:
      "Florida court rules Bitcoin can act as legal tender, reinforcing its role in a disputed payment case",
    topArticleId: "https://example.com/florida-bitcoin-ruling",
    isOrphan: false,
    isFlagged: false,
    tagsVersion2: ["Florida", "Bitcoin"],
    topicCategories: ["Securities regulation", "Government adoption"],
    legacyTags: [{ name: "Kraken" }, { name: "Crypto Facilities" }],
    articleText:
      "Kraken acquires Crypto Facilities, a crypto derivatives platform, in a nine-figure deal to expand offerings.",
  });

  assert.equal(proposals.find((p) => p.kind === "promote_v1_to_v2_tags"), undefined);
});

test("flags web2/web3 tag conflict and proposes drop", () => {
  const proposals = buildCorrectionProposals({
    date: "2024-01-15",
    summary: "Network upgrades push Web3 narrative forward.",
    topArticleId: "https://example.com/w3",
    isOrphan: false,
    isFlagged: false,
    tagsVersion2: ["web2", "web3"],
    topicCategories: ["technology"],
    legacyTags: [],
  });
  const conflict = proposals.find((p) => p.kind === "fix_tag_conflict");
  assert.ok(conflict);
  if (conflict && conflict.kind === "fix_tag_conflict") {
    assert.deepEqual(conflict.proposedDrop, ["web2"]);
  }
});

test("proposes default topic category when missing", () => {
  const proposals = buildCorrectionProposals({
    date: "2024-03-01",
    summary: "Some event happened.",
    topArticleId: "https://example.com/x",
    isOrphan: false,
    isFlagged: false,
    tagsVersion2: ["Bitcoin"],
    topicCategories: [],
    legacyTags: [],
  });
  const topic = proposals.find((p) => p.kind === "set_topic_categories");
  assert.ok(topic);
  if (topic && topic.kind === "set_topic_categories") {
    assert.deepEqual(topic.proposed, ["Bitcoin culture"]);
  }
});

test("proposes redo_summary only when weak AND top article id is valid", () => {
  const weakWithArticle = buildCorrectionProposals({
    date: "2024-04-01",
    summary: "Analysis failed.",
    topArticleId: "https://example.com/real",
    isOrphan: false,
    isFlagged: false,
    tagsVersion2: ["Bitcoin"],
    topicCategories: ["industry-news"],
    legacyTags: [],
  });
  assert.ok(weakWithArticle.find((p) => p.kind === "redo_summary"));

  const weakWithoutArticle = buildCorrectionProposals({
    date: "2024-04-02",
    summary: "Analysis failed.",
    topArticleId: "none",
    isOrphan: false,
    isFlagged: false,
    tagsVersion2: ["Bitcoin"],
    topicCategories: ["industry-news"],
    legacyTags: [],
  });
  assert.equal(weakWithoutArticle.find((p) => p.kind === "redo_summary"), undefined);
  assert.ok(weakWithoutArticle.find((p) => p.kind === "edit_summary"));
});

test("clean day produces empty proposal list", () => {
  const proposals = buildCorrectionProposals({
    date: "2024-05-15",
    summary: "Bitcoin hits all-time high amid record institutional inflows pushing market sentiment to new euphoria.",
    topArticleId: "https://example.com/ath",
    isOrphan: false,
    isFlagged: false,
    tagsVersion2: ["Bitcoin", "ETF"],
    topicCategories: ["price", "institutional"],
    legacyTags: [{ name: "Bitcoin" }, { name: "ETF" }],
  });
  assert.equal(proposals.length, 0);
});

test("flags ungrounded tags (Belgium on a Russia/WTO summary)", () => {
  const idx = buildCanonicalTagIndex(["Russia", "WTO", "Belgium", "industry-news", "tariffs"]);
  const proposals = buildCorrectionProposals({
    date: "2012-07-21",
    summary:
      "Russia joins the WTO after negotiations, lowering tariffs and opening new investment opportunities for foreign firms.",
    topArticleId: "https://example.com/russia-wto",
    isOrphan: false,
    isFlagged: false,
    tagsVersion2: ["Belgium"],
    topicCategories: ["geopolitics"],
    legacyTags: [],
    articleText:
      "Russia joins the WTO after negotiations, lowering tariffs and opening new investment opportunities for foreign firms.",
    canonicalTagIndex: idx,
  });
  const drop = proposals.find((p) => p.kind === "drop_ungrounded_tags");
  assert.ok(drop, "expected drop_ungrounded_tags proposal");
  if (drop && drop.kind === "drop_ungrounded_tags") {
    assert.deepEqual(drop.proposedDrop, ["Belgium"]);
    assert.ok(drop.suggestedFocusTags?.includes("Russia"), "expected Russia as story-aligned hint");
    assert.ok(drop.suggestedFocusTags?.includes("WTO"), "expected WTO as story-aligned hint");
  }
});

test("flags Mitch McConnell as ungrounded on a TARP/Republicans blurb", () => {
  const idx = buildCanonicalTagIndex(["Republicans", "Mitch McConnell", "bailout", "election"]);
  const proposals = buildCorrectionProposals({
    date: "2010-10-24",
    summary:
      "Companies receiving bailout money donate generously to political candidates primarily benefiting Republicans this election cycle nationwide.",
    topArticleId: "https://example.com/tarp",
    isOrphan: false,
    isFlagged: false,
    tagsVersion2: ["Republicans", "Mitch McConnell"],
    topicCategories: ["politics"],
    legacyTags: [],
    articleText:
      "Companies receiving bailout money donate generously to political candidates primarily benefiting Republicans this election cycle.",
    canonicalTagIndex: idx,
  });
  const drop = proposals.find((p) => p.kind === "drop_ungrounded_tags");
  assert.ok(drop, "expected drop_ungrounded_tags proposal");
  if (drop && drop.kind === "drop_ungrounded_tags") {
    assert.deepEqual(drop.proposedDrop, ["Mitch McConnell"]);
    assert.ok(
      drop.suggestedFocusTags?.includes("bailout") || drop.suggestedFocusTags?.includes("election"),
      "expected at least one extra story-aligned taxonomy hint besides Republicans",
    );
  }
});

test("flags redundant tag pair (Schnorr signatures alongside Schnorr)", () => {
  const proposals = buildCorrectionProposals({
    date: "2019-05-06",
    summary:
      "Pieter Wuille announces two proposals for Bitcoin privacy upgrade including Taproot and Schnorr signatures.",
    topArticleId: "https://example.com/schnorr",
    isOrphan: false,
    isFlagged: false,
    tagsVersion2: ["Bitcoin", "Taproot", "Schnorr", "Schnorr signatures"],
    topicCategories: ["technology"],
    legacyTags: [],
    articleText: "Schnorr signatures, Taproot, Bitcoin privacy.",
  });
  const merge = proposals.find((p) => p.kind === "merge_redundant_tags");
  assert.ok(merge, "expected merge_redundant_tags proposal");
  if (merge && merge.kind === "merge_redundant_tags") {
    assert.deepEqual(merge.merges, [{ from: "Schnorr signatures", to: "Schnorr" }]);
  }
});

test("does not propose generic capitalized words as grounded tags", () => {
  const idx = buildCanonicalTagIndex(["Bitcoin", "Concerns", "Bitmain"]);
  const proposals = buildCorrectionProposals({
    date: "2016-07-06",
    summary:
      "Concerns grow over potential 51% attack as Bitcoin halving approaches and mining rewards are set to decrease",
    topArticleId: "https://example.com/halving-security",
    isOrphan: false,
    isFlagged: false,
    tagsVersion2: ["Bitcoin"],
    topicCategories: ["regulation", "mining"],
    legacyTags: [],
    articleText:
      "Concerns grow over potential 51% attack as Bitcoin halving approaches and mining rewards are set to decrease.",
    canonicalTagIndex: idx,
  });
  const add = proposals.find((p) => p.kind === "add_grounded_tags");
  assert.equal(add, undefined);
});

test("does not propose person or organization fragments as grounded tags", () => {
  const idx = buildCanonicalTagIndex([
    "Bitcoin",
    "Satoshi",
    "Nakamoto",
    "Satoshi Nakamoto",
    "Bank of America",
    "America",
  ]);
  const proposals = buildCorrectionProposals({
    date: "2009-01-15",
    summary: "Satoshi Nakamoto discusses Bitcoin while Bank of America faces pressure.",
    topArticleId: "https://example.com/full-entities",
    isOrphan: false,
    isFlagged: false,
    tagsVersion2: ["Bitcoin", "Satoshi Nakamoto", "Bank of America"],
    topicCategories: ["Bitcoin culture"],
    legacyTags: [],
    articleText: "Satoshi Nakamoto discusses Bitcoin while Bank of America faces pressure.",
    canonicalTagIndex: idx,
  });
  const add = proposals.find((p) => p.kind === "add_grounded_tags");
  assert.equal(add, undefined);
});

test("does not propose generic macro words as grounded tags", () => {
  const idx = buildCanonicalTagIndex(["Bitcoin", "Unemployment", "Jobs", "President", "dollar"]);
  const proposals = buildCorrectionProposals({
    date: "2009-06-06",
    summary: "Bitcoin forum activity grows as unemployment, jobs, and dollar worries dominate headlines.",
    topArticleId: "https://example.com/macro",
    isOrphan: false,
    isFlagged: false,
    tagsVersion2: ["Bitcoin"],
    topicCategories: ["Bitcoin culture"],
    legacyTags: [],
    articleText: "Bitcoin forum activity grows as unemployment, jobs, and dollar worries dominate headlines.",
    canonicalTagIndex: idx,
  });
  const add = proposals.find((p) => p.kind === "add_grounded_tags");
  assert.equal(add, undefined);
});

test("does not re-propose grounded tags the operator suppressed for this date", () => {
  const proposals = buildCorrectionProposals({
    date: "2019-02-16",
    summary:
      "Bitcoin developer Luke Dashjr proposes cutting block size to 300 KB, aiming to raise fees and aid miners",
    topArticleId: "https://example.com/luke-dashjr",
    isOrphan: false,
    isFlagged: false,
    tagsVersion2: ["Bitcoin", "Luke Dashjr"],
    topicCategories: ["BIPs and upgrades"],
    legacyTags: [],
    articleText:
      "Bitcoin developer Luke Dashjr proposes cutting block size to 300 KB, aiming to raise fees and aid miners.",
    suppressedGroundedTags: ["Block"],
  });
  const add = proposals.find((p) => p.kind === "add_grounded_tags");
  assert.equal(add, undefined);
});


test("replaces broad placeholder topics with specific inferred storylines", () => {
  const proposals = buildCorrectionProposals({
    date: "2022-03-16",
    summary: "Aave V3 launches, introducing Portal for cross-chain liquidity and E-Mode for enhanced capital efficiency",
    topArticleId: "https://example.com/aave-v3",
    isOrphan: false,
    isFlagged: false,
    tagsVersion2: ["Aave"],
    topicCategories: ["historical", "bitcoin"],
    legacyTags: [],
    articleText: "Aave V3 launches, introducing Portal for cross-chain liquidity and E-Mode for enhanced capital efficiency.",
  });
  const topic = proposals.find((p) => p.kind === "set_topic_categories");
  assert.ok(topic);
  if (topic && topic.kind === "set_topic_categories") {
    assert.ok(topic.proposed.includes("DeFi"));
  }
});

test("does not promote dotted or generic legacy tags into v2", () => {
  const proposals = buildCorrectionProposals({
    date: "2022-03-01",
    summary: "Samson Mow departs Blockstream to promote Bitcoin adoption by nations and focus on his gaming company",
    topArticleId: "https://example.com/samson-mow",
    isOrphan: false,
    isFlagged: false,
    tagsVersion2: ["Bitcoin", "Samson Mow", "Blockstream"],
    topicCategories: ["adoption", "political"],
    legacyTags: ["gaming company", ".crypto"],
    articleText: "Samson Mow departs Blockstream to promote Bitcoin adoption by nations and focus on his gaming company.",
  });
  const promote = proposals.find((p) => p.kind === "promote_v1_to_v2_tags");
  assert.equal(promote, undefined);
});

test("does not propose dotted or generic grounded tags from taxonomy hits", () => {
  const idx = buildCanonicalTagIndex(["Bitcoin", ".crypto", "crypto", "Ukraine"]);
  const proposals = buildCorrectionProposals({
    date: "2022-03-02",
    summary: "Bitcoin's daily trading volume tops $10 billion, fueled by Ukraine's crypto fundraising and Russian controls.",
    topArticleId: "https://example.com/ukraine-volume",
    isOrphan: false,
    isFlagged: false,
    tagsVersion2: ["Bitcoin", "Ukraine", "Russia"],
    topicCategories: ["price", "adoption", "political"],
    legacyTags: [],
    articleText: "Bitcoin's daily trading volume tops $10 billion, fueled by Ukraine's crypto fundraising and Russian controls.",
    canonicalTagIndex: idx,
  });
  const add = proposals.find((p) => p.kind === "add_grounded_tags");
  assert.equal(add, undefined);
});
