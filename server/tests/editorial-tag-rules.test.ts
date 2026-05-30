import assert from "node:assert/strict";
import test from "node:test";

import { isEditorialEntityTagCandidate } from "../services/editorial-pipeline/editorial-tag-rules";
import { buildCorrectionProposals } from "../services/editorial-pipeline/proposals";
import { buildCanonicalTagIndex } from "../services/editorial-pipeline/tag-grounding";

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
  ]) {
    assert.equal(isEditorialEntityTagCandidate(tag), false, `expected reject: ${tag}`);
  }
});

test("accepts concrete entity tags", () => {
  for (const tag of ["Brussels", "Eurozone", "Mitt Romney", "Wall Street", "SEC", "Bitcoin", "U.S."]) {
    assert.equal(isEditorialEntityTagCandidate(tag), true, `expected accept: ${tag}`);
  }
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
