import { buildStepOutput, type PipelineAgentName, type TriageItem } from "./contracts";
import { evaluateDateConsistencyForDay } from "./date-consistency-llm";
import {
  evaluateTagConsistency,
  getEditorialDuplicateNeighborContext,
  getExistingDay,
  getExistingVerificationSignals,
  getDayTaxonomy,
  getTagCoverageForDate,
  topicLabelsFromRow,
  normalizedTagsFromRow,
  runExistingSearchAndSummaryForDate,
  type TaxonomyDuplicateNeighbor,
} from "./tools";
import { detectMilestoneGapsInWindow } from "./milestones";
import { evaluateSummaryQuality, isEditorialSummaryWeak, isValidPipelineTopArticleId } from "./editorial-quality";
import { evaluateRelevanceWithAgent, relevanceOperatorNote, relevanceRequiresArticlePick } from "./relevance-agent";
import { evaluateSummaryWithAgent } from "./summary-agent";
import { invalidTopicReasons } from "./topic-validation";
import { suggestTopicsWithAgent } from "./topic-agent";

export type ExecutorContext = {
  runId: string;
  triageItem: TriageItem;
};

export type ExecutorResult = {
  status: "completed" | "rejected" | "skipped" | "error";
  confidence?: number;
  output: ReturnType<typeof buildStepOutput>;
  evidence?: Record<string, unknown>;
};

type AgentExecutor = (ctx: ExecutorContext) => Promise<ExecutorResult>;

const newsManagerAgent: AgentExecutor = async (ctx) => ({
  status: "completed",
  confidence: ctx.triageItem.confidence,
  output: buildStepOutput({
    summary: "Triage routed the day into the editorial cleanup chain",
    findings: [
      `Route=${ctx.triageItem.route}`,
      `Required checks=${ctx.triageItem.requiredAgents.filter((agent) => agent !== "NewsManager").join(" -> ")}`,
      ...ctx.triageItem.reasons.slice(0, 5),
    ],
    handoff: {
      analysisId: ctx.triageItem.analysisId,
      date: ctx.triageItem.date,
      status: "needs_review",
      confidence: ctx.triageItem.confidence,
      reason: ctx.triageItem.reasons.join("; "),
      nextAgent: ctx.triageItem.requiredAgents.find((agent) => agent !== "NewsManager"),
      metadata: {
        route: ctx.triageItem.route,
        requiredAgents: ctx.triageItem.requiredAgents,
      },
    },
  }),
});

const relevanceCheckerAgent: AgentExecutor = async (ctx) => {
  const existing = await getExistingDay(ctx.triageItem.date);
  if (!existing) {
    return {
      status: "skipped",
      confidence: 0.5,
      output: buildStepOutput({
        summary: "No persisted day yet for relevance validation",
        findings: ["SourceFinder must produce a candidate before relevance can be checked."],
      }),
    };
  }

  const summaryIssue = evaluateSummaryQuality(existing.summary);
  const validArticle = isValidPipelineTopArticleId(existing.topArticleId);
  if (summaryIssue || !validArticle) {
    return {
      status: "rejected",
      confidence: 0.66,
      output: buildStepOutput({
        summary: "Candidate event is not ready for relevance approval",
        findings: [
          summaryIssue?.message ?? "Summary length/content passed",
          validArticle ? "Winning article id is present" : "Winning article id is missing or placeholder",
        ],
        rejection: {
          status: "rejected",
          agent: "RelevanceCheckerAgent",
          reason: summaryIssue?.message ?? "No valid winning article for relevance check",
          confidence: 0.66,
          suggestedAction: "retry_with_new_source",
          returnTo: "NewsManager",
        },
      }),
    };
  }

  const tax = await getDayTaxonomy(ctx.triageItem.date);
  const relevance = await evaluateRelevanceWithAgent({
    date: ctx.triageItem.date,
    summary: String(existing.summary ?? "").trim(),
    tags: normalizedTagsFromRow(tax?.tagsVersion2),
    topics: topicLabelsFromRow(tax?.topicCategories),
    topArticleId: existing.topArticleId,
  });

  if (relevanceRequiresArticlePick(relevance)) {
    return {
      status: "rejected",
      confidence: relevance.confidence === "high" ? 0.82 : 0.68,
      output: buildStepOutput({
        summary: "Relevance Agent flagged weak or off-topic story",
        findings: [`classification=${relevance.classification}`],
        rejection: {
          status: "rejected",
          agent: "RelevanceCheckerAgent",
          reason: relevanceOperatorNote(relevance.classification),
          confidence: relevance.confidence === "high" ? 0.82 : 0.68,
          suggestedAction: "retry_with_new_source",
          returnTo: "NewsManager",
        },
      }),
      evidence: { relevance },
    };
  }

  return {
    status: "completed",
    confidence: 0.82,
    output: buildStepOutput({
      summary: "Candidate event has a usable article and editorial summary",
      findings: [
        `top_article_id=${existing.topArticleId}`,
        `summary chars=${existing.summary.length}`,
      ],
    }),
  };
};

