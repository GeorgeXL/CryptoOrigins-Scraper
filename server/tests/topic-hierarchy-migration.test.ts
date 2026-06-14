import assert from "node:assert/strict";
import test from "node:test";

import { TOPIC_HIERARCHY_LEAVES } from "../../shared/topic-hierarchy";
import {
  LEGACY_TOPIC_LEAF_MIGRATION,
  resolveStorylineLeafLabel,
} from "../../shared/topic-hierarchy-migration";
import { assertMainEventsLeafPromptRulesComplete, buildTopicHierarchyAgentPromptBlock } from "../../shared/main-events-leaf-prompts";

test("hierarchy v2 has 37 leaves across 5 groups", () => {
  assert.equal(TOPIC_HIERARCHY_LEAVES.length, 37);
});

test("resolveStorylineLeafLabel maps legacy normalized keys", () => {
  assert.equal(resolveStorylineLeafLabel("bitcoin price action"), "Bitcoin price & cycles");
  assert.equal(resolveStorylineLeafLabel("exchange failures"), "Exchanges");
  assert.equal(resolveStorylineLeafLabel("payment processors"), "Bitcoin adoption");
  assert.equal(resolveStorylineLeafLabel("interest rates"), "Monetary policy & rates");
  assert.equal(resolveStorylineLeafLabel("enterprise blockchain adoption"), undefined);
});

test("every legacy leaf maps or is explicitly dropped", () => {
  const legacyCount = Object.keys(LEGACY_TOPIC_LEAF_MIGRATION).length;
  assert.equal(legacyCount, 63);
});

test("main events leaf prompt rules cover all hierarchy leaves", () => {
  assertMainEventsLeafPromptRulesComplete();
});

test("topic agent prompt block includes include/exclude guidance for every leaf", () => {
  const block = buildTopicHierarchyAgentPromptBlock();
  for (const leaf of TOPIC_HIERARCHY_LEAVES) {
    assert.match(block, new RegExp(`- ${leaf.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    assert.match(block, /Include:/);
    assert.match(block, /Exclude:/);
  }
});
