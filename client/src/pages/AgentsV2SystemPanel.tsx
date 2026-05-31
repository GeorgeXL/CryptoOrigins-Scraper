import type { ComponentType } from "react";
import {
  ArrowRight,
  Bot,
  CheckCircle2,
  Database,
  FileCheck2,
  GitBranch,
  Layers,
  Newspaper,
  SearchCheck,
  Shield,
  Tags,
  UserCheck,
  Workflow,
  Zap,
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

const ADMIN_TABS: Array<{ label: string; body: string }> = [
  {
    label: "Homepage",
    body: "Manual review queue. Each pipeline handoff lands here with the current value, proposed change, and next step. Approve, reject, keep, or pick from options.",
  },
  {
    label: "Agent",
    body: "Start a pipeline run for one day or a range (max 31 days per run; longer ranges auto-slice). Choose which checks to run: relevance, summary, topics, tags, duplicates, date.",
  },
  {
    label: "Metrics",
    body: "Corpus overview, pipeline sample KPIs, and on-demand day verification (quick or full).",
  },
  {
    label: "System",
    body: "This reference — how routing, agents, auto-apply, and the review loop work today.",
  },
];

const ROUTING_BRANCHES: FlowNode[] = [
  {
    id: "existing",
    title: "Saved day (row in database)",
    actor: "Corpus-clean graph",
    icon: SearchCheck,
    tone: "agent",
    body: "Routes: existing_ok or existing_needs_correction. Skips the legacy agent chain and runs the unified check graph below.",
    bullets: [
      "Date → duplicate → relevance → correction proposals",
      "Safe fixes auto-apply; the rest queue on Homepage",
      "Day passes with no queue item when all checks clear",
    ],
  },
  {
    id: "empty",
    title: "Empty or missing day",
    actor: "Gated Exa fetch",
    icon: Newspaper,
    tone: "agent",
    body: "Routes: empty_day or missing_day. Exa fetches candidates only — no summary, tags, or topics until you pick an article.",
    bullets: [
      "Default for empty/missing days (Relevance check enabled)",
      "You pick the winning article or confirm the day is truly empty",
      "Summary Agent runs after pick; then tags and topics",
    ],
  },
];

const EXISTING_DAY_CHECKS: FlowNode[] = [
  {
    id: "date",
    title: "1. Date consistency",
    actor: "Regex + Date Agent",
    icon: FileCheck2,
    tone: "llm",
    body: "Detects retrospective language, wrong calendar slots, and canonical date mismatches.",
    bullets: [
      "Regex rules first; LLM pass when enabled (EDITORIAL_V3_DATE_LLM)",
      "Queues calendar decision: move, keep, or delete",
    ],
  },
  {
    id: "duplicate",
    title: "2. Duplicate neighbors",
    actor: "Rules + Duplicate Agent",
    icon: Layers,
    tone: "llm",
    body: "Compares summaries within a ±56-day window using Jaccard overlap on tokens, tags, and topics.",
    bullets: [
      "Strong rule matches queue immediately",
      "Borderline pairs go to semantic Duplicate Agent (EDITORIAL_DUPLICATE_LLM)",
      "You choose: keep both, delete one, or differentiate",
    ],
  },
  {
    id: "relevance",
    title: "3. Relevance Agent",
    actor: "LLM agent",
    icon: Bot,
    tone: "llm",
    body: "Classifies the day: bitcoin_primary, crypto_adjacent, macro_adjacent, off_topic, or insufficient.",
    bullets: [
      "off_topic / insufficient → article pick from stored candidates",
      "Weak but valid summary → optional better-article pick when a stronger stored candidate exists",
    ],
  },
  {
    id: "proposals",
    title: "4. Correction proposals",
    actor: "Topic + Tag + Summary agents",
    icon: Tags,
    tone: "llm",
    body: "Topic Agent, Tag Agent, and Summary Agent (plus deterministic rules) build a fix list from summary and article evidence.",
    bullets: [
      "Topics: exactly one homepage storyline leaf",
      "Tags: concrete entities grounded in the article",
      "Summary: length 100–110 chars, active voice, no weak phrasing",
    ],
  },
  {
    id: "auto",
    title: "5. Auto-apply vs queue",
    actor: "Writer",
    icon: Zap,
    tone: "write",
    body: "High-confidence safe fixes write immediately. Everything else waits on Homepage.",
    bullets: [
      "Auto: merge_redundant_tags, clear_orphan_flag, single-leaf topic when confidence is high",
      "Manual: medium/low topic chips, tag adds/drops, summary regen, multi-option fixes",
    ],
  },
];

const EMPTY_DAY_STEPS: FlowNode[] = [
  {
    id: "exa",
    title: "Exa candidate fetch",
    actor: "Source finder",
    icon: Newspaper,
    tone: "agent",
    body: "Fetches ranked candidates across Bitcoin, crypto/Web3, and macro tiers. No LLM summary yet.",
    bullets: ["Blocks explainers, roundups, and stale stories", "Zero candidates → confirm empty or reject to widen search"],
  },
  {
    id: "pick",
    title: "Article pick",
    actor: "You",
    icon: UserCheck,
    tone: "human",
    body: "Choose the winning article, keep current, or mark the day empty.",
    bullets: ["Approval triggers Summary Agent regeneration", "Tags and topics are proposed after the summary is approved"],
  },
  {
    id: "summary-approve",
    title: "Summary approval",
    actor: "Summary Agent",
    icon: FileCheck2,
    tone: "llm",
    body: "Summary Agent writes 100–110 characters from the chosen article. You approve before tags and topics run.",
    bullets: ["Three retries to hit length target", "Reject or edit if the voice or facts are wrong"],
  },
];

const LLM_AGENTS: Array<{ name: string; role: string; disableFlag?: string }> = [
  { name: "Topic Agent", role: "Proposes exactly one homepage storyline leaf from summary + article evidence.", disableFlag: "TOPIC_AGENT_DISABLED=1" },
  { name: "Tag Agent", role: "Suggests tag adds and drops grounded in canonical entities.", disableFlag: "TAG_AGENT_DISABLED=1" },
  { name: "Summary Agent", role: "Evaluates summary quality and regenerates on redo_summary approval.", disableFlag: "SUMMARY_AGENT_DISABLED=1" },
  { name: "Relevance Agent", role: "Classifies editorial fit; triggers article pick when off-topic or insufficient.", disableFlag: "RELEVANCE_AGENT_DISABLED=1" },
  { name: "Date Agent", role: "LLM pass after regex for wrong-slot and duplicate-date detection.", disableFlag: "EDITORIAL_V3_DATE_LLM=0" },
  { name: "Duplicate Agent", role: "Semantic duplicate verdict for borderline neighbor pairs.", disableFlag: "EDITORIAL_DUPLICATE_LLM=0" },
];

const REVIEW_PHASES: Array<{ phase: string; meaning: string }> = [
  { phase: "awaiting_article_pick", meaning: "Pick an article (empty day, better storyline, or relevance failure)." },
  { phase: "awaiting_summary_approval", meaning: "Approve or edit the Summary Agent output after an article pick." },
  { phase: "awaiting_correction_approval", meaning: "Opt in to topic, tag, or summary fixes the pipeline proposed." },
  { phase: "awaiting_calendar_decision", meaning: "Summary may belong on a different calendar date." },
  { phase: "awaiting_duplicate_decision", meaning: "Neighbor day looks like the same story." },
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
    <section className={cn("min-h-[11.5rem] rounded-lg border p-4", toneClasses[node.tone])}>
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

function SectionHeader({ icon: Icon, title, subtitle }: { icon: ComponentType<{ className?: string }>; title: string; subtitle: string }) {
  return (
    <div className="mb-4 space-y-1">
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <Icon className="size-4" />
        {title}
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">{subtitle}</p>
    </div>
  );
}

export default function AgentsV2SystemPanel() {
  const [existingRoute, emptyRoute] = ROUTING_BRANCHES;
  const [dateCheck, duplicateCheck, relevanceCheck, proposalsCheck, autoCheck] = EXISTING_DAY_CHECKS;
  const [exaStep, pickStep, summaryStep] = EMPTY_DAY_STEPS;

  return (
    <main className="max-w-6xl space-y-5 p-4 sm:p-6 md:p-8">
      <header className="space-y-1">
        <h2 className="text-lg font-semibold tracking-tight text-foreground">System</h2>
        <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
          One unified editorial pipeline. Every calendar day is triaged, checked by deterministic rules and LLM agents,
          safe fixes auto-apply, and anything uncertain lands on Homepage for your decision. Approval resumes the pipeline
          until the database row is clean.
        </p>
      </header>

      <Card className="border-border/80 bg-card/35 p-4 shadow-sm md:p-5">
        <SectionHeader icon={Workflow} title="Admin Agent tabs" subtitle="Three surfaces for the same pipeline." />
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          {ADMIN_TABS.map((tab) => (
            <section key={tab.label} className="rounded-lg border border-border/80 bg-background/60 p-4">
              <p className="text-sm font-semibold text-foreground">{tab.label}</p>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{tab.body}</p>
            </section>
          ))}
        </div>
      </Card>

      <Card className="border-border/80 bg-card/35 p-4 shadow-sm md:p-5">
        <SectionHeader
          icon={GitBranch}
          title="Unified routing"
          subtitle="NewsManager triage picks a route per day. The pipeline then follows one of two paths — not the old linear agent chain for saved days."
        />
        <div className="grid gap-3 lg:grid-cols-[1fr_auto_1fr]">
          <FlowCard node={existingRoute} />
          <ArrowConnector label="or" />
          <FlowCard node={emptyRoute} />
        </div>
        <p className="mt-4 rounded-md border border-dashed border-border/80 bg-background/45 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
          Legacy empty-day chain (auto-summarize everything in one shot) is opt-in only:{" "}
          <span className="font-mono text-foreground/90">EDITORIAL_LEGACY_EMPTY_PATH=1</span>
        </p>
      </Card>

      <Card className="border-border/80 bg-card/35 p-4 shadow-sm md:p-5">
        <SectionHeader
          icon={Shield}
          title="Existing-day check order"
          subtitle="Runs in priority order. The first blocker queues on Homepage; later checks wait until you approve and the day resumes."
        />
        <div className="space-y-4">
          <div className="grid gap-3 lg:grid-cols-[1fr_auto_1fr_auto_1fr]">
            <FlowCard node={dateCheck} />
            <ArrowConnector />
            <FlowCard node={duplicateCheck} />
            <ArrowConnector />
            <FlowCard node={relevanceCheck} />
          </div>
          <div className="grid gap-3 lg:grid-cols-[1fr_auto_1fr_auto_1fr]">
            <FlowCard node={proposalsCheck} />
            <ArrowConnector />
            <FlowCard node={autoCheck} />
            <ArrowConnector label="if manual fixes remain" />
            <section className="rounded-lg border border-amber-500/35 bg-amber-500/[0.08] p-4">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-500">Homepage queue</p>
              <p className="mt-2 text-sm font-medium text-foreground">awaiting_correction_approval</p>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                You opt in to each proposed fix. Approve selected chips only — rejected proposals are suppressed on reruns.
              </p>
            </section>
          </div>
        </div>
      </Card>

      <Card className="border-border/80 bg-card/35 p-4 shadow-sm md:p-5">
        <SectionHeader
          icon={Newspaper}
          title="Empty / missing day path"
          subtitle="Gated fetch is the default when Relevance is included in the Agent run checks."
        />
        <div className="grid gap-3 lg:grid-cols-[1fr_auto_1fr_auto_1fr]">
          <FlowCard node={exaStep} />
          <ArrowConnector />
          <FlowCard node={pickStep} />
          <ArrowConnector />
          <FlowCard node={summaryStep} />
        </div>
      </Card>

      <Card className="border-border/80 bg-card/35 p-4 shadow-sm md:p-5">
        <SectionHeader icon={Bot} title="LLM agents" subtitle="Production agents and how to disable them per environment." />
        <div className="grid gap-2 sm:grid-cols-2">
          {LLM_AGENTS.map((agent) => (
            <div key={agent.name} className="rounded-lg border border-violet-500/20 bg-violet-500/[0.04] px-3 py-2.5">
              <p className="text-sm font-medium text-foreground">{agent.name}</p>
              <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{agent.role}</p>
              {agent.disableFlag ? (
                <p className="mt-2 font-mono text-[10px] text-muted-foreground">{agent.disableFlag}</p>
              ) : null}
            </div>
          ))}
        </div>
      </Card>

      <Card className="border-border/80 bg-card/35 p-4 shadow-sm md:p-5">
        <SectionHeader
          icon={UserCheck}
          title="Known / manual / milestone days"
          subtitle="Key dates in Bitcoin, web3, and macro history may have no news article — only a curated summary. The pipeline still validates whether the summary matches the known event."
        />
        <div className="grid gap-3 md:grid-cols-2">
          <section className="rounded-lg border border-sky-500/20 bg-sky-500/[0.05] p-4 text-xs leading-relaxed text-muted-foreground">
            <p className="font-medium text-foreground">What counts as known</p>
            <ul className="mt-2 space-y-1.5">
              <li>Canonical milestone on this calendar date (genesis block, halvings, etc.)</li>
              <li>Manual override flag on the analysis row</li>
              <li>Manual news entry in the database</li>
              <li>top_article_id markers: known-… or manual-…</li>
            </ul>
          </section>
          <section className="rounded-lg border border-border/70 bg-background/50 p-4 text-xs leading-relaxed text-muted-foreground">
            <p className="font-medium text-foreground">What the pipeline checks</p>
            <ul className="mt-2 space-y-1.5">
              <li>Summary length 100–110 characters</li>
              <li>Summary matches the milestone / manual reference — not an Exa article</li>
              <li>Topic leaf and grounded tags</li>
              <li>No article pick or redo_summary unless a real article winner exists</li>
            </ul>
          </section>
        </div>
      </Card>

      <Card className="border-border/80 bg-card/35 p-4 shadow-sm md:p-5">
        <SectionHeader
          icon={UserCheck}
          title="Review queue phases"
          subtitle="Each Homepage item maps to one phase. The timeline shows Triage → Article pick → Summary approval → Done."
        />
        <div className="space-y-2">
          {REVIEW_PHASES.map((row) => (
            <div
              key={row.phase}
              className="flex flex-col gap-1 rounded-md border border-border/70 bg-background/50 px-3 py-2 sm:flex-row sm:items-center sm:gap-3"
            >
              <code className="shrink-0 text-[11px] text-foreground/90">{row.phase}</code>
              <span className="text-xs leading-relaxed text-muted-foreground">{row.meaning}</span>
            </div>
          ))}
        </div>
      </Card>

      <Card className="border-border/80 bg-card/35 p-4 shadow-sm md:p-5">
        <SectionHeader
          icon={Database}
          title="Review loop and clean row"
          subtitle="Approval never ends the workflow early — it hands control back to the pipeline for the next required check."
        />
        <div className="grid gap-3 lg:grid-cols-[1fr_auto_1fr]">
          <section className="rounded-lg border border-dashed border-border/80 bg-background/45 p-4">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">After you approve</p>
            <p className="mt-2 text-sm font-medium text-foreground">
              Article pick → summary approval → tags/topics → remaining checks
            </p>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              Reject or keep-current suppresses repeat nudges for that candidate or proposal. Resume slice on Homepage
              reruns only the agents still needed for that date.
            </p>
          </section>
          <ArrowConnector label="resume" />
          <section className="rounded-lg border border-emerald-500/25 bg-emerald-500/[0.06] p-4">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-500">Clean database row</p>
            <p className="mt-2 text-sm font-medium text-foreground">
              Summary 100–110 chars, one storyline leaf, grounded tags, aligned source
            </p>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              Days with only auto-applied safe fixes never appear on Homepage. The run activity log on the Agent tab lists
              every handoff, auto-apply, and queue event.
            </p>
          </section>
        </div>
      </Card>
    </main>
  );
}
