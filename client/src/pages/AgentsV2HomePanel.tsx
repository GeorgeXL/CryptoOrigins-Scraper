import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Link } from "wouter";

import { AgentsV2ResumeSlicePanel } from "@/pages/agents-v2/AgentsV2ResumeSlicePanel";
import { AgentsV2ReviewPhasePanel } from "@/pages/agents-v2/AgentsV2ReviewPhasePanels";
import {
  expectedFirstOperatorExperienceV3,
  mapReviewItemToQueueRow,
  type AgentsV2PipelinePhase,
  type AgentsV2QueueRow,
} from "@/pages/agents-v2/map-review-queue";
import {
  approveReviewItem,
  clearPipelineArtifacts,
  deleteReviewQueueItem,
  fetchReviewQueue,
  rejectReviewItem,
  rememberLastPipelineRunId,
  type ApproveReviewOpts,
} from "@/lib/editorial-pipeline";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Check, ChevronDown, Info, Link2, Loader2, RefreshCw, Trash2, X, XCircle } from "lucide-react";

type QueueStatus = "pending" | "approved" | "rejected";
type FilterTab = QueueStatus | "all";
type ScenarioFilter =
  | "all"
  | "awaiting_article_pick"
  | "awaiting_summary_approval"
  | "awaiting_correction_approval"
  | "awaiting_calendar_decision"
  | "awaiting_duplicate_decision"
  | "triage";

type QueueRow = AgentsV2QueueRow;
type PipelinePhase = AgentsV2PipelinePhase;

const STEP_LABELS = ["Triage", "Article pick", "Summary approval", "Done"] as const;

/** Pass to `StepTimeline` when the row is approved: all steps render complete. */
const TIMELINE_ALL_COMPLETE = STEP_LABELS.length;

function timelineIndexForQueueRow(row: QueueRow): number {
  if (row.timelineStepOverride != null) return row.timelineStepOverride;
  if (row.status === "approved") return TIMELINE_ALL_COMPLETE;

  switch (row.pipelinePhase) {
    case "triage":
      return 0;
    case "awaiting_article_pick":
      return 1;
    case "awaiting_summary_approval":
    case "awaiting_correction_approval":
      return 2;
    case "awaiting_calendar_decision":
      return 1;
    case "awaiting_duplicate_decision":
      return 1;
    default:
      return 0;
  }
}

function phaseChipLabel(phase: PipelinePhase): string {
  switch (phase) {
    case "awaiting_article_pick":
      return "Article pick";
    case "awaiting_summary_approval":
      return "Summary approval";
    case "awaiting_correction_approval":
      return "Corrections";
    case "awaiting_calendar_decision":
      return "Calendar";
    case "awaiting_duplicate_decision":
      return "Duplicates";
    default:
      return "Triage";
  }
}


function statusBadge(status: QueueStatus) {
  switch (status) {
    case "pending":
      return (
        <Badge variant="secondary" className="font-normal text-amber-600 dark:text-amber-400">
          Pending
        </Badge>
      );
    case "approved":
      return (
        <Badge variant="secondary" className="font-normal text-emerald-600 dark:text-emerald-400">
          Approved
        </Badge>
      );
    default:
      return (
        <Badge variant="secondary" className="font-normal text-red-600 dark:text-red-400">
          Rejected
        </Badge>
      );
  }
}

const TIMELINE_EASE = [0.22, 1, 0.36, 1] as const;
const TIMELINE_STEP_MS = 0.1;

