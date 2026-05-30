import assert from "node:assert/strict";
import test from "node:test";

import { buildCorrectionProposals } from "../services/editorial-pipeline/proposals";
import { buildCanonicalTagIndex } from "../services/editorial-pipeline/tag-grounding";
import { inferStorylineLabels } from "../services/editorial-pipeline/storyline-taxonomy";

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

test("does not suggest incidental currency or geography tags when primary entities are already tagged", () => {
  const idx = buildCanonicalTagIndex(["AIB", "Church of Ireland", "Euros", "Ireland"]);
  const proposals = buildCorrectionProposals({
    date: "2010-10-29",
    summary: "The Church of Ireland loses over 17 million euros as AIB shares collapse affecting major shareholders",
    topArticleId: "https://www.bbc.com/news/world-europe-11652923",
    isOrphan: false,
    isFlagged: false,
    tagsVersion2: ["AIB", "Church of Ireland"],
    topicCategories: ["Banking stress"],
    legacyTags: [],
    articleText: "The Church of Ireland loses over 17 million euros as AIB shares collapse affecting major shareholders.",
    canonicalTagIndex: idx,
  });

  assert.equal(proposals.find((p) => p.kind === "add_grounded_tags"), undefined);
});

test("drops source/context tags and merges alias duplicates instead of contradicting v2 tags", () => {
  const proposals = buildCorrectionProposals({
    date: "2010-10-27",
    summary: "Campaign spending data shows Democrats gaining support as midterm financing accelerates",
    topArticleId: "https://example.com/campaign-spending",
    isOrphan: false,
    isFlagged: false,
    tagsVersion2: ["Democrats", "Democratic Party", "Center for Responsive Politics"],
    topicCategories: ["Government adoption"],
    legacyTags: [{ name: "Democratic Party" }, { name: "Center for Responsive Politics" }],
    articleText:
      "Campaign spending data from the Center for Responsive Politics shows Democrats gaining support as midterm financing accelerates.",
  });

  const promote = proposals.find((p) => p.kind === "promote_v1_to_v2_tags");
  assert.equal(promote, undefined);

  const drop = proposals.find((p) => p.kind === "drop_ungrounded_tags");
  assert.ok(drop);
  if (drop && drop.kind === "drop_ungrounded_tags") {
    assert.deepEqual(drop.proposedDrop, ["Center for Responsive Politics"]);
  }

  const merge = proposals.find((p) => p.kind === "merge_redundant_tags");
  assert.ok(merge);
  if (merge && merge.kind === "merge_redundant_tags") {
    assert.ok(merge.merges.some((m) => m.from === "Democratic Party" && m.to === "Democrats"));
  }
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

test("does not invent a topic for generic placeholder summaries", () => {
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
    assert.deepEqual(topic.proposed, []);
  }
});

test("auto-assigns topic for 2010-10-27 election spending day", () => {
  const proposals = buildCorrectionProposals({
    date: "2010-10-27",
    summary:
      "Midterm election spending reaches $4 billion as Republicans outpace Democrats in funding contributions",
    topArticleId: "article-1",
    isOrphan: false,
    isFlagged: false,
    tagsVersion2: ["Republicans"],
    topicCategories: [],
    legacyTags: [{ name: "Democrats", category: "regulation-law" }],
  });
  const topic = proposals.find((p) => p.kind === "set_topic_categories");
  assert.ok(topic);
  if (topic && topic.kind === "set_topic_categories") {
    assert.deepEqual(topic.proposed, ["Politics and elections"]);
  }
});

test("replaces broad model topics with concrete homepage hierarchy leaves", () => {
  const proposals = buildCorrectionProposals({
    date: "2010-12-05",
    summary:
      "Satoshi Nakamoto warns WikiLeaks not to use Bitcoin, fearing it could damage the project's early stage",
    topArticleId: "https://example.com/satoshi-wikileaks",
    isOrphan: false,
    isFlagged: false,
    tagsVersion2: ["Bitcoin", "Satoshi Nakamoto", "WikiLeaks"],
    topicCategories: ["historical", "bitcoin", "economic"],
    legacyTags: [],
  });
  const topic = proposals.find((p) => p.kind === "set_topic_categories");
  assert.ok(topic);
  if (topic && topic.kind === "set_topic_categories") {
    assert.deepEqual(topic.proposed, ["Satoshi identity"]);
    assert.equal(topic.proposed.includes("historical"), false);
    assert.equal(topic.proposed.includes("bitcoin"), false);
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
    summary: "Bitcoin ETF inflows push price to all-time high amid record institutional demand and market euphoria.",
    topArticleId: "https://example.com/ath",
    isOrphan: false,
    isFlagged: false,
    tagsVersion2: ["Bitcoin", "ETF"],
    topicCategories: ["Bitcoin price action"],
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

test("replaces mixed old and new topics with one valid hierarchy leaf", () => {
  const proposals = buildCorrectionProposals({
    date: "2010-01-04",
    summary: "Bitcoin price rises as traders watch support levels and renewed market momentum",
    topArticleId: "https://example.com/bitcoin-price",
    isOrphan: false,
    isFlagged: false,
    tagsVersion2: ["Bitcoin"],
    topicCategories: ["technology", "Bitcoin price action"],
    legacyTags: [],
    articleText: "Bitcoin price rises as traders watch support levels and renewed market momentum.",
  });
  const topic = proposals.find((p) => p.kind === "set_topic_categories");
  assert.ok(topic);
  if (topic && topic.kind === "set_topic_categories") {
    assert.deepEqual(topic.current, ["technology", "Bitcoin price action"]);
    assert.deepEqual(topic.proposed, ["Bitcoin price action"]);
  }
});

test("replaces old 2010 economic topics when summary maps to banking stress", () => {
  const proposals = buildCorrectionProposals({
    date: "2010-10-29",
    summary: "The Church of Ireland loses over 17 million euros as AIB shares collapse affecting major shareholders",
    topArticleId: "https://www.bbc.com/news/world-europe-11652923",
    isOrphan: false,
    isFlagged: false,
    tagsVersion2: ["AIB", "Church of Ireland"],
    topicCategories: ["economic", "institutional"],
    legacyTags: [],
    articleText: "The Church of Ireland loses over 17 million euros as AIB shares collapse affecting major shareholders.",
  });
  const topic = proposals.find((p) => p.kind === "set_topic_categories");
  assert.ok(topic);
  if (topic && topic.kind === "set_topic_categories") {
    assert.deepEqual(topic.current, ["economic", "institutional"]);
    assert.deepEqual(topic.proposed, ["Banking stress"]);
  }
});

test("keeps exactly one valid hierarchy leaf when it matches the summary", () => {
  const proposals = buildCorrectionProposals({
    date: "2010-01-05",
    summary: "Bitcoin price rises as traders watch support levels and renewed market momentum",
    topArticleId: "https://example.com/bitcoin-price",
    isOrphan: false,
    isFlagged: false,
    tagsVersion2: ["Bitcoin"],
    topicCategories: ["Bitcoin price action"],
    legacyTags: [],
    articleText: "Bitcoin price rises as traders watch support levels and renewed market momentum.",
  });
  assert.equal(proposals.find((p) => p.kind === "set_topic_categories"), undefined);
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

test("Feb 2012: blocks vague debt crisis tag and realigns Obama debt-day topic", () => {
  const idx = buildCanonicalTagIndex(["Obama", "U.S.", "Debt Crisis", "Europe", "Greece"]);
  const proposals = buildCorrectionProposals({
    date: "2012-02-09",
    summary:
      "Obama stresses European leaders must show commitment to resolve the debt crisis affecting the U.S. economy",
    topArticleId: "https://example.com/obama-debt",
    isOrphan: false,
    isFlagged: false,
    tagsVersion2: ["Obama"],
    topicCategories: ["Government adoption"],
    legacyTags: [{ name: "NO TAG", category: "miscellaneous" }],
    articleText:
      "Obama stresses European leaders must show commitment to resolve the debt crisis affecting the U.S. economy.",
    canonicalTagIndex: idx,
  });
  const add = proposals.find((p) => p.kind === "add_grounded_tags");
  if (add && add.kind === "add_grounded_tags") {
    assert.ok(!add.proposedAdd.some((t) => /debt crisis/i.test(t)), "debt crisis is too vague for a tag");
    assert.ok(add.proposedAdd.includes("U.S."));
  }
  const topic = proposals.find((p) => p.kind === "set_topic_categories");
  assert.ok(topic);
  if (topic && topic.kind === "set_topic_categories") {
    assert.deepEqual(topic.proposed, ["Debt crises"]);
  }
});

test("Feb 2012: fake Treasury bonds map to fraud topic, not mining evolution", () => {
  const proposals = buildCorrectionProposals({
    date: "2012-02-17",
    summary: "Italian police seize fake U.S. Treasury bonds worth $6 trillion and arrest eight mafia-linked suspects",
    topArticleId: "https://example.com/fake-bonds",
    isOrphan: false,
    isFlagged: false,
    tagsVersion2: ["Italy", "U.S. Treasury"],
    topicCategories: ["Mining evolution"],
    legacyTags: [],
    articleText:
      "Italian police seize fake U.S. Treasury bonds worth $6 trillion and arrest eight mafia-linked suspects.",
  });
  const topic = proposals.find((p) => p.kind === "set_topic_categories");
  assert.ok(topic);
  if (topic && topic.kind === "set_topic_categories") {
    assert.deepEqual(topic.proposed, ["Fraud and scams"]);
  }
});

test("Feb 2012: drops tangential conservatives and blocks VAT legacy promotion", () => {
  const proposals = buildCorrectionProposals({
    date: "2012-02-19",
    summary:
      "Ed Balls proposes tax cuts including VAT reduction to boost growth while facing criticism from conservatives",
    topArticleId: "https://example.com/ed-balls",
    isOrphan: false,
    isFlagged: false,
    tagsVersion2: ["Ed Balls", "Conservatives"],
    topicCategories: ["Global growth and recession"],
    legacyTags: [{ name: "Ed Balls" }, { name: "VAT" }],
    articleText:
      "Ed Balls proposes tax cuts including VAT reduction to boost growth while facing criticism from conservatives.",
  });
  assert.equal(proposals.find((p) => p.kind === "promote_v1_to_v2_tags"), undefined);
  const drop = proposals.find((p) => p.kind === "drop_ungrounded_tags");
  assert.ok(drop);
  if (drop && drop.kind === "drop_ungrounded_tags") {
    assert.deepEqual(drop.proposedDrop, ["Conservatives"]);
  }
});

test("Feb 2012: credit-rating day drops stale tags and blocks police legacy promotion", () => {
  const proposals = buildCorrectionProposals({
    date: "2012-02-28",
    summary:
      "Credit rating agencies draw scrutiny over downgrades leading to police investigation and parliamentary inquiry",
    topArticleId: "https://example.com/credit-ratings",
    isOrphan: false,
    isFlagged: false,
    tagsVersion2: ["Credit rating agencies", "Italy", "UK", "Alistair Darling", "BBC Radio 4"],
    topicCategories: ["Mining companies"],
    legacyTags: [
      { name: "Credit rating agencies" },
      { name: "police" },
      { name: "parliamentary inquiry" },
    ],
    articleText:
      "Credit rating agencies draw scrutiny over downgrades leading to police investigation and parliamentary inquiry. Italy and UK politicians including Alistair Darling spoke on BBC Radio 4.",
  });
  assert.equal(proposals.find((p) => p.kind === "promote_v1_to_v2_tags"), undefined);
  const topic = proposals.find((p) => p.kind === "set_topic_categories");
  assert.ok(topic);
  if (topic && topic.kind === "set_topic_categories") {
    assert.deepEqual(topic.proposed, ["Securities regulation"]);
  }
  const drop = proposals.find((p) => p.kind === "drop_ungrounded_tags");
  assert.ok(drop);
  if (drop && drop.kind === "drop_ungrounded_tags") {
    assert.ok(drop.proposedDrop.includes("BBC Radio 4"));
    assert.ok(drop.proposedDrop.includes("Italy"));
  }
});

test("Feb 2012: Romney summary maps to politics, not mining evolution from article noise", () => {
  const summary =
    "Wall Street executives heavily back Mitt Romney influencing the dynamics of the US presidential elections";
  const articleText =
    "Wall Street in the White House? Bitcoin mining and botnet mining capabilities discussed in unrelated forum posts.";
  const fromSummary = inferStorylineLabels({ summary, tags: ["Mitt Romney", "U.S."] });
  assert.deepEqual(fromSummary, ["Politics and elections"]);
  const withArticle = inferStorylineLabels({ summary, articleText, tags: ["Mitt Romney", "U.S."] });
  assert.deepEqual(withArticle, ["Politics and elections"]);
  const proposals = buildCorrectionProposals({
    date: "2012-02-23",
    summary,
    topArticleId: "https://example.com/romney",
    isOrphan: false,
    isFlagged: false,
    tagsVersion2: ["Mitt Romney", "U.S."],
    topicCategories: ["Mining evolution"],
    legacyTags: [],
    articleText,
  });
  const topic = proposals.find((p) => p.kind === "set_topic_categories");
  assert.ok(topic);
  if (topic && topic.kind === "set_topic_categories") {
    assert.deepEqual(topic.proposed, ["Politics and elections"]);
  }
});