const milestoneAgent: AgentExecutor = async (ctx) => {
  const gaps = await detectMilestoneGapsInWindow(ctx.triageItem.date, ctx.triageItem.date);
  const critical = gaps.length > 0 || ctx.triageItem.route === "missing_day" || ctx.triageItem.route === "empty_day";
  return {
    status: "completed",
    confidence: critical ? 0.9 : 0.7,
    output: buildStepOutput({
      summary: "Milestone integrity check complete",
      findings: critical
        ? [
            "Potential milestone gap, prioritize review",
            ...gaps.map((g) => `${g.slug}:${g.issue}`),
          ]
        : ["No critical milestone gap signal"],
    }),
  };
};

const sourceFinderAgent: AgentExecutor = async (ctx) => {
  if (ctx.triageItem.route === "existing_ok") {
    return {
      status: "skipped",
      confidence: 1,
      output: buildStepOutput({
        summary: "Skipped source discovery for healthy day",
        findings: ["Route existing_ok"],
      }),
    };
  }

  const discovered = await runExistingSearchAndSummaryForDate(ctx.triageItem.date);
  if (isEditorialSummaryWeak(discovered.summary)) {
    return {
      status: "rejected",
      confidence: 0.55,
      output: buildStepOutput({
        rejection: {
          status: "rejected",
          agent: "SourceFinderAgent",
          reason:
            "Summary is still missing, too short, or a failure placeholder after the search/summarize pass — cannot treat this day as ready.",
          confidence: 0.55,
          suggestedAction: "manual_review",
          returnTo: "NewsManager",
        },
      }),
    };
  }
  return {
    status: "completed",
    confidence: Math.min(0.99, Math.max(0.4, discovered.confidenceScore / 100)),
    output: buildStepOutput({
      summary: "Used existing search/summarization pipeline",
      findings: [
        `Fetched articles: ${discovered.totalArticlesFetched}`,
        `Summary chars: ${discovered.summary.length}`,
      ],
    }),
    evidence: {
      sourceType: "existing-news-analyzer",
      totalArticlesFetched: discovered.totalArticlesFetched,
    },
  };
};

function verificationAgreementPercent(signals: {
  factCheckConfidence: string | null;
  perplexityConfidence: string | null;
  confidenceScore: string | null;
}): number {
  const raw = signals.factCheckConfidence ?? signals.perplexityConfidence ?? signals.confidenceScore;
  if (raw == null) return 70;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 70;
}

