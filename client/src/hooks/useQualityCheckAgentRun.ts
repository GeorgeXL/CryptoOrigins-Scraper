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
  dayGroupsEqual,
  deriveDayOutcome,
  humanReviewQueuedCount,
  logLinesEqual,
  namespaceLogLines,
  type DayActivityGroup,
  type LogLine,
} from "@/lib/pipelineActivityLog";
import {
  datesWithPendingAgentQueue,
  fetchPendingAgentQueueByDates,
  formatPendingAgentQueueSkipLabel,
} from "@/lib/pendingAgentQueue";
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
const DAY_COLLAPSE_MS = 900;
const FINAL_AGENT_SCOPES: PipelineCheckScope[] = [
  "relevance",
  "summary",
  "topics",
  "tags",
  "duplicates",
  "date",
];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type SlicePlan = {
  slices: PipelineRunWindow[];
  currentIndex: number;
  checkScopes: PipelineCheckScope[];
  targetDates?: string[];
};

function taskLinesFromBuilt(built: LogLine[], runId: string): LogLine[] {
  return built.filter((line) => line.id !== `${runId}-run-header`);
}

type ActivitySnapshot = {
  logLines: LogLine[];
  dayGroups: DayActivityGroup[];
  planLine: LogLine | null;
};

function createActivityStore() {
  let snapshot: ActivitySnapshot = { logLines: [], dayGroups: [], planLine: null };
  const listeners = new Set<() => void>();
  const emit = () => {
    for (const listener of listeners) listener();
  };
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setLogLines: (next: LogLine[] | ((prev: LogLine[]) => LogLine[])) => {
      const resolved = typeof next === "function" ? next(snapshot.logLines) : next;
      if (logLinesEqual(snapshot.logLines, resolved)) return;
      snapshot = { ...snapshot, logLines: resolved };
      emit();
    },
    setDayGroups: (next: DayActivityGroup[] | ((prev: DayActivityGroup[]) => DayActivityGroup[])) => {
      const resolved = typeof next === "function" ? next(snapshot.dayGroups) : next;
      if (dayGroupsEqual(snapshot.dayGroups, resolved)) return;
      snapshot = { ...snapshot, dayGroups: resolved };
      emit();
    },
    setPlanLine: (next: LogLine | null) => {
      const prev = snapshot.planLine;
      if (prev === next) return;
      if (
        prev &&
        next &&
        prev.id === next.id &&
        prev.text === next.text &&
        prev.status === next.status &&
        prev.emphasis === next.emphasis
      ) {
        return;
      }
      snapshot = { ...snapshot, planLine: next };
      emit();
    },
  };
}

export type QualityCheckActivityStore = ReturnType<typeof createActivityStore>;

