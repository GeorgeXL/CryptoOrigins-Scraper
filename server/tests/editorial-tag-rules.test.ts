import assert from "node:assert/strict";
import test from "node:test";

import {
  isEditorialEntityTagCandidate,
  filterEditorialTagAdds,
  isRedundantCountryRoleTag,
  preferredEditorialTagDisplay,
  isDateEmbeddedEditorialTag,
  isHeadlineFragmentEditorialTag,
} from "../services/editorial-pipeline/editorial-tag-rules";
import { buildCorrectionProposals } from "../services/editorial-pipeline/proposals";
import { buildCanonicalTagIndex } from "../services/editorial-pipeline/tag-grounding";

test("rejects legacy headline fragments and date-prefixed taxonomy junk", () => {
  for (const tag of [
    "2015-12-31 wallet fixes",
    "2015-12-20 bitcoin vault",
    "android",
    "2015-12-17 ledger",
    "2015-11-25 inflation",
    "2015-11-22 bitcoin technology",
    "2015-11-17 monetary policy",
    "2015-11-12 opt-in replace-by-fee",
    "2015-11-10 multi-sig wallet",
    "2015-10-26 ministry of finance",
    "2015-10-21 digital currency and exchanges",
    "2015-10-08 mempool limits and vulnerabilities",
    "2015-09-22 virtual currency",
    "2015-09-02 energy",
    "2015-08-20 hard fork",
    "2015-08-10 OCC and thomas curry",
    "2015-07-09 hard fork",
    "2015-06-21 greylisting",
    "2015-06-08 web-wallet",
  ]) {
    assert.equal(isEditorialEntityTagCandidate(tag), false, `expected reject: ${tag}`);
  }
});

test("roundup summary skips tag add proposals and flags weekly source", () => {
  const summary =
    "Bitcoin wallet fixes ship; Android app updates; inflation debate continues; hard fork talk resurfaces";
  const idx = buildCanonicalTagIndex([
    "Bitcoin",
    "2015-12-31 wallet fixes",
    "android",
    "inflation",
    "hard fork",
    "Android",
  ]);
  const proposals = buildCorrectionProposals({
    date: "2015-12-31",
    summary,
    topArticleId: "https://example.com/weekly-roundup",
    isOrphan: false,
    isFlagged: false,
    tagsVersion2: ["Bitcoin"],
    topicCategories: ["technology"],
    legacyTags: [],
    articleText: "Weekly Bitcoin news roundup: wallet fixes; Android app; inflation; hard fork",
    canonicalTagIndex: idx,
    tagAgentAdd: ["Android", "inflation"],
    tagAgentConfidence: "high",
  });
  assert.equal(proposals.find((p) => p.kind === "add_grounded_tags"), undefined);
  const redo = proposals.find((p) => p.kind === "redo_summary");
  assert.ok(redo && redo.kind === "redo_summary");
  assert.match(redo.rationale, /Weekly roundup/i);
});

test("rejects vague policy and process tags", () => {
  for (const tag of [
    "Budget Deficits",
    "budget deficits",
    "Stress Tests",
    "stress tests",
    "Debt Crisis",
    "VAT",
    "parliamentary inquiry",
    "police",
    "fiscal treaty",
    "optimism",
    "pessimism",
    "uncertainty",
    "bullish",
    "Obama administration",
    "Biden era",
    "Trump presidency",
    "Halving",
    "halving",
    "hashrate",
    "adoption",
    "cities",
    "city",
    "community",
    "crypto community",
    "protocol",
    "protocols",
    "derivatives",
    "derivative",
    "futures",
    "cites",
  ]) {
    assert.equal(isEditorialEntityTagCandidate(tag), false, `expected reject: ${tag}`);
  }
});

test("accepts concrete entity tags", () => {
  for (const tag of ["Brussels", "Eurozone", "Mitt Romney", "Wall Street", "SEC", "Bitcoin", "U.S.", "Taproot", "SegWit"]) {
    assert.equal(isEditorialEntityTagCandidate(tag), true, `expected accept: ${tag}`);
  }
});

