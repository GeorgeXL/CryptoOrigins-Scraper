import { Bot, Loader2, StopCircle } from "lucide-react";

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
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { PipelineActivityLog } from "@/components/PipelineActivityLog";
import type { LogLine } from "@/lib/pipelineActivityLog";
import { getQualityCheckAgentAction } from "@shared/quality-check-agent-actions";

type QualityCheckAgentToolbarProps = {
  checkId: string | null;
  selectedCount: number;
  totalCount: number;
  running: boolean;
  progressLabel: string | null;
  logLines: LogLine[];
  logScrollRef: React.RefObject<HTMLDivElement | null>;
  onRun: () => void;
  onStop: () => void;
  /** Render only the run/stop button (header right). */
  compact?: boolean;
  /** Render only progress + activity log (below header). */
  logOnly?: boolean;
};

function QualityCheckAgentButton({
  action,
  running,
  targetCount,
  targetLabel,
  onRun,
  onStop,
}: {
  action: NonNullable<ReturnType<typeof getQualityCheckAgentAction>>;
  running: boolean;
  targetCount: number;
  targetLabel: string;
  onRun: () => void;
  onStop: () => void;
}) {
  if (running) {
    return (
      <Button type="button" variant="destructive" size="sm" onClick={() => void onStop()}>
        <StopCircle className="size-4" />
        Stop agent
      </Button>
    );
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button type="button" size="sm" disabled={targetCount === 0}>
          <Bot className="size-4" />
          {action.buttonLabel}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{action.confirmTitle}</AlertDialogTitle>
          <AlertDialogDescription>
            {action.confirmDescription}
            <span className="mt-2 block text-foreground/80">Target: {targetLabel}.</span>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction asChild>
            <Button type="button" onClick={() => void onRun()}>
              Run
            </Button>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function QualityCheckAgentLogPanel({
  running,
  progressLabel,
  logLines,
  logScrollRef,
}: {
  running: boolean;
  progressLabel: string | null;
  logLines: LogLine[];
  logScrollRef: React.RefObject<HTMLDivElement | null>;
}) {
  if (!running && logLines.length === 0) return null;

  return (
    <div className="mb-3 space-y-2 rounded-lg border border-border/70 bg-muted/20 px-3 py-2">
      {progressLabel ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          {running ? <Loader2 className="size-3.5 animate-spin" /> : null}
          {progressLabel}
        </p>
      ) : null}
      {logLines.length > 0 ? (
        <section className="space-y-2">
          <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Activity log</Label>
          <PipelineActivityLog lines={logLines} scrollRef={logScrollRef} scrollClassName="h-[200px]" />
        </section>
      ) : null}
    </div>
  );
}

export function QualityCheckAgentToolbar({
  checkId,
  selectedCount,
  totalCount,
  running,
  progressLabel,
  logLines,
  logScrollRef,
  onRun,
  onStop,
  compact,
  logOnly,
}: QualityCheckAgentToolbarProps) {
  const action = getQualityCheckAgentAction(checkId);
  if (!action || !checkId) return null;

  const targetCount = selectedCount > 0 ? selectedCount : totalCount;
  const targetLabel =
    selectedCount > 0
      ? `${selectedCount} selected row${selectedCount === 1 ? "" : "s"}`
      : `${totalCount} row${totalCount === 1 ? "" : "s"} in this tab`;

  if (compact) {
    return (
      <QualityCheckAgentButton
        action={action}
        running={running}
        targetCount={targetCount}
        targetLabel={targetLabel}
        onRun={onRun}
        onStop={onStop}
      />
    );
  }

  if (logOnly) {
    return (
      <QualityCheckAgentLogPanel
        running={running}
        progressLabel={progressLabel}
        logLines={logLines}
        logScrollRef={logScrollRef}
      />
    );
  }

  return (
    <div className="mb-3 space-y-2">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <QualityCheckAgentButton
          action={action}
          running={running}
          targetCount={targetCount}
          targetLabel={targetLabel}
          onRun={onRun}
          onStop={onStop}
        />
      </div>
      <QualityCheckAgentLogPanel
        running={running}
        progressLabel={progressLabel}
        logLines={logLines}
        logScrollRef={logScrollRef}
      />
    </div>
  );
}
