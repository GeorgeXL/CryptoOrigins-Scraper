import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { differenceInCalendarDays, endOfMonth, format, isValid, parse, parseISO, startOfMonth } from "date-fns";
import type { DateRange } from "react-day-picker";
import { Check, Loader2, UserRound, X } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import {
  fetchPipelineRun,
  rememberLastPipelineRunId,
  startPipelineRun,
  stopPipelineRun,
  type PipelineRunDetail,
} from "@/lib/editorial-pipeline";
import { cn } from "@/lib/utils";

type DateMode = "day" | "range";
type LogStatus = "pending" | "approved" | "rejected" | "review";

type LogLine = { id: string; text: string; status: LogStatus };

const LUXURY_EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];
const LOG_TRANSITION = { duration: 0.5, ease: LUXURY_EASE };
const POLL_MS = 1500;
const STOP_GUARD_MS = 8000;

function parseSingleDayIso(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) {
    const d = parseISO(t);
    return isValid(d) ? format(d, "yyyy-MM-dd") : null;
  }
  const d = parseISO(t);
  if (isValid(d)) return format(d, "yyyy-MM-dd");
  const patterns = [
    "dd/MM/yyyy",
    "d/M/yyyy",
    "dd-MM-yyyy",
    "d-M-yyyy",
    "MM/dd/yyyy",
    "M/d/yyyy",
    "MM-dd-yyyy",
    "M-d-yyyy",
  ];
  for (const p of patterns) {
    const alt = parse(t, p, new Date());
    if (isValid(alt)) return format(alt, "yyyy-MM-dd");
  }
  return null;
}

function stepToLogStatus(status: string): LogStatus {
  if (status === "completed" || status === "skipped") return "approved";
  if (status === "rejected" || status === "error") return "rejected";
  return "pending";
}

function shortAgentName(agentName: string): string {
  return agentName.replace(/Agent$/, "").replace(/([a-z])([A-Z])/g, "$1 $2");
}

function stepLabel(agentName: string, status: string, rejectionReason?: string | null): string {
  const short = shortAgentName(agentName);
  if (rejectionReason) return `${short} · ${status} — ${rejectionReason.slice(0, 80)}`;
  return `${short} · ${status}`;
}

function isSuccessfulTerminal(status: string): boolean {
  return status === "completed" || status === "skipped";
}

function humanReviewQueuedCount(stats: Record<string, unknown> | undefined): number {
  const raw = stats?.humanReviewQueued;
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(n) ? n : 0;
}

function autoApprovedCount(stats: Record<string, unknown> | undefined): number {
  const raw = stats?.autoApprovedCount;
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(n) ? n : 0;
}

function extractStepEventDate(step: { input?: unknown }): string | null {
  const input = step.input;
  if (!input || typeof input !== "object") return null;
  const date = (input as { date?: unknown }).date;
  return typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
}

function isV3GatedSourceFinderStep(step: { agentName?: string; input?: unknown }): boolean {
  if (step.agentName !== "SourceFinderAgent") return false;
  const input = step.input;
  if (!input || typeof input !== "object") return false;
  return (input as { mode?: unknown }).mode === "v3-gated-fetch";
}

function stepSortTs(s: PipelineRunDetail["steps"][number]): number {
  const raw = s.completedAt ?? s.startedAt;
  if (!raw) return 0;
  const t = Date.parse(String(raw));
  return Number.isFinite(t) ? t : 0;
}

function queueSortTs(q: NonNullable<PipelineRunDetail["humanReviewItems"]>[number]): number {
  if (!q.createdAt) return 0;
  const t = Date.parse(String(q.createdAt));
  return Number.isFinite(t) ? t : 0;
}

