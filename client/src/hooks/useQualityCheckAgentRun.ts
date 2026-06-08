import { useCallback, useEffect, useRef, useState } from "react";

import { useToast } from "@/hooks/use-toast";
import {
  fetchPipelineRun,
  rememberLastPipelineRunId,
  startPipelineRun,
  stopPipelineRun,
  type PipelineCheckScope,
} from "@/lib/editorial-pipeline";
import {
  buildActivityLogFromDetail,
  humanReviewQueuedCount,
  logLinesEqual,
  namespaceLogLines,
  type LogLine,
} from "@/lib/pipelineActivityLog";
import { apiRequest } from "@/lib/queryClient";
import {
  getQualityCheckAgentAction,
  resolveQualityCheckRunWindows,
  type QualityCheckDateInput,
  type PipelineRunWindow,
} from "@shared/quality-check-agent-actions";

const POLL_MS = 1500;
const STOP_GUARD_MS = 8000;

type SlicePlan = { slices: PipelineRunWindow[]; currentIndex: number; checkScopes: PipelineCheckScope[] };

export function useQualityCheckAgentRun() {
  const { toast } = useToast();
  const [running, setRunning] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const [logLines, setLogLines] = useState<LogLine[]>([]);
  const [progressLabel, setProgressLabel] = useState<string | null>(null);
  const [stopEnabledAtMs, setStopEnabledAtMs] = useState(0);

  const runningRef = useRef(running);
  runningRef.current = running;
  const stopRequestedRef = useRef(false);
  const slicePlanRef = useRef<SlicePlan | null>(null);
  const completedLogRef = useRef<LogLine[]>([]);
  const logScrollRef = useRef<HTMLDivElement | null>(null);

  const patchLog = useCallback((id: string, patch: Partial<LogLine>) => {
    setLogLines((prev) => prev.map((line) => (line.id === id ? { ...line, ...patch } : line)));
  }, []);

  const pushLog = useCallback((line: LogLine) => {
    setLogLines((prev) => [...prev, line]);
  }, []);

  const startPipelineSlice = useCallback(
    async (
      window: PipelineRunWindow,
      checkScopes: PipelineCheckScope[],
      options: { appendLog?: boolean; sliceIndex?: number; sliceTotal?: number } = {},
    ) => {
      if (!options.appendLog) {
        completedLogRef.current = [];
        slicePlanRef.current = null;
        setLogLines([]);
      }
      setRunId(null);
      setStopEnabledAtMs(Date.now() + STOP_GUARD_MS);
      stopRequestedRef.current = false;
      setRunning(true);
      setProgressLabel(
        options.sliceIndex && options.sliceTotal
          ? `Slice ${options.sliceIndex}/${options.sliceTotal}: ${window.dateFrom}${window.dateFrom !== window.dateTo ? ` → ${window.dateTo}` : ""}`
          : `${window.dateFrom}${window.dateFrom !== window.dateTo ? ` → ${window.dateTo}` : ""}`,
      );

      const out = await startPipelineRun({
        dateFrom: window.dateFrom,
        dateTo: window.dateTo,
        maxDaysToConsider: window.maxDays,
        checkScopes,
      });

      if (stopRequestedRef.current) {
        try {
          await stopPipelineRun(out.runId);
        } catch {
          /* best effort */
        }
        pushLog({
          id: `qc-agent-cancel-${out.runId}`,
          text: "Run cancelled before processing",
          status: "rejected",
        });
        setRunning(false);
        setStopEnabledAtMs(0);
        setProgressLabel(null);
        return;
      }

      setRunId(out.runId);
      rememberLastPipelineRunId(out.runId);
      const slicePrefix =
        options.sliceIndex && options.sliceTotal ? `Slice ${options.sliceIndex}/${options.sliceTotal} · ` : "";
      const startLine: LogLine = {
        id: `${out.runId}-start`,
        text: `${slicePrefix}Pipeline ${out.runId.slice(0, 8)}… · ${window.dateFrom}${window.dateFrom !== window.dateTo ? ` → ${window.dateTo}` : ""}`,
        status: "approved",
      };
      setLogLines([...completedLogRef.current, startLine]);
    },
    [pushLog],
  );

  const runRemovePeriods = useCallback(
    async (dates: string[]) => {
      setRunning(true);
      setProgressLabel(`Fix periods · ${dates.length} date${dates.length === 1 ? "" : "s"}`);
      setLogLines([]);
      pushLog({ id: "qc-periods-start", text: `Removing trailing periods from ${dates.length} date(s)…`, status: "pending" });
      try {
        const result = (await apiRequest("POST", "/api/quality-check/bulk-remove-periods", { dates })) as {
          updated?: number;
        };
        patchLog("qc-periods-start", {
          status: "approved",
          text: `Removed trailing periods on ${result.updated ?? 0} summar${result.updated === 1 ? "y" : "ies"}`,
        });
        toast({
          title: "Trailing periods fixed",
          description: `Updated ${result.updated ?? 0} of ${dates.length} selected date(s).`,
        });
      } catch (error) {
        patchLog("qc-periods-start", {
          status: "rejected",
          text: error instanceof Error ? error.message : "Period removal failed",
        });
        toast({
          title: "Fix failed",
          description: error instanceof Error ? error.message : "Error",
          variant: "destructive",
        });
      } finally {
        setRunning(false);
        setProgressLabel(null);
      }
    },
    [patchLog, pushLog, toast],
  );

  const runQualityCheckAgent = useCallback(
    async (opts: {
      checkId: string;
      rows: QualityCheckDateInput[];
      selectedDates: Set<string>;
    }) => {
      const action = getQualityCheckAgentAction(opts.checkId);
      if (!action) {
        toast({ title: "No agent action", description: "This quality tab has no bulk agent yet.", variant: "destructive" });
        return;
      }

      const targetRows =
        opts.selectedDates.size > 0
          ? opts.rows.filter((row) => opts.selectedDates.has(row.date))
          : opts.rows;

      if (targetRows.length === 0) {
        toast({ title: "Nothing selected", description: "Select rows or use the full tab list.", variant: "destructive" });
        return;
      }

      if (action.kind === "remove-periods") {
        await runRemovePeriods(targetRows.map((row) => row.date));
        return;
      }

      const windows = resolveQualityCheckRunWindows(opts.checkId, opts.rows, opts.selectedDates);
      if (windows.length === 0) {
        toast({ title: "No dates to run", description: "Could not build a pipeline window for this selection.", variant: "destructive" });
        return;
      }

      const checkScopes = action.checkScopes ?? [];
      slicePlanRef.current = { slices: windows, currentIndex: 0, checkScopes };
      completedLogRef.current = [
        {
          id: `qc-agent-plan-${Date.now()}`,
          text: `Queued ${windows.length} pipeline slice${windows.length === 1 ? "" : "s"} · scopes: ${checkScopes.join(", ")}`,
          status: "approved",
        },
      ];
      setLogLines(completedLogRef.current);
      await startPipelineSlice(windows[0]!, checkScopes, {
        appendLog: true,
        sliceIndex: windows.length > 1 ? 1 : undefined,
        sliceTotal: windows.length > 1 ? windows.length : undefined,
      });
    },
    [runRemovePeriods, startPipelineSlice, toast],
  );

  const stopRun = useCallback(async () => {
    if (Date.now() < stopEnabledAtMs) {
      toast({ title: "Run is starting", description: "Wait a few seconds before stopping." });
      return;
    }
    stopRequestedRef.current = true;
    if (!runId) {
      setRunning(false);
      setStopEnabledAtMs(0);
      setProgressLabel(null);
      pushLog({ id: `qc-agent-stop-${Date.now()}`, text: "Cancelled before pipeline attached", status: "rejected" });
      return;
    }
    try {
      await stopPipelineRun(runId);
    } catch {
      /* best effort */
    }
    setRunId(null);
    setRunning(false);
    setStopEnabledAtMs(0);
    setProgressLabel(null);
    slicePlanRef.current = null;
    pushLog({ id: `qc-agent-stop-${Date.now()}`, text: "Stopped by operator", status: "rejected" });
  }, [pushLog, runId, stopEnabledAtMs, toast]);

  useEffect(() => {
    if (!running || !runId) return;
    let cancelled = false;

    const poll = async () => {
      if (cancelled || !runningRef.current) return;
      try {
        const detail = await fetchPipelineRun(runId);
        if (cancelled) return;
        const built = namespaceLogLines(buildActivityLogFromDetail(detail), detail.run.id);
        const visible = [...completedLogRef.current, ...built];
        setLogLines((prev) => (logLinesEqual(prev, visible) ? prev : visible));

        if (detail.run.status !== "running") {
          const plan = slicePlanRef.current;
          const canContinue =
            detail.run.status === "completed" &&
            plan &&
            plan.currentIndex < plan.slices.length - 1 &&
            !stopRequestedRef.current;

          if (canContinue && plan) {
            const nextIndex = plan.currentIndex + 1;
            slicePlanRef.current = { ...plan, currentIndex: nextIndex };
            completedLogRef.current = [
              ...visible,
              {
                id: `qc-agent-slice-${nextIndex}`,
                text: `Starting slice ${nextIndex + 1}/${plan.slices.length}`,
                status: "pending",
              },
            ];
            setLogLines(completedLogRef.current);
            setRunId(null);
            setStopEnabledAtMs(0);
            void startPipelineSlice(plan.slices[nextIndex]!, plan.checkScopes, {
              appendLog: true,
              sliceIndex: nextIndex + 1,
              sliceTotal: plan.slices.length,
            });
            return;
          }

          completedLogRef.current = visible;
          setRunning(false);
          setRunId(null);
          setStopEnabledAtMs(0);
          setProgressLabel(null);
          slicePlanRef.current = null;
          const pending = humanReviewQueuedCount(detail.run.stats);
          toast({
            title: detail.run.status === "completed" ? "Agent run finished" : "Agent run stopped",
            description:
              detail.run.status === "completed" && pending > 0
                ? `${pending} item(s) queued for manual review on the Agents Homepage.`
                : "Check the Agents review queue for outcomes.",
          });
        }
      } catch {
        /* keep polling */
      }
    };

    void poll();
    const timer = setInterval(() => void poll(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [running, runId, startPipelineSlice, toast]);

  useEffect(() => {
    if (logLines.length === 0) return;
    const root = logScrollRef.current;
    const viewport = root?.querySelector("[data-radix-scroll-area-viewport]") as HTMLElement | null;
    viewport?.scrollTo({ top: viewport.scrollHeight, behavior: "smooth" });
  }, [logLines]);

  return {
    running,
    logLines,
    progressLabel,
    logScrollRef,
    runQualityCheckAgent,
    stopRun,
    clearLog: () => setLogLines([]),
  };
}
