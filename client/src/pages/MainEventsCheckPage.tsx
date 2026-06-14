import { useRef, useState, type Dispatch, type SetStateAction } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCheck, ChevronRight, Leaf, Layers, Loader2 } from "lucide-react";

import { MainEventsCrossLeafPanel } from "@/components/MainEventsCrossLeafPanel";
import { MainEventsReviewPanel } from "@/components/MainEventsReviewPanel";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { startPipelineRun } from "@/lib/editorial-pipeline";
import { cacheMainEventsGeminiForLeaf } from "@/lib/leaf-agent";
import type { MainEventsReviewQueue } from "@/lib/leaf-agent";
import {
  applyCrossLeafProposalSupabase,
  fetchMainEventsCrossLeafQueueSupabase,
  keepCrossLeafDatabaseEntrySupabase,
} from "@/lib/main-events-cross-leaf-supabase";
import {
  autoAcceptCertainMatchesSupabase,
  previewAutoAcceptCertainMatchesSupabase,
} from "@/lib/main-events-auto-accept-supabase";
import {
  applyReviewGeminiEventSupabase,
  fetchMainEventsCacheOverviewSupabase,
  fetchMainEventsLeafStatsSupabase,
  fetchMainEventsReviewQueueSupabase,
  setMainEventsReviewDecisionSupabase,
} from "@/lib/main-events-review-supabase";
import { isSupabaseConfigured } from "@/lib/supabase";
import { TOPIC_HIERARCHY, TOPIC_HIERARCHY_LEAVES } from "@shared/topic-hierarchy";
import { applyReviewDecisionToQueue } from "@shared/main-events-review-build";
import type { MainEventsReviewDecision } from "@shared/leaf-agent-config";

function reviewQueryKey(leaf: string) {
  return ["main-events-check-review-supabase", leaf] as const;
}

function mutateReviewBusyDates(
  setter: Dispatch<SetStateAction<Set<string>>>,
  date: string,
  busy: boolean,
) {
  setter((prev) => {
    const next = new Set(prev);
    if (busy) next.add(date);
    else next.delete(date);
    return next;
  });
}

function formatCacheTime(iso: string | null | undefined): string {
  if (!iso) return "earlier";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "earlier";
  return date.toLocaleString();
}

