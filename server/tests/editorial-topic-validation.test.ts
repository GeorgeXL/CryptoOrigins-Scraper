import assert from "node:assert/strict";
import test from "node:test";
import { topicLabelsFromRow } from "../services/editorial-pipeline/tools";
import { evaluateTopicHierarchy, invalidTopicReasons } from "../services/editorial-pipeline/topic-validation";
import { buildCorrectionProposals } from "../services/editorial-pipeline/proposals";

test("topicLabelsFromRow reads label/name/slug objects", () => {
  assert.deepEqual(
    topicLabelsFromRow([
      { label: "Bitcoin adoption" },
      { name: "Mining companies" },
      { slug: "bitcoin-price-action" },
    ]),
    ["bitcoin adoption", "mining companies", "bitcoin-price-action"],
  );
});

test("invalidTopicReasons rejects broad legacy topics", () => {
  assert.deepEqual(invalidTopicReasons(["economic", "institutional"]), [
    "More than one topic assigned",
    "Old broad topic assigned",
    "Topic is not in the current hierarchy",
  ]);
});

test("invalidTopicReasons accepts a single hierarchy leaf", () => {
  assert.deepEqual(invalidTopicReasons(["Bitcoin price action"]), []);
});

test("evaluateTopicHierarchy surfaces single-topic rule", () => {
  const out = evaluateTopicHierarchy(["market", "Bitcoin price action"]);
  assert.deepEqual(out.normalizedTopics, ["market", "bitcoin price action"]);
  assert.ok(out.issues.includes("More than one topic assigned"));
});

test("proposes topic fix for legacy single market topic", () => {
  const proposals = buildCorrectionProposals({
    date: "2026-01-31",
    summary: "Bitcoin price rises as traders watch support levels and renewed market momentum",
    topArticleId: "article-1",
    isOrphan: false,
    isFlagged: false,
    tagsVersion2: ["Bitcoin"],
    topicCategories: ["market"],
    legacyTags: [],
    articleText: "Bitcoin price rises as traders watch support levels and renewed market momentum.",
  });
  const topic = proposals.find((p) => p.kind === "set_topic_categories");
  assert.ok(topic);
  if (topic && topic.kind === "set_topic_categories") {
    assert.deepEqual(topic.proposed, ["Bitcoin price action"]);
  }
});
