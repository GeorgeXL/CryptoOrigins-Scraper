import { useCallback } from "react";
import { ArrowRight, CalendarRange, Copy } from "lucide-react";

import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import type { EditorialReviewItem } from "@/lib/editorial-pipeline";
import { cn } from "@/lib/utils";

export type CalendarReciprocalPair = NonNullable<
  EditorialReviewItem["calendarReciprocalPair"]
>;

function CopyDateButton({ date }: { date: string }) {
  const copyDate = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(date);
      toast({ title: "Date copied", description: date });
    } catch {
      toast({ title: "Copy failed", variant: "destructive" });
    }
  }, [date]);

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        void copyDate();
      }}
      className="inline-flex shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
      aria-label={`Copy date ${date}`}
      title="Copy date"
    >
      <Copy className="size-3.5" strokeWidth={2} aria-hidden />
    </button>
  );
}

type SideCardProps = {
  date: string;
  summary: string;
  tags?: string[] | null;
  topics?: string[] | null;
  pointsAtDate: string;
  highlight?: "keep" | "remove" | null;
};

function SideCard({ date, summary, tags, topics, pointsAtDate, highlight }: SideCardProps) {
  const border =
    highlight === "keep"
      ? "border-emerald-500/40 bg-emerald-500/[0.06]"
      : highlight === "remove"
        ? "border-red-500/35 bg-red-500/[0.04]"
        : "border-border/70 bg-muted/10";
  const label =
    highlight === "keep" ? "Keep bill here" : highlight === "remove" ? "Duplicate row" : "Timeline row";

  return (
    <div className={cn("rounded-md border p-3", border)}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
        {highlight === "keep" ? (
          <span className="rounded-full border border-emerald-500/40 px-2 py-0.5 text-[10px] text-emerald-300">
            Earlier date
          </span>
        ) : null}
      </div>
      <div className="mt-1 flex items-center gap-1.5">
        <p className="font-mono text-sm font-semibold">{date}</p>
        <CopyDateButton date={date} />
      </div>
      <p className="mt-1 text-[11px] text-amber-200/90">Flagged as belonging on {pointsAtDate}</p>
      <p className="mt-2 text-sm leading-relaxed text-foreground">{summary.trim()}</p>
      {tags?.length || topics?.length ? (
        <div className="mt-2 space-y-1 text-[11px] text-muted-foreground">
          {tags?.length ? <p>Tags: {tags.join(", ")}</p> : null}
          {topics?.length ? <p>Topics: {topics.join(", ")}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

type CalendarConflictPairReviewProps = {
  pair: CalendarReciprocalPair;
  busy?: boolean;
  onAcceptChronology: () => void;
  onKeepBoth: () => void;
  onKeepSide: (queueItemId: string) => void;
  onDeleteSide: (queueItemId: string) => void;
};

export function CalendarConflictPairReview({
  pair,
  busy,
  onAcceptChronology,
  onKeepBoth,
  onKeepSide,
  onDeleteSide,
}: CalendarConflictPairReviewProps) {
  const { chronology, sideA, sideB } = pair;
  const keepHighlight = (date: string): SideCardProps["highlight"] =>
    date === chronology.keepDate ? "keep" : date === chronology.removeDate ? "remove" : null;

  return (
    <div className="space-y-3">
      <div className="rounded-md border border-sky-500/30 bg-sky-500/[0.06] p-3">
        <div className="flex items-start gap-2">
          <CalendarRange className="mt-0.5 size-4 shrink-0 text-sky-300" aria-hidden />
          <div className="min-w-0 space-y-1">
            <p className="text-[11px] uppercase tracking-[0.14em] text-sky-300">Unified calendar conflict</p>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Both dates flag each other as the wrong slot. Compare them together instead of resolving each item in
              isolation.
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-md border border-emerald-500/35 bg-emerald-500/[0.06] p-3">
        <p className="text-[11px] uppercase tracking-[0.14em] text-emerald-300">Agent chronology read</p>
        <p className="mt-1 text-sm leading-relaxed text-foreground">{chronology.rationale}</p>
        <p className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="rounded-md border border-border/60 px-2 py-1 font-mono">{chronology.keepDate}</span>
          <ArrowRight className="size-3.5 shrink-0" aria-hidden />
          <span>likely event date</span>
          <span className="text-muted-foreground/60">·</span>
          <span className="rounded-md border border-red-500/30 px-2 py-1 font-mono text-red-200/90">
            {chronology.removeDate}
          </span>
          <span>duplicate coverage</span>
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <SideCard
          date={sideA.date}
          summary={sideA.summary}
          tags={sideA.tags}
          topics={sideA.topics}
          pointsAtDate={sideA.pointsAtDate}
          highlight={keepHighlight(sideA.date)}
        />
        <SideCard
          date={sideB.date}
          summary={sideB.summary}
          tags={sideB.tags}
          topics={sideB.topics}
          pointsAtDate={sideB.pointsAtDate}
          highlight={keepHighlight(sideB.date)}
        />
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-md border border-emerald-500/35 bg-emerald-500/[0.05] p-3">
          <p className="text-sm font-medium">Apply recommendation</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Keep the bill on {chronology.keepDate}, mark it verified, delete {chronology.removeDate}, and rerun article
            pick for the later slot.
          </p>
          <Button type="button" size="sm" className="mt-3 w-full sm:w-auto" disabled={busy} onClick={onAcceptChronology}>
            Keep {chronology.keepDate} · delete {chronology.removeDate}
          </Button>
        </div>
        <div className="rounded-md border border-border/70 bg-muted/10 p-3">
          <p className="text-sm font-medium">Keep both dates</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Mark both rows as manually verified distinct events. Use only if these are truly separate stories.
          </p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="mt-3 w-full sm:w-auto"
            disabled={busy}
            onClick={onKeepBoth}
          >
            Keep both as distinct
          </Button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {[sideA, sideB].map((side) =>
          side.queueItemId ? (
            <div key={side.queueItemId} className="rounded-md border border-border/60 p-3">
              <p className="text-xs font-medium">{side.date} only</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => onKeepSide(side.queueItemId!)}
                >
                  Keep {side.date}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  disabled={busy}
                  onClick={() => onDeleteSide(side.queueItemId!)}
                >
                  Delete {side.date} & rerun
                </Button>
              </div>
            </div>
          ) : null,
        )}
      </div>
    </div>
  );
}
