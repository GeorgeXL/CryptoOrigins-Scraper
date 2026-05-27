import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowRight, Check, Clock3, Link2, XCircle } from "lucide-react";

type Scenario = {
  id: string;
  label: string;
  date: string;
  phase: string;
  summary: string;
  tags: string[];
  now: string;
  next: string;
  reason: string;
  topic: string;
  previousSummary?: string;
  changingFrom?: string;
  changingTo?: string;
  mockArticles?: Array<{
    id: string;
    title: string;
    source: string;
    relevance: "bitcoin" | "crypto_web3" | "macro";
    dateFit: "exact" | "near" | "weak";
    score: string;
    href: string;
  }>;
};

const SCENARIOS: Scenario[] = [
  {
    id: "article_pick",
    label: "1) Article pick",
    date: "2026-01-01",
    phase: "awaiting_article_pick",
    summary: "No summary yet. Pick the best date-accurate source first.",
    tags: ["Missing day", "Candidate select"],
    now: "Pick one source candidate",
    next: "System writes summary + tags + topic draft",
    reason: "No existing day row; source selection is the first required action.",
    topic: "Not set yet",
    mockArticles: [
      {
        id: "A1",
        title: "Bitcoin Opens 2026 in Tight Range as Liquidity Stays Thin",
        source: "CoinDesk",
        relevance: "bitcoin",
        dateFit: "exact",
        score: "0.92",
        href: "https://www.coindesk.com/",
      },
      {
        id: "A2",
        title: "Crypto Markets Start Year Flat While Macro Risk Sentiment Stabilizes",
        source: "The Block",
        relevance: "crypto_web3",
        dateFit: "near",
        score: "0.84",
        href: "https://www.theblock.co/",
      },
      {
        id: "A3",
        title: "Global Risk Assets Pause Ahead of Inflation Data",
        source: "Reuters",
        relevance: "macro",
        dateFit: "weak",
        score: "0.71",
        href: "https://www.reuters.com/",
      },
    ],
  },
  {
    id: "summary_approval",
    label: "2) Summary approval",
    date: "2026-01-06",
    phase: "awaiting_summary_approval",
    summary: "Bitcoin held support after CPI cooled, while derivative funding normalized across majors.",
    tags: ["Summary", "Length check"],
    now: "Approve summary (100–110 chars)",
    next: "Continue to consistency checks",
    reason: "Source is already selected; summary is ready for human signoff.",
    topic: "market_macro",
    previousSummary: "Bitcoin held support post CPI. Funding improved.",
    changingFrom: "Summary length and phrasing were weak in previous draft.",
    changingTo: "Summary is finalized to active voice within 100–110 chars.",
  },
  {
    id: "correction_approval",
    label: "3) Correction approval",
    date: "2026-01-12",
    phase: "awaiting_correction_approval",
    summary: "Record exists, but taxonomy is incomplete and needs correction.",
    tags: ["Correction", "Taxonomy"],
    now: "Approve proposed tag/topic corrections",
    next: "Final editor validation",
    reason: "Content exists, but metadata quality checks are failing.",
    topic: "market (current) -> market_macro (proposed)",
    previousSummary: "Market moved after inflation data, but taxonomy details were missing.",
    changingFrom: "Tags/topic are incomplete and not aligned with summary context.",
    changingTo: "Apply corrected tags/topic aligned to event and summary.",
  },
  {
    id: "calendar_decision",
    label: "4) Calendar decision",
    date: "2026-01-18",
    phase: "awaiting_calendar_decision",
    summary: "Event text appears retrospective; canonical date may differ.",
    tags: ["Date check", "Canonical mismatch"],
    now: "Decide keep vs date-shift handling",
    next: "Resume with chosen date path",
    reason: "System detected potential event-date mismatch.",
    topic: "culture",
    changingFrom: "Event may be anchored to wrong date context.",
    changingTo: "Use date-accurate framing or shift to canonical date path.",
  },
  {
    id: "duplicate_decision",
    label: "5) Duplicate decision",
    date: "2026-01-22",
    phase: "awaiting_duplicate_decision",
    summary: "Storyline overlaps with nearby day and may duplicate timeline.",
    tags: ["Duplicate", "Storyline"],
    now: "Resolve duplicate (keep/merge/replace)",
    next: "Continue final checks",
    reason: "Similarity score is high vs adjacent day.",
    topic: "market",
    changingFrom: "Timeline has overlapping storyline entries.",
    changingTo: "Keep one canonical storyline and remove overlap.",
  },
];

