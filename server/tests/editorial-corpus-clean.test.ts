import assert from "node:assert/strict";
import test from "node:test";
import {
  isHighConfidenceTopicAutoApply,
  splitCorrectionProposalsForAutoApply,
} from "../services/editorial-pipeline/corpus-clean";
import type { CorrectionProposal } from "../services/editorial-pipeline/review-package";

test("auto-applies topic only when confidence is high and single leaf", () => {
  const high: CorrectionProposal = {
    id: "x",
    kind: "set_topic_categories",
    current: ["economic"],
    proposed: ["Labor market"],
    rationale: "test",
    topicAgentConfidence: "high",
    topicAgentSource: "llm",
  };
  const medium: CorrectionProposal = {
    ...high,
    proposed: ["Labor market", "Global growth and recession"],
    topicAgentConfidence: "medium",
  };
  assert.equal(isHighConfidenceTopicAutoApply(high), true);
  assert.equal(isHighConfidenceTopicAutoApply(medium), false);

  const { automatic, manual } = splitCorrectionProposalsForAutoApply([high, medium]);
  assert.equal(automatic.length, 1);
  assert.equal(manual.length, 1);
  assert.equal(automatic[0]?.kind, "set_topic_categories");
});

test("merge_redundant_tags stays automatic", () => {
  const merge: CorrectionProposal = {
    id: "m",
    kind: "merge_redundant_tags",
    merges: [{ from: "Schnorr signatures", to: "Schnorr" }],
    rationale: "dup",
  };
  const { automatic } = splitCorrectionProposalsForAutoApply([merge]);
  assert.equal(automatic.length, 1);
});

test("redo_summary stays automatic (same-article regen)", () => {
  const redo: CorrectionProposal = {
    id: "r",
    kind: "redo_summary",
    currentSummary: "x".repeat(105),
    rationale: "Regenerate summary (100–110 chars).",
  };
  const { automatic, manual } = splitCorrectionProposalsForAutoApply([redo]);
  assert.equal(automatic.length, 1);
  assert.equal(automatic[0]?.kind, "redo_summary");
  assert.equal(manual.length, 0);
});

test("edit_summary stays manual", () => {
  const edit: CorrectionProposal = {
    id: "e",
    kind: "edit_summary",
    currentSummary: "short",
    targetMin: 100,
    targetMax: 110,
    rationale: "Edit summary (100–110 chars).",
  };
  const { automatic, manual } = splitCorrectionProposalsForAutoApply([edit]);
  assert.equal(automatic.length, 0);
  assert.equal(manual.length, 1);
});
