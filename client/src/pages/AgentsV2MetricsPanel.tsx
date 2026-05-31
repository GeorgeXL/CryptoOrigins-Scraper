import { useCallback, useEffect, useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import { BarChart3, CheckCircle2, Loader2, ShieldCheck, XCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  fetchCorpusMetricsSample,
  fetchCorpusOverviewMetrics,
  verifyEditorialDay,
  type CorpusMetricsSampleReport,
  type CorpusOverviewMetrics,
  type DayVerificationResult,
  type VerificationCheckStatus,
} from "@/lib/editorial-pipeline";
import { cn } from "@/lib/utils";

function MetricCard({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-lg border border-border/80 bg-background/60 p-4">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-semibold tabular-nums text-foreground">{value}</p>
      {hint ? <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function checkGlyph(status: VerificationCheckStatus) {
  if (status === "pass") return <CheckCircle2 className="size-4 shrink-0 text-emerald-500" aria-hidden />;
  if (status === "warn") return <ShieldCheck className="size-4 shrink-0 text-amber-500" aria-hidden />;
  return <XCircle className="size-4 shrink-0 text-red-500" aria-hidden />;
}

function VerificationResults({ result }: { result: DayVerificationResult }) {
  return (
    <div
      className={cn(
        "rounded-lg border p-4",
        result.passed ? "border-emerald-500/30 bg-emerald-500/[0.06]" : "border-amber-500/35 bg-amber-500/[0.06]",
      )}
    >
      <p className="text-sm font-medium text-foreground">
        {result.passed ? "Verification passed" : "Verification found issues"} · {result.mode} mode
      </p>
      {result.summaryPreview ? (
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{result.summaryPreview}</p>
      ) : null}
      <ul className="mt-3 space-y-2">
        {result.checks.map((check) => (
          <li key={check.id} className="flex gap-2 text-xs leading-relaxed text-muted-foreground">
            {checkGlyph(check.status)}
            <span>
              <span className="font-medium text-foreground">{check.label}:</span> {check.message}
            </span>
          </li>
        ))}
      </ul>
      {result.wouldQueue?.length ? (
        <p className="mt-3 text-[11px] text-muted-foreground">
          Pipeline would queue: {result.wouldQueue.join("; ")}
        </p>
      ) : null}
    </div>
  );
}

function phaseLabel(phase: string): string {
  return phase
    .replace(/^awaiting_/, "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function AgentsV2MetricsPanel() {
  const { toast } = useToast();
  const [overview, setOverview] = useState<CorpusOverviewMetrics | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [sampleFrom, setSampleFrom] = useState("2010-01-01");
  const [sampleTo, setSampleTo] = useState("2020-12-31");
  const [sampleCount, setSampleCount] = useState("14");
  const [sampleReport, setSampleReport] = useState<CorpusMetricsSampleReport | null>(null);
  const [sampleLoading, setSampleLoading] = useState(false);
  const [verifyDate, setVerifyDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [verifyResult, setVerifyResult] = useState<DayVerificationResult | null>(null);
  const [verifyLoading, setVerifyLoading] = useState(false);

  const loadOverview = useCallback(async () => {
    setOverviewLoading(true);
    try {
      setOverview(await fetchCorpusOverviewMetrics());
    } catch (e) {
      toast({
        title: "Metrics failed",
        description: e instanceof Error ? e.message : "Could not load overview",
        variant: "destructive",
      });
    } finally {
      setOverviewLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  const pendingPhases = useMemo(() => {
    if (!overview) return [];
    return Object.entries(overview.reviewQueue.pendingByPhase).sort((a, b) => b[1] - a[1]);
  }, [overview]);

  const runSample = async () => {
    setSampleLoading(true);
    try {
      const report = await fetchCorpusMetricsSample({
        dateFrom: sampleFrom,
        dateTo: sampleTo,
        count: Number(sampleCount) || 14,
        seed: "metrics-ui",
      });
      setSampleReport(report);
    } catch (e) {
      toast({
        title: "Sample failed",
        description: e instanceof Error ? e.message : "Could not run sample",
        variant: "destructive",
      });
    } finally {
      setSampleLoading(false);
    }
  };

  const runVerify = async (mode: "quick" | "full") => {
    setVerifyLoading(true);
    try {
      const result = await verifyEditorialDay(verifyDate.trim(), mode);
      setVerifyResult(result);
    } catch (e) {
      toast({
        title: "Verify failed",
        description: e instanceof Error ? e.message : "Could not verify day",
        variant: "destructive",
      });
    } finally {
      setVerifyLoading(false);
    }
  };

  return (
    <main className="max-w-6xl space-y-5 p-4 sm:p-6 md:p-8">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-foreground">Metrics</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Corpus health at a glance, pipeline sample KPIs, and on-demand day verification.
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" disabled={overviewLoading} onClick={() => void loadOverview()}>
          {overviewLoading ? <Loader2 className="size-4 animate-spin" /> : null}
          Refresh overview
        </Button>
      </header>

      <Card className="border-border/80 bg-card/35 p-4 shadow-sm md:p-5">
        <div className="mb-4 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <BarChart3 className="size-4" />
          Corpus overview
        </div>
        {overviewLoading && !overview ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : overview ? (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <MetricCard label="Total days" value={overview.totalDays.toLocaleString()} />
              <MetricCard
                label="Summary in target"
                value={overview.summaryInTarget.toLocaleString()}
                hint="100–110 characters"
              />
              <MetricCard label="Too short" value={overview.summaryTooShort.toLocaleString()} />
              <MetricCard label="Too long" value={overview.summaryTooLong.toLocaleString()} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <MetricCard label="Empty summary" value={overview.emptySummaryDays.toLocaleString()} />
              <MetricCard label="Pending review" value={overview.reviewQueue.pending.toLocaleString()} />
              <MetricCard label="Orphan days" value={overview.orphanDays.toLocaleString()} />
              <MetricCard label="Flagged days" value={overview.flaggedDays.toLocaleString()} />
            </div>
            {pendingPhases.length > 0 ? (
              <div className="rounded-lg border border-border/70 bg-background/50 p-3">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Pending queue by phase
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {pendingPhases.map(([phase, count]) => (
                    <span
                      key={phase}
                      className="rounded-md border border-border/70 bg-muted/20 px-2 py-1 text-[11px] text-muted-foreground"
                    >
                      {phaseLabel(phase)} · {count}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
            <p className="text-[10px] text-muted-foreground">
              Updated {format(parseISO(overview.computedAt), "dd MMM yyyy HH:mm")}
            </p>
          </div>
        ) : null}
      </Card>

      <Card className="border-border/80 bg-card/35 p-4 shadow-sm md:p-5">
        <div className="mb-4 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <BarChart3 className="size-4" />
          Pipeline sample (LLM)
        </div>
        <div className="grid max-w-xl gap-3 sm:grid-cols-3">
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">From</Label>
            <Input value={sampleFrom} onChange={(e) => setSampleFrom(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">To</Label>
            <Input value={sampleTo} onChange={(e) => setSampleTo(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Count</Label>
            <Input value={sampleCount} onChange={(e) => setSampleCount(e.target.value)} inputMode="numeric" />
          </div>
        </div>
        <Button type="button" className="mt-4" disabled={sampleLoading} onClick={() => void runSample()}>
          {sampleLoading ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
          Run sample
        </Button>
        {sampleReport ? (
          <div className="mt-4 space-y-3">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <MetricCard label="Auto pass" value={`${sampleReport.autoPassPct}%`} />
              <MetricCard label="Legacy topics" value={`${sampleReport.legacyTopicPct}%`} />
              <MetricCard label="Topic suggestions" value={`${sampleReport.usefulTopicSuggestionPct}%`} />
              <MetricCard label="Model topic reason" value={`${sampleReport.modelReasonPct}%`} />
            </div>
            {Object.keys(sampleReport.phaseCounts).length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {Object.entries(sampleReport.phaseCounts).map(([phase, count]) => (
                  <span
                    key={phase}
                    className="rounded-md border border-border/70 bg-muted/20 px-2 py-1 text-[11px] text-muted-foreground"
                  >
                    {phaseLabel(phase)} · {count}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </Card>

      <Card className="border-border/80 bg-card/35 p-4 shadow-sm md:p-5">
        <div className="mb-4 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <ShieldCheck className="size-4" />
          Verify day
        </div>
        <div className="flex max-w-md flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1 space-y-2">
            <Label className="text-xs text-muted-foreground">Date</Label>
            <Input value={verifyDate} onChange={(e) => setVerifyDate(e.target.value)} placeholder="YYYY-MM-DD" />
          </div>
          <Button type="button" variant="secondary" disabled={verifyLoading} onClick={() => void runVerify("quick")}>
            Quick verify
          </Button>
          <Button type="button" disabled={verifyLoading} onClick={() => void runVerify("full")}>
            {verifyLoading ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
            Full verify
          </Button>
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
          Quick = deterministic checks (summary, topic, tags, stored fact-check). Full = also runs the corpus-clean graph
          with LLM agents.
        </p>
        {verifyResult ? (
          <div className="mt-4">
            <VerificationResults result={verifyResult} />
          </div>
        ) : null}
      </Card>
    </main>
  );
}