const verificationAgent: AgentExecutor = async (ctx) => {
  const signals = await getExistingVerificationSignals(ctx.triageItem.date);
  if (!signals) {
    return {
      status: "rejected",
      confidence: 0.65,
      output: buildStepOutput({
        rejection: {
          status: "rejected",
          agent: "VerificationAgent",
          reason: "No verification signals found for date",
          confidence: 0.65,
          suggestedAction: "retry_with_new_source",
          returnTo: "NewsManager",
        },
      }),
    };
  }
  const pct = verificationAgreementPercent(signals);
  return {
    status: "completed",
    confidence: Math.min(1, Math.max(0, pct / 100)),
    output: buildStepOutput({
      summary: "Verification pass completed from existing verification signals",
      findings: [
        `factCheckVerdict=${signals.factCheckVerdict ?? "unknown"}`,
        `perplexityVerdict=${signals.perplexityVerdict ?? "unknown"}`,
        `geminiApproved=${signals.geminiApproved === null ? "unknown" : String(signals.geminiApproved)}`,
        `perplexityApproved=${signals.perplexityApproved === null ? "unknown" : String(signals.perplexityApproved)}`,
      ],
    }),
  };
};

const summaryAgent: AgentExecutor = async (ctx) => {
  const existing = await getExistingDay(ctx.triageItem.date);
  if (!existing) {
    return {
      status: "rejected",
      confidence: 0.7,
      output: buildStepOutput({
        rejection: {
          status: "rejected",
          agent: "SummaryAgent",
          reason: "No day exists to summarize",
          confidence: 0.7,
          suggestedAction: "retry_with_new_source",
          returnTo: "NewsManager",
        },
      }),
    };
  }

  const evaluation = await evaluateSummaryWithAgent({
    date: ctx.triageItem.date,
    summary: String(existing.summary ?? "").trim(),
    topArticleId: existing.topArticleId,
    knownEvent: await (async () => {
      const { resolveKnownEventContext } = await import("./known-event-context");
      return resolveKnownEventContext(ctx.triageItem.date);
    })(),
  });

  if (!evaluation.publishable || evaluation.needsRegeneration) {
    const canRegen = isValidPipelineTopArticleId(existing.topArticleId);
    return {
      status: "rejected",
      confidence: evaluation.confidence === "high" ? 0.8 : 0.62,
      output: buildStepOutput({
        summary: "Summary needs regen or edit before publish",
        findings: [
          ...evaluation.issues.slice(0, 3),
          ...(evaluation.suggestedSummary ? [`Suggested: ${evaluation.suggestedSummary}`] : []),
          canRegen ? "Regenerate from winning article." : "Edit summary inline.",
        ],
        rejection: {
          status: "rejected",
          agent: "SummaryAgent",
          reason: evaluation.issues[0] ?? "Summary outside 100–110 chars.",
          confidence: evaluation.confidence === "high" ? 0.8 : 0.62,
          suggestedAction: canRegen ? "manual_review" : "manual_review",
          returnTo: "NewsManager",
        },
      }),
      evidence: { summaryAgent: evaluation },
    };
  }

  if (!isValidPipelineTopArticleId(existing.topArticleId)) {
    const { resolveKnownEventContext } = await import("./known-event-context");
    const knownEvent = await resolveKnownEventContext(ctx.triageItem.date);
    if (!knownEvent.isKnownEvent) {
      return {
        status: "rejected",
        confidence: 0.62,
        output: buildStepOutput({
          rejection: {
            status: "rejected",
            agent: "SummaryAgent",
            reason: "No valid winning article (top_article_id) on this day",
            confidence: 0.62,
            suggestedAction: "manual_review",
            returnTo: "NewsManager",
          },
        }),
      };
    }
  }
  return {
    status: "completed",
    confidence: 0.82,
    output: buildStepOutput({
      summary: "Summary Agent validated editorial summary",
      findings: [evaluation.reason, `Existing summary length=${existing.summary.length}`],
    }),
    evidence: { summaryAgent: evaluation },
  };
};

