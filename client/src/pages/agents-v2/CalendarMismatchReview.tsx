import { Button } from "@/components/ui/button";
import type { EditorialReviewItem } from "@/lib/editorial-pipeline";
import { cn } from "@/lib/utils";

type CalendarDecision = NonNullable<EditorialReviewItem["calendarDecision"]>;

type CalendarMismatchReviewProps = {
  decision: CalendarDecision;
  currentSummary: string | null | undefined;
  currentTags?: string[] | null;
  currentTopics?: string[] | null;
  busy?: boolean;
  compact?: boolean;
  onKeep: () => void;
  onMove: () => void;
  onDelete?: () => void;
};

function SummaryBlock({
  label,
  date,
  summary,
  tags,
  topics,
  tone,
}: {
  label: string;
  date: string;
  summary: string | null | undefined;
  tags?: string[] | null;
  topics?: string[] | null;
  tone: "current" | "suggested";
}) {
  const border =
    tone === "current" ? "border-red-500/35 bg-red-500/[0.04]" : "border-emerald-500/35 bg-emerald-500/[0.04]";
  const labelColor = tone === "current" ? "text-red-300" : "text-emerald-300";

  return (
    <div className={cn("rounded-md border p-3", border)}>
      <p className={cn("text-[11px] uppercase tracking-[0.14em]", labelColor)}>{label}</p>
      <p className="mt-1 text-sm font-medium">{date}</p>
      {summary?.trim() ? (
        <p className="mt-2 text-sm leading-relaxed text-foreground">{summary.trim()}</p>
      ) : (
        <p className="mt-2 text-sm italic text-muted-foreground">No analysis row on this date yet.</p>
      )}
      {tags?.length || topics?.length ? (
        <div className="mt-2 space-y-1 text-[11px] text-muted-foreground">
          {tags?.length ? <p>Tags: {tags.join(", ")}</p> : null}
          {topics?.length ? <p>Topics: {topics.join(", ")}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

function ActionCard({
  title,
  outcome,
  buttonLabel,
  onClick,
  disabled,
  variant = "default",
}: {
  title: string;
  outcome: string;
  buttonLabel: string;
  onClick: () => void;
  disabled?: boolean;
  variant?: "default" | "outline" | "destructive";
}) {
  return (
    <div className="rounded-md border border-border/70 bg-muted/10 p-3">
      <p className="text-sm font-medium">{title}</p>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{outcome}</p>
      <Button
        type="button"
        size="sm"
        variant={variant}
        className="mt-3 w-full sm:w-auto"
        disabled={disabled}
        onClick={onClick}
      >
        {buttonLabel}
      </Button>
    </div>
  );
}

export function CalendarMismatchReview({
  decision: p,
  currentSummary,
  currentTags,
  currentTopics,
  busy,
  compact,
  onKeep,
  onMove,
  onDelete,
}: CalendarMismatchReviewProps) {
  const current = currentSummary?.trim() || null;
  const suggested = p.expectedDateSummary?.trim() || null;

  return (
    <div className="space-y-3">
      {p.reason ? (
        <div className="rounded-md border border-amber-500/35 bg-amber-500/[0.06] p-3">
          <p className="text-[11px] uppercase tracking-[0.14em] text-amber-300">Why this was flagged</p>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{p.reason}</p>
        </div>
      ) : null}

      <div className={cn("grid gap-3", compact ? "grid-cols-1" : "md:grid-cols-2")}>
        <SummaryBlock
          label="Summary on current date"
          date={p.currentDate}
          summary={current}
          tags={currentTags}
          topics={currentTopics}
          tone="current"
        />
        <SummaryBlock
          label="Summary on suggested date"
          date={p.expectedDate}
          summary={suggested}
          tags={p.expectedDateTags}
          topics={p.expectedDateTopics}
          tone="suggested"
        />
      </div>

      {p.canonicalDateOccupied ? (
        <p className="rounded-md border border-amber-500/30 bg-amber-500/[0.06] px-3 py-2 text-xs leading-relaxed text-amber-100">
          {p.expectedDate} already has its own row — move is disabled. Compare the two summaries above. If both
          dates are valid distinct events, choose Keep. If this row is wrong, fix or delete it from Manager.
        </p>
      ) : null}

      {p.chronologyHint && !p.chronologyHint.reciprocalConflict ? (
        <div className="rounded-md border border-emerald-500/35 bg-emerald-500/[0.06] p-3">
          <p className="text-[11px] uppercase tracking-[0.14em] text-emerald-300">Agent chronology read</p>
          <p className="mt-1 text-sm leading-relaxed text-foreground">{p.chronologyHint.rationale}</p>
        </div>
      ) : null}

      <div className={cn("grid gap-3", compact ? "grid-cols-1" : "md:grid-cols-2")}>
        <ActionCard
          title={`Keep on ${p.currentDate}`}
          outcome={`Nothing is deleted and no new summary is generated. This text stays on ${p.currentDate}. We mark the day as manually verified so the calendar check will not ask again.`}
          buttonLabel={`Keep on ${p.currentDate}`}
          disabled={busy}
          onClick={onKeep}
        />
        <ActionCard
          title={`Move to ${p.expectedDate}`}
          outcome={`The same summary, tags, and article move to ${p.expectedDate}. Slot ${p.currentDate} becomes empty — no row left behind. Nothing is regenerated automatically.`}
          buttonLabel={`Move to ${p.expectedDate}`}
          disabled={busy || p.canonicalDateOccupied}
          variant="outline"
          onClick={onMove}
        />
      </div>

      {onDelete ? (
        <ActionCard
          title={`Delete ${p.currentDate} and pick a new story`}
          outcome={`Removes this analysis row entirely and starts a fresh article-pick run for ${p.currentDate}. Use when this date should cover a different event.`}
          buttonLabel={`Delete ${p.currentDate} & rerun`}
          disabled={busy}
          variant="destructive"
          onClick={onDelete}
        />
      ) : null}
    </div>
  );
}
