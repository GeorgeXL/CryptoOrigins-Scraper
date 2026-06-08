import type { ReactNode } from "react";
import { Link } from "wouter";

import { Button } from "@/components/ui/button";
import type { EditorialReviewItem } from "@/lib/editorial-pipeline";
import { cn } from "@/lib/utils";

type CalendarDecision = NonNullable<EditorialReviewItem["calendarDecision"]>;

export function CalendarFlagReason({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-border/40 bg-muted/25 px-3.5 py-3">
      <p className="text-xs font-medium text-muted-foreground/75">Why this was flagged</p>
      <div className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{children}</div>
    </div>
  );
}

type CalendarMismatchReviewProps = {
  decision: CalendarDecision;
  currentSummary: string | null | undefined;
  currentTags?: string[] | null;
  currentTopics?: string[] | null;
  busy?: boolean;
  compact?: boolean;
  onKeepDateRerunOther: (keepDate: string, rerunDate: string) => void;
  onKeepBoth: () => void;
};

function DateCard({
  date,
  summary,
  tags,
  topics,
  otherDate,
  busy,
  canKeep,
  onKeepThisRerunOther,
}: {
  date: string;
  summary: string | null | undefined;
  tags?: string[] | null;
  topics?: string[] | null;
  otherDate: string;
  busy?: boolean;
  canKeep: boolean;
  onKeepThisRerunOther: () => void;
}) {
  return (
    <div className="rounded-md border border-border/70 bg-muted/10 p-3">
      <p className="font-mono text-sm font-semibold">{date}</p>
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
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Button
          type="button"
          size="sm"
          className="w-full"
          disabled={busy || !canKeep}
          onClick={onKeepThisRerunOther}
        >
          Keep this
        </Button>
        <Button type="button" size="sm" variant="outline" className="w-full" asChild>
          <Link href={`/day/${date}`} target="_blank" rel="noopener noreferrer">
            Open day
          </Link>
        </Button>
      </div>
      <p className="mt-1.5 text-[11px] text-muted-foreground">
        Keep this · reruns {otherDate}
      </p>
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
  onKeepDateRerunOther,
  onKeepBoth,
}: CalendarMismatchReviewProps) {
  const current = currentSummary?.trim() || null;
  const suggested = p.expectedDateSummary?.trim() || null;
  const flagReason =
    p.reason ||
    (p.chronologyHint && !p.chronologyHint.reciprocalConflict ? p.chronologyHint.rationale : null);

  return (
    <div className="space-y-3">
      {flagReason ? <CalendarFlagReason>{flagReason}</CalendarFlagReason> : null}

      <div className={cn("grid gap-3", compact ? "grid-cols-1" : "md:grid-cols-2")}>
        <DateCard
          date={p.currentDate}
          summary={current}
          tags={currentTags}
          topics={currentTopics}
          otherDate={p.expectedDate}
          busy={busy}
          canKeep={Boolean(current)}
          onKeepThisRerunOther={() => onKeepDateRerunOther(p.currentDate, p.expectedDate)}
        />
        <DateCard
          date={p.expectedDate}
          summary={suggested}
          tags={p.expectedDateTags}
          topics={p.expectedDateTopics}
          otherDate={p.currentDate}
          busy={busy}
          canKeep={Boolean(suggested)}
          onKeepThisRerunOther={() => onKeepDateRerunOther(p.expectedDate, p.currentDate)}
        />
      </div>

      <Button
        type="button"
        size="sm"
        variant="outline"
        className="w-full sm:w-auto"
        disabled={busy}
        onClick={onKeepBoth}
      >
        Keep both
      </Button>
    </div>
  );
}