const topicManagerAgent: AgentExecutor = async (ctx) => {
  const row = await getDayTaxonomy(ctx.triageItem.date);
  if (!row) {
    return {
      status: "skipped",
      confidence: 0.5,
      output: buildStepOutput({
        summary: "No analysis row for topic review",
        findings: ["Missing historical_news_analyses row for this date"],
      }),
    };
  }

  const topics = topicLabelsFromRow(row.topicCategories);
  const rawTopicCount = Array.isArray(row.topicCategories) ? row.topicCategories.length : 0;
  const issues = invalidTopicReasons(topics);
  const gaps = [...issues];
  if (rawTopicCount > 0 && topics.length === 0) {
    gaps.push("topic_categories has entries but no readable storyline label (expected name, label, or slug)");
  }

  if (issues.length === 0) {
    return {
      status: "completed",
      confidence: 0.88,
      output: buildStepOutput({
        summary: "Topic hierarchy check passed — exactly one homepage storyline leaf",
        findings: [`Assigned storyline: ${topics[0]}`],
      }),
      evidence: { topics, rawTopicCount },
    };
  }

  const summary = String((await getExistingDay(ctx.triageItem.date))?.summary ?? "").trim();
  const tags = normalizedTagsFromRow(row.tagsVersion2);
  let agentFindings: string[] = [];
  let agentEvidence: Record<string, unknown> = {};

  if (summary) {
    const agent = await suggestTopicsWithAgent({
      date: ctx.triageItem.date,
      summary,
      tags,
      currentTopics: topics,
    });
    agentFindings = agent.proposed.length
      ? [
          agent.proposed.length === 1
            ? `Pick: ${agent.proposed[0]}`
            : `Pick one: ${agent.proposed.join(" · ")}`,
        ]
      : ["Pick a storyline leaf"];
    agentEvidence = {
      topicAgentSource: agent.source,
      topicAgentConfidence: agent.confidence,
      topicAgentProposed: agent.proposed,
      topicAgentReason: agent.reason.trim() || undefined,
      duplicateRisk: agent.duplicateRisk,
    };
  }

  return {
    status: "rejected",
    confidence: 0.42,
    output: buildStepOutput({
      summary: "Topic hierarchy failed — Topic Agent suggestions attached for human review",
      findings: [...gaps, ...agentFindings],
      rejection: {
        status: "rejected",
        agent: "TopicValidatorAgent",
        reason: gaps.join("; "),
        confidence: 0.42,
        suggestedAction: "manual_review",
        returnTo: "NewsManager",
      },
    }),
    evidence: { topics, rawTopicCount, issues, ...agentEvidence },
  };
};

function isStrongTaxonomyNearDuplicate(n: TaxonomyDuplicateNeighbor): boolean {
  const j = n.tokenJaccard;
  const st = n.sharedTags.length;
  const sp = n.sharedTopics.length;
  if (j >= 0.92 && st >= 1) return true;
  if (j >= 0.84 && st >= 2) return true;
  if (j >= 0.8 && st >= 2 && sp >= 1) return true;
  if (j >= 0.76 && st >= 3) return true;
  return false;
}