test("2018-05-30 does not propose generic protocol tag from summary wording", () => {
  const summary =
    "Developers debate bitcoin protocol changes as community weighs soft fork options ahead of network upgrade talks";
  const idx = buildCanonicalTagIndex(["Bitcoin", "Protocol", "protocol", "SegWit"]);
  const proposals = buildCorrectionProposals({
    date: "2018-05-30",
    summary,
    topArticleId: "https://example.com/btc-protocol",
    isOrphan: false,
    isFlagged: false,
    tagsVersion2: ["Bitcoin"],
    topicCategories: ["technology"],
    legacyTags: [],
    articleText: summary,
    canonicalTagIndex: idx,
    tagAgentAdd: ["Protocol"],
    tagAgentConfidence: "high",
  });
  const add = proposals.find((p) => p.kind === "add_grounded_tags");
  assert.equal(add, undefined);
});

test("2021-05-10 does not propose derivatives tag when Goldman Sachs is already tagged", () => {
  const summary =
    "US banks prepare Bitcoin trading, Goldman launches derivatives, and Revolut enables Bitcoin withdrawals";
  const idx = buildCanonicalTagIndex(["Bitcoin", "Derivatives", "Goldman Sachs", "Revolut", "NYDIG"]);
  const proposals = buildCorrectionProposals({
    date: "2021-05-10",
    summary,
    topArticleId: "https://example.com/btc-banks",
    isOrphan: false,
    isFlagged: false,
    tagsVersion2: ["Bitcoin", "Goldman Sachs", "NYDIG", "FIS"],
    topicCategories: ["Financial institutions"],
    legacyTags: [],
    articleText: summary,
    canonicalTagIndex: idx,
    tagAgentAdd: ["Derivatives"],
    tagAgentConfidence: "high",
  });
  const add = proposals.find((p) => p.kind === "add_grounded_tags");
  assert.ok(!add || !add.proposedAdd.some((t) => t.toLowerCase() === "derivatives"));
});

test("does not propose budget deficits for 2012-03-02", () => {
  const idx = buildCanonicalTagIndex(["Brussels", "Eurozone", "Budget Deficits", "Europe"]);
  const proposals = buildCorrectionProposals({
    date: "2012-03-02",
    summary:
      "European leaders sign a fiscal treaty in Brussels aimed at preventing budget deficits in the eurozone",
    topArticleId: "https://example.com/fiscal-treaty",
    isOrphan: false,
    isFlagged: false,
    tagsVersion2: ["Brussels", "Eurozone"],
    topicCategories: ["Hacks and exploits"],
    legacyTags: [],
    articleText:
      "European leaders sign a fiscal treaty in Brussels aimed at preventing budget deficits in the eurozone.",
    canonicalTagIndex: idx,
  });
  const add = proposals.find((p) => p.kind === "add_grounded_tags");
  assert.equal(add, undefined);
});

test("does not propose stress tests for 2012-03-17", () => {
  const idx = buildCanonicalTagIndex(["U.S.", "Federal Reserve", "Stress Tests", "Bank of America"]);
  const proposals = buildCorrectionProposals({
    date: "2012-03-17",
    summary:
      "U.S. banks pass Federal Reserve stress tests, boosting confidence in the financial sector after crisis-era reforms",
    topArticleId: "https://example.com/stress-tests",
    isOrphan: false,
    isFlagged: false,
    tagsVersion2: ["U.S.", "Federal Reserve"],
    topicCategories: ["Banking stress"],
    legacyTags: [],
    articleText:
      "U.S. banks pass Federal Reserve stress tests, boosting confidence in the financial sector after crisis-era reforms.",
    canonicalTagIndex: idx,
  });
  const add = proposals.find((p) => p.kind === "add_grounded_tags");
  assert.equal(add, undefined);
});

test("rejects role and demographic group tags", () => {
  for (const tag of ["miners", "Chinese miners", "american miners", "mining"]) {
    assert.equal(isEditorialEntityTagCandidate(tag), false, `expected reject: ${tag}`);
  }
});

test("filterEditorialTagAdds drops redundant Chinese miners when china is tagged", () => {
  assert.equal(isRedundantCountryRoleTag("Chinese miners", ["bitcoin", "china"]), true);
  const filtered = filterEditorialTagAdds(["Chinese miners", "miners", "Bitmain"], ["bitcoin", "china"]);
  assert.deepEqual(filtered, ["Bitmain"]);
});

