import assert from "node:assert/strict";
import test from "node:test";

import {
  canonicalTopicLeaf,
  normalizeTopicAgentLeaves,
  topicAgentLeavesToRanking,
} from "../services/editorial-pipeline/topic-agent";

test("canonicalTopicLeaf accepts exact and group-form labels", () => {
  assert.equal(canonicalTopicLeaf("Labor market"), "Labor market");
  assert.equal(canonicalTopicLeaf("Macro & Policy › Labor market"), "Labor market");
  assert.equal(canonicalTopicLeaf("not a real leaf"), null);
});

test("normalizeTopicAgentLeaves dedupes alternates", () => {
  const out = normalizeTopicAgentLeaves({
    recommended_topic: "Bailouts and stimulus",
    alternates: ["Global growth and recession", "Bailouts and stimulus", "Labor market"],
  });
  assert.equal(out.recommended, "Bailouts and stimulus");
  assert.deepEqual(out.alternates, ["Global growth and recession", "Labor market"]);
});

test("topicAgentLeavesToRanking maps high confidence single leaf", () => {
  const ranking = topicAgentLeavesToRanking("high", "Labor market", []);
  assert.equal(ranking.confidence, "high");
  assert.equal(ranking.primary, "Labor market");
  assert.deepEqual(ranking.candidates.map((c) => c.leaf), ["Labor market"]);
});

test("topicAgentLeavesToRanking maps medium confidence to low ranking flag with options", () => {
  const ranking = topicAgentLeavesToRanking("medium", "Bailouts and stimulus", ["Global growth and recession"]);
  assert.equal(ranking.confidence, "low");
  assert.equal(ranking.primary, "Bailouts and stimulus");
  assert.equal(ranking.candidates.length, 2);
});