const duplicateCheckerAgent: AgentExecutor = async (ctx) => {
  if (!ctx.triageItem.analysisId) {
    return {
      status: "skipped",
      confidence: 0.88,
      output: buildStepOutput({
        summary: "Duplicate check skipped — no analysis id",
        findings: ["DuplicateCheckerAgent expects a persisted analysis row"],
      }),
    };
  }

  const context = await getEditorialDuplicateNeighborContext({
    date: ctx.triageItem.date,
    analysisId: ctx.triageItem.analysisId,
  });

  if (!context) {
    return {
      status: "skipped",
      confidence: 0.85,
      output: buildStepOutput({
        summary: "No focal analysis row for taxonomy duplicate scan",
        findings: ["Missing or mismatched historical_news_analyses row"],
      }),
    };
  }

  const strong = context.neighbors.find(isStrongTaxonomyNearDuplicate);
  if (strong) {
    return {
      status: "rejected",
      confidence: 0.88,
      output: buildStepOutput({
        summary: "Near-duplicate of another calendar day (tags/topics + summary similarity)",
        findings: [
          `Strong overlap with ${strong.date}: shared_tags=[${strong.sharedTags.slice(0, 8).join(", ")}] token_jaccard=${strong.tokenJaccard}`,
        ],
        rejection: {
          status: "rejected",
          agent: "DuplicateCheckerAgent",
          reason: `Summary closely matches ${strong.date} with overlapping taxonomy — likely wrong calendar slot`,
          confidence: 0.88,
          suggestedAction: "merge_existing",
          returnTo: "NewsManager",
        },
      }),
      evidence: {
        neighborDate: strong.date,
        tokenJaccard: strong.tokenJaccard,
        sharedTags: strong.sharedTags,
        sharedTopics: strong.sharedTopics,
        suggestedDate: strong.date,
      },
    };
  }

  const findings =
    context.neighbors.length === 0 ?
      ["No taxonomy-overlap neighbors in the calendar window with meaningful summary similarity"]
    : context.neighbors.slice(0, 5).map(
        (n) =>
          `neighbor ${n.date}: jaccard=${n.tokenJaccard} tags=${n.sharedTags.slice(0, 4).join("|") || "—"} topics=${n.sharedTopics.slice(0, 3).join("|") || "—"}`
      );

  return {
    status: "completed",
    confidence: context.neighbors.length ? 0.74 : 0.9,
    output: buildStepOutput({
      summary:
        context.neighbors.length ?
          "Taxonomy-aware duplicate scan — overlapping neighbor days listed for review"
        : "No weighted taxonomy neighbors in window",
      findings,
    }),
    evidence: {
      focalTags: context.focalTags,
      focalTopics: context.focalTopics,
      topNeighbors: context.neighbors.slice(0, 8),
    },
  };
};

const tagManagerAgent: AgentExecutor = async (ctx) => {
  const cov = await getTagCoverageForDate(ctx.triageItem.date);
  if (!cov) {
    return {
      status: "skipped",
      confidence: 0.5,
      output: buildStepOutput({
        summary: "No analysis row for tag review",
        findings: ["Missing historical_news_analyses row for this date"],
      }),
    };
  }
  const gaps: string[] = [];
  if (cov.pagesAndTagsCount === 0) gaps.push("pages_and_tags has no links for this page");
  if (cov.tagsVersion2Count === 0) gaps.push("tags_version2 is empty");
  return {
    status: "completed",
    confidence: cov.pagesAndTagsCount > 0 ? 0.88 : 0.42,
    output: buildStepOutput({
      summary:
        cov.pagesAndTagsCount > 0 ?
          "Normalized tag links exist"
        : "No normalized tag links yet — use Tags admin or migrate-to-normalized-tags tooling",
      findings:
        cov.pagesAndTagsCount > 0 ?
          [`pages_and_tags rows: ${cov.pagesAndTagsCount}`, `tags_version2 count: ${cov.tagsVersion2Count}`]
        : gaps,
    }),
    evidence: { ...cov },
  };
};

const topicApplierAgent: AgentExecutor = async (ctx) => {
  const row = await getDayTaxonomy(ctx.triageItem.date);
  if (!row) {
    return {
      status: "skipped",
      confidence: 0.5,
      output: buildStepOutput({
        summary: "No analysis row for topic application check",
        findings: ["TopicApplierAgent expects a persisted analysis row"],
      }),
    };
  }

  const topics = topicLabelsFromRow(row.topicCategories);
  const issues = invalidTopicReasons(topics);
  if (issues.length > 0) {
    return {
      status: "rejected",
      confidence: 0.6,
      output: buildStepOutput({
        summary: "Topic application is incomplete or invalid",
        findings: issues,
        rejection: {
          status: "rejected",
          agent: "TopicApplierAgent",
          reason: issues.join("; "),
          confidence: 0.6,
          suggestedAction: "manual_review",
          returnTo: "NewsManager",
        },
      }),
      evidence: { topics, issues },
    };
  }

  return {
    status: "completed",
    confidence: 0.86,
    output: buildStepOutput({
      summary: "Topic application confirmed",
      findings: [`Assigned storyline: ${topics[0]}`],
    }),
    evidence: { topics },
  };
};

