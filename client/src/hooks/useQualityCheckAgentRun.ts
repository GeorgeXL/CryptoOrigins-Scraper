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
  filterQualityCheckAgentRows,
  getQualityCheckAgentAction,
  qualityCheckTargetDates,
  resolveQualityCheckRunWindows,
  type QualityCheckDateInput,
  type PipelineRunWindow,
} from "@shared/quality-check-agent-actions";

const POLL_MS = 1500;

type SlicePlan = {
  slices: PipelineRunWindow[];
  currentIndex: number;
  checkScopes: PipelineCheckScope[];
  targetDates?: string[];
};

export function useQualityCheckAgentRun() {
  const { toast } = useToast();
  const [running, setRunning] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const [logLines, setLogLines] = useState<LogLine[]>([]);
  const [progressLabel, setProgressLabel] = useState<string | null>(null);

  const runningRef = useRef(running);
  runningRef.current = running;
  const runIdRef = useRef<string | null>(null);
  runIdRef.current = runId;
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
      options: {
        appendLog?: boolean;
        sliceIndex?: number;
        sliceTotal?: number;
        targetDates?: string[];
      } = {},
    ) => {
      if (stopRequestedRef.current) {
        setRunning(false);
        setProgressLabel(null);
        return;
      }

      if (!options.appendLog) {
        completedLogRef.current = [];
        slicePlanRef.current = null;
        setLogLines([]);
      } else if (completedLogRef.current.length > 0) {
        // Keep accumulated log visible while the next slice's run is starting.
        setLogLines([...completedLogRef.current]);
      }
      setRunId(null);
      runIdRef.current = null;
      setRunning(true);
      setProgressLabel(
        options.sliceIndex && options.sliceTotal
          ? `Slice ${options.sliceIndex}/${options.sliceTotal}: ${window.dateFrom}${window.dateFrom !== window.dateTo ? ` → ${window.dateTo}` : ""}`
          : `${window.dateFrom}${window.dateFrom !== window.dateTo ? ` → ${window.dateTo}` : ""}`,
      );

      const sliceTargetDates = options.targetDates?.filter(
        (date) => date >= window.dateFrom && date <= window.dateTo,
      );

      const out = await startPipelineRun({
        dateFrom: window.dateFrom,
        dateTo: window.dateTo,
        maxDaysToConsider: sliceTargetDates?.length ?? window.maxDays,
        checkScopes,
        ...(sliceTargetDates && sliceTargetDates.length > 0 ? { targetDates: sliceTargetDates } : {}),
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
        setProgressLabel(null);
        return;
      }

      setRunId(out.runId);
      runIdRef.current = out.runId;
      rememberLastPipelineRunId(out.runId);
      const slicePrefix =
        options.sliceIndex && options.sliceTotal ? `Slice ${options.sliceIndex}/${options.sliceTotal} · ` : "";
      const startLine: LogLine = {
        id: `${out.runId}-start`,
        text: `${slicePrefix}Pipeline ${out.runId.slice(0, 8)}… · ${window.dateFrom}${window.dateFrom !== window.dateTo ? ` → ${window.dateTo}` : ""}`,
        status: "approved",
      };
      completedLogRef.current = [...completedLogRef.current, startLine];
      setLogLines([...completedLogRef.current]);
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

      const targetRows = filterQualityCheckAgentRows(opts.checkId, opts.rows, opts.selectedDates);

      if (targetRows.length === 0) {
        toast({
          title: "Nothing to run",
          description:
            opts.checkId === "empty-summary"
              ? "Select rows or use the full tab list."
              : "No selected days with a summary to process (empty summaries are skipped).",
          variant: "destructive",
        });
        return;
      }

      if (action.kind === "remove-periods") {
        await runRemovePeriods(targetRows.map((row) => row.date));
        return;
      }

      const windows = resolveQualityCheckRunWindows(opts.checkId, targetRows, new Set());
      if (windows.length === 0) {
        toast({ title: "No dates to run", description: "Could not build a pipeline window for this selection.", variant: "destructive" });
        return;
      }

      const checkScopes = action.checkScopes ?? [];
      const targetDates =
        opts.checkId === "missing-months"
          ? undefined
          : qualityCheckTargetDates(opts.checkId, opts.rows, opts.selectedDates);
      stopRequestedRef.current = false;
      slicePlanRef.current = { slices: windows, currentIndex: 0, checkScopes, targetDates };
      completedLogRef.current = [
        {
          id: `qc-agent-plan-${Date.now()}`,
          text: `Queued ${windows.length} pipeline slice${windows.length === 1 ? "" : "s"} · scopes: ${checkScopes.join(", ")}${targetDates ? ` · ${targetDates.length} day${targetDates.length === 1 ? "" : "s"}` : ""}`,
          status: "approved",
        },
      ];
      setLogLines(completedLogRef.current);
      await startPipelineSlice(windows[0]!, checkScopes, {
        appendLog: true,
        sliceIndex: windows.length > 1 ? 1 : undefined,
        sliceTotal: windows.length > 1 ? windows.length : undefined,
        targetDates,
      });
    },
    [runRemovePeriods, startPipelineSlice, toast],
  );

  const stopRun = useCallback(async () => {
    stopRequestedRef.current = true;
    slicePlanRef.current = null;

    const rid = runIdRef.current;
    setRunning(false);
    setProgressLabel(null);

    if (!rid) {
      pushLog({ id: `qc-agent-stop-${Date.now()}`, text: "Cancelled before pipeline attached", status: "rejected" });
      return;
    }

    setRunId(null);
    runIdRef.current = null;

    try {
      await stopPipelineRun(rid);
      pushLog({ id: `qc-agent-stop-${Date.now()}`, text: "Stopped by operator", status: "rejected" });
    } catch (error) {
      pushLog({
        id: `qc-agent-stop-${Date.now()}`,
        text: error instanceof Error ? error.message : "Stop failed — run may still be active on the server",
        status: "rejected",
      });
      toast({
        title: "Could not stop run",
        description: error instanceof Error ? error.message : "The pipeline may still be running.",
        variant: "destructive",
      });
    }
  }, [pushLog, toast]);

  useEffect(() => {
    if (!running || !runId) return;

    const poll = async () => {
      if (!runningRef.current || stopRequestedRef.current) return;
      const pollRunId = runId;
      try {
        const detail = await fetchPipelineRun(pollRunId);
        if (!runningRef.current || stopRequestedRef.current) return;
        // Ignore stale in-flight polls for a superseded run, but still process terminal
        // states so multi-slice handoffs are not dropped when runId clears between slices.
        if (runIdRef.current !== pollRunId && detail.run.status === "running") return;

        const built = namespaceLogLines(buildActivityLogFromDetail(detail), detail.run.id);
        const historyWithoutCurrentRun = completedLogRef.current.filter(
          (line) => !line.id.startsWith(`${pollRunId}-`),
        );
        const visible = [...historyWithoutCurrentRun, ...built];
        completedLogRef.current = visible;
        setLogLines((prev) => (logLinesEqual(prev, visible) ? prev : visible));

        if (detail.run.status !== "running") {
          const plan = slicePlanRef.current;
          const canContinue =
            detail.run.status === "completed" &&
            plan &&
            plan.currentIndex < plan.slices.length - 1 &&
            !stopRequestedRef.current;

          if (canContinue && plan) {
            if (runIdRef.current !== pollRunId) return;
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
            setLogLines([...completedLogRef.current]);
            setRunId(null);
            runIdRef.current = null;
            void startPipelineSlice(plan.slices[nextIndex]!, plan.checkScopes, {
              appendLog: true,
              sliceIndex: nextIndex + 1,
              sliceTotal: plan.slices.length,
              targetDates: plan.targetDates,
            });
            return;
          }

          completedLogRef.current = visible;
          setLogLines([...visible]);
          setRunning(false);
          setRunId(null);
          runIdRef.current = null;
          setProgressLabel(null);
          slicePlanRef.current = null;
          if (stopRequestedRef.current) return;

          const pending = humanReviewQueuedCount(detail.run.stats);
          toast({
            title: detail.run.status === "completed" ? "Agent run finished" : "Agent run stopped",
            description:
              detail.run.status === "completed" && pending > 0
                ? `${pending} item(s) queued on Agents → Pending (try Corrections for tag fixes).`
                : detail.run.status === "completed"
                  ? "Run finished — tag fixes may have auto-applied with no pending review. Check the day rows or Agents → All."
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
