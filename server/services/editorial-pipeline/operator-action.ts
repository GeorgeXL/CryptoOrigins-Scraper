/**
 * Translates triage reasons into a concrete operator action plan.
 *
 * The pipeline currently emits a flat `reasons: string[]` per review item. That
 * makes the UI show vague messages like "Day marked as orphan" and a generic
 * Approve button that doesn't tell the operator what will actually change.
 *
 * This module recognises a small set of known reasons, classifies each as
 * auto-fixable (Approve flips a DB flag) or manual (operator must open the
 * day), and bundles them into an `OperatorActionPlan` that the API exposes and
 * the writer consumes when an Approve clicks through.
 */

import type { TriageRoute } from "./contracts";

export type TriageReasonCode =
  | "flagged"
  | "orphan_flag"
  | "no_articles_fetched"
  | "weak_summary"
  | "no_winning_article"
  | "low_confidence"
  | "no_taxonomy"
  | "unknown";

export type OperatorAutoFix =
  | { code: "orphan_flag"; label: string }
  | { code: "flagged"; label: string }
  | { code: "low_confidence"; label: string };

export type OperatorManualFix =
  | { code: "weak_summary"; label: string; suggestion: string }
  | { code: "no_winning_article"; label: string; suggestion: string }
  | { code: "no_taxonomy"; label: string; suggestion: string }
  | { code: "no_articles_fetched"; label: string; suggestion: string }
  | { code: "unknown"; label: string; suggestion: string };

export type OperatorActionPlan = {
  route: TriageRoute;
  /** One-liner shown above the card, in plain English. */
  headline: string;
  /** Reasons mapped to codes with their human strings preserved. */
  reasonEntries: Array<{ code: TriageReasonCode; message: string }>;
  /** What Approve will do when clicked. Empty means Approve is a no-op confirmation. */
  autoFixes: OperatorAutoFix[];
  /** Issues the operator must resolve by hand. While any exist, Approve should be disabled. */
  manualFixes: OperatorManualFix[];
  /** Final user-visible description of the Approve button's effect. */
  approveSummary: string;
  /** True when Approve is safe to enable. */
  approveEnabled: boolean;
};

const REASON_PATTERNS: Array<{ code: TriageReasonCode; match: RegExp }> = [
  { code: "flagged", match: /flagged/i },
  { code: "orphan_flag", match: /orphan/i },
  { code: "no_articles_fetched", match: /no fetched articles/i },
  { code: "weak_summary", match: /summary appears weak|too short|too long|failure placeholder|100.?110/i },
  { code: "no_winning_article", match: /winning article|top_article_id/i },
  { code: "low_confidence", match: /low confidence/i },
  { code: "no_taxonomy", match: /topic tags|categor(y|ies) linked/i },
];

function classifyReason(message: string): TriageReasonCode {
  for (const { code, match } of REASON_PATTERNS) {
    if (match.test(message)) return code;
  }
  return "unknown";
}

function buildAutoFix(code: TriageReasonCode): OperatorAutoFix | null {
  switch (code) {
    case "orphan_flag":
      return { code, label: "Clear the orphan flag on this day" };
    case "flagged":
      return { code, label: "Clear the manual flag on this day" };
    case "low_confidence":
      return { code, label: "Acknowledge low confidence (operator override)" };
    default:
      return null;
  }
}

function buildManualFix(code: TriageReasonCode, message: string): OperatorManualFix | null {
  switch (code) {
    case "weak_summary":
      return {
        code,
        label: "Summary is missing or outside 100-110 characters",
        suggestion: "Use Redo summary if a winning article is picked, or edit the summary to 100-110 characters.",
      };
    case "no_winning_article":
      return {
        code,
        label: "No winning article is selected",
        suggestion: "Open the day and pick the article that best represents this date.",
      };
    case "no_taxonomy":
      return {
        code,
        label: "Day has no topic tags or categories",
        suggestion: "Open the day and add at least one topic / tag.",
      };
    case "no_articles_fetched":
      return {
        code,
        label: "No source articles were fetched for this day",
        suggestion: "Reject and rerun with the gated SourceFinder, or open the day and add articles manually.",
      };
    case "unknown":
      return {
        code,
        label: message,
        suggestion: "No automatic fix is known for this reason. Open the day and resolve it manually.",
      };
    default:
      return null;
  }
}

/**
 * Compute the action plan for a triage review item.
 *
 * `daySnapshot` is used to decide whether the route-default headline is still
 * accurate (e.g. `existing_ok` with no reasons means Approve is just an "I
 * looked, it's fine" gesture).
 */
export function computeOperatorActionPlan(input: {
  route: TriageRoute;
  reasons: string[];
  daySnapshot?: {
    hasSummary: boolean;
    hasTopArticle: boolean;
    tagCount: number;
  };
}): OperatorActionPlan {
  // For the happy route, reasons are just informational success messages
  // ("Quality checks passed…") — never treat them as faults.
  const isHealthyRoute = input.route === "existing_ok";
  const reasonEntries = input.reasons.map((message) => ({
    code: isHealthyRoute ? ("unknown" as TriageReasonCode) : classifyReason(message),
    message,
  }));

  const autoFixes: OperatorAutoFix[] = [];
  const manualFixes: OperatorManualFix[] = [];
  if (!isHealthyRoute) {
    for (const entry of reasonEntries) {
      const auto = buildAutoFix(entry.code);
      if (auto) {
        autoFixes.push(auto);
        continue;
      }
      const manual = buildManualFix(entry.code, entry.message);
      if (manual) manualFixes.push(manual);
    }
  }

  // Route-level headline & approve copy.
  let headline: string;
  let approveSummary: string;
  let approveEnabled: boolean;

  if (input.route === "existing_ok") {
    headline = "Day passes all checks";
    approveSummary = "Approve marks this day as reviewed. Nothing about the data changes.";
    approveEnabled = true;
  } else if (input.route === "missing_day" || input.route === "empty_day") {
    headline =
      input.route === "missing_day" ? "No analysis exists for this day yet" : "Day has no usable analysis yet";
    approveSummary =
      "When v3 gated fetch is enabled this card shows article candidates; otherwise Approve schedules the legacy re-analyze flow.";
    approveEnabled = true;
  } else {
    // existing_needs_correction
    if (autoFixes.length && manualFixes.length === 0) {
      headline = "Day is fine, just a few flags to clear";
      const labels = autoFixes.map((f) => f.label.toLowerCase()).join("; ");
      approveSummary = `Approve will: ${labels}.`;
      approveEnabled = true;
    } else if (autoFixes.length && manualFixes.length > 0) {
      headline = "Day needs both flag-clears and manual fixes";
      approveSummary = `Approve cannot finish this day — ${manualFixes.length} issue(s) need manual action below. Fix them first, then re-run.`;
      approveEnabled = false;
    } else if (manualFixes.length > 0) {
      headline = "Day needs manual fixes before it can be approved";
      approveSummary = `Approve is disabled — ${manualFixes.length} issue(s) need manual action below.`;
      approveEnabled = false;
    } else {
      headline = "Day is flagged but no specific fix was recognised";
      approveSummary = "Approve marks the queue item reviewed. The underlying day will not change.";
      approveEnabled = true;
    }
  }

  return {
    route: input.route,
    headline,
    reasonEntries,
    autoFixes,
    manualFixes,
    approveSummary,
    approveEnabled,
  };
}
