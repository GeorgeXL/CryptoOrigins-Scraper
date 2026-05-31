/**
 * On-demand day verification — deterministic checks plus optional full corpus-clean pass.
 */
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { historicalNewsAnalyses } from "@shared/schema";
import { evaluateCorpusDay } from "./corpus-clean";
import {
  EDITORIAL_SUMMARY_TARGET_MAX,
  EDITORIAL_SUMMARY_TARGET_MIN,
  evaluateSummaryQuality,
  isValidPipelineTopArticleId,
} from "./editorial-quality";
import { findUngroundedTags } from "./tag-grounding";
import { resolveKnownEventContext } from "./known-event-context";
import { getExistingVerificationSignals, normalizedTagsFromRow, topicLabelsFromRow } from "./tools";
import { invalidTopicReasons } from "./topic-validation";

export type VerificationCheckStatus = "pass" | "warn" | "fail";

export type VerificationCheck = {
  id: string;
  label: string;
  status: VerificationCheckStatus;
  message: string;
};

export type DayVerificationResult = {
  date: string;
  mode: "quick" | "full";
  passed: boolean;
  checks: VerificationCheck[];
  summaryPreview: string | null;
  topics: string[];
  tags: string[];
  corpusPhase?: string;
  wouldQueue?: string[];
  storedVerification?: {
    geminiApproved: boolean | null;
    perplexityApproved: boolean | null;
    factCheckVerdict: string | null;
    perplexityVerdict: string | null;
  } | null;
  knownEvent?: {
    isKnownEvent: boolean;
    kind: string | null;
    label: string | null;
    explanation: string | null;
  } | null;
};

function pushCheck(
  checks: VerificationCheck[],
  check: VerificationCheck,
): void {
  checks.push(check);
}

