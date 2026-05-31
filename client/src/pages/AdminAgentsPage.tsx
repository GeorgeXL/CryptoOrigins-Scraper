import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import type { DateRange } from "react-day-picker";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Bot,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  Loader2,
  MinusCircle,
  RotateCw,
  Sparkles,
  Workflow,
  XCircle,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Link } from "wouter";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

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
      phase?: string;
      error?: string;
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
    evidence?: unknown;
    input?: unknown;
    rejectionReason?: string | null;
    suggestedAction?: string | null;
    startedAt?: string | null;
  }>;
  handoffs: Array<{
    id: string;
    fromAgent: string;
    toAgent: string;
    status: string;
    payload: unknown;
    createdAt?: string | null;
  }>;
  live: { activeInThisRuntime: boolean };
};

type ArticleCandidate = {
  id: string;
  title: string;
  url: string;
  publishedDate?: string | null;
  tier: "bitcoin" | "crypto" | "macro";
  source?: string;
  summary?: string;
  rank: number;
  publishedDateOffsetDays: number | null;
  calendarSanityOk: boolean;
  calendarSanityNotes: string[];
  relevanceScore?: number;
  recommended?: boolean;
  relevanceNotes?: string[];
};

type OperatorActionPlan = {
  route: "existing_ok" | "existing_needs_correction" | "missing_day" | "empty_day";
  headline: string;
  reasonEntries: Array<{ code: string; message: string }>;
  autoFixes: Array<{ code: string; label: string }>;
  manualFixes: Array<{ code: string; label: string; suggestion: string }>;
  approveSummary: string;
  approveEnabled: boolean;
};

type CorrectionProposal =
  | { id: string; kind: "promote_v1_to_v2_tags"; current: string[]; proposed: string[]; rationale: string }
  | { id: string; kind: "set_topic_categories"; current: string[]; proposed: string[]; rationale: string }
  | { id: string; kind: "redo_summary"; currentSummary: string; rationale: string }
  | { id: string; kind: "clear_orphan_flag"; rationale: string }
  | { id: string; kind: "clear_manual_flag"; rationale: string }
  | { id: string; kind: "fix_tag_conflict"; conflictingTags: string[]; proposedDrop: string[]; rationale: string }
  | { id: string; kind: "drop_ungrounded_tags"; proposedDrop: string[]; suggestedFocusTags?: string[]; rationale: string }
  | { id: string; kind: "merge_redundant_tags"; merges: Array<{ from: string; to: string }>; rationale: string };

type SummaryApprovalPayload = {
  winningArticle: { id: string; title: string; url: string; tier: "bitcoin" | "crypto" | "macro" };
  generatedSummary: string;
  proposedTags: string[];
  proposedTopics: string[];
};

type CalendarDecisionPayload = {
  currentDate: string;
  expectedDate: string;
  ruleId: string;
  reason: string;
  canonicalDateOccupied: boolean;
};

type DuplicateNeighbor = {
  date: string;
  summaryPreview: string;
  sharedTags: string[];
  sharedTopics: string[];
  tokenJaccard: number;
};

type DuplicateDecisionPayload = {
  focal: { date: string; summaryPreview: string; tags: string[]; topics: string[] };
  neighbors: DuplicateNeighbor[];
};

type ApproveOpts = {
  selectedArticleId?: string;
  acceptedProposalIds?: string[];
  calendarDecision?: "move_to_canonical" | "keep_as_is" | "delete";
  duplicateDecision?: "keep_both" | "delete_focal" | "delete_neighbor" | "differentiate";
  duplicateNeighborDate?: string;
  editedSummary?: string;
  editedTags?: string[];
  editedTopics?: string[];
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
  /** Joined from `historical_news_analyses` on `event_date` (admin review list). */
  daySummary?: string | null;
  dayTopArticle?: { title: string; url: string } | null;
  dayTags?: string[] | null;
  dayTopicCategories?: string[] | null;
  dayTotalArticlesFetched?: number | null;
  dayTierUsed?: string | null;
  dayWinningTier?: string | null;
  daySourceArticles?: { title: string; url: string }[] | null;
  /** Mirrors `POST /api/analysis/date/:date/redo-summary` — needs a real `top_article_id`. */
  dayRedoSummaryAvailable?: boolean | null;
  /** V3 phase discriminator from the server. */
  reviewPhase?:
    | "legacy"
    | "awaiting_article_pick"
    | "awaiting_correction_approval"
    | "awaiting_summary_approval"
    | "awaiting_calendar_decision"
    | "awaiting_duplicate_decision"
    | string
    | null;
  scenario?: "empty_day" | "missing_day" | null;
  candidates?: ArticleCandidate[] | null;
  hasCandidates?: boolean | null;
  proposals?: CorrectionProposal[] | null;
  summaryApproval?: SummaryApprovalPayload | null;
  calendarDecision?: CalendarDecisionPayload | null;
  duplicateDecision?: DuplicateDecisionPayload | null;
  /** Derived plan: what Approve will do, what still needs hand-fixing. */
  actionPlan?: OperatorActionPlan | null;
};