const tagApplierAgent: AgentExecutor = async (ctx) => {
  const cov = await getTagCoverageForDate(ctx.triageItem.date);
  if (!cov) {
    return {
      status: "skipped",
      confidence: 0.5,
      output: buildStepOutput({
        summary: "No analysis row for tag application check",
        findings: ["TagApplierAgent expects a persisted analysis row"],
      }),
    };
  }

  const hasAppliedTags = cov.tagsVersion2Count > 0 || cov.pagesAndTagsCount > 0;
  if (!hasAppliedTags) {
    return {
      status: "rejected",
      confidence: 0.6,
      output: buildStepOutput({
        summary: "Tag application is incomplete",
        findings: ["No tags_version2 values or normalized pages_and_tags links exist"],
        rejection: {
          status: "rejected",
          agent: "TagApplierAgent",
          reason: "No tag has been applied to this day",
          confidence: 0.6,
          suggestedAction: "manual_review",
          returnTo: "NewsManager",
        },
      }),
      evidence: { ...cov },
    };
  }

  return {
    status: "completed",
    confidence: cov.pagesAndTagsCount > 0 ? 0.88 : 0.78,
    output: buildStepOutput({
      summary: "Tag application confirmed",
      findings: [
        `tags_version2 count=${cov.tagsVersion2Count}`,
        `pages_and_tags rows=${cov.pagesAndTagsCount}`,
      ],
    }),
    evidence: { ...cov },
  };
};

const finalEditorAgent: AgentExecutor = async (ctx) => {
  const existing = await getExistingDay(ctx.triageItem.date);
  if (!existing) {
    return {
      status: "rejected",
      confidence: 0.55,
      output: buildStepOutput({
        rejection: {
          status: "rejected",
          agent: "FinalEditorAgent",
          reason: "No persisted analysis row for final gate",
          confidence: 0.55,
          suggestedAction: "manual_review",
          returnTo: "NewsManager",
        },
      }),
    };
  }
  if (isEditorialSummaryWeak(existing.summary) || !isValidPipelineTopArticleId(existing.topArticleId)) {
    return {
      status: "rejected",
      confidence: 0.72,
      output: buildStepOutput({
        rejection: {
          status: "rejected",
          agent: "FinalEditorAgent",
          reason:
            "Day is not publishable yet (summary too weak / failure text, or no winning article). Fix on the day page before human approval.",
          confidence: 0.72,
          suggestedAction: "manual_review",
          returnTo: "NewsManager",
        },
      }),
    };
  }

  const taxonomy = await getDayTaxonomy(ctx.triageItem.date);
  const topics = taxonomy ? topicLabelsFromRow(taxonomy.topicCategories) : [];
  const topicIssues = invalidTopicReasons(topics);
  if (topicIssues.length > 0) {
    return {
      status: "rejected",
      confidence: 0.64,
      output: buildStepOutput({
        summary: "Final gate blocked — topic hierarchy is not publishable",
        findings: topicIssues,
        rejection: {
          status: "rejected",
          agent: "FinalEditorAgent",
          reason: `Each day must have exactly one homepage storyline leaf: ${topicIssues.join("; ")}`,
          confidence: 0.64,
          suggestedAction: "manual_review",
          returnTo: "NewsManager",
        },
      }),
      evidence: { topics, topicIssues },
    };
  }

  return {
    status: "completed",
    confidence: 0.88,
    output: buildStepOutput({
      summary: "Final editor assembled package for human review queue",
      findings: [`Route=${ctx.triageItem.route}`, "Human approval required before write"],
      handoff: {
        analysisId: ctx.triageItem.analysisId,
        date: ctx.triageItem.date,
        status: "needs_review",
        confidence: 0.88,
        nextAgent: "NewsManager",
        reason: "Mandatory human gate",
      },
    }),
  };
};