const DESIGNS = [
  { id: "tailored", label: "Tailored" },
  { id: "zen", label: "Zen" },
  { id: "inbox", label: "Inbox" },
  { id: "rail", label: "Rail" },
  { id: "flow", label: "Flow" },
  { id: "plain", label: "Plain" },
] as const;

type DesignId = (typeof DESIGNS)[number]["id"];

function TagRow({ tags }: { tags: string[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {tags.map((tag) => (
        <Badge key={tag} variant="secondary" className="h-6 rounded-md px-2 text-[11px] font-normal">
          {tag}
        </Badge>
      ))}
    </div>
  );
}

function TopMeta({ s }: { s: Scenario }) {
  return (
    <div className="rounded-lg border border-border bg-background p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">{s.date}</Badge>
        <Badge variant="outline">{s.phase}</Badge>
        {s.tags.map((tag) => (
          <Badge key={tag} variant="secondary" className="font-normal">{tag}</Badge>
        ))}
      </div>
      <div>
        <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground mb-1">Summary</p>
        <p className="text-sm text-foreground">{s.summary}</p>
      </div>
    </div>
  );
}

function ZenDesign({ s }: { s: Scenario }) {
  if (s.id === "article_pick") {
    return (
      <section className="space-y-3">
        <TopMeta s={s} />
        <div className="rounded-lg border border-border bg-background p-4 space-y-3">
          <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Article Pick (Simple)</p>
          <p className="text-base font-medium">{s.now}</p>
          <div className="rounded-md border border-border p-3 space-y-2">
            <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Mock candidates</p>
            {(s.mockArticles ?? []).map((a, idx) => (
              <div key={a.id} className="rounded-md border border-border/70 bg-muted/20 p-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium">{idx + 1}. {a.title}</p>
                  <Badge variant="outline">Score {a.score}</Badge>
                </div>
                <div className="mt-1.5 flex flex-wrap gap-2 text-xs text-muted-foreground">
                  <span>{a.source}</span>
                  <span>·</span>
                  <span>{a.relevance}</span>
                  <span>·</span>
                  <span>date fit: {a.dateFit}</span>
                </div>
              </div>
            ))}
          </div>
          <div className="rounded-md border border-border p-3">
            <p className="text-sm">1. Review top candidate for this date</p>
            <p className="text-sm">2. Confirm relevance (Bitcoin/crypto/macro)</p>
            <p className="text-sm">3. Approve pick to generate summary</p>
          </div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <ArrowRight className="h-4 w-4" />
            <span>{s.next}</span>
          </div>
          <Button size="sm">Pick article</Button>
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-3">
      <TopMeta s={s} />
      <div className="rounded-lg border border-border bg-background p-4 space-y-3">
        <div className="grid gap-2 md:grid-cols-[120px_1fr_1fr] items-start">
          <div>
            <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground mb-1">Date</p>
            <p className="text-sm">{s.date}</p>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground mb-1">Tags</p>
            <p className="text-sm">{s.tags.join(", ")}</p>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground mb-1">Topic</p>
            <p className="text-sm">{s.topic}</p>
          </div>
        </div>
        <div className="rounded-md border border-red-500/40 bg-red-500/5 p-3">
          <p className="text-xs uppercase tracking-[0.14em] text-red-300 mb-1">Current issue</p>
          <p className="text-sm flex items-start gap-2">
            <XCircle className="h-4 w-4 mt-0.5 text-red-400 shrink-0" />
            <span>{s.changingFrom ?? s.now}</span>
          </p>
        </div>
        <div className="rounded-md border border-emerald-500/35 bg-emerald-500/[0.06] p-3">
          <p className="text-xs uppercase tracking-[0.14em] text-emerald-300 mb-1">Changed to</p>
          <p className="text-sm">{s.changingTo ?? s.next}</p>
        </div>
        <Button size="sm">{s.now}</Button>
      </div>
    </section>
  );
}

function InboxDesign({ s }: { s: Scenario }) {
  return (
    <section className="space-y-3">
      <TopMeta s={s} />
      <div className="rounded-lg border border-border bg-background p-4 grid gap-3 md:grid-cols-[1fr_220px]">
        <div>
          <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground mb-1">Needs your decision</p>
          <p className="text-sm font-medium">{s.now}</p>
          <p className="text-xs text-muted-foreground mt-2">{s.reason}</p>
        </div>
        <div className="rounded-md border border-border p-3">
          <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground mb-1">Then</p>
          <p className="text-sm">{s.next}</p>
        </div>
      </div>
    </section>
  );
}

function RailDesign({ s }: { s: Scenario }) {
  return (
    <section className="space-y-3">
      <TopMeta s={s} />
      <div className="rounded-lg border border-border bg-background p-4">
        <div className="grid gap-2 md:grid-cols-3 text-sm">
          <div className="rounded-md border border-border p-3">
            <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground mb-1">Before</p>
            <p className="text-muted-foreground">System checks complete</p>
          </div>
          <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3">
            <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground mb-1">Now</p>
            <p className="font-medium">{s.now}</p>
          </div>
          <div className="rounded-md border border-border p-3">
            <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground mb-1">Next</p>
            <p>{s.next}</p>
          </div>
        </div>
      </div>
    </section>
  );
}

function FlowDesign({ s }: { s: Scenario }) {
  return (
    <section className="space-y-3">
      <TopMeta s={s} />
      <div className="rounded-lg border border-border bg-background p-4 space-y-3">
        <div className="flex items-center gap-2 text-sm">
          <Check className="h-4 w-4 text-emerald-400" />
          <span className="text-muted-foreground">Previous checks finished</span>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <Clock3 className="h-4 w-4 text-amber-300" />
          <span className="font-medium">{s.now}</span>
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <ArrowRight className="h-4 w-4" />
          <span>{s.next}</span>
        </div>
      </div>
    </section>
  );
}

function PlainDesign({ s }: { s: Scenario }) {
  return (
    <section className="space-y-3">
      <TopMeta s={s} />
      <div className="rounded-lg border border-border bg-background p-4 space-y-2 text-sm">
        <p><span className="text-muted-foreground">Now:</span> {s.now}</p>
        <p><span className="text-muted-foreground">After approve:</span> {s.next}</p>
        <p><span className="text-muted-foreground">Why:</span> {s.reason}</p>
      </div>
    </section>
  );
}

function ArticlePickTailored({ s }: { s: Scenario }) {
  const [selected, ...rest] = s.mockArticles ?? [];
  return (
    <section className="space-y-3">
      <div className="rounded-lg border border-border bg-background p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">{s.date}</p>
            <h3 className="text-base font-semibold">Choose the source for this missing day</h3>
            <p className="text-sm text-muted-foreground">{s.summary}</p>
          </div>
          <TagRow tags={s.tags} />
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-[1.25fr_0.75fr]">
        <div className="rounded-lg border border-border bg-background p-4 space-y-3">
          <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Recommended pick</p>
          {selected ? (
            <div className="rounded-md border border-emerald-500/35 bg-emerald-500/[0.06] p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium">{selected.title}</p>
                <div className="flex items-center gap-2">
                  <Badge variant="outline">Score {selected.score}</Badge>
                  <a
                    href={selected.href}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border text-muted-foreground hover:text-foreground"
                    aria-label={`Open source for ${selected.title}`}
                    title="Open source"
                  >
                    <Link2 className="h-3.5 w-3.5" />
                  </a>
                </div>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {selected.source} · {selected.relevance} · date fit: {selected.dateFit}
              </p>
            </div>
          ) : null}
          <div className="space-y-2">
            {rest.map((article) => (
              <div key={article.id} className="rounded-md border border-border p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm">{article.title}</p>
                  <a
                    href={article.href}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border text-muted-foreground hover:text-foreground"
                    aria-label={`Open source for ${article.title}`}
                    title="Open source"
                  >
                    <Link2 className="h-3.5 w-3.5" />
                  </a>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {article.source} · {article.relevance} · date fit: {article.dateFit}
                </p>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-border bg-background p-4 space-y-3">
          <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">What happens next</p>
          <p className="text-sm">{s.next}</p>
          <Button size="sm" className="w-full">Approve recommended pick</Button>
          <Button size="sm" variant="outline" className="w-full">Mark day empty</Button>
        </div>
      </div>
    </section>
  );
}

function SummaryTailored({ s }: { s: Scenario }) {
  return (
    <section className="rounded-lg border border-border bg-background p-4 space-y-4">
      <div className="grid gap-3 md:grid-cols-[120px_1fr_220px]">
        <div>
          <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Date</p>
          <p className="mt-1 text-sm font-medium">{s.date}</p>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Summary</p>
          <p className="mt-1 text-sm">{s.summary}</p>
          {s.previousSummary ? (
            <div className="mt-2 rounded-md border border-border bg-muted/20 p-2.5">
              <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Previous summary</p>
              <p className="mt-1 text-xs text-muted-foreground">{s.previousSummary}</p>
            </div>
          ) : null}
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Topic</p>
          <p className="mt-1 text-sm">{s.topic}</p>
          <div className="mt-2"><TagRow tags={s.tags} /></div>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-md border border-red-500/35 bg-red-500/[0.05] p-3">
          <p className="mb-1 flex items-center gap-2 text-xs uppercase tracking-[0.14em] text-red-300">
            <XCircle className="h-4 w-4" /> Current issue
          </p>
          <p className="text-sm">{s.changingFrom}</p>
        </div>
        <div className="rounded-md border border-emerald-500/35 bg-emerald-500/[0.06] p-3">
          <p className="mb-1 flex items-center gap-2 text-xs uppercase tracking-[0.14em] text-emerald-300">
            <Check className="h-4 w-4" /> Changed to
          </p>
          <p className="text-sm">{s.changingTo}</p>
        </div>
      </div>

      <Button size="sm">{s.now}</Button>
    </section>
  );
}

function CorrectionTailored({ s }: { s: Scenario }) {
  return (
    <section className="rounded-lg border border-border bg-background p-4 space-y-4">
      <div className="grid gap-3 md:grid-cols-[120px_1fr_240px]">
        <div>
          <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Date</p>
          <p className="mt-1 text-sm font-medium">{s.date}</p>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Summary</p>
          <p className="mt-1 text-sm">{s.summary}</p>
          {s.previousSummary ? (
            <div className="mt-2 rounded-md border border-border bg-muted/20 p-2.5">
              <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Previous summary</p>
              <p className="mt-1 text-xs text-muted-foreground">{s.previousSummary}</p>
            </div>
          ) : null}
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Current topic</p>
          <p className="mt-1 text-sm">{s.topic}</p>
          <div className="mt-2"><TagRow tags={s.tags} /></div>
        </div>
      </div>

      <div className="rounded-md border border-red-500/35 bg-red-500/[0.05] p-3">
        <p className="mb-1 flex items-center gap-2 text-xs uppercase tracking-[0.14em] text-red-300">
          <XCircle className="h-4 w-4" /> Failing now
        </p>
        <p className="text-sm">{s.changingFrom}</p>
      </div>
      <div className="rounded-md border border-emerald-500/35 bg-emerald-500/[0.06] p-3">
        <p className="mb-1 flex items-center gap-2 text-xs uppercase tracking-[0.14em] text-emerald-300">
          <Check className="h-4 w-4" /> Apply this change
        </p>
        <p className="text-sm">{s.changingTo}</p>
      </div>
      <Button size="sm">{s.now}</Button>
    </section>
  );
}

function CalendarTailored({ s }: { s: Scenario }) {
  const [picked, setPicked] = useState<"keep" | "move" | null>(null);
  return (
    <section className="rounded-lg border border-border bg-background p-4 space-y-4">
      <TopMeta s={s} />
      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-md border border-red-500/35 bg-red-500/[0.05] p-3">
          <p className="text-xs uppercase tracking-[0.14em] text-red-300">Target date</p>
          <p className="mt-2 text-lg font-semibold">{s.date}</p>
          <p className="mt-2 text-sm">{s.changingFrom}</p>
        </div>
        <div className="rounded-md border border-border p-3">
          <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Decision</p>
          <p className="mt-2 text-sm font-medium">{s.now}</p>
          <p className="mt-2 text-sm text-muted-foreground">{s.changingTo}</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => setPicked("keep")}>Keep on this date</Button>
        <Button size="sm" variant="outline" onClick={() => setPicked("move")}>Move to canonical date</Button>
      </div>
      {picked ? (
        <div className="rounded-md border border-border bg-muted/20 p-3 text-sm">
          <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground mb-1">Click outcome</p>
          <p>
            {picked === "keep"
              ? "Keeps this day in place and marks the decision as date-confirmed before next checks."
              : "Schedules date-shift handling to the canonical day and re-runs downstream checks on that path."}
          </p>
        </div>
      ) : null}
    </section>
  );
}

function DuplicateTailored({ s }: { s: Scenario }) {
  const [picked, setPicked] = useState<"keep" | "merge" | "replace" | null>(null);
  return (
    <section className="rounded-lg border border-border bg-background p-4 space-y-4">
      <TopMeta s={s} />
      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-md border border-border p-3">
          <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Current day</p>
          <p className="mt-2 text-sm font-medium">{s.date}</p>
          <p className="mt-1 text-sm text-muted-foreground">{s.summary}</p>
        </div>
        <div className="rounded-md border border-red-500/35 bg-red-500/[0.05] p-3">
          <p className="text-xs uppercase tracking-[0.14em] text-red-300">Overlap risk</p>
          <p className="mt-2 text-sm">{s.changingFrom}</p>
          <p className="mt-2 text-sm text-muted-foreground">{s.reason}</p>
        </div>
      </div>
      <div className="rounded-md border border-emerald-500/35 bg-emerald-500/[0.06] p-3">
        <p className="text-xs uppercase tracking-[0.14em] text-emerald-300">Recommended resolution</p>
        <p className="mt-1 text-sm">{s.changingTo}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => setPicked("keep")}>Keep this day</Button>
        <Button size="sm" variant="outline" onClick={() => setPicked("merge")}>Merge storyline</Button>
        <Button size="sm" variant="outline" onClick={() => setPicked("replace")}>Find replacement</Button>
      </div>
      {picked ? (
        <div className="rounded-md border border-border bg-muted/20 p-3 text-sm">
          <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground mb-1">Click outcome</p>
          <p>
            {picked === "keep" && "Keeps this day as the canonical record and closes the duplicate warning for the neighbor."}
            {picked === "merge" && "Merges storyline context into one canonical item and links the adjacent day as supporting context."}
            {picked === "replace" && "Sends this day back to source selection to pick a different event and avoid storyline overlap."}
          </p>
        </div>
      ) : null}
    </section>
  );
}

function TailoredDesign({ s }: { s: Scenario }) {
  switch (s.id) {
    case "article_pick":
      return <ArticlePickTailored s={s} />;
    case "summary_approval":
      return <SummaryTailored s={s} />;
    case "correction_approval":
      return <CorrectionTailored s={s} />;
    case "calendar_decision":
      return <CalendarTailored s={s} />;
    case "duplicate_decision":
      return <DuplicateTailored s={s} />;
    default:
      return <ZenDesign s={s} />;
  }
}

export default function AgentsV2ReviewDesignLabPanel() {
  const [scenarioId, setScenarioId] = useState(SCENARIOS[0].id);
  const [design, setDesign] = useState<DesignId>("tailored");
  const scenario = useMemo(() => SCENARIOS.find((s) => s.id === scenarioId) ?? SCENARIOS[0], [scenarioId]);

  return (
    <section className="max-w-5xl p-6 space-y-5">
      <div className="space-y-1">
        <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Review Design Lab</p>
        <h2 className="text-xl font-semibold">Cleaner Concepts</h2>
        <p className="text-sm text-muted-foreground">Minimal layouts focused on summary, tags, current action, and next step.</p>
      </div>

      <div className="rounded-lg border border-border bg-muted/20 p-3">
        <div className="flex flex-wrap gap-2">
          {SCENARIOS.map((s) => (
            <Button key={s.id} size="sm" variant={scenarioId === s.id ? "default" : "outline"} onClick={() => setScenarioId(s.id)}>
              {s.label}
            </Button>
          ))}
        </div>
      </div>

      <Tabs value={design} onValueChange={(v) => setDesign(v as DesignId)}>
        <TabsList className="grid w-full max-w-4xl grid-cols-6">
          {DESIGNS.map((d) => (
            <TabsTrigger key={d.id} value={d.id}>{d.label}</TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {design === "tailored" ? <TailoredDesign s={scenario} /> : null}
      {design === "zen" ? <ZenDesign s={scenario} /> : null}
      {design === "inbox" ? <InboxDesign s={scenario} /> : null}
      {design === "rail" ? <RailDesign s={scenario} /> : null}
      {design === "flow" ? <FlowDesign s={scenario} /> : null}
      {design === "plain" ? <PlainDesign s={scenario} /> : null}
    </section>
  );
}