function buildActivityLogFromDetail(detail: PipelineRunDetail): LogLine[] {
  const run = detail.run;
  const dateLabel =
    run.dateFrom === run.dateTo ? run.dateFrom : `${run.dateFrom} → ${run.dateTo}`;
  const lines: LogLine[] = [
    {
      id: "run-header",
      text: `Pipeline run ${run.id.slice(0, 8)}… · ${dateLabel}`,
      status: "approved",
    },
  ];

  const sortedSteps = [...detail.steps].sort((a, b) => a.stepIndex - b.stepIndex);
  const sortedQueue = [...(detail.humanReviewItems ?? [])].sort(
    (a, b) => queueSortTs(a) - queueSortTs(b),
  );

  type StepRow = PipelineRunDetail["steps"][number];
  type QueueRow = NonNullable<PipelineRunDetail["humanReviewItems"]>[number];
  type Merged = { kind: "step"; s: StepRow } | { kind: "queue"; q: QueueRow };

  const merged: Merged[] = [];
  let si = 0;
  let qi = 0;
  while (si < sortedSteps.length || qi < sortedQueue.length) {
    const s = sortedSteps[si];
    const q = sortedQueue[qi];
    if (!s) {
      merged.push({ kind: "queue", q: q! });
      qi += 1;
      continue;
    }
    if (!q) {
      merged.push({ kind: "step", s });
      si += 1;
      continue;
    }
    const ts = stepSortTs(s);
    const tq = queueSortTs(q);
    if (tq < ts) {
      merged.push({ kind: "queue", q });
      qi += 1;
    } else {
      merged.push({ kind: "step", s });
      si += 1;
    }
  }

  const isMultiDayWindow = run.dateFrom !== run.dateTo;

  let lastStep: StepRow | null = null;
  for (const item of merged) {
    if (item.kind === "queue") {
      const q = item.q;
      const dateStr = q.eventDate ? String(q.eventDate) : "—";
      const pending = q.status === "pending";
      lines.push({
        id: `human-review-${q.id}`,
        text: pending
          ? `Orchestrator · handed to manual review · ${dateStr}`
          : `Orchestrator · review queue recorded · ${dateStr} (${q.status})`,
        status: pending ? "review" : "approved",
      });
      continue;
    }

    const s = item.s;
    if (lastStep && isSuccessfulTerminal(lastStep.status)) {
      lines.push({
        id: `handoff-${lastStep.id}-${s.id}`,
        text: `Orchestrator · handoff → ${shortAgentName(s.agentName)}`,
        status: "approved",
      });
    }

    const dayTag = extractStepEventDate(s);
    const prefix = dayTag ? `${dayTag} · ` : "";
    lines.push({
      id: s.id,
      text: `${prefix}${stepLabel(s.agentName, s.status, s.rejectionReason)}`,
      status: stepToLogStatus(s.status),
    });
    lastStep = s;
  }

  if (run.status === "running") {
    const last = sortedSteps[sortedSteps.length - 1];
    if (last && isSuccessfulTerminal(last.status)) {
      const tail =
        isMultiDayWindow && isV3GatedSourceFinderStep(last) ?
          "Orchestrator · continuing range (next calendar day may be fetching)…"
        : "Orchestrator · waiting for next agent…";
      lines.push({
        id: "awaiting-next-agent",
        text: tail,
        status: "pending",
      });
    }
  }

  if (run.status !== "running") {
    if (run.status === "completed") {
      const pending = humanReviewQueuedCount(run.stats);
      const approved = autoApprovedCount(run.stats);
      lines.push({
        id: `run-terminal-${run.status}`,
        text: `Done · ${pending} pending · ${approved} approved`,
        status: pending > 0 ? "review" : "approved",
      });
    } else {
      lines.push({
        id: `run-terminal-${run.status}`,
        text: `Run ${run.status}`,
        status: "rejected",
      });
    }
  }

  return lines;
}

function logLinesEqual(a: LogLine[], b: LogLine[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (!y || x.id !== y.id || x.text !== y.text || x.status !== y.status) return false;
  }
  return true;
}

function StatusGlyph({ status }: { status: LogStatus }) {
  if (status === "pending") {
    return <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-orange-500" aria-hidden />;
  }
  if (status === "approved") {
    return <Check className="h-3.5 w-3.5 shrink-0 text-green-600" strokeWidth={2.5} aria-hidden />;
  }
  if (status === "review") {
    return <UserRound className="h-3.5 w-3.5 shrink-0 text-amber-500" strokeWidth={2.5} aria-hidden />;
  }
  return <X className="h-3.5 w-3.5 shrink-0 text-red-500" strokeWidth={2.5} aria-hidden />;
}