export async function verifyEditorialDay(opts: {
  date: string;
  mode?: "quick" | "full";
}): Promise<DayVerificationResult> {
  const mode = opts.mode ?? "quick";
  const checks: VerificationCheck[] = [];

  const [row] = await db
    .select()
    .from(historicalNewsAnalyses)
    .where(eq(historicalNewsAnalyses.date, opts.date))
    .limit(1);

  if (!row) {
    pushCheck(checks, {
      id: "row_exists",
      label: "Database row",
      status: "fail",
      message: "No analysis row for this date.",
    });
    return {
      date: opts.date,
      mode,
      passed: false,
      checks,
      summaryPreview: null,
      topics: [],
      tags: [],
    };
  }

  pushCheck(checks, {
    id: "row_exists",
    label: "Database row",
    status: "pass",
    message: "Analysis row exists.",
  });

  const summary = String(row.summary ?? "").trim();
  const topics = topicLabelsFromRow(row.topicCategories);
  const tags = normalizedTagsFromRow(row.tagsVersion2);
  const knownEvent = await resolveKnownEventContext(opts.date);

  const summaryIssue = evaluateSummaryQuality(summary);
  if (summaryIssue) {
    pushCheck(checks, {
      id: "summary_length",
      label: "Summary length",
      status: "fail",
      message: summaryIssue.message,
    });
  } else {
    pushCheck(checks, {
      id: "summary_length",
      label: "Summary length",
      status: "pass",
      message: `Summary is ${summary.length} chars (${EDITORIAL_SUMMARY_TARGET_MIN}–${EDITORIAL_SUMMARY_TARGET_MAX}).`,
    });
  }

  if (isValidPipelineTopArticleId(row.topArticleId)) {
    pushCheck(checks, {
      id: "top_article",
      label: "Winning article",
      status: "pass",
      message: "top_article_id is set.",
    });
  } else if (knownEvent.isKnownEvent) {
    pushCheck(checks, {
      id: "top_article",
      label: "Winning article",
      status: "pass",
      message: knownEvent.explanation ?? "Known/manual event — no article required.",
    });
  } else if (summary.length > 0) {
    pushCheck(checks, {
      id: "top_article",
      label: "Winning article",
      status: "warn",
      message: "No valid top_article_id — manual/known event or article pick still needed.",
    });
  }

  const topicIssues = invalidTopicReasons(topics);
  if (topicIssues.length === 0 && topics.length === 1) {
    pushCheck(checks, {
      id: "topic_hierarchy",
      label: "Storyline topic",
      status: "pass",
      message: `Exactly one valid leaf: ${topics[0]}.`,
    });
  } else if (topics.length === 0) {
    pushCheck(checks, {
      id: "topic_hierarchy",
      label: "Storyline topic",
      status: "fail",
      message: "No topic assigned.",
    });
  } else {
    pushCheck(checks, {
      id: "topic_hierarchy",
      label: "Storyline topic",
      status: "fail",
      message: topicIssues.join("; ") || "Topic hierarchy invalid.",
    });
  }

  if (summary.length > 0 && tags.length > 0) {
    const ungrounded = findUngroundedTags(tags, [summary]);
    if (ungrounded.length === 0) {
      pushCheck(checks, {
        id: "tags_grounded",
        label: "Tags grounded",
        status: "pass",
        message: `${tags.length} tag(s) appear grounded in the summary.`,
      });
    } else {
      pushCheck(checks, {
        id: "tags_grounded",
        label: "Tags grounded",
        status: "fail",
        message: `Ungrounded tag(s): ${ungrounded.slice(0, 6).join(", ")}${ungrounded.length > 6 ? "…" : ""}.`,
      });
    }
  } else if (tags.length === 0 && summary.length > 0) {
    pushCheck(checks, {
      id: "tags_grounded",
      label: "Tags grounded",
      status: "warn",
      message: "Summary exists but no v2 tags on the row.",
    });
  }

  const signals = await getExistingVerificationSignals(opts.date);
  if (signals) {
    const hasStored =
      signals.geminiApproved != null ||
      signals.perplexityApproved != null ||
      signals.factCheckVerdict != null ||
      signals.perplexityVerdict != null;
    if (hasStored) {
      const approved =
        signals.geminiApproved === true ||
        signals.perplexityApproved === true ||
        signals.factCheckVerdict === "Valid" ||
        signals.perplexityVerdict === "Valid";
      pushCheck(checks, {
        id: "stored_verification",
        label: "Stored fact-check signals",
        status: approved ? "pass" : "warn",
        message: approved
          ? "Legacy Gemini/Perplexity/fact-check signals look positive."
          : "Stored verification signals exist but are not clearly approved.",
      });
    }
  }

  let corpusPhase: string | undefined;
  let wouldQueue: string[] | undefined;

  if (mode === "full") {
    const eval_ = await evaluateCorpusDay(opts.date);
    if (eval_) {
      corpusPhase = eval_.phase;
      wouldQueue = eval_.wouldQueueForHuman;
      if (eval_.phase === "auto_pass") {
        pushCheck(checks, {
          id: "pipeline_eval",
          label: "Pipeline evaluation",
          status: "pass",
          message: "Corpus-clean graph reports auto_pass — no manual queue items.",
        });
      } else {
        pushCheck(checks, {
          id: "pipeline_eval",
          label: "Pipeline evaluation",
          status: "fail",
          message: `Phase ${eval_.phase}${wouldQueue.length ? `: ${wouldQueue.slice(0, 4).join("; ")}` : ""}.`,
        });
      }
    }
  }

  const passed = checks.every((c) => c.status !== "fail");

  return {
    date: opts.date,
    mode,
    passed,
    checks,
    summaryPreview: summary.slice(0, 120) || null,
    topics,
    tags,
    corpusPhase,
    wouldQueue,
    storedVerification: signals
      ? {
          geminiApproved: signals.geminiApproved,
          perplexityApproved: signals.perplexityApproved,
          factCheckVerdict: signals.factCheckVerdict,
          perplexityVerdict: signals.perplexityVerdict,
        }
      : null,
    knownEvent: knownEvent.isKnownEvent
      ? {
          isKnownEvent: true,
          kind: knownEvent.kind,
          label: knownEvent.label,
          explanation: knownEvent.explanation,
        }
      : null,
  };
}
