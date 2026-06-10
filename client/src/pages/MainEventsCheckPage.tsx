import { useEffect, useMemo, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { Link } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Leaf, Layers, Loader2, Lock, SearchCheck, Undo2, X, ExternalLink } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Badge } from "@/components/ui/badge";
import { PipelineActivityLog } from "@/components/PipelineActivityLog";
import { useToast } from "@/hooks/use-toast";
import { TOPIC_HIERARCHY } from "@shared/topic-hierarchy";
import { LEAF_AGENT_CORPUS_END_DATE } from "@shared/leaf-agent-config";
import type {
  LeafCoverageMisplaced,
  LeafCoverageResult,
  MainEventsCheckSnapshot,
  MainEventsDismissCategory,
} from "@/lib/leaf-agent";
import {
  cacheMainEventsGeminiForLeaf,
  fetchMainEventsCheckSnapshot,
  fetchMainEventsCheckStats,
  fetchMainEventsCacheOverview,
  promoteDayToLeaf,
  runMainEventsCheck,
  setMainEventsDismissal,
} from "@/lib/leaf-agent";
import type { LogLine } from "@/lib/pipelineActivityLog";
import { cn } from "@/lib/utils";

const importanceClass: Record<string, string> = {
  landmark: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  major: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  notable: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
};

function DateLink({ date }: { date: string }) {
  return (
    <Link href={`/day/${date}`} className="font-mono text-sm text-primary hover:underline">
      {date}
    </Link>
  );
}

function SourceLink({ url }: { url?: string | null }) {
  if (!url) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer noopener"
      className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
    >
      <ExternalLink className="h-3 w-3" />
      Source
    </a>
  );
}

function buildResultLogLines(runId: string, result: LeafCoverageResult, autoLockMatches: boolean): LogLine[] {
  const lines: LogLine[] = [
    {
      id: `${runId}-summary`,
      text: `Cross-check · ${result.matched.length} matched · ${result.misplaced.length} wrong leaf · ${result.missing.length} not in DB · ${result.extra.length} extra`,
      status: "approved",
    },
  ];

  if (result.skippedCanonical.length > 0) {
    lines.push({
      id: `${runId}-skipped`,
      text: `Skipped ${result.skippedCanonical.length} non-exact Gemini date(s)`,
      status: "review",
    });
  }

  if (autoLockMatches && result.newlyLockedCount > 0) {
    lines.push({
      id: `${runId}-locked`,
      text: `Locked ${result.newlyLockedCount} matched day(s)`,
      status: "approved",
    });
  } else if (autoLockMatches && result.matched.length > 0 && result.newlyLockedCount === 0) {
    lines.push({
      id: `${runId}-already-locked`,
      text: "Matched days were already locked",
      status: "review",
    });
  }

  for (const entry of result.matched.slice(0, 6)) {
    lines.push({
      id: `${runId}-match-${entry.date}`,
      text: `Matched ${entry.date} · ${entry.event}${entry.newlyLocked ? " · locked" : ""}`,
      status: "approved",
    });
  }
  if (result.matched.length > 6) {
    lines.push({
      id: `${runId}-match-more`,
      text: `… and ${result.matched.length - 6} more matched date(s)`,
      status: "review",
    });
  }

  for (const entry of result.misplaced.slice(0, 4)) {
    lines.push({
      id: `${runId}-misplaced-${entry.date}`,
      text: `Wrong leaf ${entry.date} · now ${entry.currentLeafLabel}`,
      status: "review",
    });
  }

  for (const entry of result.missing.slice(0, 4)) {
    lines.push({
      id: `${runId}-missing-${entry.date}`,
      text: `Not in DB ${entry.date} · ${entry.event}`,
      status: "review",
    });
  }
  if (result.missing.length > 4) {
    lines.push({
      id: `${runId}-missing-more`,
      text: `… and ${result.missing.length - 4} more date(s) not in database`,
      status: "review",
    });
  }

  lines.push({
    id: `${runId}-done`,
    text: "Main events check complete",
    status: "approved",
  });

  return lines;
}