type CutoverStatus = {
  featureFlagEnabled: boolean;
  requiredHumanApproval: boolean;
  autoApprovalEnabled?: boolean;
  defaultModel: string;
  cutoverReadyChecks: Record<string, boolean>;
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function parseYmdLocal(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map((x) => parseInt(x, 10));
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return new Date();
  return new Date(y, m - 1, d);
}

function formatYmdLocal(d: Date): string {
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${mo}-${day}`;
}

/** e.g. `2010-05-22` → `22 May 2010` (local calendar day). */
function formatHumanReviewDateLabel(raw: string): string {
  if (!raw || raw === "Unknown date") return raw;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const d = parseYmdLocal(raw);
  if (Number.isNaN(d.getTime())) return raw;
  return format(d, "d MMMM yyyy");
}

function formatPipelineRangeLabel(fromYmd: string, toYmd: string): string {
  const from = parseYmdLocal(fromYmd);
  const to = parseYmdLocal(toYmd);
  if (fromYmd === toYmd) return format(from, "MMM d, yyyy");
  return `${format(from, "MMM d, yyyy")} – ${format(to, "MMM d, yyyy")}`;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function formatWhen(ts: string | null | undefined): string {
  if (!ts) return "—";
  try {
    return new Date(ts).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return ts;
  }
}

function shortenId(id: string, keep = 8): string {
  if (id.length <= keep + 6) return id;
  return `${id.slice(0, keep)}…${id.slice(-4)}`;
}

function confidenceToPercent(conf: unknown): number | null {
  if (typeof conf === "number" && Number.isFinite(conf)) {
    if (conf >= 0 && conf <= 1) return Math.round(conf * 100);
    if (conf >= 0 && conf <= 100) return Math.round(conf);
  }
  if (typeof conf === "string") {
    const n = parseFloat(conf);
    if (!Number.isNaN(n)) {
      if (n >= 0 && n <= 1) return Math.round(n * 100);
      if (n >= 0 && n <= 100) return Math.round(n);
    }
  }
  return null;
}

function parseStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string");
}

type RouteGuide = { title: string; description: string; approve: string };

/** Short label on badges (not raw enum strings). */
function shortRouteLabel(route: string | undefined): string {
  switch (route) {
    case "existing_ok":
      return "As-is";
    case "missing_day":
      return "Gap";
    case "empty_day":
      return "Empty";
    case "existing_needs_correction":
      return "Review";
    default:
      return route ? route.replace(/_/g, " ") : "—";
  }
}

function explainTriageRoute(route: string | undefined): RouteGuide {
  switch (route) {
    case "existing_ok":
      return {
        title: "Good",
        description: "No edits queued — this day already passed checks.",
        approve: "Closes the item. Does not re-run article search.",
      };
    case "missing_day":
    case "empty_day":
      return {
        title: "Fill in",
        description: "This day is missing coverage. Confirm to run your usual search + summary on this date.",
        approve: "Runs search + summary for this date.",
      };
    case "existing_needs_correction":
      return {
        title: "Fix",
        description: "Summary may look fine but something still needs work — often tags, flags, or verification.",
        approve: "Accepts the package; watch the result message for what executed.",
      };
    default:
      return {
        title: "Check",
        description:
          route ? `Route: ${route.replace(/_/g, " ")}. Scan reasons below.` : "Review triage below.",
        approve: "Accepts. Reject leaves DB unchanged for this run.",
      };
  }
}

function routeBadgeVariant(route: string | undefined): "default" | "secondary" | "outline" | "destructive" {
  if (route === "existing_ok") return "secondary";
  if (route === "missing_day" || route === "empty_day") return "default";
  if (route === "existing_needs_correction") return "destructive";
  return "outline";
}

/** Short human headline for the review card (minimal UI). */
function humanReviewHeadline(route: string | undefined, asIs: boolean): string {
  if (asIs || route === "existing_ok") return "This day looks good.";
  switch (route) {
    case "empty_day":
      return "Day was empty.";
    case "missing_day":
      return "This day is missing.";
    case "existing_needs_correction":
      return "This day still needs correction.";
    default:
      return "This day needs your review.";
  }
}

function humanReviewSubline(route: string | undefined, asIs: boolean): string {
  if (asIs || route === "existing_ok") {
    return "No edits are queued from this run. Open the day page if you want to read or tweak it.";
  }
  switch (route) {
    case "empty_day":
    case "missing_day":
      return "Something looks wrong with the analysis — there is no clear summary or primary story to approve yet.";
    case "existing_needs_correction":
      return "Checks flagged something. See why below, or fix the day and redo the summary.";
    default:
      return "See why below, then approve or reject.";
  }
}

function parseReviewPackage(pkg: unknown): {
  note?: string;
  initialTriageRoute?: string;
  triage?: {
    date?: string;
    route?: string;
    reasons: string[];
    analysisId?: string;
    confidence?: unknown;
    agents: string[];
  };
} {
  if (!isRecord(pkg)) return { triage: { reasons: [], agents: [] } };
  const note = typeof pkg.note === "string" ? pkg.note : undefined;
  const initialTriageRoute =
    typeof pkg.initialTriageRoute === "string" ? pkg.initialTriageRoute : undefined;
  const tr = isRecord(pkg.triage) ? pkg.triage : null;
  if (!tr) return { note, initialTriageRoute, triage: { reasons: [], agents: [] } };
  return {
    note,
    initialTriageRoute,
    triage: {
      date: typeof tr.date === "string" ? tr.date : undefined,
      route: typeof tr.route === "string" ? tr.route : undefined,
      reasons: parseStringArray(tr.reasons),
      analysisId: typeof tr.analysisId === "string" ? tr.analysisId : undefined,
      confidence: tr.confidence,
      agents: parseStringArray(tr.requiredAgents),
    },
  };
}

function summarizeStepOutput(agentName: string, output: unknown): string {
  if (!isRecord(output)) return `${agentName} finished. Open technical details for raw output.`;
  if (typeof output.summary === "string") return output.summary;
  const handoff = output.handoff;
  if (isRecord(handoff) && typeof handoff.reason === "string") return handoff.reason;
  if (Array.isArray(output.findings) && output.findings.length && typeof output.findings[0] === "string") {
    return String(output.findings[0]);
  }
  return `${agentName} completed. Open technical details for raw output.`;
}

function stepFindings(output: unknown): string[] {
  if (!isRecord(output) || !Array.isArray(output.findings)) return [];
  return output.findings.filter((x): x is string => typeof x === "string").slice(0, 6);
}

function stepSuggestion(step: PipelineRunDetail["steps"][0]): { action?: string; date?: string } | null {
  const output = step.output;
  const action =
    step.suggestedAction ||
    (isRecord(output) && isRecord(output.rejection) && typeof output.rejection.suggestedAction === "string" ?
      output.rejection.suggestedAction
    : undefined);
  const evidence = isRecord(step.evidence) ? step.evidence : null;
  const date =
    evidence && typeof evidence.suggestedDate === "string" ? evidence.suggestedDate
    : evidence && typeof evidence.duplicateOfDate === "string" ? evidence.duplicateOfDate
    : undefined;
  if (!action && !date) return null;
  return { action, date };
}

type ChecklistStep = {
  id: string;
  agentName: string;
  status: string;
  stepIndex: number;
  summary?: string;
  suggestion?: { action?: string; date?: string } | null;
};

type ChecklistEntry = {
  date: string;
  route?: string;
  steps: ChecklistStep[];
};

function stepDateFromInput(step: PipelineRunDetail["steps"][0]): string | null {
  const input = isRecord(step.input) ? step.input : null;
  if (input && isRecord(input.triageItem) && typeof input.triageItem.date === "string") {
    return input.triageItem.date;
  }
  if (input && typeof input.date === "string") return input.date;
  return null;
}

function stepRouteFromInput(step: PipelineRunDetail["steps"][0]): string | undefined {
  const input = isRecord(step.input) ? step.input : null;
  if (input && isRecord(input.triageItem) && typeof input.triageItem.route === "string") {
    return input.triageItem.route;
  }
  const output = step.output;
  const summary = isRecord(output) && typeof output.summary === "string" ? output.summary : "";
  const match = summary.match(/Triage route ([a-z_]+)/i);
  return match ? match[1] : undefined;
}

function buildChecklist(detail: PipelineRunDetail): ChecklistEntry[] {
  const byDate = new Map<string, ChecklistEntry>();
  for (const step of detail.steps) {
    const date = stepDateFromInput(step);
    if (!date) continue;
    const summary = summarizeStepOutput(step.agentName, step.output);
    const suggestion = stepSuggestion(step);
    const entry = byDate.get(date) ?? { date, steps: [] };
    if (!entry.route) {
      const route = stepRouteFromInput(step);
      if (route) entry.route = route;
    }
    entry.steps.push({
      id: step.id,
      agentName: step.agentName,
      status: step.status,
      stepIndex: step.stepIndex,
      summary,
      suggestion,
    });
    byDate.set(date, entry);
  }
  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
}

function summarizeHandoffPayload(payload: unknown): { line: string; route?: string; date?: string } {
  if (!isRecord(payload)) return { line: "Handoff recorded." };
  const date = typeof payload.date === "string" ? payload.date : undefined;
  const reason = typeof payload.reason === "string" ? payload.reason : undefined;
  const status = typeof payload.status === "string" ? payload.status : undefined;
  const meta = isRecord(payload.metadata) && typeof payload.metadata.route === "string" ? payload.metadata.route : undefined;
  const parts = [reason, status].filter(Boolean);
  return {
    line: parts.length ? parts.join(" · ") : "Payload sent between agents.",
    route: meta,
    date,
  };
}

function statusBadgeClass(status: string): string {
  switch (status) {
    case "completed":
    case "approved":
      return "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
    case "running":
      return "border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300";
    case "error":
    case "rejected":
      return "border-destructive/40 bg-destructive/10 text-destructive";
    case "skipped":
      return "border-muted-foreground/30 bg-muted text-muted-foreground";
    default:
      return "border-border bg-muted/50 text-foreground";
  }
}

function pipelineRunFailureReason(run: PipelineRunDetail["run"]): string | null {
  const stats = run.stats;
  if (!isRecord(stats)) return null;
  if (typeof stats.error === "string" && stats.error.trim()) return stats.error.trim();
  return null;
}

type PipelineFeedEntry =
  | { kind: "handoff"; id: string; t: number; handoff: PipelineRunDetail["handoffs"][0] }
  | { kind: "step"; id: string; t: number; step: PipelineRunDetail["steps"][0] };

function buildPipelineFeed(detail: PipelineRunDetail, stepStatusFilter: string): PipelineFeedEntry[] {
  const steps =
    stepStatusFilter === "all" ?
      detail.steps
    : detail.steps.filter((s) => s.status === stepStatusFilter);
  const allowedStepIds = new Set(steps.map((s) => s.id));
  const includeHandoffs = stepStatusFilter === "all";

  const runStartMs = detail.run.startedAt ? new Date(detail.run.startedAt).getTime() : 0;

  const out: PipelineFeedEntry[] = [];

  if (includeHandoffs) {
    const handSorted = [...detail.handoffs].sort((a, b) => {
      const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return ta - tb;
    });
    handSorted.forEach((h, idx) => {
      const t = h.createdAt ? new Date(h.createdAt).getTime() : runStartMs + idx;
      out.push({ kind: "handoff", id: `h-${h.id}`, t, handoff: h });
    });
  }

  for (const s of detail.steps) {
    if (!allowedStepIds.has(s.id)) continue;
    const t = s.startedAt ? new Date(s.startedAt).getTime() : runStartMs + s.stepIndex * 2000;
    out.push({ kind: "step", id: `s-${s.id}`, t, step: s });
  }

  out.sort((a, b) => {
    if (a.t !== b.t) return a.t - b.t;
    if (a.kind === "step" && b.kind === "step") return a.step.stepIndex - b.step.stepIndex;
    if (a.kind === "handoff" && b.kind === "handoff") return a.handoff.id.localeCompare(b.handoff.id);
    return a.kind === "handoff" ? -1 : 1;
  });
  return out;
}

function humanizeAgent(name: string): string {
  return name.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/Agent/gi, "agent");
}

type ReviewItemCardProps = {
  item: HumanReviewItem;
  onApprove: (id: string, opts?: ApproveOpts) => void;
  onReject: (id: string) => void;
  onRedoSummary: (ymd: string) => Promise<void>;
  onRerunDate: (id: string) => Promise<void>;
};

function describeProposal(p: CorrectionProposal): {
  title: string;
  current: string;
  proposed: string;
  focusHint?: string;
} {
  switch (p.kind) {
    case "promote_v1_to_v2_tags":
      return {
        title: "Promote legacy tags to v2",
        current: p.current.length ? p.current.join(", ") : "(empty)",
        proposed: p.proposed.join(", "),
      };
    case "set_topic_categories":
      return {
        title: "Set topic categories",
        current: p.current.length ? p.current.join(", ") : "(empty)",
        proposed: p.proposed.join(", "),
      };
    case "fix_tag_conflict":
      return {
        title: "Resolve tag conflict",
        current: p.conflictingTags.join(" vs "),
        proposed: `drop: ${p.proposedDrop.join(", ")}`,
      };
    case "redo_summary":
      return {
        title: "Regenerate summary",
        current: p.currentSummary || "(empty)",
        proposed: "(new summary from winning article)",
      };
    case "clear_orphan_flag":
      return { title: "Clear orphan flag", current: "marked orphan", proposed: "cleared" };
    case "clear_manual_flag":
      return { title: "Clear manual flag", current: "marked flagged", proposed: "cleared" };
    case "drop_ungrounded_tags":
      return {
        title: "Drop ungrounded tags",
        current: p.proposedDrop.join(", "),
        proposed: `drop ${p.proposedDrop.length} tag(s) not in summary/article`,
        focusHint:
          p.suggestedFocusTags && p.suggestedFocusTags.length > 0
            ? `Story-aligned taxonomy tags already named in the text (not on this row yet): ${p.suggestedFocusTags.join(", ")}. Add them on the day page after you drop the bad tag(s), or leave as-is if you prefer.`
            : undefined,
      };
    case "merge_redundant_tags":
      return {
        title: "Merge redundant tags",
        current: p.merges.map((m) => m.from).join(", "),
        proposed: p.merges.map((m) => `${m.from} → ${m.to}`).join(", "),
      };
  }
}

function CorrectionProposalsPanel({
  item,
  onApprove,
}: {
  item: HumanReviewItem;
  onApprove: (id: string, opts?: ApproveOpts) => void;
}) {
  const proposals = item.proposals ?? [];
  const isPending = item.status === "pending";
  const [selected, setSelected] = useState<Set<string>>(() => new Set(proposals.map((p) => p.id)));

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  if (proposals.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">No automatic proposals built for this day.</p>
    );
  }

  return (
    <div className="space-y-2.5">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Suggested fixes ({proposals.length}). Toggle the ones you want to apply.
      </p>
      <ul className="space-y-2">
        {proposals.map((p) => {
          const meta = describeProposal(p);
          const isChecked = selected.has(p.id);
          return (
            <li key={p.id}>
              <button
                type="button"
                disabled={!isPending}
                onClick={() => toggle(p.id)}
                className={cn(
                  "w-full rounded-md border p-3 text-left transition-colors",
                  isChecked ? "border-primary bg-primary/5" : "border-border/70 hover:border-border hover:bg-muted/30",
                  !isPending && "cursor-not-allowed opacity-70",
                )}
              >
                <div className="flex items-start gap-3">
                  <span
                    aria-hidden
                    className={cn(
                      "mt-0.5 inline-block h-4 w-4 shrink-0 rounded border",
                      isChecked ? "border-primary bg-primary" : "border-muted-foreground/50 bg-transparent",
                    )}
                  />
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="text-sm font-medium text-foreground">{meta.title}</p>
                    <p className="text-xs text-muted-foreground">{p.rationale}</p>
                    <p className="line-clamp-2 text-xs">
                      <span className="text-muted-foreground">current: </span>
                      <span className="text-foreground/80">{meta.current}</span>
                    </p>
                    <p className="line-clamp-2 text-xs">
                      <span className="text-muted-foreground">proposed: </span>
                      <span className="text-foreground">{meta.proposed}</span>
                    </p>
                    {meta.focusHint ? (
                      <p className="text-xs leading-snug text-amber-600/90 dark:text-amber-400/90">{meta.focusHint}</p>
                    ) : null}
                  </div>
                </div>
              </button>
            </li>
          );
        })}
      </ul>
      {isPending ? (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button
            size="sm"
            disabled={selected.size === 0}
            onClick={() => onApprove(item.id, { acceptedProposalIds: Array.from(selected) })}
          >
            Apply {selected.size} proposal{selected.size === 1 ? "" : "s"}
          </Button>
          <p className="text-xs text-muted-foreground">
            Reject to dismiss the queue item without applying anything.
          </p>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Editable chip list — small inline component for tag / topic editing.
 * - Renders existing items as chips with an x-to-remove.
 * - Bottom text input accepts comma-separated entries; Enter or comma commits.
 * - All editing is local until the parent calls `onChange`.
 */
function ChipListEditor({
  values,
  onChange,
  placeholder,
  prefix,
  disabled,
}: {
  values: string[];
  onChange: (next: string[]) => void;
  placeholder: string;
  prefix?: string;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState("");
  const commit = (raw: string) => {
    const parts = raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length === 0) return;
    const next = [...values];
    const seen = new Set(next.map((v) => v.toLowerCase()));
    for (const p of parts) {
      if (!seen.has(p.toLowerCase())) {
        next.push(p);
        seen.add(p.toLowerCase());
      }
    }
    onChange(next);
    setDraft("");
  };
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-1.5 rounded-md border border-border/60 bg-background/40 p-1.5",
        disabled && "opacity-70",
      )}
    >
      {values.map((v) => (
        <span
          key={v}
          className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-muted px-2 py-0.5 text-xs font-normal"
        >
          {prefix}
          {v}
          {!disabled && (
            <button
              type="button"
              aria-label={`Remove ${v}`}
              className="text-muted-foreground hover:text-foreground"
              onClick={() => onChange(values.filter((x) => x !== v))}
            >
              ×
            </button>
          )}
        </span>
      ))}
      <input
        type="text"
        disabled={disabled}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            commit(draft);
          } else if (e.key === "Backspace" && draft === "" && values.length > 0) {
            onChange(values.slice(0, -1));
          }
        }}
        onBlur={() => {
          if (draft.trim()) commit(draft);
        }}
        placeholder={values.length === 0 ? placeholder : "add…"}
        className="flex-1 min-w-[6rem] border-0 bg-transparent text-sm outline-none placeholder:text-muted-foreground/70"
      />
    </div>
  );
}

function SummaryApprovalPanel({
  item,
  onApprove,
}: {
  item: HumanReviewItem;
  onApprove: (id: string, opts?: ApproveOpts) => void;
}) {
  const payload = item.summaryApproval;
  const isPending = item.status === "pending";

  const [summaryDraft, setSummaryDraft] = useState(payload?.generatedSummary ?? "");
  const [tagsDraft, setTagsDraft] = useState<string[]>(payload?.proposedTags ?? []);
  const [topicsDraft, setTopicsDraft] = useState<string[]>(payload?.proposedTopics ?? []);

  useEffect(() => {
    setSummaryDraft(payload?.generatedSummary ?? "");
    setTagsDraft(payload?.proposedTags ?? []);
    setTopicsDraft(payload?.proposedTopics ?? []);
  }, [payload?.generatedSummary, payload?.proposedTags, payload?.proposedTopics]);

  if (!payload) return null;

  const summaryLen = summaryDraft.trim().length;
  const tooShort = summaryLen > 0 && summaryLen < 100;
  const tooLong = summaryLen > 110;
  const empty = summaryLen === 0;
  const lengthLabel = empty
    ? "empty"
    : tooShort
      ? `${summaryLen} chars · short (target 100–110)`
      : tooLong
        ? `${summaryLen} chars · long (target 100–110)`
        : `${summaryLen} chars · in range`;
  const lengthClass = empty || tooShort || tooLong ? "text-amber-600" : "text-emerald-600";

  const summaryDirty = summaryDraft !== (payload.generatedSummary ?? "");
  const tagsDirty = arraysShallowEqual(tagsDraft, payload.proposedTags ?? []) === false;
  const topicsDirty = arraysShallowEqual(topicsDraft, payload.proposedTopics ?? []) === false;
  const anyDirty = summaryDirty || tagsDirty || topicsDirty;

  const buildOpts = (): ApproveOpts => {
    const opts: ApproveOpts = {};
    if (summaryDirty) opts.editedSummary = summaryDraft;
    if (tagsDirty) opts.editedTags = tagsDraft;
    if (topicsDirty) opts.editedTopics = topicsDraft;
    return opts;
  };

  return (
    <div className="space-y-3 rounded-md border border-border/60 bg-muted/10 p-3">
      <div className="space-y-1">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Picked article ({payload.winningArticle.tier})
        </p>
        <p className="text-sm font-medium text-foreground">
          <a
            href={payload.winningArticle.url}
            target="_blank"
            rel="noreferrer"
            className="underline-offset-4 hover:underline"
          >
            {payload.winningArticle.title}
          </a>
        </p>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Summary</p>
          <p className={cn("text-[11px]", lengthClass)}>{lengthLabel}</p>
        </div>
        <Textarea
          value={summaryDraft}
          onChange={(e) => setSummaryDraft(e.target.value)}
          rows={3}
          disabled={!isPending}
          className="text-sm leading-relaxed"
        />
      </div>

      <div className="space-y-1.5">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Tags ({tagsDraft.length})
        </p>
        <ChipListEditor
          values={tagsDraft}
          onChange={setTagsDraft}
          placeholder="Add tag — Enter or comma to commit"
          prefix="#"
          disabled={!isPending}
        />
      </div>

      <div className="space-y-1.5">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Topics ({topicsDraft.length})
        </p>
        <ChipListEditor
          values={topicsDraft}
          onChange={setTopicsDraft}
          placeholder="Add topic — Enter or comma to commit"
          disabled={!isPending}
        />
      </div>

      {isPending ? (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button size="sm" disabled={empty} onClick={() => onApprove(item.id, buildOpts())}>
            {anyDirty ? "Approve with edits" : "Approve and mark live"}
          </Button>
          <p className="text-xs text-muted-foreground">
            {anyDirty
              ? "Your edits will be written instead of the agent's proposal."
              : "Writes summary + tags + topics; clears orphan flag."}
          </p>
        </div>
      ) : null}
    </div>
  );
}

function arraysShallowEqual(a: string[] | null | undefined, b: string[] | null | undefined): boolean {
  const A = a ?? [];
  const B = b ?? [];
  if (A.length !== B.length) return false;
  for (let i = 0; i < A.length; i++) {
    if (A[i] !== B[i]) return false;
  }
  return true;
}

function CalendarDecisionPanel({
  item,
  onApprove,
}: {
  item: HumanReviewItem;
  onApprove: (id: string, opts?: ApproveOpts) => void;
}) {
  const payload = item.calendarDecision;
  const isPending = item.status === "pending";
  if (!payload) return null;
  return (
    <div className="space-y-3 rounded-md border border-amber-500/40 bg-amber-500/5 p-3">
      <p className="text-sm leading-relaxed text-foreground">
        Summary matches <span className="font-medium">{payload.ruleId}</span>; canonical date is{" "}
        <span className="font-medium">{payload.expectedDate}</span>, but this row lives on{" "}
        <span className="font-medium">{payload.currentDate}</span>.
      </p>
      <p className="text-xs text-muted-foreground">{payload.reason}</p>
      {payload.canonicalDateOccupied ? (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          Heads up: an analysis already exists on {payload.expectedDate}, so moving is disabled until the conflict is resolved.
        </p>
      ) : null}
      {isPending ? (
        <div className="flex flex-wrap gap-2 pt-1">
          <Button
            size="sm"
            disabled={payload.canonicalDateOccupied}
            onClick={() => onApprove(item.id, { calendarDecision: "move_to_canonical" })}
          >
            Move to {payload.expectedDate}
          </Button>
          <Button size="sm" variant="outline" onClick={() => onApprove(item.id, { calendarDecision: "keep_as_is" })}>
            Keep on {payload.currentDate}
          </Button>
          <Button size="sm" variant="destructive" onClick={() => onApprove(item.id, { calendarDecision: "delete" })}>
            Delete this day
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function DuplicateDecisionPanel({
  item,
  onApprove,
}: {
  item: HumanReviewItem;
  onApprove: (id: string, opts?: ApproveOpts) => void;
}) {
  const payload = item.duplicateDecision;
  const isPending = item.status === "pending";
  const [chosenNeighbor, setChosenNeighbor] = useState<string | null>(null);
  if (!payload) return null;
  return (
    <div className="space-y-3 rounded-md border border-amber-500/40 bg-amber-500/5 p-3">
      <p className="text-sm leading-relaxed text-foreground">
        This day looks like a duplicate of {payload.neighbors.length} other day(s).
      </p>
      <div className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Focal · {payload.focal.date}</p>
        <p className="text-xs text-muted-foreground">{payload.focal.summaryPreview.slice(0, 220)}</p>
      </div>
      <div className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Neighbors</p>
        <ul className="space-y-2">
          {payload.neighbors.map((n) => {
            const isSelected = chosenNeighbor === n.date;
            return (
              <li key={n.date}>
                <button
                  type="button"
                  disabled={!isPending}
                  onClick={() => setChosenNeighbor(n.date)}
                  className={cn(
                    "w-full rounded-md border p-2.5 text-left transition-colors",
                    isSelected ? "border-primary bg-primary/5" : "border-border/70 hover:border-border",
                    !isPending && "cursor-not-allowed opacity-70",
                  )}
                >
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant="outline" className="font-normal">
                      {n.date}
                    </Badge>
                    <span className="text-xs text-muted-foreground">j={n.tokenJaccard.toFixed(2)}</span>
                    {n.sharedTags.length ? (
                      <span className="text-xs text-muted-foreground">· tags {n.sharedTags.join(", ")}</span>
                    ) : null}
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{n.summaryPreview}</p>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
      {isPending ? (
        <div className="flex flex-wrap gap-2 pt-1">
          <Button size="sm" onClick={() => onApprove(item.id, { duplicateDecision: "keep_both" })}>
            Keep both
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => onApprove(item.id, { duplicateDecision: "differentiate" })}
          >
            Differentiate manually
          </Button>
          <Button
            size="sm"
            variant="destructive"
            onClick={() => onApprove(item.id, { duplicateDecision: "delete_focal" })}
          >
            Delete focal ({payload.focal.date})
          </Button>
          <Button
            size="sm"
            variant="destructive"
            disabled={!chosenNeighbor}
            onClick={() =>
              chosenNeighbor &&
              onApprove(item.id, {
                duplicateDecision: "delete_neighbor",
                duplicateNeighborDate: chosenNeighbor,
              })
            }
          >
            Delete selected neighbor
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function ArticlePickPanel({
  item,
  onApprove,
}: {
  item: HumanReviewItem;
  onApprove: (id: string, opts?: { selectedArticleId?: string }) => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const isPending = item.status === "pending";
  const candidates = item.candidates ?? [];
  const hasCandidates = candidates.length > 0;

  if (!hasCandidates) {
    return (
      <div className="rounded-md border border-dashed border-amber-500/40 bg-amber-500/5 p-3 text-sm">
        <p className="font-medium text-foreground">No candidate articles fetched from Exa.</p>
        <p className="mt-1 text-muted-foreground">
          If this day really has no significant news, reject and mark it as empty. Otherwise reject and rerun the
          pipeline; we&rsquo;ll widen the search next iteration.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Pick the winning article ({candidates.length})
        </p>
        <p className="text-xs text-muted-foreground">
          Sorted by relevance. Bitcoin/Crypto/Macro tiers from Exa.
        </p>
      </div>
      <ul className="space-y-2">
        {candidates.map((c) => {
          const isSelected = selected === c.id;
          const offsetLabel =
            c.publishedDateOffsetDays == null ?
              "No date"
            : c.publishedDateOffsetDays === 0 ?
              "Same day"
            : `${Math.abs(c.publishedDateOffsetDays)}d ${c.publishedDateOffsetDays > 0 ? "after" : "before"}`;
          const scorePct = c.relevanceScore != null ? Math.round(c.relevanceScore * 100) : null;
          return (
            <li key={c.id}>
              <button
                type="button"
                disabled={!isPending}
                onClick={() => setSelected(c.id)}
                className={cn(
                  "w-full rounded-md border p-3 text-left transition-colors",
                  isSelected ?
                    "border-primary bg-primary/5"
                  : c.recommended ?
                      "border-emerald-500/60 bg-emerald-500/5 hover:border-emerald-500/80"
                    : "border-border/70 hover:border-border hover:bg-muted/30",
                  !isPending && "cursor-not-allowed opacity-70",
                )}
              >
                <div className="flex items-start gap-3">
                  <span
                    aria-hidden
                    className={cn(
                      "mt-1 inline-block h-3.5 w-3.5 shrink-0 rounded-full border",
                      isSelected ? "border-primary bg-primary" : "border-muted-foreground/50 bg-transparent",
                    )}
                  />
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {c.recommended ? (
                        <Badge className="border-emerald-500/60 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
                          Recommended
                        </Badge>
                      ) : null}
                      <Badge variant="outline" className="font-normal capitalize">
                        {c.tier}
                      </Badge>
                      {scorePct != null ? (
                        <span className="text-xs font-medium text-muted-foreground">{scorePct}%</span>
                      ) : null}
                      {c.source ? (
                        <span className="text-xs text-muted-foreground">{c.source}</span>
                      ) : null}
                      <span className="text-xs text-muted-foreground">· {offsetLabel}</span>
                      {!c.calendarSanityOk ? (
                        <Badge variant="outline" className="border-amber-500/60 text-amber-600">
                          Calendar warning
                        </Badge>
                      ) : null}
                    </div>
                    <p className="text-sm font-medium leading-snug text-foreground">{c.title}</p>
                    {c.summary?.trim() ? (
                      <p className="line-clamp-2 text-xs text-muted-foreground">{c.summary.trim()}</p>
                    ) : null}
                    {c.calendarSanityNotes.length ? (
                      <ul className="mt-1 space-y-0.5 text-[11px] text-amber-700 dark:text-amber-400">
                        {c.calendarSanityNotes.map((note, i) => (
                          <li key={i}>· {note}</li>
                        ))}
                      </ul>
                    ) : null}
                    {c.relevanceNotes?.length ? (
                      <p className="text-[11px] text-muted-foreground">
                        Why: {c.relevanceNotes.slice(0, 4).join(" · ")}
                      </p>
                    ) : null}
                    <a
                      href={c.url}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="inline-block text-[11px] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                    >
                      {c.url}
                    </a>
                  </div>
                </div>
              </button>
            </li>
          );
        })}
      </ul>
      {isPending ? (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button size="sm" disabled={!selected} onClick={() => selected && onApprove(item.id, { selectedArticleId: selected })}>
            Approve picked article
          </Button>
          <p className="text-xs text-muted-foreground">
            {selected ? "Summary, tags, and topics will be generated for this article on approval." : "Choose an article to enable approval."}
          </p>
        </div>
      ) : null}
    </div>
  );
}

function HumanReviewItemCard({ item, onApprove, onReject, onRedoSummary, onRerunDate }: ReviewItemCardProps) {
  const [rawOpen, setRawOpen] = useState(false);
  const [redoBusy, setRedoBusy] = useState(false);
  const [rerunBusy, setRerunBusy] = useState(false);
  const parsed = parseReviewPackage(item.package);
  const tri = parsed.triage;
  const route = tri?.route;
  const dateRaw = item.eventDate ?? tri?.date ?? "Unknown date";
  const dateLabel = formatHumanReviewDateLabel(dateRaw);
  const dayHref = /^\d{4}-\d{2}-\d{2}$/.test(dateRaw) ? `/day/${dateRaw}` : null;
  const asIs = route === "existing_ok";
  const showReasons = Boolean(tri?.reasons.length) && !asIs;
  const isPending = item.status === "pending";
  const isAutoApproved = item.status === "approved" && item.reviewer === "auto";
  const hasJoinedAnalysis = item.dayTags !== null;

  const phase = item.reviewPhase;
  const isArticlePickPhase = phase === "awaiting_article_pick";
  const isCorrectionPhase = phase === "awaiting_correction_approval";
  const isSummaryApprovalPhase = phase === "awaiting_summary_approval";
  const isCalendarPhase = phase === "awaiting_calendar_decision";
  const isDuplicatePhase = phase === "awaiting_duplicate_decision";
  const hasV3Phase =
    isArticlePickPhase || isCorrectionPhase || isSummaryApprovalPhase || isCalendarPhase || isDuplicatePhase;

  const plan = item.actionPlan ?? null;
  const planApproveEnabled = !plan || plan.approveEnabled;

  const phaseHeadline = isArticlePickPhase
    ? "Pick the winning article"
    : isCorrectionPhase
      ? "Review suggested fixes"
      : isSummaryApprovalPhase
        ? "Approve the generated summary"
        : isCalendarPhase
          ? "Calendar mismatch — pick what to do"
          : isDuplicatePhase
            ? "Possible duplicate — pick what to do"
            : null;
  const phaseSubline = isArticlePickPhase
    ? "We fetched Exa candidates for this day but didn't write any summary yet — that comes after your pick."
    : isCorrectionPhase
      ? "Each fix is opt-in. Apply the ones you want; rejecting dismisses the queue item without writing anything."
      : isSummaryApprovalPhase
        ? "The summary was generated from the article you picked. Approve marks the day live."
        : isCalendarPhase
          ? "Triage thinks this day's story belongs on a different date. Pick what should happen."
          : isDuplicatePhase
            ? "Triage flagged this day as too similar to others. Decide which one wins."
            : null;

  const headline = phaseHeadline ?? plan?.headline ?? humanReviewHeadline(route, asIs);
  const subline = phaseSubline ?? humanReviewSubline(route, asIs);

  const showCurrentState =
    !isArticlePickPhase &&
    !isSummaryApprovalPhase &&
    !isCalendarPhase &&
    !isDuplicatePhase &&
    hasJoinedAnalysis &&
    (route === "existing_needs_correction" || route === "existing_ok");
  const summaryPreview = (item.daySummary ?? "").trim();
  const tagsPreview = (item.dayTags ?? []).slice(0, 8);
  const tagsOverflow = Math.max(0, (item.dayTags ?? []).length - tagsPreview.length);
  const topicPreview = (item.dayTopicCategories ?? []).slice(0, 6);

  const redoSummaryAllowed = item.dayRedoSummaryAvailable === true;

  const technicalBlob = useMemo(() => {
    const p = parseReviewPackage(item.package);
    const r = p.triage?.route;
    const g = explainTriageRoute(r);
    const initial = p.initialTriageRoute;
    const retriageNote =
      initial && initial !== r ?
        `Started as ${shortRouteLabel(initial)}; after agents: ${shortRouteLabel(r)}.`
      : null;
    return {
      triagePackage: item.package ?? {},
      joinedFromAnalysisRow: {
        daySummary: item.daySummary ?? null,
        dayTopArticle: item.dayTopArticle ?? null,
        dayTags: item.dayTags ?? null,
        dayTopicCategories: item.dayTopicCategories ?? null,
        dayTotalArticlesFetched: item.dayTotalArticlesFetched ?? null,
        dayTierUsed: item.dayTierUsed ?? null,
        dayWinningTier: item.dayWinningTier ?? null,
        daySourceArticles: item.daySourceArticles ?? null,
        dayRedoSummaryAvailable: item.dayRedoSummaryAvailable ?? null,
      },
      queueRow: {
        id: item.id,
        runId: item.runId,
        stepId: item.stepId,
        priority: item.priority,
        status: item.status,
        eventDate: item.eventDate,
        createdAt: item.createdAt,
        reviewer: item.reviewer,
        reviewNotes: item.reviewNotes,
        reviewedAt: item.reviewedAt,
      },
      operatorNotes: {
        whatApproveDoes: g.approve,
        triageRoute: r,
        triageRouteTitle: g.title,
        retriageNote,
        confidence: p.triage?.confidence,
        agentsRun: p.triage?.agents ?? [],
      },
    };
  }, [item]);

  const showRedo = isPending && !asIs && Boolean(dayHref);
  const redoEnabled = showRedo && redoSummaryAllowed;

  const redoSummaryTitle = !hasJoinedAnalysis
    ? "No saved analysis row for this calendar date yet."
    : item.dayRedoSummaryAvailable === false ?
      "Redo summary needs a winning article in the database. Open the day page and select one first."
    : redoSummaryAllowed ?
      "Regenerate summary from the selected winning article"
    : "Summary redo availability unknown — see technical details.";

  return (
    <div className="rounded-xl border border-border/80 bg-card text-card-foreground shadow-sm">
      <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
        <div className="min-w-0 flex-1 space-y-4">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3
                className="text-xl font-semibold tracking-tight text-foreground"
                title={dateRaw !== "Unknown date" ? dateRaw : undefined}
              >
                {dateLabel}
              </h3>
              <div className="flex flex-wrap items-center gap-2">
                {isPending ? (
                  <Badge variant="outline" className="font-normal capitalize">
                    Pending
                  </Badge>
                ) : null}
                {isAutoApproved ? (
                  <Badge variant="secondary" className="font-normal">
                    Auto-approved
                  </Badge>
                ) : null}
                {!isPending && item.status ? (
                  <Badge variant="outline" className="font-normal capitalize">
                    {item.status}
                  </Badge>
                ) : null}
              </div>
            </div>
            <p className="text-[15px] leading-snug text-foreground">{headline}</p>
            <p className="text-sm leading-relaxed text-muted-foreground">{subline}</p>
          </div>

          {showCurrentState ? (
            <div className="space-y-2 rounded-md border border-border/60 bg-muted/20 p-3">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Current state of this day</p>
              {item.dayTopArticle?.url ? (
                <p className="text-sm leading-snug text-foreground">
                  <span className="text-xs uppercase tracking-wide text-muted-foreground">Top article · </span>
                  <a
                    href={item.dayTopArticle.url}
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium underline-offset-4 hover:underline"
                  >
                    {item.dayTopArticle.title}
                  </a>
                </p>
              ) : (
                <p className="text-sm leading-snug text-amber-700 dark:text-amber-400">
                  <span className="text-xs uppercase tracking-wide text-muted-foreground">Top article · </span>
                  none selected
                </p>
              )}
              {summaryPreview ? (
                <p className="line-clamp-3 text-sm leading-relaxed text-foreground/90">{summaryPreview}</p>
              ) : (
                <p className="text-sm italic text-muted-foreground">No summary saved for this day.</p>
              )}
              {(tagsPreview.length > 0 || topicPreview.length > 0) ? (
                <div className="flex flex-wrap items-center gap-1.5">
                  {topicPreview.map((t) => (
                    <Badge key={`topic-${t}`} variant="secondary" className="font-normal">
                      {t}
                    </Badge>
                  ))}
                  {tagsPreview.map((t) => (
                    <Badge key={`tag-${t}`} variant="outline" className="font-normal">
                      #{t}
                    </Badge>
                  ))}
                  {tagsOverflow > 0 ? (
                    <span className="text-xs text-muted-foreground">+{tagsOverflow} more</span>
                  ) : null}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">No tags or topic categories on this day yet.</p>
              )}
            </div>
          ) : null}

          {isArticlePickPhase ? (
            <ArticlePickPanel item={item} onApprove={onApprove} />
          ) : null}
          {isCorrectionPhase ? (
            <CorrectionProposalsPanel item={item} onApprove={onApprove} />
          ) : null}
          {isSummaryApprovalPhase ? (
            <SummaryApprovalPanel item={item} onApprove={onApprove} />
          ) : null}
          {isCalendarPhase ? (
            <CalendarDecisionPanel item={item} onApprove={onApprove} />
          ) : null}
          {isDuplicatePhase ? (
            <DuplicateDecisionPanel item={item} onApprove={onApprove} />
          ) : null}

          {!asIs && !hasV3Phase && plan && plan.reasonEntries.length > 0 ? (
            <div className="space-y-1.5">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">What triage flagged</p>
              <ul className="list-inside list-disc space-y-1 text-sm text-foreground/90">
                {plan.reasonEntries.map((r, i) => (
                  <li key={i}>{r.message}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {!hasV3Phase && plan && plan.manualFixes.length > 0 ? (
            <div className="space-y-1.5 rounded-md border border-amber-500/40 bg-amber-500/5 p-3">
              <p className="text-xs font-medium uppercase tracking-wide text-amber-700 dark:text-amber-400">
                Needs your hands first
              </p>
              <ul className="space-y-1 text-sm text-foreground/90">
                {plan.manualFixes.map((m, i) => (
                  <li key={i}>
                    <span className="font-medium">{m.label}.</span>{" "}
                    <span className="text-muted-foreground">{m.suggestion}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {!hasV3Phase && plan && isPending ? (
            <div className="rounded-md border border-border/60 bg-background/40 p-3">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">If you click Approve</p>
              <p className="mt-1 text-sm text-foreground/90">{plan.approveSummary}</p>
            </div>
          ) : null}

          {!asIs && !hasV3Phase && !hasJoinedAnalysis && isPending ? (
            <p className="text-sm text-muted-foreground">
              There is no saved analysis row for this calendar date yet. Use Open day or technical details after data
              exists.
            </p>
          ) : null}

          {!hasV3Phase && showRedo && hasJoinedAnalysis && item.dayRedoSummaryAvailable === false ? (
            <p className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">Redo summary</span> is not available yet: the API needs a{" "}
              <span className="font-medium text-foreground">winning article</span> on this day. Open the day page, pick
              the correct article, then try again.
            </p>
          ) : null}

          {dayHref && !hasV3Phase ? (
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-border/50 pt-3">
              {showRedo ? (
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                  disabled={!redoEnabled || redoBusy}
                  title={redoSummaryTitle}
                  aria-disabled={!redoEnabled || redoBusy}
                  onClick={async () => {
                    if (!redoEnabled) return;
                    setRedoBusy(true);
                    try {
                      await onRedoSummary(dateRaw);
                    } catch {
                      // Parent already toasts on failure
                    } finally {
                      setRedoBusy(false);
                    }
                  }}
                >
                  <RotateCw className={cn("h-3.5 w-3.5 shrink-0", redoBusy && "animate-spin")} aria-hidden />
                  {redoBusy ? "Redoing…" : "Redo summary"}
                </button>
              ) : null}
              <Link
                href={dayHref}
                className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
              >
                Open day
              </Link>
            </div>
          ) : null}

          {!isPending ? (
            <p className="text-xs text-muted-foreground">
              Reviewed by {item.reviewer ?? "system"} · {formatWhen(item.reviewedAt)}
            </p>
          ) : null}
        </div>

        {isPending ? (
          <div className="flex shrink-0 flex-row gap-2 sm:flex-col">
            {hasV3Phase ? null : (
              <Button
                size="sm"
                className="min-w-[7rem]"
                disabled={!planApproveEnabled}
                title={
                  planApproveEnabled
                    ? plan?.approveSummary
                    : "Approve is disabled until the manual fixes above are resolved."
                }
                onClick={() => onApprove(item.id)}
              >
                Approve
              </Button>
            )}
            <Button size="sm" variant="outline" className="min-w-[7rem]" onClick={() => onReject(item.id)}>
              Reject
            </Button>
            {/^\d{4}-\d{2}-\d{2}$/.test(dateRaw) ? (
              <Button
                size="sm"
                variant="ghost"
                className="min-w-[7rem]"
                disabled={rerunBusy}
                title={`Start a fresh pipeline run for ${dateRaw}. Useful after delete or when no candidate fits.`}
                onClick={async () => {
                  setRerunBusy(true);
                  try {
                    await onRerunDate(item.id);
                  } finally {
                    setRerunBusy(false);
                  }
                }}
              >
                {rerunBusy ? "Rerunning…" : "Rerun date"}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      <Separator />

      <Collapsible open={rawOpen} onOpenChange={setRawOpen}>
        <CollapsibleTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-between rounded-none px-5 py-3 text-xs text-muted-foreground hover:text-foreground"
          >
            <span>Technical details</span>
            <ChevronDown className={cn("h-4 w-4 transition-transform", rawOpen && "rotate-180")} />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <pre className="max-h-72 overflow-auto border-t border-border/80 bg-muted/20 p-4 font-mono text-[11px] leading-relaxed text-muted-foreground">
            {JSON.stringify(technicalBlob, null, 2)}
          </pre>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

type PipelineStepPanelProps = { step: PipelineRunDetail["steps"][0] };

function PipelineStepPanel({ step }: PipelineStepPanelProps) {
  const [open, setOpen] = useState(false);
  const summary = summarizeStepOutput(step.agentName, step.output);
  const findings = stepFindings(step.output);
  const suggestion = stepSuggestion(step);
  const pct = step.confidence != null && step.confidence !== "" ? confidenceToPercent(step.confidence) : null;

  return (
    <div className="overflow-hidden rounded-lg border border-border/70 bg-background/50">
      <Collapsible open={open} onOpenChange={setOpen}>
      <div className="flex flex-wrap items-start justify-between gap-3 p-4">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">Step {step.stepIndex}</span>
            <span className="font-medium text-foreground">{step.agentName}</span>
            <span
              className={cn(
                "rounded-md border px-2 py-0.5 text-[11px] font-medium capitalize",
                statusBadgeClass(step.status),
              )}
            >
              {step.status}
            </span>
          </div>
          <p className="text-sm leading-relaxed text-muted-foreground">{summary}</p>
          {findings.length ? (
            <ul className="mt-2 list-inside list-disc space-y-0.5 text-xs text-muted-foreground">
              {findings.map((f, i) => (
                <li key={i}>{f}</li>
              ))}
            </ul>
          ) : null}
          {step.rejectionReason ? (
            <p className="mt-2 text-xs text-destructive">{step.rejectionReason}</p>
          ) : null}
          {suggestion ? (
            <p className="mt-2 text-xs text-muted-foreground">
              Suggestion: {suggestion.action ?? "review"} {suggestion.date ? `→ ${suggestion.date}` : ""}
            </p>
          ) : null}
          {pct !== null ? (
            <div className="mt-3 max-w-xs space-y-1">
              <div className="flex justify-between text-[11px] text-muted-foreground">
                <span>Confidence</span>
                <span className="tabular-nums">{pct}%</span>
              </div>
              <Progress value={pct} className="h-1" />
            </div>
          ) : null}
        </div>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm" className="h-8 shrink-0 text-xs text-muted-foreground hover:text-foreground">
            Raw
            <ChevronDown className={cn("ml-1 h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
          </Button>
        </CollapsibleTrigger>
      </div>
      <CollapsibleContent>
        <div className="border-t border-border/60 px-4 pb-4">
          <pre className="max-h-56 overflow-auto rounded-md bg-muted/30 p-3 font-mono text-[11px] leading-relaxed text-muted-foreground">
            {JSON.stringify(step.output ?? {}, null, 2)}
          </pre>
        </div>
      </CollapsibleContent>
    </Collapsible>
    </div>
  );
}

type HandoffRowProps = { payload: unknown; label: string; hideLabel?: boolean };

function HandoffRow({ payload, label, hideLabel }: HandoffRowProps) {
  const [open, setOpen] = useState(false);
  const { line, route, date } = summarizeHandoffPayload(payload);

  return (
    <div className="overflow-hidden rounded-lg border border-dashed border-border/80">
      <Collapsible open={open} onOpenChange={setOpen}>
      <div className="flex flex-wrap items-start justify-between gap-2 p-3">
        <div className="min-w-0 flex-1">
          {hideLabel ? null : (
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
          )}
          <p className={cn("text-sm text-foreground", !hideLabel && "mt-1")}>{line}</p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {date ? (
              <Badge variant="outline" className="text-[10px] font-normal">
                {date}
              </Badge>
            ) : null}
            {route ? (
              <Badge variant="secondary" className="text-[10px] font-normal">
                {route}
              </Badge>
            ) : null}
          </div>
        </div>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm" className="h-8 shrink-0 text-xs text-muted-foreground hover:text-foreground">
            JSON
            <ChevronDown className={cn("ml-1 h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
          </Button>
        </CollapsibleTrigger>
      </div>
      <CollapsibleContent>
        <div className="border-t border-border/60 px-3 pb-3">
          <pre className="max-h-40 overflow-auto rounded-md bg-muted/30 p-2 font-mono text-[10px] leading-relaxed text-muted-foreground">
            {JSON.stringify(payload ?? {}, null, 2)}
          </pre>
        </div>
      </CollapsibleContent>
    </Collapsible>
    </div>
  );
}

type PipelineActivityFeedProps = {
  detail: PipelineRunDetail;
  stepStatusFilter: string;
};

function PipelineActivityFeed({ detail, stepStatusFilter }: PipelineActivityFeedProps) {
  const entries = useMemo(() => buildPipelineFeed(detail, stepStatusFilter), [detail, stepStatusFilter]);

  if (!entries.length) {
    return <p className="text-sm text-muted-foreground">Nothing to show for this filter yet.</p>;
  }

  return (
    <ScrollArea className="max-h-[min(520px,62vh)] pr-3">
      <div className="space-y-4">
        {entries.map((e) =>
          e.kind === "handoff" ? (
            <div key={e.id} className="flex gap-3">
              <div
                className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-dashed border-border/60 bg-muted/30 text-xs text-muted-foreground"
                aria-hidden
              >
                ↳
              </div>
              <div className="min-w-0 flex-1 space-y-1">
                <p className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground/90">{humanizeAgent(e.handoff.fromAgent)}</span>
                  {" → "}
                  <span className="font-medium text-foreground/90">{humanizeAgent(e.handoff.toAgent)}</span>
                  <span className="text-muted-foreground"> · routing</span>
                </p>
                <HandoffRow payload={e.handoff.payload} label={e.handoff.status} hideLabel />
              </div>
            </div>
          ) : (
            <div key={e.id} className="flex gap-3">
              <div className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/12 text-primary">
                <Bot className="h-4 w-4" aria-hidden />
              </div>
              <div className="min-w-0 flex-1">
                <PipelineStepPanel step={e.step} />
              </div>
            </div>
          ),
        )}
      </div>
    </ScrollArea>
  );
}

type PipelineChecklistViewProps = {
  detail: PipelineRunDetail;
  showDetails: boolean;
};

function ChecklistStatusIcon({ status }: { status: string }) {
  if (status === "completed" || status === "approved") return <CheckCircle2 className="h-4 w-4 text-emerald-500" aria-hidden />;
  if (status === "rejected" || status === "error") return <XCircle className="h-4 w-4 text-destructive" aria-hidden />;
  if (status === "skipped") return <MinusCircle className="h-4 w-4 text-muted-foreground" aria-hidden />;
  return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden />;
}

function PipelineChecklistView({ detail, showDetails }: PipelineChecklistViewProps) {
  const entries = useMemo(() => buildChecklist(detail), [detail]);
  if (!entries.length) {
    return <p className="text-sm text-muted-foreground">No checklist items yet.</p>;
  }
  return (
    <ScrollArea className="max-h-[min(520px,62vh)] pr-3">
      <div className="space-y-4">
        {entries.map((entry) => (
          <div key={entry.date} className="rounded-lg border border-border/70 bg-background/60 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-foreground">{entry.date}</span>
                {entry.route ? (
                  <Badge variant={routeBadgeVariant(entry.route)} className="font-normal">
                    {shortRouteLabel(entry.route)}
                  </Badge>
                ) : null}
              </div>
            </div>
            <div className="mt-3 space-y-2">
              {entry.steps.map((step) => (
                <div key={step.id} className="flex items-start gap-3">
                  <ChecklistStatusIcon status={step.status} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs text-muted-foreground">Step {step.stepIndex}</span>
                      <span className="text-sm font-medium text-foreground">{step.agentName}</span>
                      <span className={cn("rounded-md border px-2 py-0.5 text-[11px] font-medium capitalize", statusBadgeClass(step.status))}>
                        {step.status}
                      </span>
                    </div>
                    {showDetails ? (
                      <p className="mt-1 text-xs text-muted-foreground">{step.summary}</p>
                    ) : null}
                    {step.suggestion ? (
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        Suggestion: {step.suggestion.action ?? "review"}{" "}
                        {step.suggestion.date ? `→ ${step.suggestion.date}` : ""}
                      </p>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}

export default function AdminAgentsPage() {
  const { toast } = useToast();
  const [dateFrom, setDateFrom] = useState("2010-01-01");
  const [dateTo, setDateTo] = useState(todayIso);
  const [pipelineDateMode, setPipelineDateMode] = useState<"single" | "range">("range");
  const [pipelineRangeOpen, setPipelineRangeOpen] = useState(false);
  const [pipelineBusy, setPipelineBusy] = useState(false);
  const [pipelineRunId, setPipelineRunId] = useState<string | null>(null);
  const [pipelineDetail, setPipelineDetail] = useState<PipelineRunDetail | null>(null);
  const [pipelineMaxDays, setPipelineMaxDays] = useState("60");
  const [reviewItems, setReviewItems] = useState<HumanReviewItem[]>([]);
  const [reviewStatus, setReviewStatus] = useState<"pending" | "approved" | "rejected">("pending");
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewRefreshCountdown, setReviewRefreshCountdown] = useState<number | null>(null);
  const [pipelineFilterStatus, setPipelineFilterStatus] = useState<string>("all");
  const [pipelineViewMode, setPipelineViewMode] = useState<"checklist" | "activity">("checklist");
  const [showChecklistDetails, setShowChecklistDetails] = useState(false);
  const [cutoverStatus, setCutoverStatus] = useState<CutoverStatus | null>(null);
  const [shadowValidation, setShadowValidation] = useState<Record<string, unknown> | null>(null);
  const [shadowOpen, setShadowOpen] = useState(false);
  const [activePane, setActivePane] = useState<"overview" | "pipeline" | "review">("overview");
  const [showSystemGraph, setShowSystemGraph] = useState(false);

  const loadPipelineRun = async (runId: string, opts?: { quiet?: boolean }) => {
    try {
      const res = await fetch(`/api/agent/pipeline/runs/${runId}`, { headers: jsonHeaders });
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as PipelineRunDetail;
      setPipelineDetail(data);
      if (data.run.status !== "running") {
        await loadReviewQueue({ quiet: opts?.quiet });
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

  const loadReviewQueue = async (opts?: { quiet?: boolean; status?: "pending" | "approved" | "rejected" }) => {
    const status = opts?.status ?? reviewStatus;
    if (!opts?.quiet) setReviewLoading(true);
    try {
      const res = await fetch(`/api/agent/pipeline/review?status=${status}&limit=200`, { headers: jsonHeaders });
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
      if (!opts?.quiet) setReviewLoading(false);
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
          maxDaysToConsider: pipelineDateMode === "single" ? 1 : Math.max(1, Math.min(Number(pipelineMaxDays) || 60, 365)),
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

  const approveReviewItem = async (id: string, opts?: ApproveOpts) => {
    try {
      const body: Record<string, unknown> = { reviewer: "admin-ui" };
      if (opts?.selectedArticleId) body.selectedArticleId = opts.selectedArticleId;
      if (opts?.acceptedProposalIds) body.acceptedProposalIds = opts.acceptedProposalIds;
      if (opts?.calendarDecision) body.calendarDecision = opts.calendarDecision;
      if (opts?.duplicateDecision) body.duplicateDecision = opts.duplicateDecision;
      if (opts?.duplicateNeighborDate) body.duplicateNeighborDate = opts.duplicateNeighborDate;
      if (opts?.editedSummary !== undefined) body.editedSummary = opts.editedSummary;
      if (opts?.editedTags !== undefined) body.editedTags = opts.editedTags;
      if (opts?.editedTopics !== undefined) body.editedTopics = opts.editedTopics;
      const res = await fetch(`/api/agent/pipeline/review/${id}/approve`, {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json().catch(() => null);
      const title = opts?.selectedArticleId
        ? "Article picked, summary generating"
        : opts?.calendarDecision
          ? "Calendar decision applied"
          : opts?.duplicateDecision
            ? "Duplicate decision applied"
            : opts?.acceptedProposalIds
              ? `Applied ${opts.acceptedProposalIds.length} proposal(s)`
              : "Review item approved";
      toast({
        title,
        description: data?.execution?.message ?? undefined,
      });
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

  const rerunReviewItemDate = async (id: string) => {
    try {
      const res = await fetch(`/api/agent/pipeline/review/${id}/rerun-date`, {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ reviewer: "admin-ui" }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json().catch(() => null);
      toast({
        title: "Rerun started",
        description: data?.message ?? `New pipeline run for ${data?.date ?? "this date"}.`,
      });
      await loadReviewQueue();
    } catch (e) {
      toast({
        title: "Rerun date failed",
        description: e instanceof Error ? e.message : "Error",
        variant: "destructive",
      });
    }
  };

  const redoSummaryFromReview = async (ymd: string) => {
    try {
      const res = await fetch(`/api/analysis/date/${ymd}/redo-summary`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
      });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(t || res.statusText);
      }
      toast({
        title: "Summary redo",
        description: `Regeneration requested for ${ymd}. Refresh the list in a moment if it still looks stale.`,
      });
      await loadReviewQueue({ quiet: true });
    } catch (e) {
      toast({
        title: "Redo summary failed",
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
          maxDaysToConsider: pipelineDateMode === "single" ? 1 : Math.max(1, Math.min(Number(pipelineMaxDays) || 60, 365)),
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      setShadowValidation((await res.json()) as Record<string, unknown>);
      setShadowOpen(true);
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
    void loadReviewQueue({ quiet: true, status: reviewStatus });
    void loadCutoverStatus();
  }, []);

  useEffect(() => {
    void loadReviewQueue({ status: reviewStatus });
  }, [reviewStatus]);

  useEffect(() => {
    if (!pipelineRunId) return;
    void loadPipelineRun(pipelineRunId);
    void loadReviewQueue({ quiet: true, status: reviewStatus });
    const t = window.setInterval(() => {
      void loadPipelineRun(pipelineRunId, { quiet: true });
      void loadReviewQueue({ quiet: true, status: reviewStatus });
    }, 2500);
    return () => window.clearInterval(t);
  }, [pipelineRunId, reviewStatus]);

  const REVIEW_MANUAL_REFRESH_TICKS = 3;

  useEffect(() => {
    if (reviewRefreshCountdown === null) return;
    const id = window.setTimeout(() => {
      setReviewRefreshCountdown((n) => {
        if (n === null || n <= 1) {
          if (n === 1) void loadReviewQueue({ status: reviewStatus });
          return null;
        }
        return n - 1;
      });
    }, 1000);
    return () => window.clearTimeout(id);
  }, [reviewRefreshCountdown]);

  const filteredSteps = pipelineDetail?.steps.filter((s) =>
    pipelineFilterStatus === "all" ? true : s.status === pipelineFilterStatus,
  );

  const routeCounts = pipelineDetail?.run.stats?.routeCounts;
  const routeCountEntries = routeCounts ? Object.entries(routeCounts) : [];
  const pendingReviewCount =
    typeof pipelineDetail?.run.stats?.humanReviewQueued === "number" ?
      pipelineDetail.run.stats.humanReviewQueued
    : reviewStatus === "pending" ? reviewItems.length
    : 0;

  return (
    <div className="space-y-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-foreground">Admin agents</h1>
          </div>
          <Button type="button" variant="outline" size="sm" className="shrink-0" onClick={() => setShowSystemGraph(true)}>
            <Sparkles className="mr-2 h-4 w-4" />
            How it works
          </Button>
        </div>

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-[220px_1fr]">
          <Card className="h-fit border-border/80 shadow-none">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium">Views</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5 pt-0">
              <Button
                variant={activePane === "overview" ? "secondary" : "ghost"}
                className="w-full justify-start font-normal"
                onClick={() => setActivePane("overview")}
              >
                <Bot className="mr-2 h-4 w-4 opacity-70" />
                Overview
              </Button>
              <Button
                variant={activePane === "pipeline" ? "secondary" : "ghost"}
                className="w-full justify-start font-normal"
                onClick={() => setActivePane("pipeline")}
              >
                <Workflow className="mr-2 h-4 w-4 opacity-70" />
                Pipeline
              </Button>
              <Button
                variant={activePane === "review" ? "secondary" : "ghost"}
                className="w-full justify-start font-normal"
                onClick={() => setActivePane("review")}
              >
                <CheckCircle2 className="mr-2 h-4 w-4 opacity-70" />
                Human review
                {reviewStatus === "pending" && reviewItems.length > 0 ? (
                  <Badge variant="outline" className="ml-auto font-normal">
                    {reviewItems.length}
                  </Badge>
                ) : null}
              </Button>
            </CardContent>
          </Card>

          <div className="min-w-0 space-y-8">
            {activePane === "overview" ? (
              <Card className="border-border/80 shadow-none">
                <CardHeader>
                  <CardTitle className="text-lg font-semibold">Overview</CardTitle>
                  <CardDescription>At-a-glance status for the operator console</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-4 sm:grid-cols-3">
                  <div className="rounded-lg border border-border/60 bg-muted/20 p-4">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Pending review</p>
                    <p className="mt-2 text-3xl font-semibold tabular-nums tracking-tight">{pendingReviewCount}</p>
                  </div>
                  <div className="rounded-lg border border-border/60 bg-muted/20 p-4">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Active run</p>
                    <p className="mt-2 break-all font-mono text-xs text-foreground">{pipelineRunId ?? "—"}</p>
                  </div>
                  <div className="rounded-lg border border-border/60 bg-muted/20 p-4">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Default model</p>
                    <p className="mt-2 text-sm font-medium text-foreground">{cutoverStatus?.defaultModel ?? "…"}</p>
                  </div>
                </CardContent>
              </Card>
            ) : null}

            {activePane === "pipeline" ? (
              <Card className="border-border/80 shadow-none">
                <CardHeader>
                  <CardTitle className="text-lg font-semibold">Editorial pipeline</CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="max-w-3xl space-y-4">
                    <ToggleGroup
                      type="single"
                      value={pipelineDateMode}
                      onValueChange={(v) => {
                        if (!v) return;
                        if (v === "single") {
                          setPipelineDateMode("single");
                          setDateTo(dateFrom);
                        } else if (v === "range") {
                          setPipelineDateMode("range");
                          if (dateFrom > dateTo) setDateTo(todayIso());
                        }
                      }}
                      variant="outline"
                      size="sm"
                      className="justify-start"
                    >
                      <ToggleGroupItem value="single" className="px-3">
                        One day
                      </ToggleGroupItem>
                      <ToggleGroupItem value="range" className="px-3">
                        Range
                      </ToggleGroupItem>
                    </ToggleGroup>

                    <div
                      className={cn(
                        "grid grid-cols-1 gap-4",
                        pipelineDateMode === "range" && "sm:grid-cols-2",
                        pipelineDateMode === "single" && "sm:max-w-xs",
                      )}
                    >
                      {pipelineDateMode === "single" ? (
                        <div className="space-y-2">
                          <Label htmlFor="pipeline-single-day" className="text-xs text-muted-foreground">
                            Day
                          </Label>
                          <Input
                            id="pipeline-single-day"
                            type="date"
                            value={dateFrom}
                            onChange={(e) => {
                              const d = e.target.value;
                              setDateFrom(d);
                              setDateTo(d);
                            }}
                          />
                        </div>
                      ) : (
                        <>
                          <div className="space-y-2">
                            <Label className="text-xs text-muted-foreground">Date range</Label>
                            <Popover open={pipelineRangeOpen} onOpenChange={setPipelineRangeOpen}>
                              <PopoverTrigger asChild>
                                <Button
                                  type="button"
                                  id="pipeline-date-range"
                                  variant="outline"
                                  className="h-10 w-full justify-start text-left font-normal sm:min-w-[280px]"
                                >
                                  <CalendarDays className="mr-2 h-4 w-4 shrink-0 opacity-70" />
                                  <span className="truncate">{formatPipelineRangeLabel(dateFrom, dateTo)}</span>
                                </Button>
                              </PopoverTrigger>
                              <PopoverContent className="w-auto p-0" align="start">
                                <Calendar
                                  mode="range"
                                  numberOfMonths={2}
                                  defaultMonth={parseYmdLocal(dateFrom)}
                                  selected={{
                                    from: parseYmdLocal(dateFrom),
                                    to: parseYmdLocal(dateTo),
                                  }}
                                  onSelect={(range: DateRange | undefined) => {
                                    if (!range?.from) return;
                                    setDateFrom(formatYmdLocal(range.from));
                                    setDateTo(range.to ? formatYmdLocal(range.to) : formatYmdLocal(range.from));
                                    if (range.from && range.to) setPipelineRangeOpen(false);
                                  }}
                                  initialFocus
                                />
                              </PopoverContent>
                            </Popover>
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="pipeline-max-days" className="text-xs text-muted-foreground">
                              Max days to consider
                            </Label>
                            <Input id="pipeline-max-days" value={pipelineMaxDays} onChange={(e) => setPipelineMaxDays(e.target.value)} />
                          </div>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button type="button" size="sm" onClick={() => void runEditorialPipeline()} disabled={pipelineBusy}>
                      {pipelineBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                      Run pipeline
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="destructive"
                      disabled={!pipelineRunId || pipelineDetail?.run.status !== "running"}
                      onClick={() => void stopPipelineRun()}
                    >
                      Stop
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
                    <div className="space-y-6">
                      <div className="rounded-xl border border-border/80 bg-muted/10 p-5">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-base font-semibold tracking-tight">Latest run</h3>
                          <span
                            className={cn(
                              "rounded-md border px-2 py-0.5 text-xs font-medium capitalize",
                              statusBadgeClass(pipelineDetail.run.status),
                            )}
                          >
                            {pipelineDetail.run.status}
                          </span>
                          {pipelineDetail.live.activeInThisRuntime ? (
                            <Badge variant="outline" className="text-[10px] font-normal">
                              Live in this server
                            </Badge>
                          ) : null}
                        </div>
                        <p className="mt-1 font-mono text-xs text-muted-foreground">{pipelineDetail.run.id}</p>
                        <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
                          <div>
                            <p className="text-xs text-muted-foreground">Window</p>
                            <p className="mt-0.5 font-medium">
                              {pipelineDetail.run.dateFrom} → {pipelineDetail.run.dateTo}
                            </p>
                          </div>
                          <div>
                            <p className="text-xs text-muted-foreground">Model</p>
                            <p className="mt-0.5 font-medium">{pipelineDetail.run.model}</p>
                          </div>
                          <div>
                            <p className="text-xs text-muted-foreground">Started</p>
                            <p className="mt-0.5 text-foreground">{formatWhen(pipelineDetail.run.startedAt)}</p>
                          </div>
                          <div>
                            <p className="text-xs text-muted-foreground">Finished</p>
                            <p className="mt-0.5 text-foreground">{formatWhen(pipelineDetail.run.completedAt)}</p>
                          </div>
                        </div>
                        {pipelineDetail.run.status === "error" && pipelineRunFailureReason(pipelineDetail.run) ? (
                          <div className="mt-4 rounded-lg border border-destructive/45 bg-destructive/10 px-4 py-3">
                            <p className="text-sm font-medium text-destructive">Run ended with an error</p>
                            <p className="mt-2 font-mono text-xs leading-relaxed text-destructive/95">
                              {pipelineRunFailureReason(pipelineDetail.run)}
                            </p>
                            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                              Steps you already see finished and were written first; the exception happened on a later action
                              in this same run (often the next agent, a DB write, or the wrap-up summary).
                            </p>
                          </div>
                        ) : null}
                        {typeof pipelineDetail.run.stats?.managerNarrative === "string" &&
                        pipelineDetail.run.stats.managerNarrative ? (
                          <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
                            {pipelineDetail.run.stats.managerNarrative}
                          </p>
                        ) : null}
                        {routeCountEntries.length > 0 ? (
                          <div className="mt-4 flex flex-wrap gap-2">
                            {routeCountEntries.map(([k, v]) => (
                              <Badge key={k} variant="secondary" className="font-normal">
                                {k.replace(/_/g, " ")} · {String(v)}
                              </Badge>
                            ))}
                            {typeof pipelineDetail.run.stats?.autoApprovedCount === "number" ? (
                              <Badge variant="outline" className="font-normal">
                                auto-approved · {pipelineDetail.run.stats.autoApprovedCount}
                              </Badge>
                            ) : null}
                          </div>
                        ) : null}
                      </div>

                      <div className="flex flex-wrap items-end justify-between gap-4">
                        <div className="space-y-2">
                          <Label className="text-xs text-muted-foreground">View</Label>
                          <ToggleGroup
                            type="single"
                            value={pipelineViewMode}
                            onValueChange={(v) => v && setPipelineViewMode(v as typeof pipelineViewMode)}
                            className="flex"
                          >
                            <ToggleGroupItem value="checklist" className="px-3 text-xs">
                              Checklist
                            </ToggleGroupItem>
                            <ToggleGroupItem value="activity" className="px-3 text-xs">
                              Activity
                            </ToggleGroupItem>
                          </ToggleGroup>
                        </div>
                        {pipelineViewMode === "activity" ? (
                          <div className="space-y-2">
                            <Label className="text-xs text-muted-foreground">Filter steps</Label>
                            <Select value={pipelineFilterStatus} onValueChange={setPipelineFilterStatus}>
                              <SelectTrigger className="h-9 w-[200px] text-sm">
                                <SelectValue placeholder="Status" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="all">All statuses</SelectItem>
                                <SelectItem value="completed">Completed</SelectItem>
                                <SelectItem value="rejected">Rejected</SelectItem>
                                <SelectItem value="error">Error</SelectItem>
                                <SelectItem value="skipped">Skipped</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <Label className="text-xs text-muted-foreground">Details</Label>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => setShowChecklistDetails((v) => !v)}
                            >
                              {showChecklistDetails ? "Hide details" : "Show details"}
                            </Button>
                          </div>
                        )}
                      </div>
                      {pipelineViewMode === "activity" ? (
                        <p className="text-xs text-muted-foreground">
                          {pipelineFilterStatus === "all" ?
                            "Handoffs + agent steps"
                          : `Agent steps with status “${pipelineFilterStatus}” only`}{" "}
                          · {filteredSteps?.length ?? 0} step{filteredSteps?.length === 1 ? "" : "s"}
                        </p>
                      ) : null}

                      <div className="space-y-2">
                        {pipelineViewMode === "activity" ? (
                          <p className="text-xs text-muted-foreground">
                            Read top to bottom: routing lines, then each agent reply. Expand Raw / JSON only when you need the exact payload.
                          </p>
                        ) : null}
                        {pipelineViewMode === "activity" ? (
                          <PipelineActivityFeed detail={pipelineDetail} stepStatusFilter={pipelineFilterStatus} />
                        ) : (
                          <PipelineChecklistView detail={pipelineDetail} showDetails={showChecklistDetails} />
                        )}
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">No pipeline run loaded yet. Run the pipeline to see trace output.</p>
                  )}

                  {shadowValidation ? (
                    <Collapsible open={shadowOpen} onOpenChange={setShadowOpen}>
                      <CollapsibleTrigger asChild>
                        <Button variant="outline" size="sm" className="w-full justify-between sm:w-auto">
                          Shadow validation output
                          <ChevronDown className={cn("h-4 w-4", shadowOpen && "rotate-180")} />
                        </Button>
                      </CollapsibleTrigger>
                      <CollapsibleContent className="mt-2">
                        <pre className="max-h-80 overflow-auto rounded-lg border border-border/80 bg-muted/20 p-4 font-mono text-[11px] text-muted-foreground">
                          {JSON.stringify(shadowValidation, null, 2)}
                        </pre>
                      </CollapsibleContent>
                    </Collapsible>
                  ) : null}
                </CardContent>
              </Card>
            ) : null}

            {activePane === "review" ? (
              <Card className="border-border/80 shadow-none">
                <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <CardTitle className="text-lg font-semibold">Human review</CardTitle>
                    <CardDescription>
                      Steps only count as passed when the day has a real summary and winning article. Technical details
                      hold the rest. (Article-first review before summary is planned: SourceFinder still runs the legacy
                      full analyze today.)
                    </CardDescription>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Select value={reviewStatus} onValueChange={(v) => setReviewStatus(v as typeof reviewStatus)}>
                      <SelectTrigger className="h-8 w-[150px]">
                        <SelectValue placeholder="Status" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="pending">Pending</SelectItem>
                        <SelectItem value="approved">Approved</SelectItem>
                        <SelectItem value="rejected">Rejected</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="min-w-[5.75rem] gap-2"
                      disabled={reviewLoading || reviewRefreshCountdown !== null}
                      onClick={() => {
                        if (reviewLoading || reviewRefreshCountdown !== null) return;
                        setReviewRefreshCountdown(REVIEW_MANUAL_REFRESH_TICKS);
                      }}
                    >
                      {reviewLoading && reviewRefreshCountdown === null ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : reviewRefreshCountdown !== null ? (
                        <span className="relative inline-flex h-8 w-8 items-center justify-center">
                          <svg className="absolute h-8 w-8 -rotate-90" viewBox="0 0 32 32" aria-hidden>
                            {(() => {
                              const r = 12;
                              const c = 2 * Math.PI * r;
                              const frac = reviewRefreshCountdown / REVIEW_MANUAL_REFRESH_TICKS;
                              return (
                                <>
                                  <circle
                                    cx="16"
                                    cy="16"
                                    r={r}
                                    fill="none"
                                    className="stroke-muted-foreground/25"
                                    strokeWidth="2.5"
                                  />
                                  <circle
                                    cx="16"
                                    cy="16"
                                    r={r}
                                    fill="none"
                                    className="stroke-primary transition-[stroke-dashoffset] duration-1000 ease-linear"
                                    strokeWidth="2.5"
                                    strokeLinecap="round"
                                    strokeDasharray={c}
                                    strokeDashoffset={c * (1 - frac)}
                                  />
                                </>
                              );
                            })()}
                          </svg>
                          <span className="text-xs font-semibold tabular-nums text-foreground">{reviewRefreshCountdown}</span>
                        </span>
                      ) : (
                        "Refresh"
                      )}
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="h-[min(640px,70vh)] pr-3">
                    {reviewItems.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        {reviewStatus === "pending" ?
                          "No pending items. When the pipeline enqueues work, it will show up here."
                        : `No ${reviewStatus} items yet.`}
                      </p>
                    ) : (
                      <div className="space-y-4">
                        {reviewItems.map((item) => (
                          <HumanReviewItemCard
                            key={item.id}
                            item={item}
                            onApprove={(id, opts) => void approveReviewItem(id, opts)}
                            onReject={(id) => void rejectReviewItem(id)}
                            onRedoSummary={(ymd) => redoSummaryFromReview(ymd)}
                            onRerunDate={(id) => rerunReviewItemDate(id)}
                          />
                        ))}
                      </div>
                    )}
                  </ScrollArea>
                </CardContent>
              </Card>
            ) : null}
          </div>
        </div>

        <Dialog open={showSystemGraph} onOpenChange={setShowSystemGraph}>
          <DialogContent className="max-w-3xl border-border/80">
            <DialogHeader>
              <DialogTitle className="text-lg font-semibold">How the pipeline works</DialogTitle>
              <DialogDescription className="text-sm leading-relaxed">
                Triage runs first. Only the branches that are needed for each day execute.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 text-sm text-muted-foreground">
              <div>
                <p className="font-medium text-foreground">Authoritative fields</p>
                <p>Tags: tags_version2 · Topics: topic_categories. Legacy tags/article_tags are not authoritative.</p>
              </div>
              <div>
                <p className="font-medium text-foreground">Scenarios</p>
                <ul className="mt-1 list-inside list-disc space-y-1">
                  <li>existing_ok → duplicate check → date check → tag check → auto-approve if clean</li>
                  <li>missing_day → search + summary → checks → human review</li>
                  <li>empty_day → re-fetch summary → checks → human review</li>
                  <li>existing_needs_correction → verification/tags → checks → human review</li>
                </ul>
              </div>
              <div>
                <p className="font-medium text-foreground">Auto-approve</p>
                <p>When every check passes and no changes are needed, the day is auto-approved and logged in this view.</p>
              </div>
            </div>
          </DialogContent>
        </Dialog>
    </div>
  );
}
