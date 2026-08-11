import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

import { DayPendingReviewPanel } from "@/components/DayPendingReviewPanel";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PipelineActivityLog } from "@/components/PipelineActivityLog";
import {
  fetchPipelineRun,
  fetchReviewQueue,
  rememberLastPipelineRunId,
  startPipelineRun,
  stopPipelineRun,
} from "@/lib/editorial-pipeline";
import {
  buildActivityLogFromDetail,
  logLinesEqual,
  namespaceLogLines,
  type LogLine,
} from "@/lib/pipelineActivityLog";
import { supabase } from "@/lib/supabase";
import { RARITY_LABELS, type Rarity } from "@shared/rarity";

const POLL_MS = 1500;

type FlowPhase = "pipeline" | "decisions" | "google" | "rarity" | "done";

type SingleDayAgentDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  date: string;
  topicLeaf?: string | null;
  onRunFinished?: () => void;
};

function googleCheckLabel(happened: "yes" | "no" | "uncertain"): string {
  if (happened === "yes") return "Happened";
  if (happened === "no") return "Didn't happen";
  return "Uncertain";
}

async function loadPendingReviewCount(date: string): Promise<number> {
  try {
    const page = await fetchReviewQueue("pending", { limit: 5, eventDate: date });
    return page.items.filter((item) => item.eventDate === date).length;
  } catch {
    const response = await fetch(`/api/analysis/date/${date}/pending-agent-queue`, {
      credentials: "include",
    });
    if (!response.ok) return 0;
    const payload = await response.json().catch(() => null);
    return Array.isArray(payload?.pending) ? payload.pending.length : 0;
  }
}

async function loadDayTagCount(date: string): Promise<number> {
  if (supabase) {
    const { data } = await supabase
      .from("historical_news_analyses")
      .select("tags_version2")
      .eq("date", date)
      .maybeSingle();
    return Array.isArray(data?.tags_version2) ?
        data.tags_version2.filter((tag) => typeof tag === "string" && tag.trim()).length
      : 0;
  }

  const response = await fetch(`/api/analysis/date/${date}`);
  if (!response.ok) return 0;
  const payload = await response.json().catch(() => null);
  const tags =
    payload?.analysis?.tags_version2 ??
    payload?.analysis?.tagsVersion2 ??
    payload?.tags_version2 ??
    [];
  return Array.isArray(tags) ? tags.filter((tag) => typeof tag === "string" && tag.trim()).length : 0;
}

async function loadDaySummary(date: string): Promise<string | null> {
  if (supabase) {
    const { data } = await supabase
      .from("historical_news_analyses")
      .select("summary")
      .eq("date", date)
      .maybeSingle();
    const summary = typeof data?.summary === "string" ? data.summary.trim() : "";
    if (summary) return summary;
  }

  const response = await fetch(`/api/analysis/date/${date}`);
  if (!response.ok) return null;
  const payload = await response.json().catch(() => null);
  const summary =
    typeof payload?.analysis?.summary === "string"
      ? payload.analysis.summary
      : typeof payload?.summary === "string"
        ? payload.summary
        : "";
  return summary.trim() || null;
}

async function runGoogleCheckForDay(opts: {
  date: string;
  topicLeaf?: string | null;
}): Promise<{ happened: "yes" | "no" | "uncertain" }> {
  const summary = await loadDaySummary(opts.date);
  if (!summary) {
    throw new Error("No summary available for Google Check");
  }

  const response = await fetch("/api/analysis/google-verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      date: opts.date,
      summary,
      topicLeaf: opts.topicLeaf ?? null,
    }),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(
      typeof payload?.error === "string" ? payload.error : response.statusText || "Google Check failed",
    );
  }

  const result = await response.json();
  if (result?.happened !== "yes" && result?.happened !== "no" && result?.happened !== "uncertain") {
    throw new Error("Google Check returned no verdict");
  }
  return { happened: result.happened };
}

async function assignRarityForDay(date: string): Promise<{ rarity: Rarity | null; skippedReason?: string }> {
  const response = await fetch("/api/quality-check/bulk-assign-rarity", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dates: [date] }),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(
      typeof payload?.error === "string" ? payload.error : response.statusText || "Rarity assignment failed",
    );
  }

  const result = (await response.json()) as {
    total?: number;
    results?: Record<string, { rarity?: string | null; error?: string }>;
  };

  if (!result.total) {
    return {
      rarity: null,
      skippedReason: "day not locked (needs storyline topic + Google Check yes)",
    };
  }

  const row = result.results?.[date];
  const rarity = row?.rarity && row.rarity in RARITY_LABELS ? (row.rarity as Rarity) : null;
  if (rarity) return { rarity };
  throw new Error(row?.error || "no rarity label returned");
}

