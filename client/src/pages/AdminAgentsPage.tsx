import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Bot, CheckCircle2, Loader2, Sparkles, Workflow } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

const jsonHeaders: HeadersInit = { "Content-Type": "application/json" };

type PipelineRunDetail = {
  run: {
    id: string;
    status: string;
    dateFrom: string;
    dateTo: string;
    model: string;
    startedAt: string | null;
    completedAt: string | null;
    stats?: {
      triageCount?: number;
      routeCounts?: Record<string, number>;
      managerNarrative?: string | null;
      [k: string]: unknown;
    };
  };
  steps: Array<{
    id: string;
    stepIndex: number;
    agentName: string;
    status: string;
    confidence?: string | null;
    output: unknown;
    input?: unknown;
    rejectionReason?: string | null;
    suggestedAction?: string | null;
  }>;
  handoffs: Array<{
    id: string;
    fromAgent: string;
    toAgent: string;
    status: string;
    payload: unknown;
  }>;
  live: { activeInThisRuntime: boolean };
};

type HumanReviewItem = {
  id: string;
  runId: string;
  stepId: string | null;
  status: string;
  priority: number;
  eventDate: string | null;
  reviewer: string | null;
  reviewNotes: string | null;
  package: unknown;
  createdAt: string | null;
  reviewedAt: string | null;
};