async function runCoverageWithLog(opts: {
  leaf: string;
  autoLockMatches: boolean;
  refreshFromGemini: boolean;
  setLogLines: Dispatch<SetStateAction<LogLine[]>>;
}): Promise<LeafCoverageResult> {
  const runId = String(Date.now());
  const push = (line: LogLine) => {
    opts.setLogLines((prev) => [...prev, line]);
  };
  const replace = (id: string, next: LogLine) => {
    opts.setLogLines((prev) => prev.map((line) => (line.id === id ? next : line)));
  };

  opts.setLogLines([
    {
      id: `${runId}-start`,
      text: `Starting main events check · ${opts.leaf}`,
      status: "approved",
    },
    {
      id: `${runId}-corpus`,
      text: "Loading corpus for leaf…",
      status: "pending",
    },
  ]);

  const stats = await fetchMainEventsCheckStats(opts.leaf);
  replace(`${runId}-corpus`, {
    id: `${runId}-corpus`,
    text: `Corpus loaded · ${stats.corpusCount.toLocaleString()} day(s) · ${stats.lockedCount.toLocaleString()} locked`,
    status: "approved",
  });

  push({
    id: `${runId}-gemini`,
    text: opts.refreshFromGemini
      ? "Refreshing main events from Gemini…"
      : "Loading cached main events list…",
    status: "pending",
  });

  const result = await runMainEventsCheck({
    leaf: opts.leaf,
    autoLockMatches: opts.autoLockMatches,
    refreshFromGemini: opts.refreshFromGemini,
  });

  replace(`${runId}-gemini`, {
    id: `${runId}-gemini`,
    text:
      result.geminiSource === "cache"
        ? `Using cached Gemini list · ${result.canonicalCount} main event(s) · saved ${formatCacheTime(result.geminiFetchedAt)}`
        : `Gemini refreshed · ${result.canonicalCount} main event(s) · cached for this leaf`,
    status: "approved",
  });

  if (result.notes?.trim()) {
    push({
      id: `${runId}-notes`,
      text: result.notes.trim(),
      status: "review",
    });
  }

  for (const line of buildResultLogLines(runId, result, opts.autoLockMatches)) {
    push(line);
  }

  return result;
}

