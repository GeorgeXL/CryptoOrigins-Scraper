import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Link } from "wouter";

import { CalendarDatesReview } from "@/pages/agents-v2/CalendarDatesReview";
import { RemovedDayArticlePickBanner } from "@/pages/agents-v2/RemovedDayArticlePickBanner";
import {
  calendarFlagReasonFromRows,
  capCalendarRemoveDates,
  collectCalendarDateEntries,
} from "@/pages/agents-v2/calendar-date-entries";
import { AgentsV2ResumeSlicePanel } from "@/pages/agents-v2/AgentsV2ResumeSlicePanel";
import { AgentsV2ReviewPhasePanel } from "@/pages/agents-v2/AgentsV2ReviewPhasePanels";
import { formatCorrectionChangeLines, summarizeCorrectionProposals } from "@/lib/correction-proposal-view";
import {
  consolidateQueueRows,
  duplicatePairKey,
  expectedFirstOperatorExperienceV3,
  mapReviewItemToQueueRow,
  type AgentsV2PipelinePhase,
  type AgentsV2QueueRow,
} from "@/pages/agents-v2/map-review-queue";
import {
  approveReviewItem,
  checkArticlePickWithGoogle,
  checkCalendarDatesWithGoogle,
  clearPipelineArtifacts,
  deleteReviewQueueItem,
  fetchReviewQueue,
  rejectReviewItem,
  rememberLastPipelineRunId,
  verifyEditorialDay,
  type ApproveReviewOpts,
  type DayVerificationResult,
} from "@/lib/editorial-pipeline";
import type { LogLine } from "@/lib/pipelineActivityLog";
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
import { GoogleGIcon } from "@/components/GoogleGIcon";
import { Label } from "@/components/ui/label";
import { PipelineActivityLog } from "@/components/PipelineActivityLog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Check, ChevronDown, ChevronLeft, ChevronRight, Copy, Info, Link2, Loader2, RefreshCw, ShieldCheck, StopCircle, Trash2, X, XCircle } from "lucide-react";

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
    case "awaiting_calendar_decision":
      return "Compare both summaries, then choose Keep, Move, or Delete & rerun.";
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

function CopyDateButton({ date }: { date: string }) {
  const copyDate = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(date);
      toast({ title: "Date copied", description: date });
    } catch {
      toast({ title: "Copy failed", variant: "destructive" });
    }
  }, [date]);

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        void copyDate();
      }}
      className="inline-flex shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
      aria-label={`Copy date ${date}`}
      title="Copy date"
    >
      <Copy className="size-3.5" strokeWidth={2} aria-hidden />
    </button>
  );
}

function ReviewCardDateField({ date }: { date: string }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Date</p>
      <div className="mt-1 flex items-center gap-1.5">
        <p className="text-sm font-medium">{date}</p>
        <CopyDateButton date={date} />
      </div>
    </div>
  );
}

function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return target.isContentEditable;
}

function orderArticlePickCandidates<T extends { id: string; recommended?: boolean }>(
  candidates: T[],
): { ordered: T[]; recommended: T | null } {
  const recommended = candidates.find((c) => c.recommended) ?? candidates[0] ?? null;
  const ordered = recommended
    ? [recommended, ...candidates.filter((c) => c.id !== recommended.id)]
    : candidates;
  return { ordered, recommended };
}

