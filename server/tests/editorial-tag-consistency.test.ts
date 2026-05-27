import assert from "node:assert/strict";
import test from "node:test";
import { evaluateTagConsistency, normalizeTagList } from "../services/editorial-pipeline/tools";

test("normalizeTagList collapses Web2 aliases", () => {
  assert.deepEqual(normalizeTagList(["Web 2.0", "web2", "Web2.0"]), ["web2"]);
});

test("normalizeTagList rejects generic fragments and broad sector labels", () => {
  assert.deepEqual(
    normalizeTagList(["U.S.", "United States", "Five U.S", "investment banks", "Bitcoin"]),
    ["united states", "bitcoin"],
  );
});

test("evaluateTagConsistency flags Web2/Web3 conflicts", () => {
  const out = evaluateTagConsistency({
    summary: "Builders debate Web3 adoption trends.",
    tags: ["Web2", "Web3"],
    topics: [],
  });
  assert.ok(out.issues.some((issue) => issue.type === "conflict"));
});

test("evaluateTagConsistency flags summary mismatch", () => {
  const out = evaluateTagConsistency({
    summary: "The push for Web3 standards continues.",
    tags: ["Web 2.0"],
    topics: [],
  });
  assert.ok(out.issues.some((issue) => issue.type === "mismatch"));
});
