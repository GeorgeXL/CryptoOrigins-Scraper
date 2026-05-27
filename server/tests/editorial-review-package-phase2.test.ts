import assert from "node:assert/strict";
import test from "node:test";

import {
  reviewPackageSchema,
  isCorrectionApprovalPackage,
  isSummaryApprovalPackage,
  isCalendarDecisionPackage,
  isDuplicateDecisionPackage,
} from "../services/editorial-pipeline/review-package";
import { determineApprovedAction } from "../services/editorial-pipeline/approved-writer";

const triage = {
  date: "2024-11-24",
  analysisId: "9d6f7c12-2b3e-4a55-9c66-2f0b5e7c1abc",
  route: "existing_needs_correction" as const,
  reasons: ["Day marked as orphan"],
  requiredAgents: ["NewsManager" as const, "TagManagerAgent" as const],
  confidence: 0.86,
};

test("correction approval package parses + dispatches to apply_correction_proposals", () => {
  const pkg = {
    phase: "awaiting_correction_approval" as const,
    triage,
    proposals: [
      {
        id: "2024-11-24:promote_v1_to_v2_tags",
        kind: "promote_v1_to_v2_tags" as const,
        current: ["Bitcoin"],
        proposed: ["Bitcoin", "Cboe", "Bitcoin index options"],
        rationale: "Found 2 legacy tag(s) not in v2",
      },
      {
        id: "2024-11-24:clear_orphan_flag",
        kind: "clear_orphan_flag" as const,
        rationale: "Day was manually picked.",
      },
    ],
  };
  const parsed = reviewPackageSchema.safeParse(pkg);
  assert.ok(parsed.success);
  assert.ok(isCorrectionApprovalPackage(pkg));
  const out = determineApprovedAction(pkg);
  assert.equal(out.action?.kind, "apply_correction_proposals");
});

test("summary approval package parses + dispatches", () => {
  const pkg = {
    phase: "awaiting_summary_approval" as const,
    triage: { ...triage, route: "missing_day" as const, reasons: ["No analysis exists for this day"] },
    winningArticle: {
      id: "art-1",
      title: "Bitcoin reaches new high",
      url: "https://example.com/btc",
      tier: "bitcoin" as const,
    },
    generatedSummary: "Bitcoin breaks records driven by ETF inflows pushing institutional adoption forward at full pace today",
    proposedTags: ["Bitcoin", "ETF"],
    proposedTopics: ["price", "institutional"],
  };
  const parsed = reviewPackageSchema.safeParse(pkg);
  assert.ok(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.format()));
  assert.ok(isSummaryApprovalPackage(pkg));
  const out = determineApprovedAction(pkg);
  assert.equal(out.action?.kind, "apply_summary_approval");
});

test("calendar decision package parses + dispatches", () => {
  const pkg = {
    phase: "awaiting_calendar_decision" as const,
    triage: { ...triage, date: "2020-05-23", reasons: ["Canonical date mismatch"] },
    currentDate: "2020-05-23",
    expectedDate: "2010-05-22",
    ruleId: "bitcoin-pizza-day",
    reason: "Bitcoin Pizza Day…",
    canonicalDateOccupied: false,
  };
  const parsed = reviewPackageSchema.safeParse(pkg);
  assert.ok(parsed.success);
  assert.ok(isCalendarDecisionPackage(pkg));
  const out = determineApprovedAction(pkg);
  assert.equal(out.action?.kind, "apply_calendar_decision");
});

test("correction proposal: drop_ungrounded_tags shape parses", () => {
  const pkg = {
    phase: "awaiting_correction_approval" as const,
    triage,
    proposals: [
      {
        id: "x:drop_ungrounded_tags",
        kind: "drop_ungrounded_tags" as const,
        proposedDrop: ["Belgium"],
        suggestedFocusTags: ["Russia", "WTO"],
        rationale: "Belgium not in summary",
      },
    ],
  };
  assert.ok(reviewPackageSchema.safeParse(pkg).success);
});

test("correction proposal: edit_summary shape parses", () => {
  const pkg = {
    phase: "awaiting_correction_approval" as const,
    triage,
    proposals: [
      {
        id: "x:edit_summary",
        kind: "edit_summary" as const,
        currentSummary: "Bitcoin Pizza Day",
        targetMin: 100,
        targetMax: 110,
        rationale: "Manual known event needs a 100-110 character summary",
      },
    ],
  };
  assert.ok(reviewPackageSchema.safeParse(pkg).success);
});


test("correction proposal: merge_redundant_tags shape parses", () => {
  const pkg = {
    phase: "awaiting_correction_approval" as const,
    triage,
    proposals: [
      {
        id: "x:merge_redundant_tags",
        kind: "merge_redundant_tags" as const,
        merges: [{ from: "Schnorr signatures", to: "Schnorr" }],
        rationale: "redundant tag pair",
      },
    ],
  };
  assert.ok(reviewPackageSchema.safeParse(pkg).success);
});

test("duplicate decision package parses + dispatches", () => {
  const pkg = {
    phase: "awaiting_duplicate_decision" as const,
    triage,
    focal: {
      date: "2024-11-24",
      summaryPreview: "Cboe launches…",
      tags: ["Bitcoin"],
      topics: ["adoption"],
    },
    neighbors: [
      {
        date: "2024-11-25",
        summaryPreview: "Cboe announcement reverberates…",
        sharedTags: ["Bitcoin"],
        sharedTopics: ["adoption"],
        tokenJaccard: 0.91,
      },
    ],
  };
  const parsed = reviewPackageSchema.safeParse(pkg);
  assert.ok(parsed.success);
  assert.ok(isDuplicateDecisionPackage(pkg));
  const out = determineApprovedAction(pkg);
  assert.equal(out.action?.kind, "apply_duplicate_decision");
});
