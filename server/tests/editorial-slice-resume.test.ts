import assert from "node:assert/strict";
import test from "node:test";
import type { PipelineAgentName } from "../services/editorial-pipeline/contracts";
import { agentsTailFromStart, validResumeStarts } from "../services/editorial-pipeline/slice-resume";

const chain: PipelineAgentName[] = [
  "DuplicateCheckerAgent",
  "DateConsistencyAgent",
  "TagConsistencyAgent",
  "FinalEditorAgent",
];

test("agentsTailFromStart returns inclusive suffix", () => {
  assert.deepEqual(agentsTailFromStart(chain, "DateConsistencyAgent"), [
    "DateConsistencyAgent",
    "TagConsistencyAgent",
    "FinalEditorAgent",
  ]);
});

test("agentsTailFromStart throws when anchor not in chain", () => {
  assert.throws(() => agentsTailFromStart(chain, "SourceFinderAgent"));
});

test("validResumeStarts preserves pipeline order", () => {
  const long: PipelineAgentName[] = [
    "SourceFinderAgent",
    "DuplicateCheckerAgent",
    "DateConsistencyAgent",
    "FinalEditorAgent",
  ];
  assert.deepEqual(validResumeStarts(long), [
    "DuplicateCheckerAgent",
    "DateConsistencyAgent",
    "FinalEditorAgent",
  ]);
});
