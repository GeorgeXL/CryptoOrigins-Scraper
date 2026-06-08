import type { PipelineRunDetail } from "@/lib/editorial-pipeline";

export type LogStatus = "pending" | "approved" | "rejected" | "review";

export type LogLine = { id: string; text: string; status: LogStatus };

function stepToLogStatus(status: string): LogStatus {
  if (status === "completed" || status === "skipped" || status === "approved") return "approved";
  if (status === "rejected" || status === "error") return "rejected";
  return "pending";
}

function shortAgentName(agentName: string): string {
  return agentName.replace(/Agent$/, "").replace(/([a-z])([A-Z])/g, "$1 $2");
}

function stepLabel(agentName: string, status: string, rejectionReason?: string | null): string {
  const short = shortAgentName(agentName);
  if (rejectionReason) return `${short} · ${status} — ${rejectionReason.slice(0, 120)}`;
  if (status === "error") return `${short} · error — step failed (see run error below)`;
  return `${short} · ${status}`;
}

function isSuccessfulTerminal(status: string): boolean {
  return status === "completed" || status === "skipped" || status === "approved";
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

function runFailureMessage(status: string, stats: Record<string, unknown> | undefined): string {
  const err = stats?.error;
  if (typeof err === "string" && err.trim()) return err.trim();
  if (status === "stopped") return "Run stopped before completion.";
  if (status === "error") return "Pipeline failed — no error detail was recorded.";
  return `Run ended with status: ${status}`;
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

export function buildActivityLogFromDetail(detail: PipelineRunDetail): LogLine[] {
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
      const failMsg = runFailureMessage(run.status, run.stats as Record<string, unknown> | undefined);
      lines.push({
        id: `run-terminal-${run.status}`,
        text: `Run ${run.status} — ${failMsg.slice(0, 240)}`,
        status: "rejected",
      });
    }
  }

  return lines;
}

export function logLinesEqual(a: LogLine[], b: LogLine[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (!y || x.id !== y.id || x.text !== y.text || x.status !== y.status) return false;
  }
  return true;
}

export function namespaceLogLines(lines: LogLine[], runId: string): LogLine[] {
  return lines.map((line) => ({ ...line, id: `${runId}-${line.id}` }));
}