const dateConsistencyAgent: AgentExecutor = async (ctx) => {
  if (!ctx.triageItem.analysisId) {
    return {
      status: "skipped",
      confidence: 0.9,
      output: buildStepOutput({
        summary: "No analysis id — cannot load summary for date check",
        findings: ["DateConsistencyAgent expects a persisted analysis row"],
      }),
    };
  }

  const existing = await getExistingDay(ctx.triageItem.date);
  if (!existing || existing.id !== ctx.triageItem.analysisId) {
    return {
      status: "skipped",
      confidence: 0.85,
      output: buildStepOutput({
        summary: "Analysis row missing or triage id mismatch — skipping date check",
        findings: ["Expected historical_news_analyses row matching triage analysisId"],
      }),
    };
  }

  const summary = String(existing.summary ?? "").trim();
  if (summary.length < 20) {
    return {
      status: "completed",
      confidence: 0.55,
      output: buildStepOutput({
        summary: "Summary too short for reliable calendar anchoring",
        findings: ["Skipped strict date check for very short summary"],
      }),
    };
  }

  const dateCheck = await evaluateDateConsistencyForDay({
    date: ctx.triageItem.date,
    analysisId: ctx.triageItem.analysisId,
    summary,
  });

  if (dateCheck.status === "canonical") {
    return {
      status: "rejected",
      confidence: 0.9,
      output: buildStepOutput({
        summary: "Summary matches a known canonical date, not this day",
        findings: [dateCheck.reason],
        rejection: {
          status: "rejected",
          agent: "DateConsistencyAgent",
          reason: dateCheck.reason,
          confidence: 0.9,
          suggestedAction: "merge_existing",
          returnTo: "NewsManager",
        },
      }),
      evidence: {
        canonicalDate: dateCheck.expectedDate,
        suggestedDate: dateCheck.expectedDate,
        canonicalRule: dateCheck.ruleId,
      },
    };
  }

  if (dateCheck.status === "skipped") {
    if (dateCheck.reason.includes("OPENAI_API_KEY")) {
      return {
        status: "skipped",
        confidence: 1,
        output: buildStepOutput({
          summary: "Date consistency check skipped (OPENAI_API_KEY not set)",
          findings: ["Set OPENAI_API_KEY to enable calendar-vs-summary verification without reading sources"],
        }),
      };
    }
    return {
      status: "completed",
      confidence: 0.55,
      output: buildStepOutput({
        summary: "Date consistency check skipped",
        findings: [dateCheck.reason],
      }),
    };
  }

  if (dateCheck.status === "mismatch") {
    const dupDate = dateCheck.duplicateOfDate;
    const duplicateMismatch = Boolean(dupDate);
    const mergedIssues = dateCheck.issues;
    return {
      status: "rejected",
      confidence: dateCheck.verdict.confidence,
      output: buildStepOutput({
        summary: duplicateMismatch
          ? "Summary likely misplaced or duplicate of another tagged day"
          : "Summary does not plausibly match the calendar date (no-source check)",
        findings: mergedIssues.length ? mergedIssues : ["Model flagged calendar or duplicate mismatch"],
        rejection: {
          status: "rejected",
          agent: "DateConsistencyAgent",
          reason: mergedIssues[0] || "Summary appears anchored to a different date than the page",
          confidence: dateCheck.verdict.confidence,
          suggestedAction: duplicateMismatch ? "merge_existing" : "manual_review",
          returnTo: "NewsManager",
        },
      }),
      evidence: {
        calendar_date: ctx.triageItem.date,
        verdict: dateCheck.verdict,
        duplicateOfDate: dupDate,
        suggestedDate: dupDate,
      },
    };
  }

  return {
    status: "completed",
    confidence: dateCheck.verdict.confidence,
    output: buildStepOutput({
      summary: "Calendar date, taxonomy neighbors, and summary appear consistent (no-source check)",
      findings: dateCheck.verdict.issues.length
        ? dateCheck.verdict.issues
        : ["No strong calendar or duplicate mismatch detected"],
    }),
    evidence: { calendar_date: ctx.triageItem.date, verdict: dateCheck.verdict },
  };
};

