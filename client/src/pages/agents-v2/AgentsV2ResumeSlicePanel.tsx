import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import {
  fetchResumeOptions,
  resumePipelineSlice,
  type PipelineAgentName,
} from "@/lib/editorial-pipeline";
import type { OperatorSnapshot } from "@/pages/agents-v2/parse-operator-snapshot";
import { useToast } from "@/hooks/use-toast";

const AGENT_LABEL: Record<string, string> = {
  VerificationAgent: "Re-verify sources",
  TopicValidatorAgent: "Re-run topics",
  TopicManagerAgent: "Re-run topics (legacy name)",
  TagManagerAgent: "Re-run tags",
  SummaryAgent: "Regenerate summary",
  DuplicateCheckerAgent: "Duplicate check",
  DateConsistencyAgent: "Date consistency",
  TagConsistencyAgent: "Tag consistency",
  FinalEditorAgent: "Final editor gate",
  SourceFinderAgent: "Source finder",
};

function labelForAgent(agent: string): string {
  return AGENT_LABEL[agent] ?? agent.replace(/Agent$/, "").replace(/([a-z])([A-Z])/g, "$1 $2");
}

type Props = {
  date: string;
  snapshot: OperatorSnapshot | null;
  disabled?: boolean;
  onSliceStarted?: (runId: string) => void;
};

export function AgentsV2ResumeSlicePanel({ date, snapshot, disabled, onSliceStarted }: Props) {
  const { toast } = useToast();
  const [starts, setStarts] = useState<string[]>(snapshot?.resumeStartsAvailable ?? []);
  const [loading, setLoading] = useState(false);
  const [busyAgent, setBusyAgent] = useState<string | null>(null);

  useEffect(() => {
    if (snapshot?.resumeStartsAvailable?.length) {
      setStarts(snapshot.resumeStartsAvailable);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void fetchResumeOptions(date)
      .then((o) => {
        if (!cancelled) setStarts(o.resumeStartsAvailable);
      })
      .catch(() => {
        if (!cancelled) setStarts([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [date, snapshot?.resumeStartsAvailable]);

  const runSlice = async (startAgent: string) => {
    setBusyAgent(startAgent);
    try {
      const out = await resumePipelineSlice({
        date,
        startAgent: startAgent as PipelineAgentName,
      });
      toast({
        title: "Resume slice started",
        description: `Run ${out.runId.slice(0, 8)}… from ${labelForAgent(startAgent)}`,
      });
      onSliceStarted?.(out.runId);
    } catch (e) {
      toast({
        title: "Resume slice failed",
        description: e instanceof Error ? e.message : "Error",
        variant: "destructive",
      });
    } finally {
      setBusyAgent(null);
    }
  };

  const blocker = snapshot?.firstBlocker;

  return (
    <div className="space-y-2.5 rounded-lg border border-amber-500/25 bg-amber-500/[0.06] p-3">
      {blocker ? (
        <div className="space-y-1">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">
            Blocked at {labelForAgent(blocker.agent)}
          </p>
          {blocker.reason ? (
            <p className="text-xs leading-relaxed text-muted-foreground">{blocker.reason}</p>
          ) : null}
        </div>
      ) : null}
      {snapshot?.shortCircuited ? (
        <p className="text-[11px] text-muted-foreground">
          Chain stopped early ({snapshot.executedAgentSteps ?? "?"} / {snapshot.scheduledAgentSteps ?? "?"} agents).
          Re-run from a step below after you fix the day.
        </p>
      ) : null}
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Resume slice</p>
      {loading ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" /> Loading options…
        </p>
      ) : starts.length === 0 ? (
        <p className="text-xs text-muted-foreground">No slice anchors for this date.</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {starts.map((agent) => (
            <Button
              key={agent}
              type="button"
              size="sm"
              variant="secondary"
              className="h-auto min-h-8 justify-start whitespace-normal py-2 text-left text-xs font-normal"
              disabled={disabled || busyAgent != null}
              onClick={(e) => {
                e.stopPropagation();
                void runSlice(agent);
              }}
            >
              {busyAgent === agent ? <Loader2 className="mr-2 size-3.5 shrink-0 animate-spin" /> : null}
              {labelForAgent(agent)}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