test("tag agent medium-confidence adds are not proposed", () => {
  const proposals = buildCorrectionProposals({
    date: "2024-01-01",
    summary: "Bitcoin optimism rises as MicroStrategy adds more BTC to its treasury holdings",
    topArticleId: "https://example.com/mstr",
    isOrphan: false,
    isFlagged: false,
    tagsVersion2: ["Bitcoin", "MicroStrategy"],
    topicCategories: ["Corporate treasury"],
    legacyTags: [],
    articleText: "",
    tagAgentAdd: ["Optimism"],
    tagAgentConfidence: "medium",
  });
  const add = proposals.find((p) => p.kind === "add_grounded_tags");
  assert.equal(add, undefined);
});

test("tag agent high-confidence adds still respect entity rules", () => {
  const proposals = buildCorrectionProposals({
    date: "2024-01-01",
    summary: "Bitcoin optimism rises as SEC officials discuss digital asset rules under the Obama administration",
    topArticleId: "https://example.com/btc",
    isOrphan: false,
    isFlagged: false,
    tagsVersion2: ["Bitcoin"],
    topicCategories: ["Securities regulation"],
    legacyTags: [],
    articleText: "",
    tagAgentAdd: ["Optimism", "Obama administration", "SEC"],
    tagAgentConfidence: "high",
  });
  const add = proposals.find((p) => p.kind === "add_grounded_tags");
  assert.ok(add && add.kind === "add_grounded_tags");
  assert.deepEqual(add.proposedAdd, ["SEC"]);
});

test("2018-03-03 does not propose CITES or generic tags on verb cites", () => {
  const summary =
    "Crypto community cites batching, SegWit and spam as Bitcoin transactions fall, offsetting volume concerns";
  const idx = buildCanonicalTagIndex(["Bitcoin", "CITES", "SegWit", "Cities", "community", "batching"]);
  const proposals = buildCorrectionProposals({
    date: "2018-03-03",
    summary,
    topArticleId: "https://example.com/btc-txn-fall",
    isOrphan: false,
    isFlagged: false,
    tagsVersion2: ["Bitcoin"],
    topicCategories: ["adoption", "technology"],
    legacyTags: [],
    articleText: summary,
    canonicalTagIndex: idx,
    tagAgentAdd: ["CITES", "Cities", "SegWit", "community"],
    tagAgentConfidence: "high",
  });
  const add = proposals.find((p) => p.kind === "add_grounded_tags");
  if (add && add.kind === "add_grounded_tags") {
    assert.ok(!add.proposedAdd.some((t) => /^(CITES|Cities|community|batching|cites)$/i.test(t)));
    assert.ok(add.proposedAdd.includes("SegWit"));
  } else {
    assert.fail("expected SegWit add proposal");
  }
});

test("does not propose Halving tag when summary only mentions halving in passing", () => {
  const idx = buildCanonicalTagIndex(["Bitcoin", "Halving", "miners"]);
  const proposals = buildCorrectionProposals({
    date: "2020-02-08",
    summary:
      "Bitcoin mining profitability projected to improve if price reaches $15,000 post halving benefiting miners",
    topArticleId: "https://example.com/mining-halving",
    isOrphan: false,
    isFlagged: false,
    tagsVersion2: ["Bitcoin"],
    topicCategories: ["Mining evolution"],
    legacyTags: [],
    articleText:
      "Bitcoin mining profitability projected to improve if price reaches $15,000 post halving benefiting miners.",
    canonicalTagIndex: idx,
    tagAgentAdd: ["Halving"],
    tagAgentConfidence: "high",
  });
  const add = proposals.find((p) => p.kind === "add_grounded_tags");
  assert.equal(add, undefined);
});

test("2020-03-04 does not propose Chinese miners when china is already tagged", () => {
  const proposals = buildCorrectionProposals({
    date: "2020-03-04",
    summary:
      "Bitcoin's hashing power increases 5.4% to 117.5 EH/s as Chinese miners resume operations after delays",
    topArticleId: "https://example.com/hashrate",
    isOrphan: false,
    isFlagged: false,
    tagsVersion2: ["bitcoin", "china"],
    topicCategories: ["scaling and layer 2"],
    legacyTags: [],
    articleText: "",
    tagAgentAdd: ["Chinese miners", "miners"],
    tagAgentReason: "Summary mentions Chinese miners.",
  });
  const add = proposals.find((p) => p.kind === "add_grounded_tags");
  assert.equal(add, undefined);
});