const tagConsistencyAgent: AgentExecutor = async (ctx) => {
  if (!ctx.triageItem.analysisId) {
    return {
      status: "skipped",
      confidence: 0.9,
      output: buildStepOutput({
        summary: "Tag consistency check skipped — no analysis id",
        findings: ["TagConsistencyAgent expects a persisted analysis row"],
      }),
    };
  }

  const row = await getDayTaxonomy(ctx.triageItem.date);
  if (!row || row.id !== ctx.triageItem.analysisId) {
    return {
      status: "skipped",
      confidence: 0.85,
      output: buildStepOutput({
        summary: "Tag consistency check skipped — analysis row missing",
        findings: ["Missing or mismatched historical_news_analyses row"],
      }),
    };
  }

  const tags = Array.isArray(row.tagsVersion2) ? row.tagsVersion2.filter((t) => typeof t === "string") : [];
  const topics = topicLabelsFromRow(row.topicCategories);
  const summary = String(row.summary ?? "").trim();
  const evaluation = evaluateTagConsistency({ summary, tags, topics });

  if (evaluation.issues.length) {
    return {
      status: "rejected",
      confidence: 0.6,
      output: buildStepOutput({
        summary: "Tag/topic consistency conflicts detected",
        findings: evaluation.issues.map((issue) => issue.message),
        rejection: {
          status: "rejected",
          agent: "TagConsistencyAgent",
          reason: evaluation.issues[0]?.message ?? "Tag/topic consistency conflicts detected",
          confidence: 0.6,
          suggestedAction: "manual_review",
          returnTo: "NewsManager",
        },
      }),
      evidence: {
        normalizedTags: evaluation.normalizedTags,
        normalizedTopics: evaluation.normalizedTopics,
        issues: evaluation.issues,
      },
    };
  }

  return {
    status: "completed",
    confidence: 0.86,
    output: buildStepOutput({
      summary: "Tag/topic consistency checks passed",
      findings: [
        `tags_version2 count=${tags.length}`,
        `topic_categories count=${topics.length}`,
      ],
    }),
    evidence: {
      normalizedTags: evaluation.normalizedTags,
      normalizedTopics: evaluation.normalizedTopics,
    },
  };
};

export const executorRegistry: Record<PipelineAgentName, AgentExecutor> = {
  NewsManager: newsManagerAgent,
  MilestoneAgent: milestoneAgent,
  SourceFinderAgent: sourceFinderAgent,
  RelevanceCheckerAgent: relevanceCheckerAgent,
  VerificationAgent: verificationAgent,
  TopicValidatorAgent: topicManagerAgent,
  TopicManagerAgent: topicManagerAgent,
  TagManagerAgent: tagManagerAgent,
  TopicApplierAgent: topicApplierAgent,
  TagApplierAgent: tagApplierAgent,
  DuplicateCheckerAgent: duplicateCheckerAgent,
  SummaryAgent: summaryAgent,
  DateConsistencyAgent: dateConsistencyAgent,
  TagConsistencyAgent: tagConsistencyAgent,
  FinalEditorAgent: finalEditorAgent,
};

export async function executeAgent(agent: PipelineAgentName, ctx: ExecutorContext): Promise<ExecutorResult> {
  return executorRegistry[agent](ctx);
}