function StepTimeline({ currentStepIndex }: { currentStepIndex: number }) {
  const allComplete = currentStepIndex >= STEP_LABELS.length;
  const safeIndex = Math.min(Math.max(currentStepIndex, 0), STEP_LABELS.length - 1);
  const reduceMotion = useReducedMotion();

  return (
    <ol className="relative space-y-0 pl-1" aria-hidden>
      {STEP_LABELS.map((label, i) => {
        const complete = allComplete || i < safeIndex;
        const current = !allComplete && i === safeIndex;
        const upcoming = !allComplete && i > safeIndex;
        const bubbleDelay = reduceMotion ? 0 : i * TIMELINE_STEP_MS;
        const lineDelay = reduceMotion ? 0 : i * TIMELINE_STEP_MS + 0.06;
        const textDelay = reduceMotion ? 0 : i * TIMELINE_STEP_MS;

        return (
          <li key={label} className="flex gap-3">
            <div className="flex w-4 shrink-0 flex-col items-center self-stretch">
              <motion.span
                className={cn(
                  "relative z-[1] flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-colors",
                  complete &&
                    "border-emerald-500/65 bg-emerald-500/[0.14] text-emerald-600 dark:border-emerald-400/60 dark:bg-emerald-400/[0.12] dark:text-emerald-400",
                  current &&
                    "border-orange-600/45 bg-orange-500 text-orange-50 shadow-sm dark:border-orange-500/50 dark:bg-orange-600 dark:text-orange-50",
                  upcoming && "border-white/22 bg-transparent",
                )}
                initial={reduceMotion ? false : { scale: 0.45, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{
                  delay: bubbleDelay,
                  duration: reduceMotion ? 0 : 0.32,
                  ease: TIMELINE_EASE,
                }}
              >
                {complete ? <Check className="size-2.5 shrink-0" strokeWidth={3} aria-hidden /> : null}
              </motion.span>
              {i < STEP_LABELS.length - 1 ? (
                <motion.span
                  className={cn(
                    "mt-0 min-h-[1.5rem] w-0 flex-1 shrink-0 border-l border-solid bg-transparent",
                    (allComplete || i < safeIndex) ? "border-white/45" : "border-white/22",
                  )}
                  aria-hidden
                  initial={reduceMotion ? false : { scaleY: 0 }}
                  animate={{ scaleY: 1 }}
                  transition={{
                    delay: lineDelay,
                    duration: reduceMotion ? 0 : 0.38,
                    ease: TIMELINE_EASE,
                  }}
                  style={{ transformOrigin: "top" }}
                />
              ) : null}
            </div>
            <motion.div
              className={cn("min-w-0 -mt-0.5", i < STEP_LABELS.length - 1 && "pb-6")}
              initial={reduceMotion ? false : { opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{
                delay: textDelay,
                duration: reduceMotion ? 0 : 0.3,
                ease: TIMELINE_EASE,
              }}
            >
              <p
                className={cn(
                  "text-[13px] leading-snug",
                  complete && "font-medium text-muted-foreground/75",
                  current && "font-semibold text-foreground",
                  upcoming && "font-medium text-foreground/70",
                )}
              >
                {label}
              </p>
              <p
                className={cn(
                  "mt-0.5 text-[11px] leading-tight",
                  (complete || upcoming) && "font-normal text-muted-foreground",
                  current && "font-medium text-orange-400/90 dark:text-orange-300/95",
                )}
              >
                {complete ? "Complete" : current ? "In progress" : "Upcoming"}
              </p>
            </motion.div>
          </li>
        );
      })}
    </ol>
  );
}

function OutcomePreviewStrip({
  preview,
  live,
}: {
  preview: NonNullable<QueueRow["outcomePreview"]>;
  live: boolean;
}) {
  const positive = preview.kind === "approve";
  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-lg border px-3 py-2.5 text-xs",
        positive
          ? "border-emerald-500/20 bg-emerald-500/[0.06] text-emerald-900 dark:text-emerald-100/90"
          : "border-red-500/20 bg-red-500/[0.06] text-red-900 dark:text-red-100/90",
      )}
    >
      {positive ? (
        <Check className="mt-0.5 size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" strokeWidth={2.5} />
      ) : (
        <X className="mt-0.5 size-3.5 shrink-0 text-red-600 dark:text-red-400" strokeWidth={2.5} />
      )}
      <div>
        <p className="font-medium">{positive ? "Would approve" : "Would reject"}</p>
        <p className="mt-0.5 text-muted-foreground">{preview.line}</p>
        <p className="mt-1.5 text-[10px] uppercase tracking-wide text-muted-foreground/70">
          {live ? "On approve" : "Preview"}
        </p>
      </div>
    </div>
  );
}

function reviewChecklistForPhase(row: QueueRow): string[] {
  switch (row.pipelinePhase) {
    case "awaiting_article_pick":
      return [
        "Check the recommended article is about this exact date.",
        "Prefer Bitcoin, then crypto/Web3, then market or macro relevance.",
        "If nothing fits, confirm the day should stay empty.",
      ];
    case "awaiting_summary_approval":
      return [
        "Read the summary for factual accuracy and active voice.",
        "Keep the summary between 100 and 110 characters.",
        "Confirm tags and topics match the summary.",
      ];
    case "awaiting_correction_approval":
      return [
        "Review the proposed fixes before applying them.",
        "Keep only tags and topics grounded in the event.",
        "Reject when the event needs a different source.",
      ];
    case "awaiting_calendar_decision":
      return [
        "Check whether the event belongs on the suggested canonical date.",
        "Move only when the current date is objectively wrong.",
        "Keep as-is when this day has its own valid storyline.",
      ];
    case "awaiting_duplicate_decision":
      return [
        "Compare the focal day with nearby duplicate candidates.",
        "If the storyline repeats, ask the system to find another event.",
        "Keep both only when both dates have distinct historical meaning.",
      ];
    default:
      return row.operatorSnapshot?.shortCircuited
        ? [
            "The agent chain stopped before a final review package.",
            "Resume from the most relevant step or reject and rerun the day.",
            "Use Open day when manual editing is clearer.",
          ]
        : [
            "Check why this row entered review.",
            "Approve only when the proposed action matches the day.",
            "Reject when the system should rerun the decision.",
          ];
  }
}

