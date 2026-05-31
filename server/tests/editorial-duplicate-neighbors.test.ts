import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizedTagsFromRow,
  summaryTokenJaccardForDuplicateCheck,
  summariesHaveDistinctMilestoneNumbers,
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

test("summariesHaveDistinctMilestoneNumbers: 2019-08-08 vs 2019-09-18 hash rate milestones differ", () => {
  const aug =
    "Bitcoin's hash rate exceeds 80 quintillion hashes per second, boosting security and investor confidence";
  const sep =
    "Bitcoin's hash rate reaches a record 100 quintillion hashes per second reflecting improved network security";
  assert.equal(summariesHaveDistinctMilestoneNumbers(aug, sep), true);
  assert.ok(summaryTokenJaccardForDuplicateCheck(aug, sep) < 0.76);
});