test("2012-03-14 Bitcoin-Qt release maps to Bitcoin › Protocol development", () => {
  const proposals = buildCorrectionProposals({
    date: "2012-03-14",
    summary:
      "Bitcoin-Qt v0.5.3 introduces critical fixes and improvements to enhance user experience and stability",
    topArticleId: "https://example.com/bitcoin-qt",
    isOrphan: false,
    isFlagged: false,
    tagsVersion2: ["Bitcoin"],
    topicCategories: ["historical", "bitcoin"],
    legacyTags: [{ name: "Bitcoin-Qt" }, { name: "Bitcoin" }],
    articleText: "",
  });
  const topic = proposals.find((p) => p.kind === "set_topic_categories");
  assert.ok(topic);
  if (topic && topic.kind === "set_topic_categories") {
    assert.deepEqual(topic.proposed, ["Protocol development"]);
    assert.match(topic.rationale, /Bitcoin › Protocol development/);
  }
});

test("preferredEditorialTagDisplay collapses Bitcoin ATMs to singular Bitcoin ATM", () => {
  assert.equal(preferredEditorialTagDisplay("Bitcoin ATMs"), "Bitcoin ATM");
  assert.equal(preferredEditorialTagDisplay("bitcoin atms"), "Bitcoin ATM");
});

test("2018-05-08 keeps full person names and drops surname fragments and crypto community", () => {
  const summary =
    "Warren Buffett and Bill Gates criticize Bitcoin, sparking varied reactions from the crypto community";
  const idx = buildCanonicalTagIndex([
    "Bitcoin",
    "Bill Gates",
    "Warren Buffett",
    "Gates",
    "Buffett",
    "crypto community",
  ]);
  const proposals = buildCorrectionProposals({
    date: "2018-05-08",
    summary,
    topArticleId: "https://example.com/buffett-gates",
    isOrphan: false,
    isFlagged: false,
    tagsVersion2: ["Bitcoin"],
    topicCategories: ["historical", "bitcoin"],
    legacyTags: [],
    articleText: summary,
    canonicalTagIndex: idx,
  });
  const add = proposals.find((p) => p.kind === "add_grounded_tags");
  assert.ok(add && add.kind === "add_grounded_tags");
  assert.ok(add.proposedAdd.includes("Bill Gates"));
  assert.ok(add.proposedAdd.includes("Warren Buffett"));
  assert.ok(!add.proposedAdd.includes("Gates"));
  assert.ok(!add.proposedAdd.includes("Buffett"));
  assert.ok(!add.proposedAdd.some((tag) => tag.toLowerCase().includes("community")));
});

test("filterEditorialTagAdds drops surname-only tags when full names are present", () => {
  const out = filterEditorialTagAdds(
    ["Buffett", "Warren Buffett", "Gates", "Bill Gates"],
    ["Bitcoin"],
  );
  assert.deepEqual(out.sort(), ["Bill Gates", "Warren Buffett"]);
});

test("rejects dotted initialism tags like B.C.", () => {
  assert.equal(isEditorialEntityTagCandidate("B.C."), false);
});

test("2018-05-27 does not propose article-only company tags missing from summary", () => {
  const summary =
    "U.K. firm trademarks bitcoin for clothing and drinks, sparking confusion but leaving the currency alone";
  const idx = buildCanonicalTagIndex(["Bitcoin", "A.B.C. IP Holdings", "B.C.", "UK", "U.K."]);
  const proposals = buildCorrectionProposals({
    date: "2018-05-27",
    summary,
    topArticleId: "https://example.com/bitcoin-trademark",
    isOrphan: false,
    isFlagged: false,
    tagsVersion2: ["Bitcoin"],
    topicCategories: ["regulation", "adoption"],
    legacyTags: [],
    articleText: summary,
    canonicalTagIndex: idx,
    tagAgentAdd: ["A.B.C. IP Holdings", "B.C.", "UK"],
    tagAgentConfidence: "high",
  });
  const add = proposals.find((p) => p.kind === "add_grounded_tags");
  assert.ok(add && add.kind === "add_grounded_tags");
  assert.deepEqual(add.proposedAdd, ["UK"]);
  assert.ok(!add.proposedAdd.includes("A.B.C. IP Holdings"));
  assert.ok(!add.proposedAdd.includes("B.C."));
});
