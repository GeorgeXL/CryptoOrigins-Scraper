import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizedTagsFromRow,
  summaryTokenJaccardForDuplicateCheck,
  topicLabelsFromRow,
} from "../services/editorial-pipeline/tools";

test("topicLabelsFromRow supports strings and {name}", () => {
  assert.deepEqual(topicLabelsFromRow(["Adoption", "regulation"]), ["adoption", "regulation"]);
  assert.deepEqual(topicLabelsFromRow([{ name: "EtF" }, { foo: 1 }]), ["etf"]);
});

test("normalizedTagsFromRow dedupes case", () => {
  assert.deepEqual(normalizedTagsFromRow(["Bitcoin", "bitcoin"]), ["bitcoin"]);
});

test("summaryTokenJaccardForDuplicateCheck detects near-copies", () => {
  const a = "Laszlo Hanyecz buys two pizzas for ten thousand BTC famous pizza milestone";
  const b = "Laszlo buys two pizzas for ten thousand BTC marking the pizza milestone story";
  const j = summaryTokenJaccardForDuplicateCheck(a, b);
  assert.ok(j > 0.45);
});