export function useQualityCheckAgentRun() {
  const { toast } = useToast();
  const [running, setRunning] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const [progressLabel, setProgressLabel] = useState<string | null>(null);
  const activityStoreRef = useRef<QualityCheckActivityStore | null>(null);
  if (!activityStoreRef.current) activityStoreRef.current = createActivityStore();
  const activityStore = activityStoreRef.current;
  const setLogLines = activityStore.setLogLines;
  const setDayGroups = activityStore.setDayGroups;
  const setPlanLine = activityStore.setPlanLine;

  const runningRef = useRef(running);
  runningRef.current = running;
  const runIdRef = useRef<string | null>(null);
  const stopRequestedRef = useRef(false);
  const finalAgentActiveRef = useRef(false);
  if (!finalAgentActiveRef.current) {
    runIdRef.current = runId;
  }
  const slicePlanRef = useRef<SlicePlan | null>(null);
  const completedLogRef = useRef<LogLine[]>([]);
  const logScrollRef = useRef<HTMLDivElement | null>(null);
  const userExpandedRef = useRef<Set<string>>(new Set());
  const collapseTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const clearCollapseTimer = useCallback((dayId: string) => {
    const timer = collapseTimersRef.current.get(dayId);
    if (timer) {
      clearTimeout(timer);
      collapseTimersRef.current.delete(dayId);
    }
  }, []);

  const scheduleDayCollapse = useCallback(
    (dayId: string) => {
      clearCollapseTimer(dayId);
      const timer = setTimeout(() => {
        collapseTimersRef.current.delete(dayId);
        if (userExpandedRef.current.has(dayId)) return;
        setDayGroups((prev) =>
          prev.map((group) => (group.id === dayId ? { ...group, expanded: false } : group)),
        );
      }, DAY_COLLAPSE_MS);
      collapseTimersRef.current.set(dayId, timer);
    },
    [clearCollapseTimer],
  );

  const patchLog = useCallback((id: string, patch: Partial<LogLine>) => {
    setLogLines((prev) => prev.map((line) => (line.id === id ? { ...line, ...patch } : line)));
  }, []);

  const pushLog = useCallback((line: LogLine) => {
    setLogLines((prev) => [...prev, line]);
  }, []);

  const resetBulkDayState = useCallback(() => {
    for (const timer of collapseTimersRef.current.values()) {
      clearTimeout(timer);
    }
    collapseTimersRef.current.clear();
    userExpandedRef.current.clear();
    setDayGroups([]);
    setPlanLine(null);
  }, []);

  const toggleDayExpanded = useCallback(
    (dayId: string) => {
      setDayGroups((prev) =>
        prev.map((group) => {
          if (group.id !== dayId) return group;
          const nextExpanded = !group.expanded;
          if (nextExpanded) {
            userExpandedRef.current.add(dayId);
            clearCollapseTimer(dayId);
          } else {
            userExpandedRef.current.delete(dayId);
          }
          return { ...group, expanded: nextExpanded };
        }),
      );
    },
    [clearCollapseTimer],
  );

  const startPipelineSlice = useCallback(
    async (
      window: PipelineRunWindow,
      checkScopes: PipelineCheckScope[],
      options: {
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

      setRunId(null);
      runIdRef.current = null;
      setRunning(true);
      const dayLabel =
        window.dateFrom === window.dateTo
          ? window.dateFrom
          : `${window.dateFrom} → ${window.dateTo}`;
      setProgressLabel(
        options.sliceIndex && options.sliceTotal
          ? `Day ${options.sliceIndex}/${options.sliceTotal}: ${dayLabel}`
          : dayLabel,
      );

      const sliceIndex = options.sliceIndex ?? 1;
      setDayGroups((prev) =>
        prev.map((group) =>
          group.dayIndex === sliceIndex
            ? { ...group, status: "running", expanded: true, lines: [] }
            : group,
        ),
      );

      const sliceTargetDates =
        options.targetDates?.filter((date) => date >= window.dateFrom && date <= window.dateTo) ??
        (window.dateFrom === window.dateTo ? [window.dateFrom] : undefined);

      const out = await startPipelineRun({
        dateFrom: window.dateFrom,
        dateTo: window.dateTo,
        maxDaysToConsider: sliceTargetDates?.length ?? window.maxDays,
        checkScopes,
        ignoreDayLock: true,
        ...(sliceTargetDates && sliceTargetDates.length > 0 ? { targetDates: sliceTargetDates } : {}),
      });

      if (stopRequestedRef.current) {
        try {
          await stopPipelineRun(out.runId);
        } catch {
          /* best effort */
        }
        setDayGroups((prev) =>
          prev.map((group) =>
            group.dayIndex === sliceIndex
              ? {
                  ...group,
                  status: "done",
                  outcome: "rejected",
                  expanded: false,
                  lines: [{ id: `cancel-${out.runId}`, text: "Run cancelled before processing", status: "rejected" }],
                }
              : group,
          ),
        );
        setRunning(false);
        setProgressLabel(null);
        return;
      }

      setRunId(out.runId);
      runIdRef.current = out.runId;
      rememberLastPipelineRunId(out.runId);
    },
    [],
  );

  const runRemovePeriods = useCallback(
    async (dates: string[]) => {
      resetBulkDayState();
      setRunning(true);
      setProgressLabel(`Fix periods · ${dates.length} date${dates.length === 1 ? "" : "s"}`);
      setLogLines([]);
      pushLog({ id: "qc-periods-start", text: `Removing trailing periods from ${dates.length} date(s)…`, status: "pending" });
      try {
        const response = await apiRequest("POST", "/api/quality-check/bulk-remove-periods", { dates });
        const result = (await response.json()) as {
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
    [patchLog, pushLog, resetBulkDayState, toast],
  );

  const runAssignRarity = useCallback(
    async (dates: string[]) => {
      resetBulkDayState();
      setRunning(true);
      setProgressLabel(`Rarity agent · ${dates.length} date${dates.length === 1 ? "" : "s"}`);
      setLogLines([]);
      pushLog({
        id: "qc-rarity-start",
        text: `Assigning rarity on ${dates.length} locked day(s)…`,
        status: "pending",
      });

      let updated = 0;
      let failed = 0;

      try {
        for (const date of dates) {
          pushLog({ id: `qc-rarity-${date}`, text: `${date}…`, status: "pending" });
        }

        const response = await apiRequest("POST", "/api/quality-check/bulk-assign-rarity", {
          dates,
        });
        const result = (await response.json()) as {
          updated?: number;
          results?: Record<string, { rarity?: string | null; error?: string }>;
        };

        for (const date of dates) {
          const row = result.results?.[date];
          const lineId = `qc-rarity-${date}`;
          if (row?.rarity) {
            updated += 1;
            patchLog(lineId, { status: "approved", text: `${date} → ${row.rarity}` });
          } else {
            failed += 1;
            patchLog(lineId, {
              status: "rejected",
              text: `${date} — ${row?.error ?? "no label"}`,
            });
          }
        }

        patchLog("qc-rarity-start", {
          status: failed > 0 ? "review" : "approved",
          text: `Rarity agent done · ${updated} assigned${failed > 0 ? ` · ${failed} failed` : ""}`,
        });

        toast({
          title: "Rarity agent finished",
          description: `${updated} assigned${failed > 0 ? `, ${failed} failed` : ""}.`,
          variant: failed > 0 ? "destructive" : "default",
        });
      } catch (error) {
        patchLog("qc-rarity-start", {
          status: "rejected",
          text: error instanceof Error ? error.message : "Rarity assignment failed",
        });
        toast({
          title: "Rarity agent failed",
          description: error instanceof Error ? error.message : "Error",
          variant: "destructive",
        });
      } finally {
        setRunning(false);
        setProgressLabel(null);
      }
    },
    [patchLog, pushLog, resetBulkDayState, scheduleDayCollapse, toast],
  );

  type FinalAgentApiResult = {
    ok: boolean;
    phase: string;
    message: string;
    runId?: string;
    googleHappened?: string;
    rarity?: string | null;
  };

  function finalAgentLineStatus(result: FinalAgentApiResult): LogLine["status"] {
    if (!result.ok) return "rejected";
    if (result.phase === "queued_review" || result.phase === "tags_missing") return "review";
    if (result.phase === "pipeline_failed") return "rejected";
    return "approved";
  }

  const runFinalAgent = useCallback(
    async (dates: string[]) => {
      stopRequestedRef.current = false;
      finalAgentActiveRef.current = true;
      setRunId(null);
      resetBulkDayState();
      setRunning(true);
      setLogLines([]);

      const pendingByDate = await fetchPendingAgentQueueByDates(dates);
      const pendingDates = datesWithPendingAgentQueue(dates, pendingByDate);
      const runnableDates = dates.filter((date) => !pendingDates.has(date));
      const skippedCount = dates.length - runnableDates.length;

      const groups: DayActivityGroup[] = dates.map((date, index) => ({
        id: date,
        date,
        dayIndex: index + 1,
        dayTotal: dates.length,
        status: pendingDates.has(date) ? "done" : runnableDates[0] === date ? "running" : "pending",
        outcome: pendingDates.has(date) ? "review" : undefined,
        lines: pendingDates.has(date)
          ? [
              {
                id: `${date}-skip-pending`,
                text: formatPendingAgentQueueSkipLabel(pendingByDate[date] ?? []),
                status: "review",
              },
            ]
          : [],
        expanded: pendingDates.has(date) ? false : runnableDates[0] === date,
      }));
      setDayGroups(groups);
      setPlanLine({
        id: `qc-final-plan-${Date.now()}`,
        text:
          skippedCount > 0
            ? `Queued ${runnableDates.length} day${runnableDates.length === 1 ? "" : "s"} · ${skippedCount} skipped (pending in Agents) · final agent`
            : `Queued ${dates.length} day${dates.length === 1 ? "" : "s"} · final agent (pipeline → Google Check → rarity)`,
        status: "approved",
      });

      if (runnableDates.length === 0) {
        toast({
          title: "Nothing to run",
          description: `All ${dates.length} selected day${dates.length === 1 ? " has" : "s have"} pending items in Agents — resolve those first.`,
          variant: "destructive",
        });
        finalAgentActiveRef.current = false;
        setRunning(false);
        setProgressLabel(null);
        return;
      }

      const patchDayLines = (date: string, lines: LogLine[], status: DayActivityGroup["status"] = "running") => {
        setDayGroups((prev) =>
          prev.map((group) =>
            group.id === date ? { ...group, status, expanded: true, lines } : group,
          ),
        );
      };

      let completed = 0;
      let review = skippedCount;
      let failed = 0;
      let runnableIndex = 0;

      try {
        for (let i = 0; i < dates.length; i += 1) {
          if (stopRequestedRef.current) break;
          const date = dates[i]!;
          if (pendingDates.has(date)) {
            scheduleDayCollapse(date);
            continue;
          }

          runnableIndex += 1;
          setProgressLabel(`Day ${runnableIndex}/${runnableDates.length}: ${date}`);
          setDayGroups((prev) =>
            prev.map((group) => ({
              ...group,
              status:
                group.id === date ? "running"
                : pendingDates.has(group.id) ? "done"
                : runnableDates.indexOf(group.id) < runnableIndex ? group.status
                : "pending",
              expanded: group.id === date,
            })),
          );

          let lines: LogLine[] = [
            { id: `${date}-pipeline-start`, text: "Starting editorial pipeline…", status: "pending" },
          ];
          patchDayLines(date, lines);

          let pipelineRunId: string | null = null;
          let pipelineStatus = "completed";
          try {
            const out = await startPipelineRun({
              dateFrom: date,
              dateTo: date,
              maxDaysToConsider: 1,
              checkScopes: FINAL_AGENT_SCOPES,
              ignoreDayLock: true,
              targetDates: [date],
            });
            pipelineRunId = out.runId;
            runIdRef.current = out.runId;
            rememberLastPipelineRunId(out.runId);
            lines = [
              {
                id: `${out.runId}-start`,
                text: `Pipeline run ${out.runId.slice(0, 8)}… · ${date}`,
                status: "approved",
              },
            ];
            patchDayLines(date, lines);

            while (!stopRequestedRef.current) {
              const detail = await fetchPipelineRun(out.runId, { activity: true });
              const built = namespaceLogLines(buildActivityLogFromDetail(detail), detail.run.id);
              const tasks = taskLinesFromBuilt(built, out.runId);
              lines = tasks;
              patchDayLines(date, lines);
              pipelineStatus = detail.run.status;
              if (detail.run.status !== "running") break;
              await sleep(POLL_MS);
            }

            if (stopRequestedRef.current && pipelineRunId) {
              try {
                await stopPipelineRun(pipelineRunId);
              } catch {
                /* best effort */
              }
              lines = [
                ...lines,
                { id: `${date}-stopped`, text: "Stopped by operator during pipeline", status: "rejected" },
              ];
              patchDayLines(date, lines, "done");
              failed += 1;
              scheduleDayCollapse(date);
              break;
            }

            if (pipelineStatus !== "completed") {
              const errMsg =
                pipelineStatus === "error" || pipelineStatus === "stopped"
                  ? `Pipeline ended with status=${pipelineStatus}`
                  : `Pipeline ended with status=${pipelineStatus}`;
              lines = [...lines, { id: `${date}-pipeline-failed`, text: errMsg, status: "rejected" }];
              patchDayLines(date, lines, "done");
              failed += 1;
              scheduleDayCollapse(date);
              continue;
            }
          } catch (error) {
            failed += 1;
            const message = error instanceof Error ? error.message : "Pipeline failed to start";
            patchDayLines(
              date,
              [{ id: `${date}-pipeline-err`, text: message, status: "rejected" }],
              "done",
            );
            scheduleDayCollapse(date);
            continue;
          } finally {
            runIdRef.current = null;
          }

          lines = [
            ...lines,
            { id: `${date}-google-start`, text: "Running Google Check…", status: "pending" },
          ];
          patchDayLines(date, lines);

          try {
            const response = await apiRequest("POST", "/api/quality-check/final-agent-tail", {
              date,
            });
            const result = (await response.json()) as FinalAgentApiResult;

            const tailLines: LogLine[] = [];
            if (result.phase === "google_check" || result.phase === "complete") {
              tailLines.push({
                id: `${date}-google`,
                text:
                  result.googleHappened ?
                    `Google Check → ${result.googleHappened}`
                  : "Google Check finished",
                status: result.googleHappened === "yes" ? "approved" : "review",
              });
            }
            if (result.rarity) {
              tailLines.push({
                id: `${date}-rarity`,
                text: `Rarity assigned — ${result.rarity}`,
                status: "approved",
              });
            }
            tailLines.push({
              id: `${date}-result`,
              text: result.message,
              status: finalAgentLineStatus(result),
            });

            lines = [...lines.filter((line) => line.id !== `${date}-google-start`), ...tailLines];
            const lineStatus = finalAgentLineStatus(result);
            setDayGroups((prev) =>
              prev.map((group) =>
                group.id === date
                  ? {
                      ...group,
                      status: "done",
                      outcome:
                        lineStatus === "approved" ? "approved" : lineStatus === "review" ? "review" : "rejected",
                      lines,
                      expanded: true,
                    }
                  : group,
              ),
            );
            scheduleDayCollapse(date);

            if (lineStatus === "approved") completed += 1;
            else if (lineStatus === "review") review += 1;
            else failed += 1;
          } catch (error) {
            failed += 1;
            const message = error instanceof Error ? error.message : "Google Check / rarity failed";
            setDayGroups((prev) =>
              prev.map((group) =>
                group.id === date
                  ? {
                      ...group,
                      status: "done",
                      outcome: "rejected",
                      lines: [
                        ...lines.filter((line) => line.id !== `${date}-google-start`),
                        { id: `${date}-tail-err`, text: message, status: "rejected" },
                      ],
                      expanded: true,
                    }
                  : group,
              ),
            );
            scheduleDayCollapse(date);
          }
        }

        toast({
          title: stopRequestedRef.current ? "Final agent stopped" : "Final agent finished",
          description:
            skippedCount > 0
              ? `${completed} complete · ${skippedCount} skipped · ${review - skippedCount} need review · ${failed} failed`
              : `${completed} complete · ${review} need review · ${failed} failed`,
          variant: failed > 0 ? "destructive" : "default",
        });
      } finally {
        finalAgentActiveRef.current = false;
        runIdRef.current = null;
        setRunning(false);
        setProgressLabel(null);
        slicePlanRef.current = null;
      }
    },
    [resetBulkDayState, scheduleDayCollapse, toast],
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

      if (action.kind === "rarity") {
        await runAssignRarity(targetRows.map((row) => row.date));
        return;
      }

      if (action.kind === "final") {
        await runFinalAgent(targetRows.map((row) => row.date));
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
      resetBulkDayState();
      slicePlanRef.current = { slices: windows, currentIndex: 0, checkScopes, targetDates };
      completedLogRef.current = [];
      setLogLines([]);

      const groups: DayActivityGroup[] = windows.map((window, index) => ({
        id: window.dateFrom,
        date: window.dateFrom,
        dayIndex: index + 1,
        dayTotal: windows.length,
        status: index === 0 ? "running" : "pending",
        lines: [],
        expanded: index === 0,
      }));
      setDayGroups(groups);
      setPlanLine({
        id: `qc-agent-plan-${Date.now()}`,
        text: `Queued ${windows.length} day${windows.length === 1 ? "" : "s"} (one pipeline run each) · scopes: ${checkScopes.join(", ")}`,
        status: "approved",
      });

      await startPipelineSlice(windows[0]!, checkScopes, {
        sliceIndex: 1,
        sliceTotal: windows.length,
        targetDates,
      });
    },
    [resetBulkDayState, runAssignRarity, runFinalAgent, runRemovePeriods, startPipelineSlice, toast],
  );

  const stopRun = useCallback(async () => {
    stopRequestedRef.current = true;
    const plan = slicePlanRef.current;
    slicePlanRef.current = null;

    const rid = runIdRef.current;
    setRunning(false);
    setProgressLabel(null);

    if (finalAgentActiveRef.current) {
      const rid = runIdRef.current;
      if (rid) {
        try {
          await stopPipelineRun(rid);
        } catch {
          /* best effort */
        }
        runIdRef.current = null;
      }
      setDayGroups((prev) =>
        prev.map((group) =>
          group.status === "running"
            ? {
                ...group,
                status: "done",
                outcome: "rejected",
                expanded: false,
                lines: [
                  ...group.lines,
                  { id: `qc-agent-stop-${Date.now()}`, text: "Stopped by operator", status: "rejected" },
                ],
              }
            : group,
        ),
      );
      return;
    }

    if (plan) {
      const current = plan.slices[plan.currentIndex];
      if (current) {
        setDayGroups((prev) =>
          prev.map((group) =>
            group.id === current.dateFrom
              ? {
                  ...group,
                  status: "done",
                  outcome: "rejected",
                  expanded: false,
                  lines: [
                    ...group.lines,
                    { id: `qc-agent-stop-${Date.now()}`, text: "Stopped by operator", status: "rejected" },
                  ],
                }
              : group,
          ),
        );
      }
    }

    if (!rid) {
      if (!plan) {
        pushLog({ id: `qc-agent-stop-${Date.now()}`, text: "Cancelled before pipeline attached", status: "rejected" });
      }
      return;
    }

    setRunId(null);
    runIdRef.current = null;

    try {
      await stopPipelineRun(rid);
      if (!plan) {
        pushLog({ id: `qc-agent-stop-${Date.now()}`, text: "Stopped by operator", status: "rejected" });
      }
    } catch (error) {
      if (!plan) {
        pushLog({
          id: `qc-agent-stop-${Date.now()}`,
          text: error instanceof Error ? error.message : "Stop failed — run may still be active on the server",
          status: "rejected",
        });
      }
      toast({
        title: "Could not stop run",
        description: error instanceof Error ? error.message : "The pipeline may still be running.",
        variant: "destructive",
      });
    }
  }, [pushLog, toast]);

  useEffect(() => {
    if (!running || !runId || finalAgentActiveRef.current) return;

    const poll = async () => {
      if (!runningRef.current || stopRequestedRef.current || finalAgentActiveRef.current) return;
      const pollRunId = runId;
      try {
        const detail = await fetchPipelineRun(pollRunId, { activity: true });
        if (!runningRef.current || stopRequestedRef.current) return;
        if (runIdRef.current !== pollRunId && detail.run.status === "running") return;

        const built = namespaceLogLines(buildActivityLogFromDetail(detail), detail.run.id);
        const tasks = taskLinesFromBuilt(built, pollRunId);
        const plan = slicePlanRef.current;
        const currentIndex = plan?.currentIndex ?? 0;

        if (plan) {
          setDayGroups((prev) =>
            prev.map((group, index) =>
              index === currentIndex ? { ...group, status: "running", expanded: true, lines: tasks } : group,
            ),
          );
        } else {
          completedLogRef.current = tasks;
          setLogLines((prev) => (logLinesEqual(prev, tasks) ? prev : tasks));
        }

        if (detail.run.status !== "running") {
          const sliceFailed = detail.run.status === "error" || detail.run.status === "stopped";
          const canContinue =
            plan &&
            plan.currentIndex < plan.slices.length - 1 &&
            !stopRequestedRef.current &&
            (detail.run.status === "completed" || sliceFailed);

          let finishedLines = tasks;
          if (sliceFailed && plan && !stopRequestedRef.current) {
            const errMsg =
              typeof detail.run.stats === "object" &&
              detail.run.stats &&
              "error" in detail.run.stats &&
              typeof detail.run.stats.error === "string"
                ? detail.run.stats.error
                : "Pipeline run failed";
            finishedLines = [
              ...tasks,
              {
                id: `${pollRunId}-failed`,
                text: errMsg,
                status: "rejected" as const,
              },
            ];
          }

          if (plan) {
            const currentDay = plan.slices[currentIndex]!;
            setDayGroups((prev) =>
              prev.map((group, index) =>
                index === currentIndex
                  ? {
                      ...group,
                      status: "done",
                      outcome: deriveDayOutcome(finishedLines),
                      lines: finishedLines,
                      expanded: true,
                    }
                  : group,
              ),
            );
            scheduleDayCollapse(currentDay.dateFrom);
          }

          if (canContinue && plan) {
            if (runIdRef.current !== pollRunId) return;
            const nextIndex = plan.currentIndex + 1;
            slicePlanRef.current = { ...plan, currentIndex: nextIndex };
            setRunId(null);
            runIdRef.current = null;
            void startPipelineSlice(plan.slices[nextIndex]!, plan.checkScopes, {
              sliceIndex: nextIndex + 1,
              sliceTotal: plan.slices.length,
              targetDates: plan.targetDates,
            });
            return;
          }

          setRunning(false);
          setRunId(null);
          runIdRef.current = null;
          setProgressLabel(null);
          slicePlanRef.current = null;
          if (stopRequestedRef.current) return;

          const pending = humanReviewQueuedCount(detail.run.stats);
          const batchHadFailures =
            plan ?
              finishedLines.some((line) => line.status === "rejected")
            : completedLogRef.current.some((line) => line.status === "rejected");
          toast({
            title:
              detail.run.status === "completed" && !batchHadFailures
                ? "Agent run finished"
                : batchHadFailures && plan && plan.slices.length > 1
                  ? "Agent run finished with errors"
                  : detail.run.status === "completed"
                    ? "Agent run finished"
                    : "Agent run stopped",
            description:
              batchHadFailures && plan && plan.slices.length > 1
                ? "Some days failed — see the activity log. Successful days may have auto-applied fixes."
                : detail.run.status === "completed" && pending > 0
                  ? `${pending} item(s) queued on Agents → Pending (try Corrections for tag fixes).`
                  : detail.run.status === "completed"
                    ? "Run finished — tag fixes may have auto-applied with no pending review. Check the day rows or Agents → All."
                    : typeof detail.run.stats === "object" &&
                        detail.run.stats &&
                        "error" in detail.run.stats &&
                        typeof detail.run.stats.error === "string"
                      ? detail.run.stats.error
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
  }, [running, runId, scheduleDayCollapse, startPipelineSlice, toast]);

  useEffect(() => {
    return () => {
      for (const timer of collapseTimersRef.current.values()) {
        clearTimeout(timer);
      }
      collapseTimersRef.current.clear();
    };
  }, []);

  return {
    running,
    activityStore,
    progressLabel,
    logScrollRef,
    runQualityCheckAgent,
    stopRun,
    toggleDayExpanded,
    clearLog: () => {
      resetBulkDayState();
      setLogLines([]);
    },
  };
}