function recommendedActionForRow(row: QueueRow): string {
  if (row.item.actionPlan?.approveSummary) return row.item.actionPlan.approveSummary;
  if (row.outcomePreview?.line) return row.outcomePreview.line;
  switch (row.pipelinePhase) {
    case "awaiting_article_pick":
      return "Pick the most date-accurate article, or confirm the day is empty.";
    case "awaiting_summary_approval":
      return "Approve the summary only after the text, tags, and topics are correct.";
    case "awaiting_correction_approval":
      return "Apply the selected fixes, or reject if the event needs a different source.";
    case "awaiting_duplicate_decision":
      return "Find another event if this repeats an existing storyline.";
    default:
      return row.title;
  }
}

function ReviewerBriefCard({ row }: { row: QueueRow }) {
  const spec = expectedFirstOperatorExperienceV3(row);
  return (
    <div className="rounded-xl border border-border/70 bg-background/70 p-4 text-xs shadow-sm">
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(16rem,0.9fr)]">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-300">
            <Info className="size-4" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/80">
              Reviewer brief
            </p>
            <p className="mt-1 text-sm font-semibold leading-snug text-foreground">{row.title}</p>
            {row.subtitle ? <p className="mt-1.5 leading-relaxed text-muted-foreground">{row.subtitle}</p> : null}
            {row.operatorSnapshot?.shortCircuited ? (
              <p className="mt-2 rounded-md border border-amber-500/25 bg-amber-500/10 px-2.5 py-2 text-[11px] leading-relaxed text-amber-100">
                {spec.headline}
              </p>
            ) : null}
          </div>
        </div>
        <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/80">
            Recommended action
          </p>
          <p className="mt-1.5 text-[13px] font-medium leading-relaxed text-foreground">
            {recommendedActionForRow(row)}
          </p>
          <ul className="mt-3 space-y-1.5 text-[12px] leading-relaxed text-muted-foreground">
            {reviewChecklistForPhase(row).map((b) => (
              <li key={b} className="flex gap-2">
                <Check className="mt-0.5 size-3 shrink-0 text-emerald-400" aria-hidden />
                <span>{b}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function TailoredLiveReviewCard({
  row,
  busy,
  onApprove,
  onReject,
}: {
  row: QueueRow;
  busy: boolean;
  onApprove: (id: string, opts?: ApproveReviewOpts) => void;
  onReject: (id: string) => void;
}) {
  const [calendarPick, setCalendarPick] = useState<"keep" | "move" | null>(null);
  const [duplicatePick, setDuplicatePick] = useState<"keep" | "replace" | "delete_focal" | null>(null);
  const [articlePickId, setArticlePickId] = useState<string | null>(null);
  const phase = row.pipelinePhase;
  const item = row.item;
  const topArticleUrl = item.dayTopArticle?.url ?? null;
  const dayTags = item.dayTags ?? [];
  const dayTopics = item.dayTopicCategories ?? [];
  const previousSummary =
    phase === "awaiting_summary_approval" && item.daySummary && item.summaryApproval?.generatedSummary
      ? item.daySummary
      : phase === "awaiting_correction_approval" && item.daySummary
        ? item.daySummary
        : null;

  if (phase === "awaiting_article_pick") {
    const candidates = item.candidates ?? [];
    const recommended = candidates.find((c) => c.recommended) ?? candidates[0] ?? null;
    const selectedId = articlePickId ?? recommended?.id ?? null;
    const selectedCandidate = candidates.find((c) => c.id === selectedId) ?? null;
    const selectedBlocked = selectedCandidate?.calendarSanityOk === false;
    const betterStoryline = item.scenario === "better_storyline";
    const currentSummary = item.daySummary?.trim() ?? "";
    const currentTags = (item.dayTags ?? []).filter(Boolean);
    const currentTopics = (item.dayTopicCategories ?? []).filter(Boolean);
    return (
      <div className="space-y-3">
        {betterStoryline ? (
          <section className="rounded-lg border border-amber-500/30 bg-amber-500/[0.04] p-3">
            <div className="grid gap-3 md:grid-cols-[1fr_14rem]">
              <div className="min-w-0 space-y-1.5">
                <p className="text-[11px] uppercase tracking-[0.14em] text-amber-500/90">Current vague storyline</p>
                {currentSummary ? (
                  <p className="text-sm leading-relaxed text-foreground">{currentSummary}</p>
                ) : (
                  <p className="text-sm italic text-muted-foreground">No current summary saved.</p>
                )}
                {topArticleUrl ? (
                  <Button type="button" variant="outline" size="sm" asChild className="mt-1 h-8 px-2.5 text-xs">
                    <a href={topArticleUrl} target="_blank" rel="noreferrer">
                      <Link2 className="mr-1.5 size-3.5" aria-hidden />
                      Open current source
                    </a>
                  </Button>
                ) : currentSummary ? (
                  <p className="text-xs font-medium text-red-400">Manual entry</p>
                ) : null}
              </div>
              <div className="space-y-2">
                <div>
                  <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Tags</p>
                  {currentTags.length ? (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {currentTags.slice(0, 8).map((tag) => (
                        <span key={tag} className="rounded-full border border-border/70 px-2 py-0.5 text-[11px] text-muted-foreground">
                          {tag}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-1 text-xs text-muted-foreground">No tags</p>
                  )}
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Topics</p>
                  <p className="mt-1 text-xs text-muted-foreground">{currentTopics.join(", ") || "Unassigned"}</p>
                </div>
              </div>
            </div>
          </section>
        ) : null}
        <div className="grid gap-3 lg:grid-cols-[1.25fr_0.75fr]">
          <div className="rounded-lg border border-border bg-background p-3 space-y-2">
            <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Candidates</p>
            <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
            {(recommended ? [recommended, ...candidates.filter((c) => c.id !== recommended.id)] : candidates)
              .map((c, i) => {
                const blocked = c.calendarSanityOk === false;
                return (
                  <div
                    key={c.id}
                    role="button"
                    tabIndex={busy ? -1 : 0}
                    aria-disabled={busy}
                    onClick={() => {
                      if (busy) return;
                      setArticlePickId(c.id);
                    }}
                    onKeyDown={(e) => {
                      if (busy) return;
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setArticlePickId(c.id);
                      }
                    }}
                    className={cn(
                      "w-full rounded-md border p-2.5 text-left transition-colors",
                      busy && "cursor-not-allowed opacity-70",
                      i === 0 && "border-emerald-500/35 bg-emerald-500/[0.06]",
                      blocked && "border-red-500/35 bg-red-500/[0.04]",
                      selectedId === c.id && "ring-1 ring-primary/55",
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-xs font-medium leading-snug">{c.title}</p>
                        {blocked ? (
                          <p className="mt-1 text-[10px] leading-snug text-red-300">
                            {(c.calendarSanityNotes ?? []).slice(0, 2).join("; ")}
                          </p>
                        ) : null}
                      </div>
                      {c.url ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            window.open(c.url, "_blank", "noopener,noreferrer");
                          }}
                          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground hover:text-foreground"
                          aria-label={`Open source for ${c.title}`}
                          title="Open source"
                        >
                          <Link2 className="h-3.5 w-3.5" />
                        </button>
                      ) : null}
                    </div>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {c.source || "source"} · {c.tier} · rank #{c.rank + 1}
                      {blocked ? " · date issue" : ""}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="rounded-lg border border-border bg-background p-3">
            <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Next step</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {betterStoryline
                ? "Choosing a stored candidate replaces the vague storyline, then writes a fresh summary, tags, and topic draft."
                : "Choosing a candidate writes summary, tags, and topic draft for final checks."}
            </p>
            {recommended ? (
              <div className="mt-2 rounded-md border border-emerald-500/30 bg-emerald-500/[0.06] p-2 text-xs">
                Recommended: {recommended.title}
              </div>
            ) : null}
            <div className="mt-3 space-y-2">
              <Button
                size="sm"
                className="w-full"
                disabled={busy || !selectedId || selectedBlocked}
                onClick={() => selectedId && onApprove(item.id, { selectedArticleId: selectedId })}
              >
                Approve selected pick
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="w-full"
                disabled={busy}
                onClick={() =>
                  betterStoryline
                    ? onApprove(item.id, { keepCurrentSummary: true })
                    : onReject(row.id)
                }
              >
                {betterStoryline ? "Keep current summary" : "Reject and rerun"}
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (phase === "awaiting_calendar_decision" && item.calendarDecision) {
    const p = item.calendarDecision;
    return (
      <div className="space-y-3">
        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-md border border-red-500/35 bg-red-500/[0.05] p-3">
            <p className="text-[11px] uppercase tracking-[0.14em] text-red-300">Current date</p>
            <p className="mt-1 text-sm font-medium">{p.currentDate}</p>
          </div>
          <div className="rounded-md border border-border p-3">
            <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Canonical date</p>
            <p className="mt-1 text-sm">{p.expectedDate}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            disabled={busy}
            onClick={() => {
              setCalendarPick("keep");
              onApprove(item.id, { calendarDecision: "keep_as_is" });
            }}
          >
            Keep on this date
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy || p.canonicalDateOccupied}
            onClick={() => {
              setCalendarPick("move");
              onApprove(item.id, { calendarDecision: "move_to_canonical" });
            }}
          >
            Move to canonical date
          </Button>
        </div>
        {calendarPick ? (
          <div className="rounded-md border border-border bg-muted/20 p-3 text-xs text-muted-foreground">
            {calendarPick === "keep"
              ? "Keeps this date and marks calendar decision resolved for current day."
              : "Moves handling to canonical date and continues downstream checks there."}
          </div>
        ) : null}
      </div>
    );
  }

  if (phase === "awaiting_duplicate_decision" && item.duplicateDecision) {
    const p = item.duplicateDecision;
    const summariesMatch = (left: string, right: string) =>
      left.trim().toLowerCase() === right.trim().toLowerCase();
    return (
      <div className="space-y-3">
        <div className="rounded-md border border-red-500/35 bg-red-500/[0.05] p-3">
          <p className="text-[11px] uppercase tracking-[0.14em] text-red-300">Potential overlaps</p>
          <div className="mt-2 space-y-2">
            {p.neighbors.slice(0, 3).map((n) => (
              <div key={n.date} className="rounded-md border border-border/70 bg-background/60 p-2.5">
                <p className="text-[11px] text-muted-foreground">
                  {p.focal.date} <span className="mx-1 text-muted-foreground/70">↔</span> {n.date} · similarity {(n.tokenJaccard * 100).toFixed(0)}%
                </p>
                {summariesMatch(p.focal.summaryPreview, n.summaryPreview) ? (
                  <p className="mt-1 text-[10px] uppercase tracking-[0.12em] text-amber-300">
                    Identical summary text in payload
                  </p>
                ) : null}
                <div className="mt-2 grid gap-2 md:grid-cols-2">
                  <div className="rounded-md border border-border/60 bg-muted/20 p-2">
                    <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Focal summary</p>
                    <p className="mt-1 text-xs text-muted-foreground">{p.focal.summaryPreview}</p>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      tags: {p.focal.tags.join(", ") || "none"}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      topics: {p.focal.topics.join(", ") || "none"}
                    </p>
                  </div>
                  <div className="rounded-md border border-border/60 bg-muted/20 p-2">
                    <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Neighbor summary</p>
                    <p className="mt-1 text-xs text-muted-foreground">{n.summaryPreview}</p>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      shared tags: {n.sharedTags.join(", ") || "none"}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      shared topics: {n.sharedTopics.join(", ") || "none"}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            disabled={busy}
            onClick={() => {
              setDuplicatePick("keep");
              onApprove(item.id, { duplicateDecision: "keep_both" });
            }}
          >
            Keep this day
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => {
              setDuplicatePick("replace");
              onApprove(item.id, { duplicateDecision: "find_another_event" });
            }}
          >
            Find replacement
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => {
              setDuplicatePick("delete_focal");
              onApprove(item.id, { duplicateDecision: "delete_focal" });
            }}
          >
            Remove focal day
          </Button>
        </div>
        {duplicatePick ? (
          <div className="rounded-md border border-border bg-muted/20 p-3 text-xs text-muted-foreground">
            {duplicatePick === "keep" && "Keeps this day as-is and resolves duplicate warning."}
            {duplicatePick === "replace" && "Returns this day to source selection to find a non-overlapping event."}
            {duplicatePick === "delete_focal" && "Deletes this focal day from the duplicate pair."}
          </div>
        ) : null}
      </div>
    );
  }

  if (phase === "awaiting_correction_approval") {
    const displayedSummary = item.daySummary?.trim() || row.subtitle || row.title;
    const proposedChanges = item.proposals ?? [];
    return (
      <div className="space-y-3">
        <div className="rounded-lg border border-border bg-background p-4">
          <div className="grid gap-3 lg:grid-cols-[120px_minmax(0,1fr)_220px]">
            <div>
              <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Date</p>
              <p className="mt-1 text-sm font-medium">{row.date}</p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Summary</p>
              <p className="mt-1 text-sm">{displayedSummary}</p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Tags</p>
              <p className="mt-1 text-xs text-muted-foreground">{dayTags.join(", ") || "No tags"}</p>
              <p className="mt-3 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Topics</p>
              <p className="mt-1 text-xs text-muted-foreground">{dayTopics.join(", ") || "Unassigned"}</p>
            </div>
          </div>
          <div className="mt-3 rounded-md border border-emerald-500/35 bg-emerald-500/[0.06] p-3">
            <p className="mb-1 text-[11px] uppercase tracking-[0.14em] text-emerald-300">What will change</p>
            {proposedChanges.length ? (
              <ul className="space-y-1">
                {proposedChanges.slice(0, 5).map((p) => (
                  <li key={p.id} className="text-xs text-muted-foreground">
                    • {p.kind.replaceAll("_", " ")}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted-foreground">
                {row.outcomePreview?.line ?? "Apply approved fixes and keep this day in the timeline."}
              </p>
            )}
          </div>
        </div>
        <div className="rounded-lg border border-border bg-background p-3">
          <AgentsV2ReviewPhasePanel item={item} busy={busy} onApprove={(id, opts) => onApprove(id, opts)} />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-border bg-background p-4">
        <div className="grid gap-3 lg:grid-cols-[120px_minmax(0,1fr)_220px]">
          <div>
            <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Date</p>
            <p className="mt-1 text-sm font-medium">{row.date}</p>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Summary</p>
            <p className="mt-1 text-sm">{item.summaryApproval?.generatedSummary ?? row.title}</p>
            {previousSummary ? (
              <div className="mt-2 rounded-md border border-border bg-muted/20 p-2">
                <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Previous summary</p>
                <p className="mt-1 text-xs text-muted-foreground">{previousSummary}</p>
              </div>
            ) : null}
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Tags</p>
            <p className="mt-1 text-xs text-muted-foreground">{dayTags.join(", ") || "No tags"}</p>
            <p className="mt-3 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Topics</p>
            <p className="mt-1 text-xs text-muted-foreground">{dayTopics.join(", ") || "Unassigned"}</p>
          </div>
        </div>
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <div className="rounded-md border border-red-500/35 bg-red-500/[0.05] p-3">
            <p className="mb-1 flex items-center gap-2 text-[11px] uppercase tracking-[0.14em] text-red-300">
              <XCircle className="h-4 w-4" /> Current issue
            </p>
            <p className="text-xs text-muted-foreground">{row.item.actionPlan?.approveSummary ?? row.subtitle ?? row.title}</p>
          </div>
          <div className="rounded-md border border-emerald-500/35 bg-emerald-500/[0.06] p-3">
            <p className="mb-1 text-[11px] uppercase tracking-[0.14em] text-emerald-300">Changed to</p>
            <p className="text-xs text-muted-foreground">{row.outcomePreview?.line ?? "Applies approved summary/tag/topic corrections."}</p>
            {topArticleUrl ? (
              <a
                href={topArticleUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                <Link2 className="h-3.5 w-3.5" />
                Open current source
              </a>
            ) : row.item.daySummary?.trim() ? (
              <p className="mt-2 text-xs font-medium text-red-400">Manual entry</p>
            ) : null}
          </div>
        </div>
      </div>
      <div className="rounded-lg border border-border bg-background p-3">
        <AgentsV2ReviewPhasePanel item={item} busy={busy} onApprove={(id, opts) => onApprove(id, opts)} />
      </div>
    </div>
  );
}

const PANEL_EASE = [0.22, 1, 0.36, 1] as const;

type QueueListProps = {
  rows: QueueRow[];
  busyId: string | null;
  advanceSignal: { id: string; nonce: number } | null;
  onApprove: (id: string, opts?: ApproveReviewOpts) => Promise<void>;
  onReject: (id: string) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
};

function duplicatePairKey(row: QueueRow): string | null {
  if (row.pipelinePhase !== "awaiting_duplicate_decision") return null;
  const decision = row.item.duplicateDecision;
  if (!decision?.neighbors?.length) return null;
  const neighbor = decision.neighbors[0]?.date;
  if (!neighbor) return null;
  const [a, b] = [row.date, neighbor].sort();
  return `${a}::${b}`;
}

function consolidateDuplicateRows(rows: QueueRow[]): QueueRow[] {
  const seen = new Set<string>();
  const out: QueueRow[] = [];
  for (const row of rows) {
    const key = duplicatePairKey(row);
    if (!key) {
      out.push(row);
      continue;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

function QueueList({ rows, busyId, advanceSignal, onApprove, onReject, onRemove }: QueueListProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const previousRowsRef = useRef<QueueRow[]>(rows);
  const reduceMotion = useReducedMotion();
  const panelTransition = reduceMotion
    ? { duration: 0.15 }
    : { duration: 0.3, ease: PANEL_EASE };

  useEffect(() => {
    if (expandedId && !rows.some((r) => r.id === expandedId)) setExpandedId(null);
  }, [rows, expandedId]);

  useEffect(() => {
    if (!advanceSignal) return;
    const previous = previousRowsRef.current;
    const prevIndex = previous.findIndex((r) => r.id === advanceSignal.id);
    if (rows.length === 0) {
      setExpandedId(null);
      return;
    }
    if (prevIndex === -1) {
      setExpandedId(rows[0].id);
      return;
    }
    const next = rows[prevIndex] ?? rows[Math.max(0, prevIndex - 1)] ?? rows[0];
    setExpandedId(next.id);
  }, [advanceSignal, rows]);

  useEffect(() => {
    previousRowsRef.current = rows;
  }, [rows]);

  return (
    <ul
      className="divide-y divide-border/80 overflow-hidden rounded-xl border border-border/80 bg-card/40 shadow-sm"
      aria-live="polite"
    >
      {rows.length === 0 ? (
        <li className="px-4 py-8 text-center text-sm text-muted-foreground">Nothing in this bucket.</li>
      ) : (
        rows.map((row) => {
          const open = expandedId === row.id;
          return (
            <li key={row.id} className="bg-card/20">
              <button
                type="button"
                className={cn(
                  "flex w-full items-start gap-3 px-4 py-3.5 text-left transition-colors hover:bg-muted/30",
                  open && "bg-muted/20",
                )}
                onClick={() => setExpandedId((id) => (id === row.id ? null : row.id))}
              >
                <motion.span
                  className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md border border-border/60 bg-muted/20 text-muted-foreground"
                  animate={{ rotate: open ? 180 : 0 }}
                  transition={reduceMotion ? { duration: 0 } : { duration: 0.28, ease: PANEL_EASE }}
                  aria-hidden
                >
                  <ChevronDown className="size-4" />
                </motion.span>
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <p className="font-mono text-xs text-muted-foreground">{row.date}</p>
                    <Badge variant="outline" className="h-5 px-1.5 text-[10px] font-normal text-muted-foreground">
                      {phaseChipLabel(row.pipelinePhase)}
                    </Badge>
                  </div>
                  <p className="text-sm font-medium leading-snug text-foreground">{row.title}</p>
                  {row.subtitle ? (
                    <p className="text-xs leading-relaxed text-muted-foreground">{row.subtitle}</p>
                  ) : null}
                </div>
                <div className="shrink-0 pt-0.5">{statusBadge(row.status)}</div>
              </button>

              <AnimatePresence initial={false}>
                {open ? (
                  <motion.div
                    key={`${row.id}-detail`}
                    initial={reduceMotion ? false : { height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={reduceMotion ? { opacity: 0 } : { height: 0, opacity: 0 }}
                    transition={panelTransition}
                    className="overflow-hidden border-t border-border/60 bg-muted/[0.12]"
                  >
                    <div className="px-4 pb-4 pt-3 sm:px-5">
                      <div className="space-y-4">
                        {row.status === "pending" ? (
                          <TailoredLiveReviewCard
                            row={row}
                            busy={busyId === row.id}
                            onApprove={(id, opts) => void onApprove(id, opts)}
                            onReject={(id) => void onReject(id)}
                          />
                        ) : (
                          <ReviewerBriefCard row={row} />
                        )}
                        {row.status === "pending" &&
                        row.pipelinePhase === "triage" &&
                        (row.operatorSnapshot?.shortCircuited || row.operatorSnapshot?.resumeStartsAvailable?.length) &&
                        /^\d{4}-\d{2}-\d{2}$/.test(row.date) ? (
                          <AgentsV2ResumeSlicePanel
                            date={row.date}
                            snapshot={row.operatorSnapshot}
                            disabled={busyId === row.id}
                            onSliceStarted={(runId) => rememberLastPipelineRunId(runId)}
                          />
                        ) : null}
                        <div className="rounded-xl border border-border/70 bg-background/45 p-4">
                          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Actions</p>
                          <div className="mt-3 flex flex-wrap gap-2">
                            {row.status === "pending" ? (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                disabled={busyId === row.id}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void onReject(row.id);
                                }}
                              >
                                Reject
                              </Button>
                            ) : null}
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                              disabled={busyId === row.id}
                              onClick={(e) => {
                                e.stopPropagation();
                                const msg =
                                  row.status === "pending" ?
                                    "Remove this pending review from the queue? This cannot be undone."
                                  : "Remove this queue entry from the database? Pipeline step history is kept.";
                                if (!window.confirm(msg)) return;
                                void onRemove(row.id);
                              }}
                            >
                              <Trash2 className="mr-2 size-4 shrink-0" aria-hidden />
                              Remove from queue
                            </Button>
                            {/^\d{4}-\d{2}-\d{2}$/.test(row.date) ? (
                              <Button type="button" variant="outline" size="sm" asChild>
                                <Link href={`/day/${row.date}`}>Open day</Link>
                              </Button>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </li>
          );
        })
      )}
    </ul>
  );
}

export default function AgentsV2HomePanel() {
  const { toast } = useToast();
  const [filter, setFilter] = useState<FilterTab>("pending");
  const [scenarioFilter, setScenarioFilter] = useState<ScenarioFilter>("all");
  const [rows, setRows] = useState<QueueRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [clearing, setClearing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [advanceSignal, setAdvanceSignal] = useState<{ id: string; nonce: number } | null>(null);

  const loadQueue = useCallback(async () => {
    setLoading(true);
    try {
      if (filter === "all") {
        const [pending, approved, rejected] = await Promise.all([
          fetchReviewQueue("pending"),
          fetchReviewQueue("approved"),
          fetchReviewQueue("rejected"),
        ]);
        const merged = [...pending, ...approved, ...rejected].map(mapReviewItemToQueueRow);
        merged.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
        setRows(merged);
      } else {
        const items = await fetchReviewQueue(filter);
        setRows(items.map(mapReviewItemToQueueRow));
      }
    } catch (e) {
      toast({
        title: "Queue",
        description: e instanceof Error ? e.message : "Failed to load review queue",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [filter, toast]);

  useEffect(() => {
    void loadQueue();
  }, [loadQueue]);

  const handleApprove = async (id: string, opts?: ApproveReviewOpts) => {
    setBusyId(id);
    try {
      await approveReviewItem(id, opts);
      if (opts?.duplicateDecision && opts.duplicateDecision !== "delete_focal") {
        const source = rows.find((r) => r.id === id);
        const pairKey = source ? duplicatePairKey(source) : null;
        if (pairKey) {
          const sibling = rows.find(
            (r) => r.id !== id && r.status === "pending" && duplicatePairKey(r) === pairKey,
          );
          if (sibling) {
            await approveReviewItem(sibling.id, opts);
          }
        }
      }
      toast({ title: "Approved", description: "Changes applied for this review item." });
      await loadQueue();
      setAdvanceSignal({ id, nonce: Date.now() });
    } catch (e) {
      toast({
        title: "Approve failed",
        description: e instanceof Error ? e.message : "Error",
        variant: "destructive",
      });
    } finally {
      setBusyId(null);
    }
  };

  const handleReject = async (id: string) => {
    setBusyId(id);
    try {
      await rejectReviewItem(id);
      toast({ title: "Rejected" });
      await loadQueue();
      setAdvanceSignal({ id, nonce: Date.now() });
    } catch (e) {
      toast({
        title: "Reject failed",
        description: e instanceof Error ? e.message : "Error",
        variant: "destructive",
      });
    } finally {
      setBusyId(null);
    }
  };

  const handleRemove = async (id: string) => {
    setBusyId(id);
    try {
      await deleteReviewQueueItem(id);
      toast({
        title: "Removed",
        description: "This review queue row was deleted.",
      });
      await loadQueue();
    } catch (e) {
      toast({
        title: "Remove failed",
        description: e instanceof Error ? e.message : "Error",
        variant: "destructive",
      });
    } finally {
      setBusyId(null);
    }
  };

  const handleClearArtifacts = async () => {
    setClearing(true);
    try {
      await clearPipelineArtifacts();
      toast({
        title: "Queue cleared",
        description: "All agent run artifacts were removed.",
      });
      await loadQueue();
    } catch (e) {
      toast({
        title: "Clear failed",
        description: e instanceof Error ? e.message : "Error",
        variant: "destructive",
      });
    } finally {
      setClearing(false);
    }
  };

  const statusFiltered = filter === "all" ? rows : rows.filter((r) => r.status === filter);
  const filtered =
    scenarioFilter === "all"
      ? statusFiltered
      : statusFiltered.filter((r) => r.pipelinePhase === scenarioFilter);
  const scenarioFilteredRows =
    scenarioFilter === "awaiting_duplicate_decision" ? consolidateDuplicateRows(filtered) : filtered;
  const listProps = {
    rows: scenarioFilteredRows,
    busyId,
    advanceSignal,
    onApprove: handleApprove,
    onReject: handleReject,
    onRemove: handleRemove,
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6 md:p-8">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-foreground">Review queue</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Review the recommended action, then approve, reject, or open the day.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" disabled={loading || clearing} onClick={() => void loadQueue()}>
            {loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
            <span className="sr-only">Refresh</span>
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button type="button" variant="outline" size="sm" disabled={loading || clearing}>
                {clearing ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                <span className="sr-only">Clear all artifacts</span>
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Clear all agent artifacts?</AlertDialogTitle>
                <AlertDialogDescription>
                  This removes all pipeline runs, review queue items, and linked artifacts. This cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction asChild>
                  <Button
                    type="button"
                    variant="destructive"
                    disabled={clearing}
                    onClick={() => void handleClearArtifacts()}
                  >
                    {clearing ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
                    Clear all
                  </Button>
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </header>

      <Tabs
        value={filter}
        onValueChange={(v) => {
          if (v === "pending" || v === "approved" || v === "rejected" || v === "all") setFilter(v);
        }}
        className="w-full"
      >
        <TabsList className="grid h-11 w-full grid-cols-4 gap-1 rounded-xl border border-border/70 bg-background/80 p-1 shadow-sm">
          <TabsTrigger value="pending" className="rounded-lg px-2 text-xs text-muted-foreground data-[state=active]:bg-amber-500 data-[state=active]:text-black data-[state=active]:shadow-sm sm:text-sm">Pending</TabsTrigger>
          <TabsTrigger value="approved" className="rounded-lg px-2 text-xs text-muted-foreground data-[state=active]:bg-emerald-500 data-[state=active]:text-black data-[state=active]:shadow-sm sm:text-sm">Approved</TabsTrigger>
          <TabsTrigger value="rejected" className="rounded-lg px-2 text-xs text-muted-foreground data-[state=active]:bg-red-500 data-[state=active]:text-white data-[state=active]:shadow-sm sm:text-sm">Rejected</TabsTrigger>
          <TabsTrigger value="all" className="rounded-lg px-2 text-xs text-muted-foreground data-[state=active]:bg-foreground data-[state=active]:text-background data-[state=active]:shadow-sm sm:text-sm">All</TabsTrigger>
        </TabsList>

        <div className="mt-3 flex justify-end">
          <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
            Scenario
            <select
              value={scenarioFilter}
              onChange={(e) => setScenarioFilter(e.target.value as ScenarioFilter)}
              className="h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground outline-none"
            >
              <option value="all">All scenarios</option>
              <option value="awaiting_article_pick">Article pick</option>
              <option value="awaiting_summary_approval">Summary approval</option>
              <option value="awaiting_correction_approval">Corrections</option>
              <option value="awaiting_calendar_decision">Calendar decision</option>
              <option value="awaiting_duplicate_decision">Duplicate decision</option>
              <option value="triage">Triage</option>
            </select>
          </label>
        </div>

        {(["pending", "approved", "rejected", "all"] as const).map((tab) => (
          <TabsContent key={tab} value={tab} className="mt-4 outline-none focus-visible:outline-none focus-visible:ring-0">
            {loading ? (
              <p className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Loading…
              </p>
            ) : (
              <QueueList {...listProps} />
            )}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