async function prefetchAllGeminiLists(opts: {
  setLogLines: Dispatch<SetStateAction<LogLine[]>>;
}): Promise<{ fetched: number; skipped: number; failed: number }> {
  const runId = String(Date.now());
  const push = (line: LogLine) => {
    opts.setLogLines((prev) => [...prev, line]);
  };
  const replace = (id: string, next: LogLine) => {
    opts.setLogLines((prev) => prev.map((line) => (line.id === id ? next : line)));
  };

  opts.setLogLines([
    {
      id: `${runId}-start`,
      text: "Preparing Gemini lists for all storyline leaves…",
      status: "approved",
    },
  ]);

  const overview = await fetchMainEventsCacheOverview();
  push({
    id: `${runId}-overview`,
    text: `${overview.cachedCount} of ${overview.totalLeaves} leaves already cached`,
    status: "approved",
  });

  if (overview.uncachedLeaves.length === 0) {
    push({
      id: `${runId}-done`,
      text: "All leaves already have Gemini lists — nothing to fetch",
      status: "approved",
    });
    return { fetched: 0, skipped: overview.cachedCount, failed: 0 };
  }

  push({
    id: `${runId}-queue`,
    text: `Fetching ${overview.uncachedLeaves.length} uncached leaf(es) from Gemini…`,
    status: "review",
  });

  let fetched = 0;
  let failed = 0;

  for (const leafName of overview.uncachedLeaves) {
    const lineId = `${runId}-leaf-${leafName}`;
    push({
      id: lineId,
      text: `${leafName} · calling Gemini…`,
      status: "pending",
    });

    try {
      const result = await cacheMainEventsGeminiForLeaf({ leaf: leafName });
      replace(lineId, {
        id: lineId,
        text: `${leafName} · ${result.canonicalCount} main events cached`,
        status: "approved",
      });
      fetched += 1;
    } catch (error) {
      replace(lineId, {
        id: lineId,
        text: `${leafName} — ${error instanceof Error ? error.message : "Failed"}`,
        status: "rejected",
      });
      failed += 1;
    }
  }

  push({
    id: `${runId}-done`,
    text: `Prepare all complete · ${fetched} fetched · ${overview.cachedCount} skipped · ${failed} failed`,
    status: failed > 0 ? "review" : "approved",
  });

  return { fetched, skipped: overview.cachedCount, failed };
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
  const [autoLockMatches, setAutoLockMatches] = useState(true);
  const [logLines, setLogLines] = useState<LogLine[]>([]);
  const [coverageResult, setCoverageResult] = useState<LeafCoverageResult | undefined>();
  const [promotingDate, setPromotingDate] = useState<string | null>(null);
  const [dismissActionKey, setDismissActionKey] = useState<string | null>(null);
  const logScrollRef = useRef<HTMLDivElement | null>(null);

  const snapshotQuery = useQuery({
    queryKey: ["main-events-check-snapshot", leaf],
    queryFn: () => fetchMainEventsCheckSnapshot(leaf),
    enabled: Boolean(leaf),
    staleTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const cacheOverviewQuery = useQuery({
    queryKey: ["main-events-check-cache-overview"],
    queryFn: fetchMainEventsCacheOverview,
    staleTime: 30 * 1000,
  });

  useEffect(() => {
    setCoverageResult(undefined);
    setLogLines([]);
  }, [leaf]);

  const coverageMutation = useMutation({
    mutationFn: (refreshFromGemini: boolean) =>
      runCoverageWithLog({
        leaf,
        autoLockMatches,
        refreshFromGemini,
        setLogLines,
      }),
    onSuccess: (result) => {
      setCoverageResult(result);
      queryClient.setQueryData<MainEventsCheckSnapshot>(
        ["main-events-check-snapshot", leaf],
        (previous) => ({
          stats: {
            leaf: result.leaf,
            leafLabel: result.leafLabel,
            corpusCount: result.corpusCount,
            lockedCount:
              (previous?.stats.lockedCount ?? 0) +
              result.matched.filter((entry) => entry.newlyLocked).length,
            geminiCache: {
              cached: true,
              fetchedAt: result.geminiFetchedAt,
              geminiModel: result.geminiModel,
              canonicalCount: result.canonicalCount,
              cacheVersion: previous?.stats.geminiCache.cacheVersion ?? null,
            },
          },
          preview: result,
        }),
      );
      if (result.newlyLockedCount > 0) {
        toast({
          title: `${result.newlyLockedCount} day${result.newlyLockedCount === 1 ? "" : "s"} locked`,
          description: "Matched canonical dates are now protected from pipeline edits.",
        });
      }
    },
    onError: (error: Error) => {
      setLogLines((prev) => [
        ...prev.filter((line) => line.status !== "pending"),
        {
          id: `error-${Date.now()}`,
          text: `Main events check failed — ${error.message}`,
          status: "rejected",
        },
      ]);
      toast({
        title: "Main events check failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const prefetchAllMutation = useMutation({
    mutationFn: () => prefetchAllGeminiLists({ setLogLines }),
    onSuccess: (summary) => {
      void cacheOverviewQuery.refetch();
      void snapshotQuery.refetch();
      queryClient.invalidateQueries({ queryKey: ["main-events-check-snapshot"] });
      toast({
        title: "Gemini lists prepared",
        description:
          summary.fetched > 0
            ? `Cached ${summary.fetched} leaf${summary.fetched === 1 ? "" : "es"}. ${summary.skipped} were already prepared.`
            : "Every storyline leaf already had a cached Gemini list.",
      });
    },
    onError: (error: Error) => {
      setLogLines((prev) => [
        ...prev.filter((line) => line.status !== "pending"),
        {
          id: `prefetch-error-${Date.now()}`,
          text: `Prepare all failed — ${error.message}`,
          status: "rejected",
        },
      ]);
      toast({
        title: "Prepare all failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  useEffect(() => {
    if (logLines.length === 0) return;
    const root = logScrollRef.current;
    const viewport = root?.querySelector("[data-radix-scroll-area-viewport]") as HTMLElement | null;
    viewport?.scrollTo({ top: viewport.scrollHeight, behavior: "smooth" });
  }, [logLines]);

  const snapshot = snapshotQuery.data;
  const stats = snapshot?.stats;
  const result = coverageResult ?? snapshot?.preview ?? undefined;
  const extraPreview = useMemo(() => result?.extra.slice(0, 12) ?? [], [result]);
  const dismissedCount = useMemo(() => {
    if (!result?.dismissed) return 0;
    return (
      result.dismissed.misplaced.length +
      result.dismissed.missing.length +
      result.dismissed.extra.length
    );
  }, [result]);
  const running = coverageMutation.isPending;
  const preparingAll = prefetchAllMutation.isPending;
  const busy = running || preparingAll;
  const loadingSnapshot = snapshotQuery.isLoading && !snapshot;
  const showActivityLog = busy || logLines.length > 0;
  const cacheOverview = cacheOverviewQuery.data;
  const uncachedLeafCount = cacheOverview?.uncachedLeaves.length ?? null;

  const syncCoverageResult = (nextResult: LeafCoverageResult) => {
    setCoverageResult(nextResult);
    queryClient.setQueryData<MainEventsCheckSnapshot>(
      ["main-events-check-snapshot", leaf],
      (previous) =>
        previous
          ? {
              stats: previous.stats,
              preview: nextResult,
            }
          : previous,
    );
  };

  const handleDismiss = async (category: MainEventsDismissCategory, date: string) => {
    if (!result) return;
    const actionKey = `${category}:${date}:dismiss`;
    setDismissActionKey(actionKey);
    try {
      const nextResult = await setMainEventsDismissal({
        leaf: result.leaf,
        category,
        date,
        dismissed: true,
      });
      syncCoverageResult(nextResult);
    } catch (error) {
      toast({
        title: "Could not dismiss item",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setDismissActionKey(null);
    }
  };

  const handleRestoreDismissed = async (category: MainEventsDismissCategory, date: string) => {
    if (!result) return;
    const actionKey = `${category}:${date}:restore`;
    setDismissActionKey(actionKey);
    try {
      const nextResult = await setMainEventsDismissal({
        leaf: result.leaf,
        category,
        date,
        dismissed: false,
      });
      syncCoverageResult(nextResult);
    } catch (error) {
      toast({
        title: "Could not restore item",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setDismissActionKey(null);
    }
  };

  const handlePromote = async (entry: LeafCoverageMisplaced) => {
    if (!result) return;
    setPromotingDate(entry.date);
    try {
      const promoted = await promoteDayToLeaf({
        date: entry.date,
        leaf: result.leaf,
        unlockIfNeeded: entry.isLocked,
        lock: true,
      });
      setCoverageResult((prev) => {
        const base = prev ?? result;
        const nextMisplaced = base.misplaced.filter((row) => row.date !== entry.date);
        const isLocked = Boolean(promoted.isLocked);
        const nextMatched = [
          ...base.matched,
          {
            date: entry.date,
            event: entry.event,
            importance: entry.importance,
            summary: entry.summary,
            wasLocked: isLocked,
            newlyLocked: isLocked && !entry.isLocked,
          },
        ].sort((a, b) => a.date.localeCompare(b.date));
        const nextResult = {
          ...base,
          corpusCount: base.corpusCount + 1,
          misplaced: nextMisplaced,
          matched: nextMatched,
          newlyLockedCount: base.newlyLockedCount + (isLocked && !entry.isLocked ? 1 : 0),
        };
        queryClient.setQueryData<MainEventsCheckSnapshot>(
          ["main-events-check-snapshot", leaf],
          (previous) =>
            previous
              ? {
                  stats: {
                    ...previous.stats,
                    corpusCount: nextResult.corpusCount,
                    lockedCount:
                      previous.stats.lockedCount + (isLocked && !entry.isLocked ? 1 : 0),
                  },
                  preview: nextResult,
                }
              : previous,
        );
        return nextResult;
      });
      toast({
        title: "Moved and locked",
        description: `${entry.date} is now matched on ${result.leafLabel}.`,
      });
    } catch (error) {
      toast({
        title: "Could not move day",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setPromotingDate(null);
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
          <Leaf className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Main events check</h1>
          <p className="text-sm text-muted-foreground">
            Gemini lists the main events for a storyline leaf (through{" "}
            {LEAF_AGENT_CORPUS_END_DATE.slice(0, 4)}), cross-checks your database, and locks matches.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Run check</CardTitle>
          <CardDescription>
            Uses Gemini Flash with web search only — no Admin Agent queue.
            {cacheOverview ? (
              <>
                {" "}
                {cacheOverview.cachedCount} of {cacheOverview.totalLeaves} leaves have Gemini lists
                cached.
              </>
            ) : null}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="leaf-select">Storyline leaf</Label>
              <Select value={leaf} onValueChange={setLeaf}>
                <SelectTrigger id="leaf-select">
                  <SelectValue placeholder="Choose a leaf" />
                </SelectTrigger>
                <SelectContent className="max-h-80">
                  {TOPIC_HIERARCHY.map((group) => (
                    <SelectGroup key={group.name}>
                      <SelectLabel>{group.name}</SelectLabel>
                      {group.leaves.map((item) => (
                        <SelectItem key={item} value={item}>
                          {item}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
              {stats ? (
                <div className="space-y-1 text-xs text-muted-foreground">
                  <p>
                    {stats.corpusCount.toLocaleString()} days on this leaf ·{" "}
                    {stats.lockedCount.toLocaleString()} already locked
                  </p>
                  {stats.geminiCache.cached ? (
                    <p>
                      Gemini list cached · {stats.geminiCache.canonicalCount} main events ·{" "}
                      {formatCacheTime(stats.geminiCache.fetchedAt)}
                    </p>
                  ) : (
                    <p>No Gemini list saved for this leaf yet — first run will call Gemini and cache it.</p>
                  )}
                </div>
              ) : null}
            </div>

            <div className="flex items-end sm:col-span-2">
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <Checkbox
                  checked={autoLockMatches}
                  onCheckedChange={(checked) => setAutoLockMatches(checked === true)}
                />
                Auto-lock matched dates
              </label>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button onClick={() => coverageMutation.mutate(false)} disabled={busy || !leaf}>
              {running ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Checking main events…
                </>
              ) : (
                <>
                  <SearchCheck className="mr-2 h-4 w-4" />
                  Run check
                </>
              )}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => coverageMutation.mutate(true)}
              disabled={busy || !leaf}
            >
              Refresh from Gemini
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => prefetchAllMutation.mutate()}
              disabled={busy || uncachedLeafCount === 0}
              title={
                uncachedLeafCount === 0
                  ? "All storyline leaves already have cached Gemini lists"
                  : `Fetch Gemini lists for ${uncachedLeafCount} uncached leaves`
              }
            >
              {preparingAll ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Preparing all leaves…
                </>
              ) : (
                <>
                  <Layers className="mr-2 h-4 w-4" />
                  Prepare all leaves
                  {uncachedLeafCount != null && uncachedLeafCount > 0
                    ? ` (${uncachedLeafCount})`
                    : ""}
                </>
              )}
            </Button>
          </div>

          {showActivityLog ? (
            <div className="space-y-2 rounded-lg border border-border/70 bg-muted/20 px-3 py-2">
              {running ? (
                <p className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="size-3.5 animate-spin" />
                  Main events check running for {leaf}
                </p>
              ) : null}
              {preparingAll ? (
                <p className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="size-3.5 animate-spin" />
                  Fetching Gemini lists for uncached storyline leaves…
                </p>
              ) : null}
              <section className="space-y-2">
                <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Activity log
                </Label>
                <PipelineActivityLog
                  lines={logLines}
                  scrollRef={logScrollRef}
                  scrollClassName="h-[200px]"
                />
              </section>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {loadingSnapshot ? (
        <Card>
          <CardContent className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading {leaf}…
          </CardContent>
        </Card>
      ) : null}

      {result ? (
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">{result.leafLabel}</CardTitle>
              {result.notes ? <CardDescription>{result.notes}</CardDescription> : null}
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2 text-sm text-muted-foreground">
              <span>{result.corpusCount} corpus days</span>
              <span>·</span>
              <span>{result.canonicalCount} main events</span>
              <span>·</span>
              <span>
                {result.geminiSource === "cache" ? "cached Gemini list" : "fresh Gemini list"}
              </span>
              <span>·</span>
              <span>{result.matched.length} matched</span>
              <span>·</span>
              <span>{result.misplaced.length} wrong leaf</span>
              <span>·</span>
              <span>{result.missing.length} not in DB</span>
              <span>·</span>
              <span>{result.extra.length} extra</span>
              {result.newlyLockedCount > 0 ? (
                <>
                  <span>·</span>
                  <span className="font-medium text-emerald-600 dark:text-emerald-400">
                    {result.newlyLockedCount} newly locked
                  </span>
                </>
              ) : null}
            </CardContent>
          </Card>

          {result.matched.length > 0 ? (
            <Section title={`Matched (${result.matched.length})`} tone="success">
              {result.matched.map((entry) => (
                <div key={entry.date} className="rounded-md border border-border/70 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <DateLink date={entry.date} />
                    <Badge variant="secondary" className={cn("text-[10px]", importanceClass[entry.importance])}>
                      {entry.importance}
                    </Badge>
                    <SourceLink url={entry.sourceUrl} />
                    {(entry.newlyLocked || entry.wasLocked) && (
                      <Badge variant="outline" className="gap-1 text-[10px]">
                        <Lock className="h-3 w-3" />
                        {entry.newlyLocked ? "Locked now" : "Already locked"}
                      </Badge>
                    )}
                  </div>
                  <p className="mt-1 text-sm font-medium">{entry.event}</p>
                  {entry.summary ? (
                    <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{entry.summary}</p>
                  ) : null}
                </div>
              ))}
            </Section>
          ) : null}

          {result.misplaced.length > 0 ? (
            <Section
              title={`Wrong leaf (${result.misplaced.length})`}
              tone="warn"
              description="Gemini expects these on this leaf. The day exists in your database but is tagged elsewhere."
            >
              {result.misplaced.map((entry) => (
                <div key={entry.date} className="rounded-md border border-amber-500/30 bg-amber-500/[0.04] p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <DateLink date={entry.date} />
                    <Badge variant="secondary" className={cn("text-[10px]", importanceClass[entry.importance])}>
                      {entry.importance}
                    </Badge>
                    <SourceLink url={entry.sourceUrl} />
                    {entry.isLocked ? (
                      <Badge variant="outline" className="gap-1 text-[10px]">
                        <Lock className="h-3 w-3" />
                        Locked
                      </Badge>
                    ) : null}
                  </div>
                  <p className="mt-1 text-sm font-medium">{entry.event}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Gemini label · Currently{" "}
                    <span className="font-medium text-foreground">{entry.currentLeafLabel}</span>
                  </p>
                  {entry.summary ? (
                    <p className="mt-1 text-xs text-muted-foreground line-clamp-2">
                      In DB: {entry.summary}
                    </p>
                  ) : null}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      disabled={promotingDate === entry.date || dismissActionKey !== null}
                      onClick={() => void handlePromote(entry)}
                    >
                      {promotingDate === entry.date ? (
                        <>
                          <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                          Moving…
                        </>
                      ) : (
                        `Move & lock on ${result.leaf}`
                      )}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={promotingDate === entry.date || dismissActionKey !== null}
                      onClick={() => void handleDismiss("misplaced", entry.date)}
                    >
                      {dismissActionKey === `misplaced:${entry.date}:dismiss` ? (
                        <>
                          <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                          Dismissing…
                        </>
                      ) : (
                        <>
                          <X className="mr-2 h-3.5 w-3.5" />
                          Dismiss
                        </>
                      )}
                    </Button>
                  </div>
                  {entry.isLocked ? (
                    <p className="mt-2 text-xs text-muted-foreground">
                      Locked on another leaf — will unlock, move here, and lock again.
                    </p>
                  ) : null}
                </div>
              ))}
            </Section>
          ) : null}

          {result.missing.length > 0 ? (
            <Section
              title={`Not in database (${result.missing.length})`}
              tone="warn"
              description="Gemini expects these on this leaf, but there is no row for this date in your database."
            >
              {result.missing.map((entry) => (
                <div key={entry.date} className="rounded-md border border-amber-500/30 bg-amber-500/[0.04] p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm">{entry.date}</span>
                    <Badge variant="secondary" className={cn("text-[10px]", importanceClass[entry.importance])}>
                      {entry.importance}
                    </Badge>
                    <SourceLink url={entry.sourceUrl} />
                  </div>
                  <p className="mt-1 text-sm">{entry.event}</p>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="mt-3"
                    disabled={dismissActionKey !== null}
                    onClick={() => void handleDismiss("missing", entry.date)}
                  >
                    {dismissActionKey === `missing:${entry.date}:dismiss` ? (
                      <>
                        <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                        Dismissing…
                      </>
                    ) : (
                      <>
                        <X className="mr-2 h-3.5 w-3.5" />
                        Dismiss
                      </>
                    )}
                  </Button>
                </div>
              ))}
            </Section>
          ) : null}

          {result.skippedCanonical.length > 0 ? (
            <Section title={`Skipped non-exact dates (${result.skippedCanonical.length})`} tone="muted">
              {result.skippedCanonical.map((entry) => (
                <p key={`${entry.date}-${entry.event}`} className="text-sm text-muted-foreground">
                  {entry.date} · {entry.event}
                </p>
              ))}
            </Section>
          ) : null}

          {result.extra.length > 0 ? (
            <Section title={`Extra on leaf (${result.extra.length})`} tone="muted">
              {extraPreview.map((row) => (
                <div key={row.date} className="rounded-md border border-border/70 p-3">
                  <div className="flex flex-wrap items-start gap-2 text-sm">
                    <DateLink date={row.date} />
                    {row.isLocked ? (
                      <Badge variant="outline" className="gap-1 text-[10px]">
                        <Lock className="h-3 w-3" />
                        Locked
                      </Badge>
                    ) : null}
                    <span className="text-muted-foreground line-clamp-2">{row.summary}</span>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="mt-3"
                    disabled={dismissActionKey !== null}
                    onClick={() => void handleDismiss("extra", row.date)}
                  >
                    {dismissActionKey === `extra:${row.date}:dismiss` ? (
                      <>
                        <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                        Dismissing…
                      </>
                    ) : (
                      <>
                        <X className="mr-2 h-3.5 w-3.5" />
                        Dismiss
                      </>
                    )}
                  </Button>
                </div>
              ))}
              {result.extra.length > extraPreview.length ? (
                <p className="text-xs text-muted-foreground">
                  … and {result.extra.length - extraPreview.length} more
                </p>
              ) : null}
            </Section>
          ) : null}

          {dismissedCount > 0 && result.dismissed ? (
            <Section
              title={`Dismissed (${dismissedCount})`}
              tone="muted"
              description="Hidden from the lists above for this leaf. Restore if you want to review them again."
            >
              {result.dismissed.misplaced.map((entry) => (
                <DismissedRow
                  key={`misplaced-${entry.date}`}
                  label={`Wrong leaf · ${entry.date} · ${entry.event}`}
                  restoreBusy={dismissActionKey === `misplaced:${entry.date}:restore`}
                  disabled={dismissActionKey !== null}
                  onRestore={() => void handleRestoreDismissed("misplaced", entry.date)}
                />
              ))}
              {result.dismissed.missing.map((entry) => (
                <DismissedRow
                  key={`missing-${entry.date}`}
                  label={`Not in DB · ${entry.date} · ${entry.event}`}
                  restoreBusy={dismissActionKey === `missing:${entry.date}:restore`}
                  disabled={dismissActionKey !== null}
                  onRestore={() => void handleRestoreDismissed("missing", entry.date)}
                />
              ))}
              {result.dismissed.extra.map((entry) => (
                <DismissedRow
                  key={`extra-${entry.date}`}
                  label={`Extra · ${entry.date} · ${entry.summary}`}
                  restoreBusy={dismissActionKey === `extra:${entry.date}:restore`}
                  disabled={dismissActionKey !== null}
                  onRestore={() => void handleRestoreDismissed("extra", entry.date)}
                />
              ))}
            </Section>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function DismissedRow({
  label,
  restoreBusy,
  disabled,
  onRestore,
}: {
  label: string;
  restoreBusy: boolean;
  disabled: boolean;
  onRestore: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border/70 px-3 py-2">
      <p className="text-sm text-muted-foreground">{label}</p>
      <Button type="button" size="sm" variant="ghost" disabled={disabled} onClick={onRestore}>
        {restoreBusy ? (
          <>
            <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
            Restoring…
          </>
        ) : (
          <>
            <Undo2 className="mr-2 h-3.5 w-3.5" />
            Restore
          </>
        )}
      </Button>
    </div>
  );
}

function Section({
  title,
  description,
  tone,
  children,
}: {
  title: string;
  description?: string;
  tone: "success" | "warn" | "muted";
  children: ReactNode;
}) {
  const border =
    tone === "success"
      ? "border-emerald-500/30"
      : tone === "warn"
        ? "border-amber-500/30"
        : "border-border/70";

  return (
    <Card className={border}>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent className="space-y-2">{children}</CardContent>
    </Card>
  );
}
