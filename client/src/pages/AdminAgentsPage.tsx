import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Bot, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type AgentDecisionRow = {
  id: string;
  sessionId: string;
  module: string;
  type: string;
  targetType: string;
  targetId: string | null;
  confidence: string | null;
  status: string;
  beforeState: unknown;
  afterState: unknown;
  reasoning: string | null;
  createdAt: string | null;
};

type LiveSessionResponse = {
  session: {
    id: string;
    status: string;
    startedAt: string | null;
    completedAt: string | null;
    issuesFlagged: number | null;
    config: unknown;
    stats: unknown;
  };
  live: {
    isRunningInThisRuntime: boolean;
    totalDecisions: number;
    pendingDecisions: number;
  };
  recentDecisions: Array<{
    id: string;
    type: string;
    module: string;
    status: string;
    reasoning: string | null;
    createdAt: string | null;
  }>;
};

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

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function AdminAgentsPage() {
  const { toast } = useToast();
  const [agentSecret, setAgentSecret] = useState(() => import.meta.env.VITE_ADMIN_AGENT_SECRET || "");
  const [dateFrom, setDateFrom] = useState("2010-01-01");
  const [dateTo, setDateTo] = useState(todayIso);
  const [maxDays, setMaxDays] = useState("7");
  const [maxProposals, setMaxProposals] = useState("15");
  const [agentDecisions, setAgentDecisions] = useState<AgentDecisionRow[]>([]);
  const [agentLoading, setAgentLoading] = useState(false);
  const [overseerBusy, setOverseerBusy] = useState(false);
  const [lastRun, setLastRun] = useState<{ sessionId: string; status: string } | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [liveSession, setLiveSession] = useState<LiveSessionResponse | null>(null);
  const [liveLoading, setLiveLoading] = useState(false);
  const [approveExecuteById, setApproveExecuteById] = useState<Record<string, boolean>>({});
  const [pipelineBusy, setPipelineBusy] = useState(false);
  const [pipelineRunId, setPipelineRunId] = useState<string | null>(null);
  const [pipelineDetail, setPipelineDetail] = useState<PipelineRunDetail | null>(null);
  const [pipelineMaxDays, setPipelineMaxDays] = useState("60");
  const [reviewItems, setReviewItems] = useState<HumanReviewItem[]>([]);
  const [reviewLoading, setReviewLoading] = useState(false);

  const agentHeaders = (): HeadersInit => {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (agentSecret.trim()) h["X-Admin-Agent-Secret"] = agentSecret.trim();
    return h;
  };

  const loadAgentQueue = async () => {
    setAgentLoading(true);
    try {
      const res = await fetch("/api/agent/decisions?status=pending&limit=100", { headers: agentHeaders() });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setAgentDecisions(data.decisions || []);
    } catch (e) {
      toast({
        title: "Agent queue",
        description: e instanceof Error ? e.message : "Failed to load",
        variant: "destructive",
      });
    } finally {
      setAgentLoading(false);
    }
  };

  const loadLiveSession = async (sessionId: string, opts?: { quiet?: boolean }) => {
    if (!opts?.quiet) setLiveLoading(true);
    try {
      const res = await fetch(`/api/agent/sessions/${sessionId}`, { headers: agentHeaders() });
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as LiveSessionResponse;
      setLiveSession(data);
      if (data.session.status === "completed" || data.session.status === "error" || data.session.status === "stopped") {
        setLastRun({ sessionId: data.session.id, status: data.session.status });
        setActiveSessionId(null);
        await loadAgentQueue();
      }
    } catch (e) {
      if (!opts?.quiet) {
        toast({
          title: "Live session",
          description: e instanceof Error ? e.message : "Failed to load",
          variant: "destructive",
        });
      }
    } finally {
      if (!opts?.quiet) setLiveLoading(false);
    }
  };

  const runOverseer = async () => {
    setOverseerBusy(true);
    setLastRun(null);
    setLiveSession(null);
    try {
      const res = await fetch("/api/agent/wiki-overseer/run", {
        method: "POST",
        headers: agentHeaders(),
        body: JSON.stringify({
          dateFrom,
          dateTo,
          maxDaysToConsider: Number(maxDays) || 7,
          maxProposals: Number(maxProposals) || 15,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setLastRun({
        sessionId: data.sessionId,
        status: data.status || "running",
      });
      setActiveSessionId(data.sessionId);
      toast({
        title: "Wiki Overseer started",
        description: `Session ${data.sessionId} is now running`,
      });
      await loadLiveSession(data.sessionId);
    } catch (e) {
      toast({
        title: "Overseer run failed",
        description: e instanceof Error ? e.message : "Error",
        variant: "destructive",
      });
    } finally {
      setOverseerBusy(false);
    }
  };

  const stopOverseer = async () => {
    if (!activeSessionId) return;
    try {
      const res = await fetch(`/api/agent/sessions/${activeSessionId}/stop`, {
        method: "POST",
        headers: agentHeaders(),
      });
      if (!res.ok) throw new Error(await res.text());
      toast({
        title: "Stop requested",
        description: `Session ${activeSessionId} was stopped`,
      });
      await loadLiveSession(activeSessionId);
    } catch (e) {
      toast({
        title: "Stop failed",
        description: e instanceof Error ? e.message : "Error",
        variant: "destructive",
      });
    }
  };

  const runEditorialPipeline = async () => {
    setPipelineBusy(true);
    try {
      const res = await fetch("/api/agent/pipeline/run", {
        method: "POST",
        headers: agentHeaders(),
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

  const loadPipelineRun = async (runId: string, opts?: { quiet?: boolean }) => {
    try {
      const res = await fetch(`/api/agent/pipeline/runs/${runId}`, { headers: agentHeaders() });
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as PipelineRunDetail;
      setPipelineDetail(data);
      if (data.run.status !== "running") {
        await loadAgentQueue();
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
      const res = await fetch("/api/agent/pipeline/review?status=pending&limit=200", { headers: agentHeaders() });
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

  const approveReviewItem = async (id: string) => {
    try {
      const res = await fetch(`/api/agent/pipeline/review/${id}/approve`, {
        method: "POST",
        headers: agentHeaders(),
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
        headers: agentHeaders(),
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

  const stopPipelineRun = async () => {
    if (!pipelineRunId) return;
    try {
      const res = await fetch(`/api/agent/pipeline/runs/${pipelineRunId}/stop`, {
        method: "POST",
        headers: agentHeaders(),
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

  const approveDecision = async (id: string) => {
    const execute = approveExecuteById[id] === true;
    try {
      const res = await fetch(`/api/agent/decisions/${id}/approve`, {
        method: "POST",
        headers: agentHeaders(),
        body: JSON.stringify({ reviewer: "admin-ui", execute }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      toast({
        title: "Approved",
        description: data.execution?.message || "OK",
      });
      await loadAgentQueue();
    } catch (e) {
      toast({
        title: "Approve failed",
        description: e instanceof Error ? e.message : "Error",
        variant: "destructive",
      });
    }
  };

  const rejectDecision = async (id: string) => {
    try {
      const res = await fetch(`/api/agent/decisions/${id}/reject`, {
        method: "POST",
        headers: agentHeaders(),
        body: JSON.stringify({ reviewer: "admin-ui" }),
      });
      if (!res.ok) throw new Error(await res.text());
      toast({ title: "Rejected" });
      await loadAgentQueue();
    } catch (e) {
      toast({
        title: "Reject failed",
        description: e instanceof Error ? e.message : "Error",
        variant: "destructive",
      });
    }
  };

  useEffect(() => {
    void loadAgentQueue();
    void loadReviewQueue();
  }, []);

  useEffect(() => {
    if (!activeSessionId) return;
    const tick = () => {
      void loadLiveSession(activeSessionId, { quiet: true });
    };
    tick();
    const t = window.setInterval(tick, 2000);
    return () => window.clearInterval(t);
  }, [activeSessionId]);

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
      <div>
        <h1 className="text-3xl font-bold text-foreground">Admin agents</h1>
        <p className="text-muted-foreground mt-1">
          OpenAI <strong>Agents SDK</strong> Wiki Overseer: reads your database via tools, then files{" "}
          <strong>pending</strong> proposals. You approve or reject; optional execute runs safe actions only.
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Bot className="w-5 h-5" />
            <CardTitle>Wiki Overseer</CardTitle>
          </div>
          <CardDescription>
            Requires <code className="text-xs">OPENAI_API_KEY</code>, migration{" "}
            <code className="text-xs">20251129000000_create_agent_tables.sql</code>, and optional{" "}
            <code className="text-xs">ADMIN_AGENT_SECRET</code> / <code className="text-xs">VITE_ADMIN_AGENT_SECRET</code>.
            Model: <code className="text-xs">WIKI_OVERSEER_MODEL</code> or <code className="text-xs">AGENT_OPENAI_MODEL</code>{" "}
            or <code className="text-xs">gpt-4o-mini</code>.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2 max-w-md">
            <Label htmlFor="agent-secret">Admin agent secret (optional)</Label>
            <Input
              id="agent-secret"
              type="password"
              autoComplete="off"
              placeholder="Same as ADMIN_AGENT_SECRET if configured"
              value={agentSecret}
              onChange={(e) => setAgentSecret(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 max-w-4xl">
            <div className="grid gap-2">
              <Label htmlFor="df">dateFrom</Label>
              <Input id="df" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="dt">dateTo</Label>
              <Input id="dt" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="md">maxDaysToConsider</Label>
              <Input id="md" value={maxDays} onChange={(e) => setMaxDays(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="mp">maxProposals</Label>
              <Input id="mp" value={maxProposals} onChange={(e) => setMaxProposals(e.target.value)} />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={() => void loadAgentQueue()} disabled={agentLoading}>
              {agentLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Refresh queue"}
            </Button>
            <Button type="button" variant="default" size="sm" disabled={overseerBusy} onClick={() => void runOverseer()}>
              {overseerBusy ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Run Wiki Overseer
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={!activeSessionId || liveSession?.session.status !== "running"}
              onClick={() => void stopOverseer()}
            >
              Stop run
            </Button>
          </div>
          {lastRun ? (
            <div className="text-sm space-y-1 rounded-md border p-3 bg-muted/40">
              <div>
                <span className="font-medium">Last session:</span> {lastRun.sessionId}
              </div>
              <div>
                <span className="font-medium">Status:</span> {lastRun.status}
              </div>
            </div>
          ) : null}
          {activeSessionId || liveSession ? (
            <div className="text-sm space-y-2 rounded-md border p-3">
              <div className="flex items-center justify-between">
                <div>
                  <span className="font-medium">Live session:</span> {liveSession?.session.id ?? activeSessionId}
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void (activeSessionId ? loadLiveSession(activeSessionId) : Promise.resolve())}
                  disabled={liveLoading || !activeSessionId}
                >
                  {liveLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Refresh live"}
                </Button>
              </div>
              <div className="text-muted-foreground">
                Status: <strong>{liveSession?.session.status ?? "loading..."}</strong> · Pending proposals:{" "}
                <strong>{liveSession?.live.pendingDecisions ?? 0}</strong> · Total proposals:{" "}
                <strong>{liveSession?.live.totalDecisions ?? 0}</strong>
              </div>
              {liveSession?.recentDecisions?.length ? (
                <ul className="space-y-2 text-xs">
                  {liveSession.recentDecisions.map((d) => (
                    <li key={d.id} className="rounded border p-2">
                      <div className="font-medium">
                        {d.module} · {d.type} · {d.status}
                      </div>
                      {d.reasoning ? <div className="text-muted-foreground mt-1">{d.reasoning.slice(0, 240)}</div> : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-muted-foreground">No proposal activity yet for this session.</p>
              )}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Editorial Pipeline (v2 preview)</CardTitle>
          <CardDescription>
            Triage-first rebuild path. Keeps your existing search and summarization flows in place while routing only days that need intervention.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 max-w-3xl">
            <div className="grid gap-2">
              <Label htmlFor="pipeline-max-days">maxDaysToConsider</Label>
              <Input
                id="pipeline-max-days"
                value={pipelineMaxDays}
                onChange={(e) => setPipelineMaxDays(e.target.value)}
              />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" onClick={() => void runEditorialPipeline()} disabled={pipelineBusy}>
              {pipelineBusy ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Run pipeline (v2)
            </Button>
            <Button
              type="button"
              size="sm"
              variant="destructive"
              disabled={!pipelineRunId || pipelineDetail?.run.status !== "running"}
              onClick={() => void stopPipelineRun()}
            >
              Stop pipeline run
            </Button>
            {pipelineRunId ? (
              <Button type="button" size="sm" variant="outline" onClick={() => void loadPipelineRun(pipelineRunId)}>
                Refresh run
              </Button>
            ) : null}
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
              {pipelineDetail.run.stats?.routeCounts ? (
                <pre className="text-xs bg-muted p-2 rounded overflow-x-auto">
                  {JSON.stringify(pipelineDetail.run.stats.routeCounts, null, 2)}
                </pre>
              ) : null}
              {pipelineDetail.run.stats?.managerNarrative ? (
                <p className="text-muted-foreground">{pipelineDetail.run.stats.managerNarrative}</p>
              ) : null}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <div className="font-medium mb-1">Recent steps</div>
                  <ul className="space-y-1 text-xs">
                    {pipelineDetail.steps.slice(-8).map((s) => (
                      <li key={s.id} className="border rounded p-2">
                        <div className="font-medium">
                          #{s.stepIndex} {s.agentName} · {s.status}
                          {s.confidence ? ` · conf ${s.confidence}` : ""}
                        </div>
                        {s.rejectionReason ? (
                          <div className="text-muted-foreground mt-1">
                            Rejection: {s.rejectionReason}
                            {s.suggestedAction ? ` · action: ${s.suggestedAction}` : ""}
                          </div>
                        ) : null}
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
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Human review queue (pipeline v2)</CardTitle>
          <CardDescription>
            Mandatory approval gate for editorial pipeline output. Approve or reject each queued day package.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2 mb-3">
            <Button type="button" size="sm" variant="outline" onClick={() => void loadReviewQueue()} disabled={reviewLoading}>
              {reviewLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Refresh review queue"}
            </Button>
          </div>
          <ScrollArea className="h-[min(420px,45vh)] rounded-md border p-3">
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

      <Card>
        <CardHeader>
          <CardTitle>Pending proposals</CardTitle>
          <CardDescription>
            Approve or reject each row. Check “Execute on approve” only when you want re-analysis or flagging applied.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[min(480px,50vh)] rounded-md border p-3">
            {agentDecisions.length === 0 ? (
              <p className="text-sm text-muted-foreground">No pending proposals. Run the overseer or refresh.</p>
            ) : (
              <ul className="space-y-4">
                {agentDecisions.map((d) => (
                  <li key={d.id} className="border-b pb-3 last:border-0 text-sm space-y-2">
                    <div className="flex flex-wrap gap-2 justify-between items-start">
                      <div>
                        <div className="font-medium">
                          {d.module} · {d.type}
                        </div>
                        <div className="text-muted-foreground text-xs">id {d.id}</div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <div className="flex items-center gap-2 mr-2">
                          <Checkbox
                            id={`exec-${d.id}`}
                            checked={approveExecuteById[d.id] === true}
                            onCheckedChange={(v) =>
                              setApproveExecuteById((prev) => ({ ...prev, [d.id]: v === true }))
                            }
                          />
                          <Label htmlFor={`exec-${d.id}`} className="text-xs font-normal cursor-pointer">
                            Execute on approve (re-run day / flag — uses live APIs when checked)
                          </Label>
                        </div>
                        <Button size="sm" variant="default" onClick={() => void approveDecision(d.id)}>
                          Approve
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => void rejectDecision(d.id)}>
                          Reject
                        </Button>
                      </div>
                    </div>
                    {d.reasoning ? <p className="text-muted-foreground whitespace-pre-wrap">{d.reasoning}</p> : null}
                    <pre className="text-xs bg-muted p-2 rounded overflow-x-auto max-h-32">
                      {JSON.stringify({ before: d.beforeState, after: d.afterState }, null, 2)}
                    </pre>
                  </li>
                ))}
              </ul>
            )}
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
