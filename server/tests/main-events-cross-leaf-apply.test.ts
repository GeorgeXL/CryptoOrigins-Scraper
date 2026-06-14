import assert from "node:assert/strict";
import test from "node:test";

import {
  assertCrossLeafDbEntryKeepable,
  assertGeminiMainEventApplyable,
  buildCrossLeafManualEntryInputs,
  buildGeminiMainEventManualEntryInputs,
  canKeepCrossLeafDatabaseEntry,
  ensureCrossLeafProposalSummary,
  findCrossLeafProposal,
  geminiMainEventUsedPlaceholderSource,
  resolveCrossLeafProposalSourceUrl,
} from "../../shared/main-events-cross-leaf-apply";
import type { MainEventsCrossLeafDuplicate } from "../../shared/leaf-agent-config";

test("findCrossLeafProposal matches leaf case-insensitively", () => {
  const proposal = findCrossLeafProposal(
    {
      proposals: [
        {
          leaf: "Bailouts and stimulus",
          leafLabel: "Macroeconomy · Bailouts and stimulus",
          event: "US stimulus package announced",
          importance: "landmark",
        },
      ],
    },
    "bailouts and stimulus",
  );

  assert.equal(proposal?.leaf, "Bailouts and stimulus");
});

test("ensureCrossLeafProposalSummary pads short Gemini event text", () => {
  const summary = ensureCrossLeafProposalSummary("Third halving");
  assert.ok(summary.length >= 20);
  assert.match(summary, /Third halving/);
});

test("resolveCrossLeafProposalSourceUrl prefers cached Gemini link", () => {
  const url = resolveCrossLeafProposalSourceUrl({
    date: "2009-02-17",
    proposal: {
      leaf: "Housing",
      sourceUrl: "https://example.com/housing-2009",
    },
  });

  assert.equal(url, "https://example.com/housing-2009");
});

test("resolveCrossLeafProposalSourceUrl falls back to placeholder host", () => {
  const url = resolveCrossLeafProposalSourceUrl({
    date: "2009-02-17",
    proposal: {
      leaf: "Bailouts and stimulus",
    },
  });

  assert.match(url, /^https:\/\/gemini-main-events\.local\//);
  assert.match(url, /2009-02-17$/);
});

test("buildCrossLeafManualEntryInputs wires summary source and topic", () => {
  const inputs = buildCrossLeafManualEntryInputs({
    date: "2009-02-17",
    ownerLeaf: "Housing",
    proposal: {
      leaf: "Housing",
      leafLabel: "Macroeconomy · Housing",
      event: "US housing starts fall to a record low in January 2009",
      importance: "major",
      sourceUrl: "https://example.com/housing",
    },
  });

  assert.equal(inputs.topic, "Housing");
  assert.equal(inputs.sourceUrl, "https://example.com/housing");
  assert.ok(inputs.summary.length >= 20);
  assert.match(inputs.summary, /housing starts/i);
});

test("canKeepCrossLeafDatabaseEntry allows tagged rows on or off Gemini proposals", () => {
  const taggedOffProposal: MainEventsCrossLeafDuplicate = {
    date: "2013-03-18",
    proposals: [
      {
        leaf: "Bitcoin regulation",
        leafLabel: "Policy · Bitcoin regulation",
        event: "FinCEN guidance",
        importance: "landmark",
      },
    ],
    dbStatus: "wrong_leaf",
    dbOwnerLeaf: "Protocol & upgrades",
    dbOwnerLeafLabel: "Bitcoin · Protocol & upgrades",
  };

  assert.equal(canKeepCrossLeafDatabaseEntry(taggedOffProposal), true);
  assert.doesNotThrow(() => assertCrossLeafDbEntryKeepable(taggedOffProposal));
});

test("canKeepCrossLeafDatabaseEntry rejects untagged and locked rows", () => {
  const untagged: MainEventsCrossLeafDuplicate = {
    date: "2024-12-30",
    proposals: [],
    dbStatus: "untagged",
  };

  assert.equal(canKeepCrossLeafDatabaseEntry(untagged), false);
  assert.throws(() => assertCrossLeafDbEntryKeepable(untagged), /No tagged database entry/i);

  const locked: MainEventsCrossLeafDuplicate = {
    date: "2013-03-18",
    proposals: [],
    dbStatus: "wrong_leaf",
    dbOwnerLeaf: "Protocol & upgrades",
    isLocked: true,
  };

  assert.throws(() => assertCrossLeafDbEntryKeepable(locked), /locked/i);
});

test("buildGeminiMainEventManualEntryInputs builds review-panel manual entry", () => {
  const inputs = buildGeminiMainEventManualEntryInputs({
    date: "2012-11-28",
    ownerLeaf: "Halving events",
    event: "First Bitcoin halving block mined",
    sourceUrl: "https://example.com/halving",
  });

  assert.equal(inputs.topic, "Halving events");
  assert.equal(inputs.sourceUrl, "https://example.com/halving");
  assert.ok(inputs.summary.length >= 20);
  assert.match(inputs.summary, /halving/i);
});

test("buildGeminiMainEventManualEntryInputs uses placeholder when source missing", () => {
  const inputs = buildGeminiMainEventManualEntryInputs({
    date: "2012-11-28",
    ownerLeaf: "Halving events",
    event: "First Bitcoin halving block mined on schedule",
  });

  assert.match(inputs.sourceUrl, /^https:\/\/gemini-main-events\.local\//);
  assert.equal(geminiMainEventUsedPlaceholderSource(undefined), true);
  assert.equal(geminiMainEventUsedPlaceholderSource("https://example.com/x"), false);
});

test("assertGeminiMainEventApplyable blocks locked days", () => {
  assert.throws(
    () => assertGeminiMainEventApplyable({ date: "2012-11-28", isLocked: true }),
    /locked/i,
  );
  assert.doesNotThrow(() => assertGeminiMainEventApplyable({ date: "2012-11-28", isLocked: false }));
});
