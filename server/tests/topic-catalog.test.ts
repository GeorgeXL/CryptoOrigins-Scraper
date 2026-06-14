import assert from "node:assert/strict";
import test from "node:test";

import {
  analysisMatchesTopicLeaf,
  buildTopicCatalogData,
  extractTopicLabelsFromCategories,
  resolveSelectedTopicLeafFromSelection,
  resolveTopicLabelFromSelection,
  type AnalysisTopicRow,
} from "../../client/src/lib/topicCatalog";

test("extractTopicLabelsFromCategories reads strings and objects", () => {
  assert.deepEqual(extractTopicLabelsFromCategories(["Bitcoin price & cycles", "  "]), [
    "Bitcoin price & cycles",
  ]);
  assert.deepEqual(extractTopicLabelsFromCategories([{ label: "Mining evolution" }]), ["Mining evolution"]);
});

test("buildTopicCatalogData counts analyses from topic_categories", () => {
  const analysisTopics: AnalysisTopicRow[] = [
    { id: "a2", topic_categories: ["Bitcoin adoption"] },
    { id: "a1", topic_categories: ["Bitcoin price & cycles"] },
  ];

  const catalog = buildTopicCatalogData(analysisTopics);
  assert.ok(catalog);
  const narratives = catalog!.entitiesByCategory.narratives;
  const markets = narratives.find((g) => g.name === "Markets");
  const bitcoin = narratives.find((g) => g.name === "Bitcoin");
  const priceLeaf = markets?.children?.find((c) => c.name === "Bitcoin price & cycles");
  const adoptLeaf = bitcoin?.children?.find((c) => c.name === "Bitcoin adoption");

  assert.equal(priceLeaf?.count, 1);
  assert.equal(adoptLeaf?.count, 1);
  assert.equal(catalog!.taggedCount, 2);
});

test("resolveTopicLabelFromSelection returns one storyline label", () => {
  const catalog = buildTopicCatalogData([]);
  assert.ok(catalog);

  const selection = new Set(["narratives::Bitcoin price & cycles"]);
  assert.equal(resolveTopicLabelFromSelection(selection, catalog), "Bitcoin price & cycles");
  assert.equal(resolveTopicLabelFromSelection(new Set(["bitcoin::Bitcoin"]), catalog), null);
});

test("resolveSelectedTopicLeafFromSelection reads narratives:: keys for unseeded leaves", () => {
  assert.equal(
    resolveSelectedTopicLeafFromSelection(new Set(["narratives::Bitcoin mining"]), null),
    "Bitcoin mining",
  );
});

test("analysisMatchesTopicLeaf resolves migrated and current labels", () => {
  assert.equal(
    analysisMatchesTopicLeaf({ topic_categories: ["Bitcoin mining"] }, "Bitcoin mining"),
    true,
  );
  assert.equal(
    analysisMatchesTopicLeaf({ topic_categories: ["Mining evolution"] }, "Bitcoin mining"),
    true,
  );
  assert.equal(
    analysisMatchesTopicLeaf({ topic_categories: ["Derivatives"] }, "Bitcoin mining"),
    false,
  );
});
