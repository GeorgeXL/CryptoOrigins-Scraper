import type { ComponentType } from "react";
import {
  ArrowRight,
  CheckCircle2,
  Database,
  FileCheck2,
  GitBranch,
  Newspaper,
  SearchCheck,
  Tags,
  UserCheck,
  Workflow,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type FlowNode = {
  id: string;
  title: string;
  actor: string;
  icon: ComponentType<{ className?: string }>;
  tone: "neutral" | "agent" | "llm" | "human" | "write";
  body: string;
  bullets: string[];
};

const FLOW_NODES: FlowNode[] = [
  {
    id: "start",
    title: "Date enters pipeline",
    actor: "System",
    icon: Workflow,
    tone: "neutral",
    body: "A single day or range is loaded from the database.",
    bullets: ["Reads summary, articles, tags, topics, flags", "Known/manual days can continue without fetched articles"],
  },
  {
    id: "triage",
    title: "Triage + sanity checks",
    actor: "Deterministic agent",
    icon: SearchCheck,
    tone: "agent",
    body: "The system decides whether the day is clean, missing, vague, duplicated, or needs correction.",
    bullets: ["Summary must be 100-110 characters", "Rejects retrospective/wrong-date stories", "Checks duplicate neighboring storylines"],
  },
  {
    id: "source",
    title: "Article selection",
    actor: "Ranking agent",
    icon: Newspaper,
    tone: "agent",
    body: "If the day needs a source, candidates are ranked before any new summary is written.",
    bullets: ["Prefer Bitcoin, then crypto/Web3, then macro", "Block explainers, roundups, and stale stories", "Human picks or marks the day empty"],
  },
  {
    id: "summary",
    title: "Summary writer",
    actor: "LLM agent",
    icon: FileCheck2,
    tone: "llm",
    body: "After a source is chosen, the system writes or repairs the editorial summary.",
    bullets: ["Active voice", "100-110 characters", "Uses the chosen article or known-event context only"],
  },
  {
    id: "taxonomy",
    title: "Tags + storylines",
    actor: "LLM + deterministic grounding",
    icon: Tags,
    tone: "llm",
    body: "Tags and homepage storylines are proposed from the summary and source evidence.",
    bullets: ["Tags must be concrete entities or exact event subjects", "Topics use homepage storylines", "Creates granular topics only when a major gap exists"],
  },
  {
    id: "review",
    title: "Human review",
    actor: "You",
    icon: UserCheck,
    tone: "human",
    body: "Anything uncertain stops here with the current value, proposed change, and next step.",
    bullets: ["Approve returns to the agent to finish", "Reject/keep suppresses repeat nudges", "Multiple-choice changes are applied only if selected"],
  },
  {
    id: "write",
    title: "Persist clean day",
    actor: "Writer",
    icon: Database,
    tone: "write",
    body: "Approved changes are written back to the database and the day is marked clean.",
    bullets: ["Summary, selected source, tags, and topics stay in sync", "Queue records what happened", "Clean days can auto-approve"],
  },
];

const toneClasses: Record<FlowNode["tone"], string> = {
  neutral: "border-border bg-background/80",
  agent: "border-sky-500/25 bg-sky-500/[0.06]",
  llm: "border-violet-500/25 bg-violet-500/[0.06]",
  human: "border-amber-500/35 bg-amber-500/[0.08]",
  write: "border-emerald-500/30 bg-emerald-500/[0.07]",
};

const badgeClasses: Record<FlowNode["tone"], string> = {
  neutral: "border-border text-muted-foreground",
  agent: "border-sky-500/30 text-sky-500",
  llm: "border-violet-500/30 text-violet-500",
  human: "border-amber-500/40 text-amber-500",
  write: "border-emerald-500/35 text-emerald-500",
};

function FlowCard({ node }: { node: FlowNode }) {
  const Icon = node.icon;
  return (
    <section className={cn("min-h-[13.5rem] rounded-lg border p-4", toneClasses[node.tone])}>
      <div className="flex items-start justify-between gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border/70 bg-background/70">
          <Icon className="size-4 text-foreground" />
        </span>
        <Badge variant="outline" className={cn("shrink-0 text-[10px]", badgeClasses[node.tone])}>
          {node.actor}
        </Badge>
      </div>
      <div className="mt-4 space-y-2">
        <h3 className="text-sm font-semibold leading-snug text-foreground">{node.title}</h3>
        <p className="text-xs leading-relaxed text-muted-foreground">{node.body}</p>
      </div>
      <ul className="mt-4 space-y-1.5 text-[11px] leading-relaxed text-muted-foreground">
        {node.bullets.map((bullet) => (
          <li key={bullet} className="flex gap-2">
            <CheckCircle2 className="mt-0.5 size-3 shrink-0 text-emerald-500/80" />
            <span>{bullet}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ArrowConnector({ label }: { label?: string }) {
  return (
    <div className="hidden min-w-8 flex-col items-center justify-center gap-1 text-muted-foreground lg:flex">
      <ArrowRight className="size-4" />
      {label ? <span className="max-w-16 text-center text-[9px] uppercase tracking-wide">{label}</span> : null}
    </div>
  );
}

export default function AgentsV2SystemPanel() {
  const [start, triage, source, summary, taxonomy, review, write] = FLOW_NODES;

  return (
    <main className="max-w-6xl space-y-5 p-4 sm:p-6 md:p-8">
      <header className="space-y-1">
        <h2 className="text-lg font-semibold tracking-tight text-foreground">System</h2>
        <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
          One editorial cleanup flow: every day is checked, uncertain changes go to human review, and approved work returns to the agents until the database row is clean.
        </p>
      </header>

      <Card className="border-border/80 bg-card/35 p-4 shadow-sm md:p-5">
        <div className="mb-4 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <GitBranch className="size-4" />
          Admin agent flow
        </div>

        <div className="space-y-4">
          <div className="grid gap-3 lg:grid-cols-[1fr_auto_1fr_auto_1fr]">
            <FlowCard node={start} />
            <ArrowConnector />
            <FlowCard node={triage} />
            <ArrowConnector label="if source needed" />
            <FlowCard node={source} />
          </div>

          <div className="grid gap-3 lg:grid-cols-[1fr_auto_1fr_auto_1fr]">
            <FlowCard node={summary} />
            <ArrowConnector />
            <FlowCard node={taxonomy} />
            <ArrowConnector label="if uncertain" />
            <FlowCard node={review} />
          </div>

          <div className="grid gap-3 lg:grid-cols-[1fr_auto_1fr_auto_1fr]">
            <section className="rounded-lg border border-dashed border-border/80 bg-background/45 p-4">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Review loop</p>
              <p className="mt-2 text-sm font-medium text-foreground">Approve, reject, keep current, choose another source, or edit.</p>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                Approval does not end the workflow early. It returns the day to the next required check so tags, topics, duplicates, and summary length still finish.
              </p>
            </section>
            <ArrowConnector label="resume" />
            <FlowCard node={write} />
            <ArrowConnector label="final" />
            <section className="rounded-lg border border-emerald-500/25 bg-emerald-500/[0.06] p-4">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-500">Clean database row</p>
              <p className="mt-2 text-sm font-medium text-foreground">Each date ends with aligned summary, source, tags, and storylines.</p>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                The queue keeps a record of what was approved, rejected, or suppressed so repeat nudges do not keep coming back.
              </p>
            </section>
          </div>
        </div>
      </Card>

    </main>
  );
}
