import { useMutation, useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { Bot, Loader2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import {
  approveReviewItem,
  fetchReviewQueue,
  rejectReviewItem,
  type ApproveReviewOpts,
  type EditorialReviewItem,
} from "@/lib/editorial-pipeline";
import { queryClient } from "@/lib/queryClient";
import { AgentsV2ReviewPhasePanel } from "@/pages/agents-v2/AgentsV2ReviewPhasePanels";
import {
  effectiveReviewItemPhase,
  mapReviewItemToQueueRow,
} from "@/pages/agents-v2/map-review-queue";
import { cn } from "@/lib/utils";

type DayPendingReviewPanelProps = {
  date: string;
  /** Fires after each approve/reject refresh. */
  onResolved?: () => void;
  /** Fires once when pending decisions drop to zero after a resolve. */
  onAllCleared?: () => void;
  /** Compact layout for embedding inside the Final agent dialog. */
  compact?: boolean;
  /** Slide items in/out when embedded in the Final agent dialog. */
  animateItems?: boolean;
  className?: string;
};

function invalidateDayReviewQueries(date: string) {
  void queryClient.invalidateQueries({ queryKey: ["day-pending-reviews", date] });
  void queryClient.invalidateQueries({ queryKey: ["pending-agent-queue", date] });
  void queryClient.invalidateQueries({ queryKey: ["pipeline-review-summary", date] });
  void queryClient.invalidateQueries({ queryKey: [`supabase-date-${date}`] });
  void queryClient.invalidateQueries({ queryKey: ["analyses-browse"] });
}

export function DayPendingReviewPanel({
  date,
  onResolved,
  onAllCleared,
  compact = false,
  animateItems = false,
  className,
}: DayPendingReviewPanelProps) {
  const { toast } = useToast();
  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ["day-pending-reviews", date],
    queryFn: () => fetchReviewQueue("pending", { limit: 20, eventDate: date }),
    enabled: Boolean(date),
    staleTime: 5_000,
    refetchOnWindowFocus: true,
  });

  const items = (data?.items ?? []).filter((item) => item.eventDate === date);

  const afterResolve = async () => {
    await invalidateDayReviewQueries(date);
    const refreshed = await queryClient.fetchQuery({
      queryKey: ["day-pending-reviews", date],
      queryFn: () => fetchReviewQueue("pending", { limit: 20, eventDate: date }),
    });
    const remaining = (refreshed.items ?? []).filter((item) => item.eventDate === date);
    onResolved?.();
    if (remaining.length === 0) {
      onAllCleared?.();
    }
  };

  const approveMutation = useMutation({
    mutationFn: async ({ id, opts }: { id: string; opts?: ApproveReviewOpts }) =>
      approveReviewItem(id, opts),
    onSuccess: async () => {
      toast({ title: "Decision saved" });
      await afterResolve();
    },
    onError: (err: Error) => {
      toast({
        title: "Approve failed",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: async (id: string) => rejectReviewItem(id),
    onSuccess: async () => {
      toast({ title: "Rejected — pipeline can rerun this day" });
      await afterResolve();
    },
    onError: (err: Error) => {
      toast({
        title: "Reject failed",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  if (isLoading) {
    const body = (
      <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading decisions for this day…
      </div>
    );
    if (compact) return <div className={className}>{body}</div>;
    return (
      <Card className={cn("border-amber-500/30 bg-amber-500/[0.04]", className)}>
        <CardContent className="p-0">{body}</CardContent>
      </Card>
    );
  }

  if (isError) {
    const body = (
      <div className="space-y-3 p-4">
        <p className="text-sm text-destructive">
          Could not load pending decisions{error instanceof Error ? `: ${error.message}` : "."}
        </p>
        <Button type="button" size="sm" variant="outline" onClick={() => void refetch()}>
          Retry
        </Button>
      </div>
    );
    if (compact) return <div className={className}>{body}</div>;
    return (
      <Card className={cn("border-destructive/40 bg-destructive/5", className)}>
        <CardContent className="p-0">{body}</CardContent>
      </Card>
    );
  }

  if (items.length === 0) return null;

  const busyId = approveMutation.isPending
    ? approveMutation.variables?.id ?? null
    : rejectMutation.isPending
      ? rejectMutation.variables ?? null
      : null;

  const content = (
    <div className={cn("space-y-4", compact ? "p-0" : "p-4 sm:p-5")}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Bot className="h-4 w-4 text-amber-300" />
            <h3 className="text-sm font-semibold text-foreground">Decisions needed</h3>
            <Badge
              variant="outline"
              className="border-amber-500/40 bg-amber-950/30 text-[10px] text-amber-100"
            >
              {items.length} pending
            </Badge>
            {isFetching ? <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" /> : null}
          </div>
          <p className="text-xs text-muted-foreground">
            {compact
              ? "Answer here — Google Check runs automatically after the last decision."
              : "Same questions as Admin Agent — answer them here without leaving this day."}
          </p>
        </div>
      </div>

      <div className="space-y-4">
        <AnimatePresence initial={false} mode="popLayout">
          {items.map((item) => (
            <motion.div
              key={item.id}
              layout
              initial={animateItems ? { opacity: 0, y: 24, height: 0 } : false}
              animate={animateItems ? { opacity: 1, y: 0, height: "auto" } : undefined}
              exit={animateItems ? { opacity: 0, y: -12, height: 0, marginBottom: 0 } : undefined}
              transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
              className={animateItems ? "overflow-hidden" : undefined}
            >
              <DayReviewItemCard
                item={item}
                busy={busyId === item.id}
                onApprove={(id, opts) => approveMutation.mutate({ id, opts })}
                onReject={(id) => rejectMutation.mutate(id)}
              />
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );

  if (compact) {
    return (
      <div
        className={cn("rounded-lg border border-amber-500/40 bg-amber-500/[0.06] p-3 sm:p-4", className)}
        data-testid="day-pending-review-panel"
      >
        {content}
      </div>
    );
  }

  return (
    <Card
      className={cn("border-amber-500/40 bg-amber-500/[0.06]", className)}
      data-testid="day-pending-review-panel"
    >
      <CardContent className="p-0">{content}</CardContent>
    </Card>
  );
}

function DayReviewItemCard({
  item,
  busy,
  onApprove,
  onReject,
}: {
  item: EditorialReviewItem;
  busy: boolean;
  onApprove: (id: string, opts?: ApproveReviewOpts) => void;
  onReject: (id: string) => void;
}) {
  const row = mapReviewItemToQueueRow(item);
  const phase = effectiveReviewItemPhase(item) ?? item.reviewPhase ?? "legacy";

  return (
    <div className="rounded-lg border border-border bg-background/80 p-3 sm:p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0 space-y-0.5">
          <p className="text-sm font-medium text-foreground">{row.title}</p>
          {row.subtitle ? <p className="text-xs text-muted-foreground">{row.subtitle}</p> : null}
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
            {String(phase).replaceAll("_", " ")}
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => onReject(item.id)}
        >
          Reject
        </Button>
      </div>
      <AgentsV2ReviewPhasePanel item={item} busy={busy} onApprove={onApprove} />
    </div>
  );
}