export default function MainEventsCheckPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [leaf, setLeaf] = useState("Halving events");
  const [reviewBusyDates, setReviewBusyDates] = useState<Set<string>>(() => new Set());
  const [crossLeafBusyDate, setCrossLeafBusyDate] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"leaf" | "duplicates">("leaf");
  const reviewMutationChain = useRef(Promise.resolve());
  const reviewInflightDates = useRef(new Set<string>());

  const [autoAcceptPreview, setAutoAcceptPreview] = useState<{
    candidateDates: number;
    leavesWithCandidates: number;
  } | null>(null);

  const statsQuery = useQuery({
    queryKey: ["main-events-check-stats-supabase", leaf],
    queryFn: () => fetchMainEventsLeafStatsSupabase(leaf),
    enabled: Boolean(leaf) && isSupabaseConfigured,
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const cacheOverviewQuery = useQuery({
    queryKey: ["main-events-check-cache-overview-supabase"],
    queryFn: fetchMainEventsCacheOverviewSupabase,
    enabled: isSupabaseConfigured,
    staleTime: 30 * 1000,
  });

  const reviewQuery = useQuery({
    queryKey: ["main-events-check-review-supabase", leaf],
    queryFn: () => fetchMainEventsReviewQueueSupabase(leaf),
    enabled: Boolean(leaf) && isSupabaseConfigured && viewMode === "leaf",
    staleTime: 0,
    refetchOnWindowFocus: false,
  });

  const crossLeafQuery = useQuery({
    queryKey: ["main-events-check-cross-leaf-supabase"],
    queryFn: fetchMainEventsCrossLeafQueueSupabase,
    enabled: isSupabaseConfigured,
    staleTime: 30 * 1000,
    refetchOnWindowFocus: false,
  });

  const autoAcceptPreviewMutation = useMutation({
    mutationFn: () => previewAutoAcceptCertainMatchesSupabase(),
    onSuccess: (preview) => {
      setAutoAcceptPreview(preview);
      toast({
        title: "Auto-accept preview",
        description:
          preview.candidateDates > 0
            ? `${preview.candidateDates} certain match${preview.candidateDates === 1 ? "" : "es"} across ${preview.leavesWithCandidates} leaf${preview.leavesWithCandidates === 1 ? "" : "es"}.`
            : "No certain matches found — nothing would be auto-accepted.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Preview failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const autoAcceptMutation = useMutation({
    mutationFn: () => autoAcceptCertainMatchesSupabase({ dryRun: false }),
    onSuccess: (summary) => {
      setAutoAcceptPreview(null);
      void cacheOverviewQuery.refetch();
      void statsQuery.refetch();
      void reviewQuery.refetch();
      queryClient.invalidateQueries({ queryKey: ["main-events-check-stats-supabase"] });
      queryClient.invalidateQueries({ queryKey: ["main-events-check-review-supabase"] });
      queryClient.invalidateQueries({ queryKey: ["main-events-check-cross-leaf-supabase"] });

      const accepted = summary.totals.accepted;
      toast({
        title: "Auto-accept complete",
        description:
          accepted > 0
            ? `Accepted ${accepted} certain match${accepted === 1 ? "" : "es"} across ${summary.totals.leavesWithCandidates} leaf${summary.totals.leavesWithCandidates === 1 ? "" : "es"}.`
            : "No certain matches were found to accept.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Auto-accept failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const prefetchAllMutation = useMutation({
    mutationFn: async () => {
      const overview = await fetchMainEventsCacheOverviewSupabase();
      let fetched = 0;
      let failed = 0;

      for (const leafName of overview.uncachedLeaves) {
        try {
          await cacheMainEventsGeminiForLeaf({ leaf: leafName });
          fetched += 1;
        } catch {
          failed += 1;
        }
      }

      return { fetched, skipped: overview.cachedCount, failed, total: overview.totalLeaves };
    },
    onSuccess: (summary) => {
      void cacheOverviewQuery.refetch();
      void statsQuery.refetch();
      void reviewQuery.refetch();
      queryClient.invalidateQueries({ queryKey: ["main-events-check-stats-supabase"] });
      queryClient.invalidateQueries({ queryKey: ["main-events-check-review-supabase"] });
      queryClient.invalidateQueries({ queryKey: ["main-events-check-cross-leaf-supabase"] });

      toast({
        title: "Gemini lists prepared",
        description:
          summary.fetched > 0
            ? `Cached ${summary.fetched} leaf${summary.fetched === 1 ? "" : "es"}. ${summary.skipped} were already prepared.`
            : "Every storyline leaf already had a cached Gemini list.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Prepare all failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const enqueueReviewMutation = (run: () => Promise<void>) => {
    reviewMutationChain.current = reviewMutationChain.current.then(run).catch(() => {
      /* keep the serialized queue alive after failures */
    });
  };

  const handleReviewDecision = (date: string, decision: MainEventsReviewDecision) => {
    if (reviewInflightDates.current.has(date)) return;

    const queryKey = reviewQueryKey(leaf);
    const snapshot = queryClient.getQueryData<MainEventsReviewQueue>(queryKey);
    const item = snapshot?.items.find((row) => row.date === date);
    if (item && item.reviewStatus !== "pending") return;

    const priorStatus = item?.reviewStatus ?? "pending";

    if (snapshot) {
      queryClient.setQueryData(queryKey, applyReviewDecisionToQueue(snapshot, date, decision));
    }

    reviewInflightDates.current.add(date);
    mutateReviewBusyDates(setReviewBusyDates, date, true);

    enqueueReviewMutation(async () => {
      try {
        await setMainEventsReviewDecisionSupabase({ leaf, date, decision, refetchQueue: false });
      } catch (error) {
        const current = queryClient.getQueryData<MainEventsReviewQueue>(queryKey);
        if (current) {
          queryClient.setQueryData(queryKey, applyReviewDecisionToQueue(current, date, priorStatus));
        }
        toast({
          title: "Could not save review",
          description: error instanceof Error ? error.message : "Unknown error",
          variant: "destructive",
        });
      } finally {
        reviewInflightDates.current.delete(date);
        mutateReviewBusyDates(setReviewBusyDates, date, false);
      }
    });
  };

  const handleReviewApply = async (date: string) => {
    const item = reviewQuery.data?.items.find((row) => row.date === date);
    if (!item) {
      toast({
        title: "Could not apply to database",
        description: "Review item no longer in queue — refresh and try again.",
        variant: "destructive",
      });
      return;
    }

    setReviewBusyDates((prev) => new Set(prev).add(date));
    enqueueReviewMutation(async () => {
      try {
        const result = await applyReviewGeminiEventSupabase({ leaf, date, item });
        queryClient.setQueryData(reviewQueryKey(leaf), result.queue);
        queryClient.invalidateQueries({ queryKey: ["main-events-check-stats-supabase"] });
        queryClient.invalidateQueries({ queryKey: ["main-events-check-cross-leaf-supabase"] });
        queryClient.invalidateQueries({ queryKey: [`supabase-date-${date}`] });
        queryClient.invalidateQueries({ queryKey: ["supabase-tags-analyses"] });

        let agentNote = "";
        try {
          await startPipelineRun({
            dateFrom: date,
            dateTo: date,
            maxDaysToConsider: 1,
            targetDates: [date],
          });
          agentNote = " Editorial agent started for tags and summary.";
        } catch (agentError) {
          agentNote =
            agentError instanceof Error
              ? ` Manual entry saved, but agent could not start: ${agentError.message}`
              : " Manual entry saved, but agent could not start.";
        }

        const placeholderNote = result.usedPlaceholderSource
          ? " Used placeholder source URL (no Gemini link cached)."
          : "";

        toast({
          title: "Applied to database",
          description: `${date} — manual entry saved on ${result.leafLabel}.${placeholderNote}${agentNote}`,
        });
      } catch (error) {
        toast({
          title: "Could not apply to database",
          description: error instanceof Error ? error.message : "Unknown error",
          variant: "destructive",
        });
      } finally {
        mutateReviewBusyDates(setReviewBusyDates, date, false);
      }
    });
  };

  const handleCrossLeafApply = async (date: string, ownerLeaf: string) => {
    const item = crossLeafQuery.data?.items.find((row) => row.date === date);
    if (!item) {
      toast({
        title: "Could not apply proposal",
        description: "Duplicate date no longer in queue — refresh and try again.",
        variant: "destructive",
      });
      return;
    }

    setCrossLeafBusyDate(date);
    try {
      const result = await applyCrossLeafProposalSupabase({ date, ownerLeaf, item });
      queryClient.setQueryData(["main-events-check-cross-leaf-supabase"], result.queue);
      queryClient.invalidateQueries({ queryKey: ["main-events-check-review-supabase"] });
      queryClient.invalidateQueries({ queryKey: ["main-events-check-stats-supabase"] });
      queryClient.invalidateQueries({ queryKey: [`supabase-date-${date}`] });
      queryClient.invalidateQueries({ queryKey: ["supabase-tags-analyses"] });

      let agentNote = "";
      try {
        await startPipelineRun({
          dateFrom: date,
          dateTo: date,
          maxDaysToConsider: 1,
          targetDates: [date],
        });
        agentNote = " Editorial agent started for tags and summary.";
      } catch (agentError) {
        agentNote =
          agentError instanceof Error
            ? ` Manual entry saved, but agent could not start: ${agentError.message}`
            : " Manual entry saved, but agent could not start.";
      }

      const placeholderNote = result.usedPlaceholderSource
        ? " Used placeholder source URL (no Gemini link cached)."
        : "";

      toast({
        title: `Applied ${result.ownerLeafLabel} proposal`,
        description: `${date} — manual entry saved and cross-leaf ownership assigned.${placeholderNote}${agentNote}`,
      });
    } catch (error) {
      toast({
        title: "Could not apply proposal",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setCrossLeafBusyDate(null);
    }
  };

  const handleCrossLeafKeepDatabase = async (date: string) => {
    const item = crossLeafQuery.data?.items.find((row) => row.date === date);
    if (!item) {
      toast({
        title: "Could not keep database entry",
        description: "Duplicate date no longer in queue — refresh and try again.",
        variant: "destructive",
      });
      return;
    }

    setCrossLeafBusyDate(date);
    try {
      const result = await keepCrossLeafDatabaseEntrySupabase({ date, item });
      queryClient.setQueryData(["main-events-check-cross-leaf-supabase"], result.queue);
      queryClient.invalidateQueries({ queryKey: ["main-events-check-review-supabase"] });
      queryClient.invalidateQueries({ queryKey: ["main-events-check-stats-supabase"] });

      toast({
        title: "Kept database entry",
        description: `${date} — assigned to ${result.ownerLeafLabel}. Your summary and tags were not changed.`,
      });
    } catch (error) {
      toast({
        title: "Could not keep database entry",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setCrossLeafBusyDate(null);
    }
  };

  const advanceToNextLeaf = () => {
    const index = TOPIC_HIERARCHY_LEAVES.indexOf(leaf);
    const nextIndex = index >= 0 ? (index + 1) % TOPIC_HIERARCHY_LEAVES.length : 0;
    setLeaf(TOPIC_HIERARCHY_LEAVES[nextIndex]!);
  };

  const stats = statsQuery.data;
  const cacheOverview = cacheOverviewQuery.data;
  const uncachedLeafCount = cacheOverview?.uncachedLeaves.length ?? null;
  const preparingAll = prefetchAllMutation.isPending;
  const autoAcceptBusy = autoAcceptPreviewMutation.isPending || autoAcceptMutation.isPending;

  if (!isSupabaseConfigured) {
    return (
      <div className="mx-auto max-w-5xl space-y-4 py-8">
        <h1 className="text-2xl font-bold tracking-tight">Main events check</h1>
        <p className="text-sm text-destructive">
          Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to client/.env
          (same as the homepage).
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
          <Leaf className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Main events check</h1>
          <p className="text-sm text-muted-foreground">
            Review cached Gemini main events per storyline leaf — compare each event to your database,
            then accept or reject. Resolve duplicate dates across leaves in the second tab.
          </p>
        </div>
      </div>

      <Tabs value={viewMode} onValueChange={(value) => setViewMode(value as "leaf" | "duplicates")}>
        <TabsList className="grid w-full max-w-md grid-cols-2">
          <TabsTrigger value="leaf">Review by leaf</TabsTrigger>
          <TabsTrigger value="duplicates">
            Duplicate dates
            {crossLeafQuery.data?.counts.unresolved
              ? ` (${crossLeafQuery.data.counts.unresolved})`
              : ""}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="leaf" className="mt-6 space-y-6">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Storyline leaf</CardTitle>
          <CardDescription>
            {cacheOverview
              ? `${cacheOverview.cachedCount} of ${cacheOverview.totalLeaves} leaves have Gemini lists cached.`
              : "Choose a leaf to review its main events checklist."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="leaf-select">Leaf</Label>
            <div className="flex gap-2">
              <Select value={leaf} onValueChange={setLeaf}>
                <SelectTrigger id="leaf-select" className="min-w-0 flex-1">
                  <SelectValue placeholder="Choose a leaf" />
                </SelectTrigger>
                <SelectContent className="max-h-80">
                  {TOPIC_HIERARCHY.map((group) => (
                    <SelectGroup key={group.name}>
                      <SelectLabel className="pl-2 pr-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {group.name}
                      </SelectLabel>
                      {group.leaves.map((item) => (
                        <SelectItem key={item} value={item}>
                          {item}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
              <Button
                type="button"
                variant="outline"
                size="default"
                className="shrink-0"
                onClick={advanceToNextLeaf}
                aria-label="Next leaf"
              >
                Next
                <ChevronRight className="ml-1 h-4 w-4" />
              </Button>
            </div>
            {stats ? (
              <div className="space-y-1 text-xs text-muted-foreground">
                <p>
                  {stats.corpusCount.toLocaleString()} days on this leaf ·{" "}
                  {stats.lockedCount.toLocaleString()} locked
                </p>
                {stats.geminiCached ? (
                  <p>
                    {stats.canonicalCount} cached main events · saved {formatCacheTime(stats.fetchedAt)}
                  </p>
                ) : (
                  <p>No Gemini list for this leaf yet — use Prepare all leaves below.</p>
                )}
              </div>
            ) : statsQuery.isLoading ? (
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                Loading leaf stats…
              </p>
            ) : null}
          </div>

          <details className="text-sm">
            <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
              Advanced — batch tools
            </summary>
            <div className="mt-3 space-y-3">
              <div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => prefetchAllMutation.mutate()}
                  disabled={preparingAll || uncachedLeafCount === 0}
                >
                  {preparingAll ? (
                    <>
                      <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                      Preparing all leaves…
                    </>
                  ) : (
                    <>
                      <Layers className="mr-2 h-3.5 w-3.5" />
                      Prepare all leaves
                      {uncachedLeafCount != null && uncachedLeafCount > 0 ? ` (${uncachedLeafCount})` : ""}
                    </>
                  )}
                </Button>
                <p className="mt-1 text-xs text-muted-foreground">
                  Fetch missing Gemini lists (requires server API).
                </p>
              </div>

              <div className="space-y-2 border-t border-border/60 pt-3">
                <p className="text-xs text-muted-foreground">
                  Auto-accept pending items where the database row exists and is tagged on this leaf
                  (skips locked, untagged, wrong-leaf, and missing rows).
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => autoAcceptPreviewMutation.mutate()}
                    disabled={autoAcceptBusy}
                  >
                    {autoAcceptPreviewMutation.isPending ? (
                      <>
                        <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                        Previewing…
                      </>
                    ) : (
                      "Preview auto-accept"
                    )}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => autoAcceptMutation.mutate()}
                    disabled={autoAcceptBusy}
                  >
                    {autoAcceptMutation.isPending ? (
                      <>
                        <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                        Auto-accepting…
                      </>
                    ) : (
                      <>
                        <CheckCheck className="mr-2 h-3.5 w-3.5" />
                        Auto-accept certain matches
                        {autoAcceptPreview && autoAcceptPreview.candidateDates > 0
                          ? ` (${autoAcceptPreview.candidateDates})`
                          : ""}
                      </>
                    )}
                  </Button>
                </div>
                {autoAcceptPreview ? (
                  <p className="text-xs text-muted-foreground">
                    Preview: {autoAcceptPreview.candidateDates} match
                    {autoAcceptPreview.candidateDates === 1 ? "" : "es"} across{" "}
                    {autoAcceptPreview.leavesWithCandidates} leaf
                    {autoAcceptPreview.leavesWithCandidates === 1 ? "" : "es"}.
                  </p>
                ) : null}
              </div>
            </div>
          </details>
        </CardContent>
      </Card>

      <MainEventsReviewPanel
        queue={reviewQuery.data}
        loading={reviewQuery.isLoading}
        error={
          reviewQuery.error instanceof Error
            ? reviewQuery.error.message
            : reviewQuery.isError
              ? "Failed to load review checklist"
              : null
        }
        busyDates={reviewBusyDates}
        onRetry={() => void reviewQuery.refetch()}
        onDecision={(date, decision) => void handleReviewDecision(date, decision)}
        onApply={(date) => void handleReviewApply(date)}
      />
        </TabsContent>

        <TabsContent value="duplicates" className="mt-6">
          <MainEventsCrossLeafPanel
            queue={crossLeafQuery.data}
            loading={crossLeafQuery.isLoading}
            error={
              crossLeafQuery.error instanceof Error
                ? crossLeafQuery.error.message
                : crossLeafQuery.isError
                  ? "Failed to load duplicate dates"
                  : null
            }
            busyDate={crossLeafBusyDate}
            onRetry={() => void crossLeafQuery.refetch()}
            onApply={(date, ownerLeaf) => void handleCrossLeafApply(date, ownerLeaf)}
            onKeepDatabase={(date) => void handleCrossLeafKeepDatabase(date)}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
