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
import { BulkDayActivityLog } from "@/components/BulkDayActivityLog";
import { PipelineActivityLog } from "@/components/PipelineActivityLog";
import type { DayActivityGroup, LogLine } from "@/lib/pipelineActivityLog";
import { getQualityCheckAgentAction } from "@shared/quality-check-agent-actions";

type QualityCheckAgentToolbarProps = {
  checkId: string | null;
  selectedCount: number;
  totalCount: number;
  running: boolean;
  progressLabel: string | null;
  logLines: LogLine[];
  dayGroups?: DayActivityGroup[];
  planLine?: LogLine | null;
  logScrollRef: React.RefObject<HTMLDivElement | null>;
  onRun: () => void;
  onStop: () => void;
  onToggleDay?: (dayId: string) => void;
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
  dayGroups,
  planLine,
  logScrollRef,
  onToggleDay,
}: {
  running: boolean;
  progressLabel: string | null;
  logLines: LogLine[];
  dayGroups?: DayActivityGroup[];
  planLine?: LogLine | null;
  logScrollRef: React.RefObject<HTMLDivElement | null>;
  onToggleDay?: (dayId: string) => void;
}) {
  const useDayGroups = (dayGroups?.length ?? 0) > 0;
  if (!running && logLines.length === 0 && !useDayGroups) return null;

  return (
    <div className="mb-3 space-y-2 rounded-lg border border-border/70 bg-muted/20 px-3 py-2">
      {progressLabel ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          {running ? <Loader2 className="size-3.5 animate-spin" /> : null}
          {progressLabel}
        </p>
      ) : null}
      <section className="space-y-2">
        <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Activity log</Label>
        {useDayGroups ? (
          <BulkDayActivityLog
            planLine={planLine ?? null}
            groups={dayGroups ?? []}
            scrollRef={logScrollRef}
            scrollClassName="h-[200px]"
            onToggleDay={onToggleDay ?? (() => undefined)}
          />
        ) : (
          <PipelineActivityLog lines={logLines} scrollRef={logScrollRef} scrollClassName="h-[200px]" />
        )}
      </section>
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
  dayGroups,
  planLine,
  logScrollRef,
  onRun,
  onStop,
  onToggleDay,
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
        dayGroups={dayGroups}
        planLine={planLine}
        logScrollRef={logScrollRef}
        onToggleDay={onToggleDay}
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
        dayGroups={dayGroups}
        planLine={planLine}
        logScrollRef={logScrollRef}
        onToggleDay={onToggleDay}
      />
    </div>
  );
}