type CutoverStatus = {
  featureFlagEnabled: boolean;
  requiredHumanApproval: boolean;
  defaultModel: string;
  cutoverReadyChecks: Record<string, boolean>;
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function AdminAgentsPage() {
  const { toast } = useToast();
  const [dateFrom, setDateFrom] = useState("2010-01-01");
  const [dateTo, setDateTo] = useState(todayIso);
  const [pipelineBusy, setPipelineBusy] = useState(false);
  const [pipelineRunId, setPipelineRunId] = useState<string | null>(null);
  const [pipelineDetail, setPipelineDetail] = useState<PipelineRunDetail | null>(null);
  const [pipelineMaxDays, setPipelineMaxDays] = useState("60");
  const [reviewItems, setReviewItems] = useState<HumanReviewItem[]>([]);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [pipelineFilterStatus, setPipelineFilterStatus] = useState<string>("all");
  const [cutoverStatus, setCutoverStatus] = useState<CutoverStatus | null>(null);
  const [shadowValidation, setShadowValidation] = useState<Record<string, unknown> | null>(null);
  const [activePane, setActivePane] = useState<"overview" | "pipeline" | "review">("overview");
  const [showSystemGraph, setShowSystemGraph] = useState(false);

  const loadPipelineRun = async (runId: string, opts?: { quiet?: boolean }) => {
    try {
      const res = await fetch(`/api/agent/pipeline/runs/${runId}`, { headers: jsonHeaders });
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as PipelineRunDetail;
      setPipelineDetail(data);
      if (data.run.status !== "running") {
        await loadReviewQueue();
      }
    } catch (e) {
      if (!opts?.quiet) {
        toast({
          title: "Pipeline run",
          description: e instanceof Error ? e.message : "Failed to load run",
          variant: "destructive",
        });
      }
    }
  };

  const loadReviewQueue = async () => {
    setReviewLoading(true);
    try {
      const res = await fetch("/api/agent/pipeline/review?status=pending&limit=200", { headers: jsonHeaders });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setReviewItems((data.items || []) as HumanReviewItem[]);
    } catch (e) {
      toast({
        title: "Review queue",
        description: e instanceof Error ? e.message : "Failed to load review items",
        variant: "destructive",
      });
    } finally {
      setReviewLoading(false);
    }
  };

  const loadCutoverStatus = async () => {
    try {
      const res = await fetch("/api/agent/pipeline/cutover-status", { headers: jsonHeaders });
      if (!res.ok) throw new Error(await res.text());
      setCutoverStatus((await res.json()) as CutoverStatus);
    } catch (e) {
      toast({
        title: "Cutover status",
        description: e instanceof Error ? e.message : "Failed to load",
        variant: "destructive",
      });
    }
  };

  const runEditorialPipeline = async () => {
    setPipelineBusy(true);
    try {
      const res = await fetch("/api/agent/pipeline/run", {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({
          dateFrom,
          dateTo,
          maxDaysToConsider: Number(pipelineMaxDays) || 60,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setPipelineRunId(data.runId);
      toast({
        title: "Editorial pipeline started",
        description: `Run ${data.runId}`,
      });
    } catch (e) {
      toast({
        title: "Pipeline run failed",
        description: e instanceof Error ? e.message : "Error",
        variant: "destructive",
      });
    } finally {
      setPipelineBusy(false);
    }
  };

  const approveReviewItem = async (id: string) => {
    try {
      const res = await fetch(`/api/agent/pipeline/review/${id}/approve`, {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ reviewer: "admin-ui" }),
      });
      if (!res.ok) throw new Error(await res.text());
      toast({ title: "Review item approved" });
      await loadReviewQueue();
    } catch (e) {
      toast({
        title: "Approve review failed",
        description: e instanceof Error ? e.message : "Error",
        variant: "destructive",
      });
    }
  };

  const rejectReviewItem = async (id: string) => {
    try {
      const res = await fetch(`/api/agent/pipeline/review/${id}/reject`, {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ reviewer: "admin-ui" }),
      });
      if (!res.ok) throw new Error(await res.text());
      toast({ title: "Review item rejected" });
      await loadReviewQueue();
    } catch (e) {
      toast({
        title: "Reject review failed",
        description: e instanceof Error ? e.message : "Error",
        variant: "destructive",
      });
    }
  };

  const runShadowValidation = async () => {
    try {
      const res = await fetch("/api/agent/pipeline/shadow-validate", {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({
          dateFrom,
          dateTo,
          maxDaysToConsider: Number(pipelineMaxDays) || 60,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      setShadowValidation((await res.json()) as Record<string, unknown>);
      toast({ title: "Shadow validation finished" });
    } catch (e) {
      toast({
        title: "Shadow validation failed",
        description: e instanceof Error ? e.message : "Error",
        variant: "destructive",
      });
    }
  };

  const stopPipelineRun = async () => {
    if (!pipelineRunId) return;
    try {
      const res = await fetch(`/api/agent/pipeline/runs/${pipelineRunId}/stop`, {
        method: "POST",
        headers: jsonHeaders,
      });
      if (!res.ok) throw new Error(await res.text());
      toast({ title: "Pipeline stop requested", description: pipelineRunId });
      await loadPipelineRun(pipelineRunId);
    } catch (e) {
      toast({
        title: "Pipeline stop failed",
        description: e instanceof Error ? e.message : "Error",
        variant: "destructive",
      });
    }
  };

  const pausePipelineRun = async () => {
    if (!pipelineRunId) return;
    try {
      const res = await fetch(`/api/agent/pipeline/runs/${pipelineRunId}/pause`, {
        method: "POST",
        headers: jsonHeaders,
      });
      if (!res.ok) throw new Error(await res.text());
      toast({ title: "Pipeline paused", description: pipelineRunId });
      await loadPipelineRun(pipelineRunId);
    } catch (e) {
      toast({
        title: "Pipeline pause failed",
        description: e instanceof Error ? e.message : "Error",
        variant: "destructive",
      });
    }
  };

  const resumePipelineRun = async () => {
    if (!pipelineRunId) return;
    try {
      const res = await fetch(`/api/agent/pipeline/runs/${pipelineRunId}/resume`, {
        method: "POST",
        headers: jsonHeaders,
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setPipelineRunId(data.runId);
      toast({ title: "Pipeline resumed", description: data.runId });
    } catch (e) {
      toast({
        title: "Pipeline resume failed",
        description: e instanceof Error ? e.message : "Error",
        variant: "destructive",
      });
    }
  };

  useEffect(() => {
    void loadReviewQueue();
    void loadCutoverStatus();
  }, []);

  useEffect(() => {
    if (!pipelineRunId) return;
    void loadPipelineRun(pipelineRunId);
    void loadReviewQueue();
    const t = window.setInterval(() => {
      void loadPipelineRun(pipelineRunId, { quiet: true });
      void loadReviewQueue();
    }, 2500);
    return () => window.clearInterval(t);
  }, [pipelineRunId]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Admin agents</h1>
          <p className="text-muted-foreground mt-1">
            Editorial pipeline (v2): run triage, inspect steps, approve work in human review.
          </p>
        </div>
        <Button type="button" variant="secondary" onClick={() => setShowSystemGraph(true)}>
          <Sparkles className="w-4 h-4 mr-2" />
          How the system works
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-6">
        <Card className="h-fit">
          <CardHeader>
            <CardTitle className="text-base">Navigation</CardTitle>
            <CardDescription>Pipeline and review</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <Button variant={activePane === "overview" ? "default" : "outline"} className="w-full justify-start" onClick={() => setActivePane("overview")}>
              <Bot className="w-4 h-4 mr-2" /> Overview
            </Button>
            <Button variant={activePane === "pipeline" ? "default" : "outline"} className="w-full justify-start" onClick={() => setActivePane("pipeline")}>
              <Workflow className="w-4 h-4 mr-2" /> Pipeline
            </Button>
            <Button variant={activePane === "review" ? "default" : "outline"} className="w-full justify-start" onClick={() => setActivePane("review")}>
              <CheckCircle2 className="w-4 h-4 mr-2" /> Human review ({reviewItems.length})
            </Button>
          </CardContent>
        </Card>

        <div className="space-y-6">
          {activePane === "overview" ? (
            <Card>
              <CardHeader>
                <CardTitle>Overview</CardTitle>
                <CardDescription>Queue depth and configuration snapshot</CardDescription>
              </CardHeader>
              <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
                <div className="rounded border p-3">
                  <div className="text-muted-foreground">Pending human review</div>
                  <div className="text-2xl font-semibold">{reviewItems.length}</div>
                </div>
                <div className="rounded border p-3">
                  <div className="text-muted-foreground">Active run</div>
                  <div className="font-semibold break-all">{pipelineRunId ?? "—"}</div>
                </div>
                <div className="rounded border p-3">
                  <div className="text-muted-foreground">Default model</div>
                  <div className="font-semibold">{cutoverStatus?.defaultModel ?? "loading…"}</div>
                </div>
              </CardContent>
            </Card>
          ) : null}

          {activePane === "pipeline" ? (
            <Card>
              <CardHeader>
                <CardTitle>Editorial pipeline</CardTitle>
                <CardDescription>Triage-first run: set the window, cap days processed, then run or validate.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 max-w-4xl">
                  <div className="grid gap-2">
                    <Label htmlFor="df">Start date</Label>
                    <Input id="df" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="dt">End date</Label>
                    <Input id="dt" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="pipeline-max-days">Max days to consider</Label>
                    <Input id="pipeline-max-days" value={pipelineMaxDays} onChange={(e) => setPipelineMaxDays(e.target.value)} />
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" size="sm" onClick={() => void runEditorialPipeline()} disabled={pipelineBusy}>
                    {pipelineBusy ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                    Run pipeline
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="destructive"
                    disabled={!pipelineRunId || pipelineDetail?.run.status !== "running"}
                    onClick={() => void stopPipelineRun()}
                  >
                    Stop run
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={!pipelineRunId || pipelineDetail?.run.status !== "running"}
                    onClick={() => void pausePipelineRun()}
                  >
                    Pause
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={!pipelineRunId || pipelineDetail?.run.status !== "paused"}
                    onClick={() => void resumePipelineRun()}
                  >
                    Resume
                  </Button>
                  {pipelineRunId ? (
                    <Button type="button" size="sm" variant="outline" onClick={() => void loadPipelineRun(pipelineRunId)}>
                      Refresh run
                    </Button>
                  ) : null}
                  <Button type="button" size="sm" variant="outline" onClick={() => void runShadowValidation()}>
                    Shadow validation
                  </Button>
                </div>

                {pipelineDetail ? (
                  <div className="text-sm rounded-md border p-3 space-y-2">
                    <div>
                      <span className="font-medium">Run:</span> {pipelineDetail.run.id} ·{" "}
                      <span className="font-medium">Status:</span> {pipelineDetail.run.status}
                    </div>
                    <div className="text-muted-foreground">
                      Model: {pipelineDetail.run.model} · Triage items: {pipelineDetail.run.stats?.triageCount ?? 0}
                    </div>
                    <div className="flex items-center gap-2">
                      <Label htmlFor="pipeline-filter-status">Step status</Label>
                      <select
                        id="pipeline-filter-status"
                        className="border rounded px-2 py-1 text-xs bg-background"
                        value={pipelineFilterStatus}
                        onChange={(e) => setPipelineFilterStatus(e.target.value)}
                      >
                        <option value="all">all</option>
                        <option value="completed">completed</option>
                        <option value="rejected">rejected</option>
                        <option value="error">error</option>
                        <option value="skipped">skipped</option>
                      </select>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <div className="font-medium mb-1">Recent steps</div>
                        <ul className="space-y-1 text-xs">
                          {pipelineDetail.steps
                            .filter((s) => (pipelineFilterStatus === "all" ? true : s.status === pipelineFilterStatus))
                            .slice(-12)
                            .map((s) => (
                              <li key={s.id} className="border rounded p-2">
                                <div className="font-medium">
                                  #{s.stepIndex} {s.agentName} · {s.status}
                                  {s.confidence ? ` · conf ${s.confidence}` : ""}
                                </div>
                                <pre className="mt-1 bg-muted rounded p-2 overflow-x-auto">
                                  {JSON.stringify(s.output ?? {}, null, 2)}
                                </pre>
                              </li>
                            ))}
                        </ul>
                      </div>
                      <div>
                        <div className="font-medium mb-1">Recent handoffs</div>
                        <ul className="space-y-1 text-xs">
                          {pipelineDetail.handoffs.slice(0, 8).map((h) => (
                            <li key={h.id} className="border rounded p-2">
                              <div className="font-medium">
                                {h.fromAgent} → {h.toAgent} · {h.status}
                              </div>
                              <pre className="mt-1 bg-muted rounded p-2 overflow-x-auto">
                                {JSON.stringify(h.payload ?? {}, null, 2)}
                              </pre>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No pipeline run started yet.</p>
                )}
                {shadowValidation ? (
                  <pre className="text-xs bg-muted rounded p-2 overflow-x-auto">
                    {JSON.stringify(shadowValidation, null, 2)}
                  </pre>
                ) : null}
                {cutoverStatus ? (
                  <div className="text-xs text-muted-foreground rounded border p-2">
                    Cutover: model {cutoverStatus.defaultModel} · feature flag{" "}
                    {cutoverStatus.featureFlagEnabled ? "on" : "off"} · human approval{" "}
                    {cutoverStatus.requiredHumanApproval ? "required" : "off"}
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ) : null}

          {activePane === "review" ? (
            <Card>
              <CardHeader>
                <CardTitle>Human review queue</CardTitle>
                <CardDescription>Approve or reject packages before writes are applied.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex gap-2 mb-3">
                  <Button type="button" size="sm" variant="outline" onClick={() => void loadReviewQueue()} disabled={reviewLoading}>
                    {reviewLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Refresh queue"}
                  </Button>
                </div>
                <ScrollArea className="h-[min(520px,60vh)] rounded-md border p-3">
                  {reviewItems.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No pending review items.</p>
                  ) : (
                    <ul className="space-y-3">
                      {reviewItems.map((item) => (
                        <li key={item.id} className="border rounded p-3 text-xs space-y-2">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="font-medium">
                              {item.eventDate ?? "n/a"} · priority {item.priority} · run {item.runId}
                            </div>
                            <div className="flex gap-2">
                              <Button size="sm" variant="default" onClick={() => void approveReviewItem(item.id)}>
                                Approve
                              </Button>
                              <Button size="sm" variant="outline" onClick={() => void rejectReviewItem(item.id)}>
                                Reject
                              </Button>
                            </div>
                          </div>
                          <pre className="bg-muted rounded p-2 overflow-x-auto">
                            {JSON.stringify(item.package ?? {}, null, 2)}
                          </pre>
                        </li>
                      ))}
                    </ul>
                  )}
                </ScrollArea>
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>

      <Dialog open={showSystemGraph} onOpenChange={setShowSystemGraph}>
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle>Editorial pipeline flow</DialogTitle>
            <DialogDescription>
              Triage-first orchestration: only the needed agents run for each day, then everything goes through human review.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 text-xs">
            <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
              <div className="rounded border p-2 bg-muted/40 animate-pulse">
                <div className="font-medium">RunScheduler</div>
                <div className="text-muted-foreground">Date window + limits</div>
              </div>
              <div className="rounded border p-2 bg-muted/40 animate-pulse">
                <div className="font-medium">NewsManager</div>
                <div className="text-muted-foreground">Routing + retries</div>
              </div>
              <div className="rounded border p-2 bg-muted/40 animate-pulse">
                <div className="font-medium">TriageEngine</div>
                <div className="text-muted-foreground">existing_ok / correction / missing</div>
              </div>
              <div className="rounded border p-2 bg-muted/40 animate-pulse">
                <div className="font-medium">Agent stages</div>
                <div className="text-muted-foreground">Source, verify, topic/tag, dedupe, summary</div>
              </div>
              <div className="rounded border p-2 bg-muted/40 animate-pulse">
                <div className="font-medium">FinalEditor</div>
                <div className="text-muted-foreground">Assemble review package</div>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              <div className="rounded border p-3">
                <div className="font-medium mb-1">Discovery path</div>
                <div className="text-muted-foreground">Triggered for missing/empty days. Reuses existing search + summary flow.</div>
              </div>
              <div className="rounded border p-3">
                <div className="font-medium mb-1">Correction path</div>
                <div className="text-muted-foreground">Triggered for weak/flagged/context issues. Runs verification + taxonomy + dedupe checks.</div>
              </div>
              <div className="rounded border p-3">
                <div className="font-medium mb-1">Human gate</div>
                <div className="text-muted-foreground">Nothing auto-publishes. Queue item must be approved in review panel first.</div>
              </div>
            </div>
            <div className="rounded border p-3 bg-muted/30">
              <div className="font-medium">Traceability</div>
              <div className="text-muted-foreground">
                Every run writes steps, handoffs, evidence references, and confidence history for auditability.
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
