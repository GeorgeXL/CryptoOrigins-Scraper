import { useEffect, useRef, useState } from "react";

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

const POLL_MS = 1500;

type SingleDayAgentDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  date: string;
  onRunFinished?: () => void;
};

export function SingleDayAgentDialog({
  open,
  onOpenChange,
  date,
  onRunFinished,
}: SingleDayAgentDialogProps) {
  const [runId, setRunId] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [logLines, setLogLines] = useState<LogLine[]>([]);
  const [startError, setStartError] = useState<string | null>(null);
  const logScrollRootRef = useRef<HTMLDivElement | null>(null);
  const isRunningRef = useRef(isRunning);
  isRunningRef.current = isRunning;
  const runIdRef = useRef<string | null>(runId);
  runIdRef.current = runId;

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    setRunId(null);
    setIsRunning(true);
    setStartError(null);
    setLogLines([
      {
        id: "starting",
        text: `Starting editorial agent for ${date}…`,
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

    const poll = async () => {
      if (cancelled || !isRunningRef.current) return;
      try {
        const detail = await fetchPipelineRun(runId);
        if (cancelled) return;
        const built = namespaceLogLines(buildActivityLogFromDetail(detail), detail.run.id);
        setLogLines((prev) => (logLinesEqual(prev, built) ? prev : built));
        if (detail.run.status !== "running") {
          setIsRunning(false);
          onRunFinished?.();
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
  }, [open, runId, onRunFinished]);

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && isRunning && runIdRef.current) {
      void stopPipelineRun(runIdRef.current).catch(() => undefined);
      setIsRunning(false);
    }
    onOpenChange(nextOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Editorial agent</DialogTitle>
          <DialogDescription>
            Single-day pipeline run for {date}. Activity updates while agents work.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Activity log</p>
          <PipelineActivityLog lines={logLines} scrollRef={logScrollRootRef} />
          {startError ? <p className="text-xs text-destructive">{startError}</p> : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            {isRunning ? "Close and stop" : "Close"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
