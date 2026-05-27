import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCanonicalTagIndex,
  canonicaliseAgainstIndex,
  findGroundedTaxonomyTagsMissingFromRow,
  findRedundantTagPairs,
  findUngroundedTags,
  groundAndCanonicaliseTags,
  isTagGroundedInTexts,
} from "../services/editorial-pipeline/tag-grounding";

test("isTagGroundedInTexts: exact whole-word match grounds the tag", () => {
  const text = "Russia joins the WTO after negotiations, lowering tariffs and opening new investment opportunities.";
  assert.equal(isTagGroundedInTexts("Russia", [text]), true);
  assert.equal(isTagGroundedInTexts("WTO", [text]), true);
});

test("isTagGroundedInTexts: unrelated tag is NOT grounded (Belgium on Russia/WTO)", () => {
  const text = "Russia joins the WTO after negotiations, lowering tariffs and opening new investment opportunities.";
  assert.equal(isTagGroundedInTexts("Belgium", [text]), false);
});

test("isTagGroundedInTexts: ungrounded entity rejected (Mitch McConnell on TARP)", () => {
  const text = "Companies receiving bailout money donate generously to political candidates primarily benefiting Republicans.";
  assert.equal(isTagGroundedInTexts("Mitch McConnell", [text]), false);
  assert.equal(isTagGroundedInTexts("Republicans", [text]), true);
});

test("isTagGroundedInTexts: multi-word tag must appear as contiguous tokens", () => {
  const text = "Bank of America announced new policy.";
  assert.equal(isTagGroundedInTexts("Bank of America", [text]), true);
  assert.equal(isTagGroundedInTexts("Bank policy", [text]), false);
});

test("canonicaliseAgainstIndex: exact match returns existing canonical", () => {
  const idx = buildCanonicalTagIndex(["Schnorr", "Taproot", "Bitcoin"]);
  const hit = canonicaliseAgainstIndex("schnorr", idx);
  assert.ok(hit);
  assert.equal(hit?.canonical, "Schnorr");
  assert.equal(hit?.reason, "exact");
});

test("canonicaliseAgainstIndex: 'Schnorr signatures' collapses to existing 'Schnorr' canonical", () => {
  const idx = buildCanonicalTagIndex(["Schnorr", "Taproot", "Bitcoin"]);
  const hit = canonicaliseAgainstIndex("Schnorr signatures", idx);
  assert.ok(hit);
  assert.equal(hit?.canonical, "Schnorr");
  assert.equal(hit?.reason, "merge_into_shorter");
});

test("canonicaliseAgainstIndex: unrelated proposal returns null", () => {
  const idx = buildCanonicalTagIndex(["Schnorr", "Taproot"]);
  assert.equal(canonicaliseAgainstIndex("Belgium", idx), null);
});

test("groundAndCanonicaliseTags: drops ungrounded + merges redundant + dedupes", () => {
  const idx = buildCanonicalTagIndex(["Schnorr", "Bitcoin", "Russia"]);
  const result = groundAndCanonicaliseTags({
    proposed: ["Russia", "WTO", "Belgium", "Schnorr signatures", "Schnorr", "Bitcoin"],
    texts: ["Russia joins the WTO. Bitcoin Schnorr signatures shipped."],
    index: idx,
  });
  assert.deepEqual(result.kept.sort(), ["Bitcoin", "Russia", "Schnorr", "WTO"].sort());
  assert.ok(result.dropped.some((d) => d.name === "Belgium" && d.reason === "ungrounded"));
  assert.ok(result.merged.some((m) => m.from === "Schnorr signatures" && m.to === "Schnorr"));
});

test("groundAndCanonicaliseTags: skips grounding when no texts provided", () => {
  const idx = buildCanonicalTagIndex(["Bitcoin"]);
  const result = groundAndCanonicaliseTags({
    proposed: ["Bitcoin", "Anything"],
    texts: [],
    index: idx,
  });
  assert.deepEqual(result.kept.sort(), ["Anything", "Bitcoin"].sort());
});

test("findGroundedTaxonomyTagsMissingFromRow: surfaces taxonomy names in text not on row", () => {
  const idx = buildCanonicalTagIndex(["Russia", "WTO", "Belgium", "tariffs"]);
  const text =
    "Russia joins the WTO after negotiations, lowering tariffs and opening new investment opportunities for foreign firms.";
  const hints = findGroundedTaxonomyTagsMissingFromRow({
    texts: [text],
    currentTags: ["industry-news", "Belgium"],
    index: idx,
    limit: 12,
  });
  assert.ok(hints.includes("Russia"));
  assert.ok(hints.includes("WTO"));
  assert.ok(!hints.includes("Belgium"));
});

test("findGroundedTaxonomyTagsMissingFromRow: does not propose fragments of full entity tags already on row", () => {
  const idx = buildCanonicalTagIndex(["Bitcoin", "Satoshi", "Nakamoto", "Satoshi Nakamoto", "Bank of America", "America"]);
  const hints = findGroundedTaxonomyTagsMissingFromRow({
    texts: ["Satoshi Nakamoto cites Bank of America while discussing Bitcoin."],
    currentTags: ["Bitcoin", "Satoshi Nakamoto", "Bank of America"],
    index: idx,
    limit: 12,
  });
  assert.ok(!hints.includes("Satoshi"));
  assert.ok(!hints.includes("Nakamoto"));
  assert.ok(!hints.includes("America"));
});

test("findGroundedTaxonomyTagsMissingFromRow: ignores possessive taxonomy artifacts", () => {
  const idx = buildCanonicalTagIndex(["Japan", "Japan's", "Bitcoin"]);
  const hints = findGroundedTaxonomyTagsMissingFromRow({
    texts: ["Japan's reserves shift while Bitcoin keeps trading."],
    currentTags: ["Bitcoin", "Japan"],
    index: idx,
    limit: 12,
  });
  assert.ok(!hints.includes("Japan's"));
});

test("findUngroundedTags: flags tags missing from summary+article", () => {
  const ungrounded = findUngroundedTags(
    ["Russia", "WTO", "Belgium"],
    ["Russia joins the WTO."],
  );
  assert.deepEqual(ungrounded, ["Belgium"]);
});

test("findRedundantTagPairs: surfaces shorter-canonical merges within a single tag list", () => {
  const pairs = findRedundantTagPairs(["Bitcoin", "Schnorr", "Schnorr signatures"]);
  assert.deepEqual(pairs, [{ from: "Schnorr signatures", to: "Schnorr" }]);
});

test("findRedundantTagPairs: no false positives on truly distinct tags", () => {
  const pairs = findRedundantTagPairs(["Bitcoin", "Ethereum", "Solana"]);
  assert.deepEqual(pairs, []);
});

test("findRedundantTagPairs: does not collapse suffix fragments from organization names", () => {
  const pairs = findRedundantTagPairs(["Royal Bank of Scotland", "Scotland", "Bank of America", "America"]);
  assert.deepEqual(pairs, []);
});