export default function AgentsV2AgentPanel() {
  const { toast } = useToast();
  const [dateMode, setDateMode] = useState<DateMode>("day");
  const [singleDayIso, setSingleDayIso] = useState("2010-01-01");
  const [isRunning, setIsRunning] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const [month, setMonth] = useState(() => new Date());
  const [range, setRange] = useState<DateRange | undefined>();
  const [logLines, setLogLines] = useState<LogLine[]>([]);
  const [stopEnabledAtMs, setStopEnabledAtMs] = useState(0);
  const startCancelRequestedRef = useRef(false);
  const logScrollRootRef = useRef<HTMLDivElement | null>(null);

  const isRunningRef = useRef(isRunning);
  isRunningRef.current = isRunning;

  const rangeLabel = useMemo(() => {
    if (!range?.from) return null;
    const from = format(range.from, "dd-MM-yyyy");
    const to = range.to ? format(range.to, "dd-MM-yyyy") : "…";
    return `${from} → ${to}`;
  }, [range]);

  const applyVisibleMonthAsRange = () => {
    const from = startOfMonth(month);
    const to = endOfMonth(month);
    setRange({ from, to });
  };

  const resolveRunDates = useCallback((): { dateFrom: string; dateTo: string; maxDays: number } | null => {
    if (dateMode === "day") {
      const iso = parseSingleDayIso(singleDayIso);
      if (!iso) return null;
      return { dateFrom: iso, dateTo: iso, maxDays: 1 };
    }
    if (!range?.from || !range.to) return null;
    const start = range.from <= range.to ? range.from : range.to;
    const end = range.from <= range.to ? range.to : range.from;
    const dateFrom = format(start, "yyyy-MM-dd");
    const dateTo = format(end, "yyyy-MM-dd");
    const inclusiveDays = differenceInCalendarDays(end, start) + 1;
    return { dateFrom, dateTo, maxDays: Math.min(Math.max(inclusiveDays, 1), 31) };
  }, [dateMode, singleDayIso, range]);

  const normalizeSingleDayInput = useCallback(() => {
    const iso = parseSingleDayIso(singleDayIso);
    if (iso) setSingleDayIso(iso);
  }, [singleDayIso]);

  const startRun = async () => {
    const window = resolveRunDates();
    if (!window) {
      toast({
        title: "Invalid dates",
        description:
          dateMode === "day" ?
            "Pick a valid calendar day."
          : "Select a start date and an end date (two clicks on the calendar), or use “Use month as full range”.",
        variant: "destructive",
      });
      return;
    }
    setLogLines([]);
    setRunId(null);
    setStopEnabledAtMs(Date.now() + STOP_GUARD_MS);
    startCancelRequestedRef.current = false;
    setIsRunning(true);
    try {
      const out = await startPipelineRun({
        dateFrom: window.dateFrom,
        dateTo: window.dateTo,
        maxDaysToConsider: window.maxDays,
      });
      if (startCancelRequestedRef.current) {
        try {
          await stopPipelineRun(out.runId);
        } catch {
          /* best effort */
        }
        setLogLines([
          {
            id: `start-${out.runId}`,
            text: `Pipeline run ${out.runId.slice(0, 8)}… · ${window.dateFrom}${window.dateFrom !== window.dateTo ? ` → ${window.dateTo}` : ""}`,
            status: "approved",
          },
          {
            id: `operator-cancel-${out.runId}`,
            text: "Run cancelled by operator (Stop)",
            status: "rejected",
          },
        ]);
        setIsRunning(false);
        setStopEnabledAtMs(0);
        toast({ title: "Cancelled", description: "The pipeline run was stopped right after it was created." });
        return;
      }
      setRunId(out.runId);
      rememberLastPipelineRunId(out.runId);
      setLogLines([
        {
          id: "start",
          text: `Pipeline run ${out.runId.slice(0, 8)}… · ${window.dateFrom}${window.dateFrom !== window.dateTo ? ` → ${window.dateTo}` : ""}`,
          status: "approved",
        },
      ]);
    } catch (e) {
      setIsRunning(false);
      if (!startCancelRequestedRef.current) {
        setStopEnabledAtMs(0);
        toast({
          title: "Run failed",
          description: e instanceof Error ? e.message : "Could not start pipeline",
          variant: "destructive",
        });
      }
    }
  };

  const stopRun = async () => {
    if (Date.now() < stopEnabledAtMs) {
      toast({
        title: "Run is starting",
        description: "Wait a few seconds before stopping this run.",
      });
      return;
    }
    if (!runId) {
      startCancelRequestedRef.current = true;
      setIsRunning(false);
      setStopEnabledAtMs(0);
      setLogLines((prev) => [
        ...prev,
        {
          id: `operator-cancel-start-${Date.now()}`,
          text: "Start cancelled — run had not finished attaching yet",
          status: "rejected",
        },
      ]);
      return;
    }
    try {
      await stopPipelineRun(runId);
    } catch {
      /* best effort */
    }
    const rid = runId;
    setRunId(null);
    setIsRunning(false);
    setStopEnabledAtMs(0);
    try {
      await stopPipelineRun(rid);
    } catch {
      /* best effort */
    }
    setLogLines((prev) => [
      ...prev,
      {
        id: `operator-stop-${rid}`,
        text: "Run stopped by operator (Stop)",
        status: "rejected",
      },
    ]);
  };

  useEffect(() => {
    if (!isRunning || !runId) return;

    let cancelled = false;

    const poll = async () => {
      if (cancelled || !isRunningRef.current) return;
      try {
        const detail = await fetchPipelineRun(runId);
        if (cancelled) return;
        const built = buildActivityLogFromDetail(detail);
        setLogLines((prev) => (logLinesEqual(prev, built) ? prev : built));
        if (detail.run.status !== "running") {
          setIsRunning(false);
          setRunId(null);
          setStopEnabledAtMs(0);
          const pending = humanReviewQueuedCount(detail.run.stats);
          toast({
            title: detail.run.status === "completed" ? "Run finished" : "Run stopped",
            description:
              detail.run.status === "completed" && pending > 0 ?
                `${pending} item(s) handed to manual review — see the Queue tab; each handoff is listed in the activity log.`
              : "Check the Queue tab for human review items.",
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
  }, [isRunning, runId, toast]);

  const selectionSummary = useMemo(() => {
    if (dateMode === "day") {
      const iso = parseSingleDayIso(singleDayIso);
      if (!iso) return { text: "Pick a day", isPlaceholder: true };
      return { text: format(parseISO(iso), "dd-MM-yyyy"), isPlaceholder: false };
    }
    return {
      text: rangeLabel ?? "Pick a range",
      isPlaceholder: !rangeLabel,
    };
  }, [dateMode, singleDayIso, rangeLabel]);

  useEffect(() => {
    if (logLines.length === 0) return;
    let cancelled = false;
    let innerRaf = 0;
    const outerRaf = requestAnimationFrame(() => {
      innerRaf = requestAnimationFrame(() => {
        if (cancelled) return;
        const root = logScrollRootRef.current;
        const viewport = root?.querySelector(
          "[data-radix-scroll-area-viewport]",
        ) as HTMLElement | null;
        if (!viewport) return;
        viewport.scrollTo({ top: viewport.scrollHeight, behavior: "smooth" });
      });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(outerRaf);
      cancelAnimationFrame(innerRaf);
    };
  }, [logLines]);

  return (
    <div className="max-w-2xl space-y-5 p-4 md:p-6">
      <header>
        <h2 className="text-lg font-semibold tracking-tight text-foreground">Agent run</h2>
        <p className="mt-1 text-sm text-muted-foreground">Start an editorial pipeline run for a day or range.</p>
      </header>

      <section className="space-y-3">
        <div className="w-full max-w-md space-y-2">
          <Tabs
            value={dateMode}
            onValueChange={(v) => {
              if (isRunning) return;
              if (v === "day" || v === "range") setDateMode(v);
            }}
            className="w-full max-w-md"
          >
            <TabsList className="grid h-10 w-full grid-cols-2 gap-0 rounded-xl p-1 shadow-sm transition-none">
              <TabsTrigger value="day" disabled={isRunning} className="rounded-lg text-sm !transition-none">
                One day
              </TabsTrigger>
              <TabsTrigger value="range" disabled={isRunning} className="rounded-lg text-sm !transition-none">
                Range
              </TabsTrigger>
            </TabsList>

            <TabsContent value="day" className="mt-3 outline-none focus-visible:outline-none focus-visible:ring-0">
              <div className="grid grid-cols-1 gap-4 sm:max-w-xs">
                <div className="space-y-2">
                  <Label htmlFor="pipeline-single-day" className="text-xs text-muted-foreground">
                    Day
                  </Label>
                  <Input
                    id="pipeline-single-day"
                    type="text"
                    value={singleDayIso}
                    onChange={(e) => setSingleDayIso(e.target.value)}
                    onBlur={normalizeSingleDayInput}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") normalizeSingleDayInput();
                    }}
                    inputMode="numeric"
                    placeholder="YYYY-MM-DD"
                    disabled={isRunning}
                  />
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-end gap-3">
                <Button
                  type="button"
                  variant={isRunning ? "destructive" : "default"}
                  className="min-w-[5.5rem]"
                  onClick={() => void (isRunning ? stopRun() : startRun())}
                  disabled={isRunning && Date.now() < stopEnabledAtMs}
                >
                  {isRunning ? (Date.now() < stopEnabledAtMs ? "Starting..." : "Stop") : "Run"}
                </Button>
                {isRunning ? (
                  <p className="pb-2 text-xs text-muted-foreground">
                    Running <span className="font-mono text-foreground/90">{selectionSummary.text}</span>
                  </p>
                ) : null}
              </div>
            </TabsContent>

            <TabsContent value="range" className="mt-3 space-y-3 outline-none focus-visible:outline-none focus-visible:ring-0">
              <div className="w-fit rounded-lg border bg-background p-1 shadow-sm">
                <Calendar
                  mode="range"
                  month={month}
                  onMonthChange={setMonth}
                  selected={range}
                  onSelect={setRange}
                  numberOfMonths={1}
                  captionLayout="dropdown"
                  fromDate={new Date(2009, 0, 1)}
                  toDate={new Date(2026, 11, 31)}
                  className="rounded-md"
                />
              </div>
              <div className="flex w-full flex-row flex-wrap items-center justify-start gap-2">
                <Button
                  type="button"
                  variant={isRunning ? "destructive" : "default"}
                  size="default"
                  className="w-fit shrink-0"
                  onClick={() => void (isRunning ? stopRun() : startRun())}
                  disabled={isRunning && Date.now() < stopEnabledAtMs}
                >
                  {isRunning ? (Date.now() < stopEnabledAtMs ? "Starting..." : "Stop") : "Run"}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="default"
                  className="w-fit shrink-0 whitespace-normal text-sm leading-snug"
                  onClick={applyVisibleMonthAsRange}
                >
                  Use {format(month, "MMMM yyyy")} as full range
                </Button>
              </div>
              {isRunning ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  Running <span className="font-mono text-foreground/90">{selectionSummary.text}</span>
                </p>
              ) : null}
            </TabsContent>
          </Tabs>
        </div>
      </section>

      <AnimatePresence initial={false}>
        {isRunning || logLines.length > 0 ? (
          <motion.div
            key="activity-log-block"
            layout
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={LOG_TRANSITION}
            style={{ overflow: "hidden" }}
            className="space-y-2"
          >
            <Separator className="opacity-60" />
            <section className="space-y-2">
              <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Activity log</Label>
              <div
                className={cn(
                  "rounded-2xl border border-border/80 bg-muted/15 shadow-sm",
                  "[&_[data-radix-scroll-area-viewport]:focus-visible]:outline-none",
                )}
              >
                <ScrollArea ref={logScrollRootRef} className="h-[200px]">
                  <ul className="space-y-1.5 p-3 font-mono text-[11px] leading-relaxed text-muted-foreground">
                    {logLines.map((line) => (
                      <motion.li
                        key={line.id}
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.28, ease: LUXURY_EASE }}
                        className="flex items-start gap-2.5"
                      >
                        <span className="mt-0.5 flex w-4 justify-center">
                          <StatusGlyph status={line.status} />
                        </span>
                        <span className="min-w-0 flex-1 pt-0.5 text-foreground/90">{line.text}</span>
                      </motion.li>
                    ))}
                  </ul>
                </ScrollArea>
              </div>
            </section>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