function CalendarReviewPanel({
  rows,
  busy,
  readOnly,
  resolutionNote,
  onApprove,
}: {
  rows: QueueRow[];
  busy: boolean;
  readOnly?: boolean;
  resolutionNote?: string | null;
  onApprove: (id: string, opts?: ApproveReviewOpts) => void;
}) {
  const pendingRows = rows.filter(
    (row) => row.status === "pending" && row.pipelinePhase === "awaiting_calendar_decision",
  );
  const sourceRows = pendingRows.length > 0 ? pendingRows : rows;
  const entries = collectCalendarDateEntries(sourceRows);
  if (entries.length === 0) return null;

  const anchor = pendingRows[0] ?? rows[0];
  if (!anchor) return null;

  return (
    <CalendarDatesReview
      entries={entries}
      flagReason={calendarFlagReasonFromRows(sourceRows)}
      busy={busy}
      readOnly={readOnly}
      resolutionNote={resolutionNote}
      onApply={(removeDates) =>
        onApprove(anchor.id, {
          calendarGroupDates: entries.map((entry) => entry.date),
          calendarRemoveDates: removeDates,
        })
      }
    />
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
  const [duplicatePick, setDuplicatePick] = useState<"keep" | "replace" | "delete_focal" | null>(null);
  const [articlePickId, setArticlePickId] = useState<string | null>(null);
  const [checkingArticlePickGoogle, setCheckingArticlePickGoogle] = useState(false);
  const [articlePickGoogleNote, setArticlePickGoogleNote] = useState<string | null>(null);
  const [articlePickGoogleError, setArticlePickGoogleError] = useState<string | null>(null);
  const candidatesListRef = useRef<HTMLDivElement>(null);
  const phase = row.pipelinePhase;
  const item = row.item;
  const topArticleUrl = item.dayTopArticle?.url ?? null;
  const dayTags = item.dayTags ?? [];
  const dayTopics = item.dayTopicCategories ?? [];
  const isArticlePick = phase === "awaiting_article_pick";
  const articleCandidates = isArticlePick ? (item.candidates ?? []) : [];
  const { ordered: orderedArticleCandidates, recommended: recommendedArticle } = isArticlePick
    ? orderArticlePickCandidates(articleCandidates)
    : { ordered: [], recommended: null };
  const selectedArticleId = isArticlePick ? (articlePickId ?? recommendedArticle?.id ?? null) : null;
  const selectedArticleCandidate =
    isArticlePick ? (articleCandidates.find((c) => c.id === selectedArticleId) ?? null) : null;
  const selectedArticleBlocked = selectedArticleCandidate?.calendarSanityOk === false;
  const betterStoryline = isArticlePick && item.scenario === "better_storyline";
  const hasOpenDay = /^\d{4}-\d{2}-\d{2}$/.test(row.date);
  const previousSummary =
    phase === "awaiting_summary_approval" && item.daySummary && item.summaryApproval?.generatedSummary
      ? item.daySummary
      : phase === "awaiting_correction_approval" && item.daySummary
        ? item.daySummary
        : null;

  useEffect(() => {
    setArticlePickId(null);
    setArticlePickGoogleNote(null);
    setArticlePickGoogleError(null);
  }, [row.id]);

  useEffect(() => {
    if (busy) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (isEditableKeyboardTarget(e.target)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const key = e.key.toLowerCase();

      if (key === "r") {
        e.preventDefault();
        onReject(row.id);
        return;
      }

      if (key === "o" && hasOpenDay) {
        e.preventDefault();
        window.open(`/day/${row.date}`, "_blank", "noopener,noreferrer");
        return;
      }

      if (!isArticlePick) return;

      if (key === "arrowdown" || key === "arrowup") {
        if (orderedArticleCandidates.length === 0) return;
        e.preventDefault();
        const currentIndex = Math.max(
          0,
          orderedArticleCandidates.findIndex((c) => c.id === selectedArticleId),
        );
        const delta = key === "arrowdown" ? 1 : -1;
        const nextIndex = Math.min(
          orderedArticleCandidates.length - 1,
          Math.max(0, currentIndex + delta),
        );
        const next = orderedArticleCandidates[nextIndex];
        if (next) {
          setArticlePickId(next.id);
          queueMicrotask(() => {
            candidatesListRef.current
              ?.querySelector(`[data-candidate-id="${CSS.escape(next.id)}"]`)
              ?.scrollIntoView({ block: "nearest" });
          });
        }
        return;
      }

      if (key === "a") {
        if (!selectedArticleId || selectedArticleBlocked) return;
        e.preventDefault();
        onApprove(item.id, { selectedArticleId: selectedArticleId });
        return;
      }

      if (key === "k") {
        e.preventDefault();
        if (betterStoryline) {
          onApprove(item.id, { keepCurrentSummary: true });
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    busy,
    row.id,
    row.date,
    item.id,
    isArticlePick,
    betterStoryline,
    hasOpenDay,
    selectedArticleId,
    selectedArticleBlocked,
    orderedArticleCandidates,
    onApprove,
    onReject,
  ]);

  if (isArticlePick) {
    const recommended = recommendedArticle;
    const selectedId = selectedArticleId;
    const selectedBlocked = selectedArticleBlocked;
    const currentSummary = item.daySummary?.trim() ?? "";
    const currentTags = (item.dayTags ?? []).filter(Boolean);
    const currentTopics = (item.dayTopicCategories ?? []).filter(Boolean);
    const articlePickActionsBusy = busy || checkingArticlePickGoogle;

    const handleCheckArticlePickWithGoogle = async () => {
      setCheckingArticlePickGoogle(true);
      setArticlePickGoogleNote(null);
      setArticlePickGoogleError(null);
      try {
        const { pickId } = await checkArticlePickWithGoogle({
          date: row.date,
          scenario: item.scenario ?? undefined,
          currentSummary: betterStoryline ? currentSummary : undefined,
          candidates: articleCandidates.map((candidate) => ({
            id: candidate.id,
            title: candidate.title,
            publishedDate: candidate.publishedDate ?? null,
            tier: candidate.tier,
            summary: candidate.summary,
          })),
        });
        if (pickId) {
          setArticlePickId(pickId);
          const picked = articleCandidates.find((candidate) => candidate.id === pickId);
          setArticlePickGoogleNote(
            picked
              ? `Google picked: ${picked.title}. Review and approve when ready.`
              : "Google returned a pick. Review and approve when ready.",
          );
          queueMicrotask(() => {
            candidatesListRef.current
              ?.querySelector(`[data-candidate-id="${CSS.escape(pickId)}"]`)
              ?.scrollIntoView({ block: "nearest" });
          });
        } else {
          setArticlePickGoogleNote("Google found no reliable match — pick manually or reject.");
        }
      } catch (error) {
        setArticlePickGoogleError(error instanceof Error ? error.message : "Google check failed");
      } finally {
        setCheckingArticlePickGoogle(false);
      }
    };

    return (
      <div className="space-y-3">
        {item.removedDayContext ? <RemovedDayArticlePickBanner context={item.removedDayContext} /> : null}
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
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Candidates</p>
              <p className="text-[10px] text-muted-foreground/80">↑↓ pick · A approve · K keep · R reject · O day</p>
            </div>
            <div ref={candidatesListRef} className="max-h-80 space-y-2 overflow-y-auto pr-1">
            {orderedArticleCandidates
              .map((c, i) => {
                const blocked = c.calendarSanityOk === false;
                return (
                  <div
                    key={c.id}
                    data-candidate-id={c.id}
                    role="button"
                    tabIndex={busy ? -1 : 0}
                    aria-disabled={busy}
                    aria-pressed={selectedId === c.id}
                    onClick={() => {
                      if (busy) return;
                      setArticlePickGoogleNote(null);
                      setArticlePickGoogleError(null);
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
                variant="outline"
                className="w-full"
                disabled={articlePickActionsBusy || articleCandidates.length === 0}
                onClick={() => void handleCheckArticlePickWithGoogle()}
              >
                {checkingArticlePickGoogle ? (
                  <>
                    <Loader2 className="animate-spin" />
                    Checking…
                  </>
                ) : (
                  <>
                    <GoogleGIcon className="size-4 shrink-0" />
                    Check with Google
                  </>
                )}
              </Button>
              {articlePickGoogleNote ? (
                <p className="text-xs leading-relaxed text-muted-foreground">{articlePickGoogleNote}</p>
              ) : null}
              {articlePickGoogleError ? (
                <p className="text-xs leading-relaxed text-destructive">{articlePickGoogleError}</p>
              ) : null}
              <Button
                size="sm"
                className="w-full"
                disabled={articlePickActionsBusy || !selectedId || selectedBlocked}
                onClick={() => selectedId && onApprove(item.id, { selectedArticleId: selectedId })}
                title="Approve selected pick (A)"
              >
                Approve selected pick <kbd className="ml-1 rounded border border-border/80 px-1 text-[10px] font-normal text-muted-foreground">A</kbd>
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="w-full"
                disabled={articlePickActionsBusy}
                onClick={() =>
                  betterStoryline
                    ? onApprove(item.id, { keepCurrentSummary: true })
                    : onReject(row.id)
                }
                title={betterStoryline ? "Keep current summary (K)" : "Reject and rerun (R)"}
              >
                {betterStoryline ? (
                  <>
                    Keep current summary <kbd className="ml-1 rounded border border-border/80 px-1 text-[10px] font-normal text-muted-foreground">K</kbd>
                  </>
                ) : (
                  "Reject and rerun"
                )}
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (phase === "awaiting_calendar_decision") {
    return (
      <CalendarReviewPanel rows={[row]} busy={busy} onApprove={(id, opts) => onApprove(id, opts)} />
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
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <Button
            size="sm"
            className="w-full sm:w-auto"
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
            className="w-full sm:w-auto"
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
            className="w-full sm:w-auto"
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
          <div className="grid grid-cols-1 gap-3 md:grid-cols-[120px_minmax(0,1fr)_minmax(0,12rem)]">
            <ReviewCardDateField date={row.date} />
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
                {formatCorrectionChangeLines(summarizeCorrectionProposals(proposedChanges)).map((line) => (
                  <li key={line} className="text-xs text-muted-foreground">
                    • {line}
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
        <div className="grid grid-cols-1 gap-3 md:grid-cols-[120px_minmax(0,1fr)_minmax(0,12rem)]">
          <ReviewCardDateField date={row.date} />
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
  expandedId: string | null;
  onExpandedIdChange: (id: string | null) => void;
  onApprove: (id: string, opts?: ApproveReviewOpts) => Promise<void>;
  onReject: (id: string) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
};

function rowIsBusy(row: QueueRow, busyId: string | null): boolean {
  if (!busyId) return false;
  if (busyId === row.id) return true;
  return row.calendarGroup?.rows.some((member) => member.id === busyId) ?? false;
}

function ResolvedReviewBody({ row }: { row: QueueRow }) {
  if (row.pipelinePhase === "awaiting_calendar_decision") {
    return (
      <CalendarReviewPanel
        rows={[row]}
        busy={false}
        readOnly
        resolutionNote={row.item.reviewNotes}
        onApprove={() => {}}
      />
    );
  }
  return <ReviewerBriefCard row={row} />;
}

function QueueList({
  rows,
  busyId,
  advanceSignal,
  expandedId,
  onExpandedIdChange,
  onApprove,
  onReject,
  onRemove,
}: QueueListProps) {
  const previousRowsRef = useRef<QueueRow[]>(rows);
  const lastAdvanceNonceRef = useRef<number | null>(null);
  const [verifyBusyId, setVerifyBusyId] = useState<string | null>(null);
  const [verifyResults, setVerifyResults] = useState<Record<string, DayVerificationResult>>({});
  const reduceMotion = useReducedMotion();
  const panelTransition = reduceMotion
    ? { duration: 0.15 }
    : { duration: 0.3, ease: PANEL_EASE };

  useEffect(() => {
    if (
      expandedId &&
      !rows.some(
        (r) => r.id === expandedId || r.calendarGroup?.rows.some((member) => member.id === expandedId),
      )
    ) {
      onExpandedIdChange(null);
    }
  }, [rows, expandedId, onExpandedIdChange]);

  useEffect(() => {
    if (!advanceSignal) return;
    if (lastAdvanceNonceRef.current === advanceSignal.nonce) return;
    lastAdvanceNonceRef.current = advanceSignal.nonce;

    const previous = previousRowsRef.current;
    const rowIndex = (list: QueueRow[]) =>
      list.findIndex(
        (r) =>
          r.id === advanceSignal.id || r.calendarGroup?.rows.some((member) => member.id === advanceSignal.id),
      );
    const prevIndex = rowIndex(previous);
    if (rows.length === 0) {
      onExpandedIdChange(null);
      return;
    }
    if (prevIndex === -1) {
      onExpandedIdChange(rows[0].id);
      return;
    }
    const next = rows[prevIndex] ?? rows[Math.max(0, prevIndex - 1)] ?? rows[0];
    onExpandedIdChange(next.id);
  }, [advanceSignal, rows, onExpandedIdChange]);

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
          const group = row.calendarGroup;
          const reviewRows = group?.rows ?? [row];
          const busy = rowIsBusy(row, busyId);
          const calendarGroupRows =
            group?.rows.filter((member) => member.pipelinePhase === "awaiting_calendar_decision") ?? [];
          const showUnifiedCalendarPicker =
            Boolean(group && group.rows.length > 1) && calendarGroupRows.length > 0;
          const actionRowId =
            calendarGroupRows.find((member) => member.status === "pending")?.id ?? row.id;
          return (
            <li key={row.id} className="bg-card/20">
              <button
                type="button"
                className={cn(
                  "flex w-full items-start gap-2 px-3 py-3.5 text-left transition-colors hover:bg-muted/30 sm:gap-3 sm:px-4",
                  open && "bg-muted/20",
                )}
                onClick={() => onExpandedIdChange(expandedId === row.id ? null : row.id)}
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
                    <p className="font-mono text-xs text-muted-foreground">
                      {row.pipelinePhase === "awaiting_calendar_decision" ? calendarRowLabel(row) : row.date}
                    </p>
                    <Badge variant="outline" className="h-5 px-1.5 text-[10px] font-normal text-muted-foreground">
                      {phaseChipLabel(row.pipelinePhase)}
                    </Badge>
                    {group && group.rows.length > 1 ? (
                      <Badge variant="secondary" className="h-5 gap-1 px-1.5 text-[10px] font-normal">
                        <Link2 className="size-3" aria-hidden />
                        {group.dates.length} dates
                      </Badge>
                    ) : null}
                    {group && group.sharedDates.length > 0 ? (
                      <Badge variant="outline" className="h-5 px-1.5 text-[10px] font-normal text-muted-foreground">
                        shared {group.sharedDates.join(", ")}
                      </Badge>
                    ) : null}
                    {statusBadge(row.status)}
                  </div>
                  <p className="text-sm font-medium leading-snug text-foreground">{row.title}</p>
                  {row.subtitle ? (
                    <p className="text-xs leading-relaxed text-muted-foreground">{row.subtitle}</p>
                  ) : null}
                </div>
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
                        {showUnifiedCalendarPicker ? (
                          row.status === "pending" ? (
                            <>
                              <CalendarReviewPanel
                                rows={calendarGroupRows}
                                busy={busy}
                                onApprove={(id, opts) => void onApprove(id, opts)}
                              />
                              <div className="rounded-xl border border-border/70 bg-background/45 p-4">
                                <div className="mt-0 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="w-full sm:w-auto"
                                    disabled={busy}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      void onReject(actionRowId);
                                    }}
                                  >
                                    Reject
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="w-full border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive sm:w-auto"
                                    disabled={busy}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (
                                        !window.confirm(
                                          "Remove this pending review from the queue? This cannot be undone.",
                                        )
                                      ) {
                                        return;
                                      }
                                      void onRemove(actionRowId);
                                    }}
                                  >
                                    <Trash2 className="mr-2 size-4 shrink-0" aria-hidden />
                                    Remove from queue
                                  </Button>
                                </div>
                              </div>
                            </>
                          ) : (
                            calendarGroupRows.map((reviewRow) => (
                              <ResolvedReviewBody key={reviewRow.id} row={reviewRow} />
                            ))
                          )
                        ) : (
                          reviewRows.map((reviewRow) => (
                            <div key={reviewRow.id} className="space-y-4">
                              {reviewRow.status === "pending" ? (
                                <TailoredLiveReviewCard
                                  row={reviewRow}
                                  busy={busyId === reviewRow.id}
                                  onApprove={(id, opts) => void onApprove(id, opts)}
                                  onReject={(id) => void onReject(id)}
                                />
                              ) : (
                                <ResolvedReviewBody row={reviewRow} />
                              )}
                              {reviewRow.status === "pending" ? (
                                <div className="rounded-xl border border-border/70 bg-background/45 p-4">
                                  <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      className="w-full sm:w-auto"
                                      disabled={busy}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        void onReject(reviewRow.id);
                                      }}
                                    >
                                      Reject
                                    </Button>
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      className="w-full border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive sm:w-auto"
                                      disabled={busy}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        if (
                                          !window.confirm(
                                            "Remove this pending review from the queue? This cannot be undone.",
                                          )
                                        ) {
                                          return;
                                        }
                                        void onRemove(reviewRow.id);
                                      }}
                                    >
                                      <Trash2 className="mr-2 size-4 shrink-0" aria-hidden />
                                      Remove from queue
                                    </Button>
                                    {/^\d{4}-\d{2}-\d{2}$/.test(reviewRow.date) ? (
                                      <Button type="button" variant="outline" size="sm" className="w-full sm:w-auto" asChild>
                                        <Link href={`/day/${reviewRow.date}`} target="_blank" rel="noopener noreferrer">
                                          Open day
                                        </Link>
                                      </Button>
                                    ) : null}
                                  </div>
                                </div>
                              ) : null}
                            </div>
                          ))
                        )}
                        {row.status === "pending" &&
                        row.pipelinePhase === "triage" &&
                        !group &&
                        (row.operatorSnapshot?.shortCircuited || row.operatorSnapshot?.resumeStartsAvailable?.length) &&
                        /^\d{4}-\d{2}-\d{2}$/.test(row.date) ? (
                          <AgentsV2ResumeSlicePanel
                            date={row.date}
                            snapshot={row.operatorSnapshot}
                            disabled={busy}
                            onSliceStarted={(runId) => rememberLastPipelineRunId(runId)}
                          />
                        ) : null}
                        {!group ? (
                          <div className="rounded-xl border border-border/70 bg-background/45 p-4">
                            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Actions</p>
                            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                              {row.status === "pending" ? (
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="w-full sm:w-auto"
                                  disabled={busy}
                                  title="Reject (R)"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void onReject(row.id);
                                  }}
                                >
                                  Reject{" "}
                                  <kbd className="ml-1 hidden rounded border border-border/80 px-1 text-[10px] font-normal text-muted-foreground sm:inline">
                                    R
                                  </kbd>
                                </Button>
                              ) : null}
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="w-full border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive sm:w-auto"
                                disabled={busy}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const msg =
                                    row.status === "pending"
                                      ? "Remove this pending review from the queue? This cannot be undone."
                                      : "Remove this queue entry from the database? Pipeline step history is kept.";
                                  if (!window.confirm(msg)) return;
                                  void onRemove(row.id);
                                }}
                              >
                                <Trash2 className="mr-2 size-4 shrink-0" aria-hidden />
                                <span className="sm:hidden">Remove</span>
                                <span className="hidden sm:inline">Remove from queue</span>
                              </Button>
                              {/^\d{4}-\d{2}-\d{2}$/.test(row.date) ? (
                                <>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="w-full sm:w-auto"
                                    disabled={busy || verifyBusyId === row.id}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setVerifyBusyId(row.id);
                                      void verifyEditorialDay(row.date, "quick")
                                        .then((result) => {
                                          setVerifyResults((prev) => ({ ...prev, [row.id]: result }));
                                        })
                                        .catch(() => {
                                          toast({
                                            title: "Verify failed",
                                            description: "Could not verify this day.",
                                            variant: "destructive",
                                          });
                                        })
                                        .finally(() => setVerifyBusyId(null));
                                    }}
                                  >
                                    {verifyBusyId === row.id ? (
                                      <Loader2 className="mr-2 size-4 animate-spin" />
                                    ) : (
                                      <ShieldCheck className="mr-2 size-4 shrink-0" aria-hidden />
                                    )}
                                    Verify
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="w-full sm:w-auto"
                                    asChild
                                    title="Open day (O)"
                                  >
                                    <Link href={`/day/${row.date}`} target="_blank" rel="noopener noreferrer">
                                      Open day{" "}
                                      <kbd className="ml-1 hidden rounded border border-border/80 px-1 text-[10px] font-normal text-muted-foreground sm:inline">
                                        O
                                      </kbd>
                                    </Link>
                                  </Button>
                                </>
                              ) : null}
                            </div>
                            {verifyResults[row.id] ? (
                              <div
                                className={cn(
                                  "mt-3 rounded-lg border px-3 py-2 text-xs leading-relaxed",
                                  verifyResults[row.id].passed
                                    ? "border-emerald-500/30 bg-emerald-500/[0.06] text-muted-foreground"
                                    : "border-amber-500/35 bg-amber-500/[0.06] text-muted-foreground",
                                )}
                              >
                                <p className="font-medium text-foreground">
                                  {verifyResults[row.id].passed ? "Quick verify passed" : "Quick verify found issues"}
                                </p>
                                <ul className="mt-2 space-y-1">
                                  {verifyResults[row.id].checks
                                    .filter((c) => c.status !== "pass")
                                    .slice(0, 4)
                                    .map((c) => (
                                      <li key={c.id}>
                                        {c.label}: {c.message}
                                      </li>
                                    ))}
                                </ul>
                              </div>
                            ) : null}
                          </div>
                        ) : null}
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

const QUEUE_PAGE_SIZE = 50;

function calendarRowLabel(row: QueueRow): string {
  if (row.calendarGroup) return row.calendarGroup.dates.join(" · ");
  if (row.item.calendarReciprocalPair) {
    const pair = row.item.calendarReciprocalPair;
    return `${pair.sideA.date} ↔ ${pair.sideB.date}`;
  }
  const cd = row.item.calendarDecision;
  if (cd) return `${cd.currentDate} ↔ ${cd.expectedDate}`;
  return row.date;
}

type CalendarAutoProgress = {
  current: number;
  total: number;
  label: string;
};

function buildCalendarAutoWorkItems(rows: QueueRow[]): Array<{
  anchorId: string;
  label: string;
  entries: ReturnType<typeof collectCalendarDateEntries>;
}> {
  const seenAnchors = new Set<string>();
  const items: Array<{
    anchorId: string;
    label: string;
    entries: ReturnType<typeof collectCalendarDateEntries>;
  }> = [];

  for (const row of rows) {
    if (row.status !== "pending" || row.pipelinePhase !== "awaiting_calendar_decision") continue;

    const sourceRows = row.calendarGroup?.rows ?? [row];
    const pendingRows = sourceRows.filter(
      (member) => member.status === "pending" && member.pipelinePhase === "awaiting_calendar_decision",
    );
    if (pendingRows.length === 0) continue;

    const anchor = pendingRows[0];
    if (!anchor || seenAnchors.has(anchor.id)) continue;

    const entries = collectCalendarDateEntries(pendingRows);
    if (entries.length < 2) continue;

    seenAnchors.add(anchor.id);
    items.push({
      anchorId: anchor.id,
      label: calendarRowLabel(row),
      entries,
    });
  }

  return items;
}

type ArticlePickAutoWorkItem = {
  id: string;
  label: string;
  date: string;
  scenario?: "empty_day" | "missing_day" | "better_storyline";
  currentSummary?: string;
  candidates: NonNullable<QueueRow["item"]["candidates"]>;
};

function buildArticlePickAutoWorkItems(rows: QueueRow[]): ArticlePickAutoWorkItem[] {
  const seen = new Set<string>();
  const items: ArticlePickAutoWorkItem[] = [];

  for (const row of rows) {
    if (row.status !== "pending" || row.pipelinePhase !== "awaiting_article_pick") continue;
    if (seen.has(row.id)) continue;

    const candidates = row.item.candidates ?? [];
    if (candidates.length === 0) continue;

    seen.add(row.id);
    items.push({
      id: row.id,
      label: row.date,
      date: row.date,
      scenario: row.item.scenario ?? undefined,
      currentSummary:
        row.item.scenario === "better_storyline" ? row.item.daySummary?.trim() || undefined : undefined,
      candidates,
    });
  }

  return items;
}

export default function AgentsV2HomePanel() {
  const [filter, setFilter] = useState<FilterTab>("pending");
  const [scenarioFilter, setScenarioFilter] = useState<ScenarioFilter>("all");
  const [rows, setRows] = useState<QueueRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [clearing, setClearing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [advanceSignal, setAdvanceSignal] = useState<{ id: string; nonce: number } | null>(null);
  const [page, setPage] = useState(0);
  const [queueTotal, setQueueTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [calendarAutoRunning, setCalendarAutoRunning] = useState(false);
  const [calendarAutoProgress, setCalendarAutoProgress] = useState<CalendarAutoProgress | null>(null);
  const [calendarAutoLogLines, setCalendarAutoLogLines] = useState<LogLine[]>([]);
  const calendarAutoStopRef = useRef(false);
  const calendarAutoLogScrollRef = useRef<HTMLDivElement | null>(null);
  const [articlePickAutoRunning, setArticlePickAutoRunning] = useState(false);
  const [articlePickAutoProgress, setArticlePickAutoProgress] = useState<CalendarAutoProgress | null>(null);
  const [articlePickAutoLogLines, setArticlePickAutoLogLines] = useState<LogLine[]>([]);
  const articlePickAutoStopRef = useRef(false);
  const articlePickAutoLogScrollRef = useRef<HTMLDivElement | null>(null);
  const autoRunBusy = calendarAutoRunning || articlePickAutoRunning;

  useEffect(() => {
    if (calendarAutoLogLines.length === 0) return;
    let cancelled = false;
    let innerRaf = 0;
    const outerRaf = requestAnimationFrame(() => {
      innerRaf = requestAnimationFrame(() => {
        if (cancelled) return;
        const root = calendarAutoLogScrollRef.current;
        const viewport = root?.querySelector("[data-radix-scroll-area-viewport]") as HTMLElement | null;
        if (!viewport) return;
        viewport.scrollTo({ top: viewport.scrollHeight, behavior: "smooth" });
      });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(outerRaf);
      cancelAnimationFrame(innerRaf);
    };
  }, [calendarAutoLogLines]);

  useEffect(() => {
    if (articlePickAutoLogLines.length === 0) return;
    let cancelled = false;
    let innerRaf = 0;
    const outerRaf = requestAnimationFrame(() => {
      innerRaf = requestAnimationFrame(() => {
        if (cancelled) return;
        const root = articlePickAutoLogScrollRef.current;
        const viewport = root?.querySelector("[data-radix-scroll-area-viewport]") as HTMLElement | null;
        if (!viewport) return;
        viewport.scrollTo({ top: viewport.scrollHeight, behavior: "smooth" });
      });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(outerRaf);
      cancelAnimationFrame(innerRaf);
    };
  }, [articlePickAutoLogLines]);

  const loadQueue = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    try {
      const status = filter === "all" ? "all" : filter;
      const offset = page * QUEUE_PAGE_SIZE;
      const phase = scenarioFilter !== "all" ? scenarioFilter : undefined;
      const result = await fetchReviewQueue(status, { limit: QUEUE_PAGE_SIZE, offset, phase });
      setRows(result.items.map(mapReviewItemToQueueRow));
      setQueueTotal(result.total);
      setHasMore(result.hasMore);
    } catch (e) {
      toast({
        title: "Queue",
        description: e instanceof Error ? e.message : "Failed to load review queue",
        variant: "destructive",
      });
    } finally {
      if (!opts?.silent) setLoading(false);
    }
  }, [filter, page, scenarioFilter]);

  useEffect(() => {
    void loadQueue();
  }, [loadQueue]);

  const handleApprove = async (id: string, opts?: ApproveReviewOpts) => {
    setBusyId(id);
    try {
      const source = rows.find((r) => r.id === id);
      const pair = source?.item.calendarReciprocalPair;

      if (opts?.calendarGroupDates && opts?.calendarRemoveDates !== undefined) {
        await approveReviewItem(id, {
          calendarGroupDates: opts.calendarGroupDates,
          calendarRemoveDates: opts.calendarRemoveDates,
        });
      } else if (opts?.calendarKeepDate && opts?.calendarRerunDate) {
        await approveReviewItem(id, {
          calendarKeepDate: opts.calendarKeepDate,
          calendarRerunDate: opts.calendarRerunDate,
        });
      } else if (opts?.calendarPairResolution === "keep_both" && pair) {
        const pairRows = rows.filter(
          (r) => r.status === "pending" && r.item.calendarReciprocalPair?.pairKey === pair.pairKey,
        );
        for (const row of pairRows) {
          await approveReviewItem(row.id, { calendarDecision: "keep_as_is" });
        }
      } else {
        await approveReviewItem(id, opts);
      }

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
      await loadQueue({ silent: true });
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
      await loadQueue({ silent: true });
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
      await loadQueue({ silent: true });
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

  const stopCalendarAutoRun = () => {
    calendarAutoStopRef.current = true;
  };

  const stopArticlePickAutoRun = () => {
    articlePickAutoStopRef.current = true;
  };

  const runCalendarAutoWithGoogle = async () => {
    calendarAutoStopRef.current = false;
    setCalendarAutoRunning(true);
    setCalendarAutoProgress(null);
    setCalendarAutoLogLines([]);

    let processed = 0;
    let approved = 0;
    let failed = 0;

    const pushLog = (line: LogLine) => {
      setCalendarAutoLogLines((prev) => [...prev, line]);
    };

    const patchLog = (id: string, patch: Partial<LogLine>) => {
      setCalendarAutoLogLines((prev) => prev.map((line) => (line.id === id ? { ...line, ...patch } : line)));
    };

    try {
      pushLog({
        id: "calendar-auto-load",
        text: "Loading pending calendar items…",
        status: "pending",
      });

      const rawRows: QueueRow[] = [];
      let offset = 0;
      let total = 0;

      while (true) {
        const result = await fetchReviewQueue("pending", {
          limit: QUEUE_PAGE_SIZE,
          offset,
          phase: "awaiting_calendar_decision",
        });
        rawRows.push(...result.items.map(mapReviewItemToQueueRow));
        total = result.total;
        if (!result.hasMore) break;
        offset += QUEUE_PAGE_SIZE;
      }

      const workItems = buildCalendarAutoWorkItems(consolidateQueueRows(rawRows));
      if (workItems.length === 0) {
        patchLog("calendar-auto-load", {
          status: "rejected",
          text: "No pending calendar items found.",
        });
        toast({ title: "Nothing to run", description: "No pending calendar items found." });
        return;
      }

      patchLog("calendar-auto-load", {
        status: "approved",
        text: `Loaded ${workItems.length} calendar item${workItems.length === 1 ? "" : "s"} (${total.toLocaleString()} in queue).`,
      });

      for (let index = 0; index < workItems.length; index += 1) {
        if (calendarAutoStopRef.current) break;

        const item = workItems[index];
        const allDates = item.entries.map((entry) => entry.date);
        const logId = `calendar-auto-${item.anchorId}-${index}`;
        setCalendarAutoProgress({
          current: index + 1,
          total: workItems.length,
          label: item.label,
        });
        setBusyId(item.anchorId);
        processed += 1;

        pushLog({
          id: logId,
          text: `${item.label} · Google check…`,
          status: "pending",
        });

        try {
          const { removeDates } = await checkCalendarDatesWithGoogle(
            item.entries.map((entry) => ({ date: entry.date, summary: entry.summary })),
          );
          const cappedRemoveDates = capCalendarRemoveDates(allDates, removeDates);
          await approveReviewItem(item.anchorId, {
            calendarGroupDates: allDates,
            calendarRemoveDates: cappedRemoveDates,
          });
          approved += 1;
          patchLog(logId, {
            status: "approved",
            text:
              cappedRemoveDates.length === 0
                ? `${item.label} · kept all dates`
                : `${item.label} · removed ${cappedRemoveDates.join(", ")}`,
          });
        } catch (e) {
          failed += 1;
          const message = e instanceof Error ? e.message : "Error";
          patchLog(logId, {
            status: "rejected",
            text: `${item.label} · ${message}`,
          });
          console.error("Calendar auto-run failed for", item.label, e);
        }
      }

      await loadQueue({ silent: true });

      if (calendarAutoStopRef.current) {
        pushLog({
          id: `calendar-auto-stop-${Date.now()}`,
          text: `Stopped after ${processed} item${processed === 1 ? "" : "s"} · approved ${approved}, failed ${failed}.`,
          status: "review",
        });
        toast({
          title: "Auto-run stopped",
          description: `Processed ${processed} of ${workItems.length}. Approved ${approved}, failed ${failed}.`,
        });
      } else {
        pushLog({
          id: `calendar-auto-done-${Date.now()}`,
          text: `Complete · approved ${approved} of ${workItems.length}${failed ? ` · ${failed} failed` : ""}.`,
          status: failed > 0 ? "review" : "approved",
        });
        toast({
          title: "Calendar auto-run complete",
          description: `Approved ${approved} of ${workItems.length} item${workItems.length === 1 ? "" : "s"}${failed ? ` · ${failed} failed` : ""}. Queue total was ${total.toLocaleString()}.`,
        });
      }
    } catch (e) {
      pushLog({
        id: `calendar-auto-error-${Date.now()}`,
        text: e instanceof Error ? e.message : "Auto-run failed",
        status: "rejected",
      });
      toast({
        title: "Auto-run failed",
        description: e instanceof Error ? e.message : "Error",
        variant: "destructive",
      });
    } finally {
      setBusyId(null);
      setCalendarAutoRunning(false);
      setCalendarAutoProgress(null);
      calendarAutoStopRef.current = false;
    }
  };

  const runArticlePickAutoWithGoogle = async () => {
    articlePickAutoStopRef.current = false;
    setArticlePickAutoRunning(true);
    setArticlePickAutoProgress(null);
    setArticlePickAutoLogLines([]);

    let processed = 0;
    let approved = 0;
    let skipped = 0;
    let failed = 0;

    const pushLog = (line: LogLine) => {
      setArticlePickAutoLogLines((prev) => [...prev, line]);
    };

    const patchLog = (id: string, patch: Partial<LogLine>) => {
      setArticlePickAutoLogLines((prev) => prev.map((line) => (line.id === id ? { ...line, ...patch } : line)));
    };

    try {
      pushLog({
        id: "article-pick-auto-load",
        text: "Loading pending article-pick items…",
        status: "pending",
      });

      const rawRows: QueueRow[] = [];
      let offset = 0;
      let total = 0;

      while (true) {
        const result = await fetchReviewQueue("pending", {
          limit: QUEUE_PAGE_SIZE,
          offset,
          phase: "awaiting_article_pick",
        });
        rawRows.push(...result.items.map(mapReviewItemToQueueRow));
        total = result.total;
        if (!result.hasMore) break;
        offset += QUEUE_PAGE_SIZE;
      }

      const workItems = buildArticlePickAutoWorkItems(rawRows);
      if (workItems.length === 0) {
        patchLog("article-pick-auto-load", {
          status: "rejected",
          text: "No pending article-pick items with candidates found.",
        });
        toast({
          title: "Nothing to run",
          description: "No pending article-pick items with candidates found.",
        });
        return;
      }

      patchLog("article-pick-auto-load", {
        status: "approved",
        text: `Loaded ${workItems.length} article-pick item${workItems.length === 1 ? "" : "s"} (${total.toLocaleString()} in queue).`,
      });

      for (let index = 0; index < workItems.length; index += 1) {
        if (articlePickAutoStopRef.current) break;

        const item = workItems[index]!;
        const logId = `article-pick-auto-${item.id}-${index}`;
        setArticlePickAutoProgress({
          current: index + 1,
          total: workItems.length,
          label: item.label,
        });
        setBusyId(item.id);
        processed += 1;

        pushLog({
          id: logId,
          text: `${item.label} · Google check…`,
          status: "pending",
        });

        try {
          const { pickId } = await checkArticlePickWithGoogle({
            date: item.date,
            scenario: item.scenario,
            currentSummary: item.currentSummary,
            candidates: item.candidates.map((candidate) => ({
              id: candidate.id,
              title: candidate.title,
              publishedDate: candidate.publishedDate ?? null,
              tier: candidate.tier,
              summary: candidate.summary,
            })),
          });

          if (!pickId) {
            skipped += 1;
            patchLog(logId, {
              status: "review",
              text: `${item.label} · no reliable match — left in queue`,
            });
            continue;
          }

          const picked = item.candidates.find((candidate) => candidate.id === pickId);
          if (!picked) {
            skipped += 1;
            patchLog(logId, {
              status: "review",
              text: `${item.label} · unknown pick id — left in queue`,
            });
            continue;
          }

          if (picked.calendarSanityOk === false) {
            skipped += 1;
            patchLog(logId, {
              status: "review",
              text: `${item.label} · "${picked.title.slice(0, 60)}" blocked by date sanity — left in queue`,
            });
            continue;
          }

          await approveReviewItem(item.id, { selectedArticleId: pickId });
          approved += 1;
          patchLog(logId, {
            status: "approved",
            text: `${item.label} · picked "${picked.title.slice(0, 80)}"`,
          });
        } catch (e) {
          failed += 1;
          const message = e instanceof Error ? e.message : "Error";
          patchLog(logId, {
            status: "rejected",
            text: `${item.label} · ${message}`,
          });
          console.error("Article pick auto-run failed for", item.label, e);
        }
      }

      await loadQueue({ silent: true });

      if (articlePickAutoStopRef.current) {
        pushLog({
          id: `article-pick-auto-stop-${Date.now()}`,
          text: `Stopped after ${processed} item${processed === 1 ? "" : "s"} · approved ${approved}, skipped ${skipped}, failed ${failed}.`,
          status: "review",
        });
        toast({
          title: "Auto-run stopped",
          description: `Processed ${processed} of ${workItems.length}. Approved ${approved}, skipped ${skipped}, failed ${failed}.`,
        });
      } else {
        pushLog({
          id: `article-pick-auto-done-${Date.now()}`,
          text: `Complete · approved ${approved} of ${workItems.length}${skipped ? ` · skipped ${skipped}` : ""}${failed ? ` · ${failed} failed` : ""}.`,
          status: failed > 0 ? "review" : "approved",
        });
        toast({
          title: "Article pick auto-run complete",
          description: `Approved ${approved} of ${workItems.length} item${workItems.length === 1 ? "" : "s"}${skipped ? ` · skipped ${skipped}` : ""}${failed ? ` · ${failed} failed` : ""}. Queue total was ${total.toLocaleString()}.`,
        });
      }
    } catch (e) {
      pushLog({
        id: `article-pick-auto-error-${Date.now()}`,
        text: e instanceof Error ? e.message : "Auto-run failed",
        status: "rejected",
      });
      toast({
        title: "Auto-run failed",
        description: e instanceof Error ? e.message : "Error",
        variant: "destructive",
      });
    } finally {
      setBusyId(null);
      setArticlePickAutoRunning(false);
      setArticlePickAutoProgress(null);
      articlePickAutoStopRef.current = false;
    }
  };

  const listRows = filter === "pending" ? consolidateQueueRows(rows) : rows;
  const listProps = {
    rows: listRows,
    busyId,
    advanceSignal,
    expandedId,
    onExpandedIdChange: setExpandedId,
    onApprove: handleApprove,
    onReject: handleReject,
    onRemove: handleRemove,
  };

  const pageStart = queueTotal === 0 ? 0 : page * QUEUE_PAGE_SIZE + 1;
  const pageEnd = Math.min((page + 1) * QUEUE_PAGE_SIZE, queueTotal);

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6 md:p-8">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-foreground">Review queue</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Review the recommended action, then approve, reject, or open the day.
            {queueTotal > 0 ? ` ${queueTotal.toLocaleString()} item${queueTotal === 1 ? "" : "s"} in this tab.` : null}
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
          if (v === "pending" || v === "approved" || v === "rejected" || v === "all") {
            setFilter(v);
            setPage(0);
            setExpandedId(null);
          }
        }}
        className="w-full"
      >
        <TabsList className="grid h-11 w-full grid-cols-4 gap-1 rounded-xl border border-border/70 bg-background/80 p-1 shadow-sm">
          <TabsTrigger value="pending" className="rounded-lg px-2 text-xs text-muted-foreground data-[state=active]:bg-amber-500 data-[state=active]:text-black data-[state=active]:shadow-sm sm:text-sm">Pending</TabsTrigger>
          <TabsTrigger value="approved" className="rounded-lg px-2 text-xs text-muted-foreground data-[state=active]:bg-emerald-500 data-[state=active]:text-black data-[state=active]:shadow-sm sm:text-sm">Approved</TabsTrigger>
          <TabsTrigger value="rejected" className="rounded-lg px-2 text-xs text-muted-foreground data-[state=active]:bg-red-500 data-[state=active]:text-white data-[state=active]:shadow-sm sm:text-sm">Rejected</TabsTrigger>
          <TabsTrigger value="all" className="rounded-lg px-2 text-xs text-muted-foreground data-[state=active]:bg-foreground data-[state=active]:text-background data-[state=active]:shadow-sm sm:text-sm">All</TabsTrigger>
        </TabsList>

        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
          <label className="inline-flex w-full flex-col gap-1.5 text-xs text-muted-foreground sm:w-auto sm:flex-row sm:items-center sm:gap-2">
            Scenario
            <select
              value={scenarioFilter}
              onChange={(e) => {
                setScenarioFilter(e.target.value as ScenarioFilter);
                setPage(0);
                setExpandedId(null);
              }}
              disabled={autoRunBusy}
              className="h-9 w-full rounded-md border border-border bg-background px-2 text-xs text-foreground outline-none disabled:cursor-not-allowed disabled:opacity-50 sm:h-8 sm:w-auto sm:min-w-[11rem]"
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

          {scenarioFilter === "awaiting_calendar_decision" && filter === "pending" ? (
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
              {calendarAutoRunning ? (
                <Button type="button" variant="destructive" size="sm" onClick={stopCalendarAutoRun}>
                  <StopCircle className="size-4" />
                  Stop
                </Button>
              ) : (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button type="button" size="sm" disabled={loading || clearing || autoRunBusy}>
                      <GoogleGIcon className="size-4 shrink-0" />
                      Auto-run with Google
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Auto-run all calendar decisions with Google?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This checks every pending calendar item one by one with Google Search grounding, then
                        auto-approves each using Google&apos;s remove-date suggestions. Removed dates are cleared and
                        re-run. This cannot be undone.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction asChild>
                        <Button type="button" onClick={() => void runCalendarAutoWithGoogle()}>
                          Run all
                        </Button>
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
            </div>
          ) : null}

          {scenarioFilter === "awaiting_article_pick" && filter === "pending" ? (
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
              {articlePickAutoRunning ? (
                <Button type="button" variant="destructive" size="sm" onClick={stopArticlePickAutoRun}>
                  <StopCircle className="size-4" />
                  Stop
                </Button>
              ) : (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button type="button" size="sm" disabled={loading || clearing || autoRunBusy}>
                      <GoogleGIcon className="size-4 shrink-0" />
                      Auto-run with Google
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Auto-run all article picks with Google?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This checks every pending article-pick item with Google Search grounding, then auto-approves
                        each when Google returns a reliable pick. Items with no match or a date-sanity block stay in the
                        queue for manual review. This cannot be undone.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction asChild>
                        <Button type="button" onClick={() => void runArticlePickAutoWithGoogle()}>
                          Run all
                        </Button>
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
            </div>
          ) : null}
        </div>

        {calendarAutoProgress || calendarAutoRunning || calendarAutoLogLines.length > 0 ? (
          <div className="mt-3 space-y-2">
            {calendarAutoProgress ? (
              <div className="rounded-lg border border-border/70 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                <p className="flex items-center gap-2">
                  {calendarAutoRunning ? <Loader2 className="size-3.5 animate-spin" /> : null}
                  Processing {calendarAutoProgress.current} of {calendarAutoProgress.total}: {calendarAutoProgress.label}
                </p>
              </div>
            ) : null}
            {calendarAutoLogLines.length > 0 ? (
              <section className="space-y-2">
                <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Activity log
                </Label>
                <PipelineActivityLog
                  lines={calendarAutoLogLines}
                  scrollRef={calendarAutoLogScrollRef}
                  scrollClassName="h-[200px]"
                />
              </section>
            ) : null}
          </div>
        ) : null}

        {articlePickAutoProgress || articlePickAutoRunning || articlePickAutoLogLines.length > 0 ? (
          <div className="mt-3 space-y-2">
            {articlePickAutoProgress ? (
              <div className="rounded-lg border border-border/70 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                <p className="flex items-center gap-2">
                  {articlePickAutoRunning ? <Loader2 className="size-3.5 animate-spin" /> : null}
                  Processing {articlePickAutoProgress.current} of {articlePickAutoProgress.total}:{" "}
                  {articlePickAutoProgress.label}
                </p>
              </div>
            ) : null}
            {articlePickAutoLogLines.length > 0 ? (
              <section className="space-y-2">
                <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Activity log
                </Label>
                <PipelineActivityLog
                  lines={articlePickAutoLogLines}
                  scrollRef={articlePickAutoLogScrollRef}
                  scrollClassName="h-[200px]"
                />
              </section>
            ) : null}
          </div>
        ) : null}

        <div className="mt-4 space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-muted-foreground">
              {loading ?
                "Loading…"
              : queueTotal === 0 ?
                "No items on this page."
              : `Showing ${pageStart.toLocaleString()}–${pageEnd.toLocaleString()} of ${queueTotal.toLocaleString()}`}
            </p>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={loading || page === 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
              >
                <ChevronLeft className="size-4" />
                Previous
              </Button>
              <span className="min-w-[4.5rem] text-center text-xs text-muted-foreground">
                Page {page + 1}
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={loading || !hasMore}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
                <ChevronRight className="size-4" />
              </Button>
            </div>
          </div>
          {loading ? (
            <p className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Loading…
            </p>
          ) : (
            <QueueList {...listProps} />
          )}
        </div>
      </Tabs>
    </div>
  );
}