export function SingleDayAgentDialog({
  open,
  onOpenChange,
  date,
  topicLeaf = null,
  onRunFinished,
}: SingleDayAgentDialogProps) {
  const [runId, setRunId] = useState<string | null>(null);
  const [phase, setPhase] = useState<FlowPhase>("pipeline");
  const [isRunning, setIsRunning] = useState(false);
  const [logLines, setLogLines] = useState<LogLine[]>([]);
  const [startError, setStartError] = useState<string | null>(null);
  const logScrollRootRef = useRef<HTMLDivElement | null>(null);
  const isRunningRef = useRef(isRunning);
  isRunningRef.current = isRunning;
  const runIdRef = useRef<string | null>(runId);
  runIdRef.current = runId;
  const phaseRef = useRef<FlowPhase>(phase);
  phaseRef.current = phase;
  const googleCheckStartedRef = useRef(false);
  const pipelineFinishHandledRef = useRef(false);
  const userStoppedRef = useRef(false);
  const pipelineStatusRef = useRef("completed");

  const appendOrReplaceLog = useCallback((line: LogLine) => {
    setLogLines((prev) => {
      const idx = prev.findIndex((entry) => entry.id === line.id);
      if (idx === -1) return [...prev, line];
      const next = [...prev];
      next[idx] = line;
      return next;
    });
  }, []);

  const runGoogleCheckStep = useCallback(
    async (pipelineStatus: string) => {
      if (userStoppedRef.current) return;
      googleCheckStartedRef.current = true;
      setPhase("google");
      setIsRunning(true);
      isRunningRef.current = true;

      const googleLineId = `${runIdRef.current ?? "run"}-google-check`;
      const rarityLineId = `${runIdRef.current ?? "run"}-rarity`;
      appendOrReplaceLog({
        id: googleLineId,
        text:
          pipelineStatus === "completed"
            ? "Running Google Check…"
            : `Pipeline ended (${pipelineStatus}) — still running Google Check…`,
        status: "pending",
      });

      let googleHappened: "yes" | "no" | "uncertain" | null = null;

      try {
        const result = await runGoogleCheckForDay({ date, topicLeaf });
        if (userStoppedRef.current) return;
        googleHappened = result.happened;
        appendOrReplaceLog({
          id: googleLineId,
          text: "Google Check complete —",
          emphasis: googleCheckLabel(result.happened),
          status: "approved",
        });
      } catch (error) {
        if (userStoppedRef.current) return;
        const message = error instanceof Error ? error.message : "Google Check failed";
        appendOrReplaceLog({
          id: googleLineId,
          text: `Google Check failed — ${message}`,
          status: "rejected",
        });
      }

      if (userStoppedRef.current) return;

      if (googleHappened === "yes") {
        setPhase("rarity");
        appendOrReplaceLog({
          id: rarityLineId,
          text: "Assigning rarity…",
          status: "pending",
        });
        try {
          const rarityResult = await assignRarityForDay(date);
          if (userStoppedRef.current) return;
          if (rarityResult.rarity) {
            appendOrReplaceLog({
              id: rarityLineId,
              text: "Rarity assigned —",
              emphasis: RARITY_LABELS[rarityResult.rarity],
              status: "approved",
            });
          } else {
            appendOrReplaceLog({
              id: rarityLineId,
              text: `Rarity skipped — ${rarityResult.skippedReason ?? "not eligible"}`,
              status: "review",
            });
          }
        } catch (error) {
          if (userStoppedRef.current) return;
          const message = error instanceof Error ? error.message : "Rarity assignment failed";
          appendOrReplaceLog({
            id: rarityLineId,
            text: `Rarity failed — ${message}`,
            status: "rejected",
          });
        }
      } else if (googleHappened) {
        appendOrReplaceLog({
          id: rarityLineId,
          text: "Rarity skipped — Google Check did not pass",
          status: "review",
        });
      }

      if (!userStoppedRef.current) {
        setPhase("done");
        setIsRunning(false);
        isRunningRef.current = false;
        onRunFinished?.();
      }
    },
    [appendOrReplaceLog, date, onRunFinished, topicLeaf],
  );

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    googleCheckStartedRef.current = false;
    pipelineFinishHandledRef.current = false;
    userStoppedRef.current = false;
    setRunId(null);
    setPhase("pipeline");
    setIsRunning(true);
    setStartError(null);
    setLogLines([
      {
        id: "starting",
        text: `Starting final agent for ${date}…`,
        status: "pending",
      },
    ]);

    void (async () => {
      try {
        const out = await startPipelineRun({
          dateFrom: date,
          dateTo: date,
          maxDaysToConsider: 1,
        });
        if (cancelled) {
          try {
            await stopPipelineRun(out.runId);
          } catch {
            /* best effort */
          }
          return;
        }
        setRunId(out.runId);
        rememberLastPipelineRunId(out.runId);
        setLogLines([
          {
            id: `${out.runId}-start`,
            text: `Pipeline run ${out.runId.slice(0, 8)}… · ${date}`,
            status: "approved",
          },
        ]);
      } catch (error) {
        if (cancelled) return;
        setIsRunning(false);
        setPhase("done");
        const message = error instanceof Error ? error.message : "Could not start pipeline";
        setStartError(message);
        setLogLines([
          {
            id: "start-error",
            text: `Run failed to start — ${message}`,
            status: "rejected",
          },
        ]);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, date]);

  useEffect(() => {
    if (!open || !runId) return;

    let cancelled = false;

    const afterPipeline = async (pipelineStatus: string) => {
      if (pipelineFinishHandledRef.current || userStoppedRef.current) return;
      pipelineFinishHandledRef.current = true;
      pipelineStatusRef.current = pipelineStatus;

      const pendingCount = await loadPendingReviewCount(date);
      if (cancelled || userStoppedRef.current) return;

      if (pendingCount > 0) {
        setPhase("decisions");
        setIsRunning(false);
        isRunningRef.current = false;
        appendOrReplaceLog({
          id: `${runId}-pending-review`,
          text: `${pendingCount} decision${pendingCount === 1 ? "" : "s"} — answer below, then Google Check continues`,
          status: "review",
        });
        onRunFinished?.();
        return;
      }

      const tagCount = await loadDayTagCount(date);
      if (cancelled || userStoppedRef.current) return;
      if (tagCount === 0) {
        appendOrReplaceLog({
          id: `${runIdRef.current ?? "run"}-tags-missing`,
          text: "Tags still empty — add tags on the day page, then rerun final agent",
          status: "rejected",
        });
        setPhase("done");
        setIsRunning(false);
        isRunningRef.current = false;
        onRunFinished?.();
        return;
      }

      await runGoogleCheckStep(pipelineStatus);
    };

    const poll = async () => {
      if (cancelled || phaseRef.current !== "pipeline") return;
      try {
        const detail = await fetchPipelineRun(runId);
        if (cancelled) return;
        const built = namespaceLogLines(buildActivityLogFromDetail(detail), detail.run.id);
        setLogLines((prev) => {
          const kept = prev.filter(
            (line) =>
              line.id.endsWith("-google-check") ||
              line.id.endsWith("-rarity") ||
              line.id.endsWith("-pending-review"),
          );
          const next = [...built, ...kept];
          return logLinesEqual(prev, next) ? prev : next;
        });
        if (detail.run.status !== "running" && phaseRef.current === "pipeline") {
          void afterPipeline(detail.run.status);
        }
      } catch {
        /* keep polling */
      }
    };

    void poll();
    const timer = window.setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [open, runId, date, appendOrReplaceLog, onRunFinished, runGoogleCheckStep]);

  const handleDecisionsCleared = async () => {
    if (phaseRef.current !== "decisions" || userStoppedRef.current) return;

    const tagCount = await loadDayTagCount(date);
    if (tagCount === 0) {
      appendOrReplaceLog({
        id: `${runIdRef.current ?? "run"}-pending-review`,
        text: "Tags still empty — add tags on the day page, then rerun final agent",
        status: "rejected",
      });
      setPhase("done");
      setIsRunning(false);
      isRunningRef.current = false;
      onRunFinished?.();
      return;
    }

    appendOrReplaceLog({
      id: `${runIdRef.current ?? "run"}-pending-review`,
      text: "Decisions done — continuing to Google Check",
      status: "approved",
    });
    void runGoogleCheckStep(pipelineStatusRef.current);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      if (phaseRef.current === "pipeline" && isRunningRef.current && runIdRef.current) {
        userStoppedRef.current = true;
        void stopPipelineRun(runIdRef.current).catch(() => undefined);
        setIsRunning(false);
      } else if (phaseRef.current === "google" || phaseRef.current === "rarity") {
        userStoppedRef.current = true;
        setIsRunning(false);
      }
    }
    onOpenChange(nextOpen);
  };

  const showDecisions = phase === "decisions";
  const footerLabel =
    phase === "pipeline" && isRunning
      ? "Close and stop"
      : phase === "google" || phase === "rarity"
        ? "Close"
        : phase === "done"
          ? "Done"
          : "Close";

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="flex max-h-[90vh] flex-col gap-4 sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Final agent</DialogTitle>
          <DialogDescription>
            {showDecisions
              ? `Pipeline finished for ${date}. Answer the decision below — it slides in here without resizing the dialog.`
              : phase === "google"
                ? `Running Google Check for ${date}…`
                : phase === "rarity"
                  ? `Assigning rarity for ${date}…`
                : phase === "done"
                  ? `Finished for ${date}.`
                  : `Pipeline for ${date}, then Google Check, then rarity if it passes.`}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Activity log</p>
            <PipelineActivityLog
              lines={logLines}
              scrollRef={logScrollRootRef}
              scrollClassName="h-[280px]"
            />
            {startError ? <p className="text-xs text-destructive">{startError}</p> : null}
          </div>

          <AnimatePresence initial={false}>
            {showDecisions ? (
              <motion.div
                key="decisions-panel"
                initial={{ opacity: 0, y: 28, height: 0 }}
                animate={{ opacity: 1, y: 0, height: "auto" }}
                exit={{ opacity: 0, y: 20, height: 0 }}
                transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
                className="overflow-hidden"
              >
                <DayPendingReviewPanel
                  date={date}
                  compact
                  animateItems
                  onResolved={onRunFinished}
                  onAllCleared={handleDecisionsCleared}
                />
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>

        <DialogFooter>
          <Button
            variant={phase === "done" ? "default" : "outline"}
            onClick={() => handleOpenChange(false)}
          >
            {footerLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
