import { useCallback } from "react";
import { Link } from "wouter";
import { Copy } from "lucide-react";

import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import type { EditorialReviewItem } from "@/lib/editorial-pipeline";
import { CalendarFlagReason } from "@/pages/agents-v2/CalendarMismatchReview";

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
  otherDate: string;
  busy?: boolean;
  onKeepThisRerunOther: () => void;
};

function SideCard({ date, summary, tags, topics, otherDate, busy, onKeepThisRerunOther }: SideCardProps) {
  return (
    <div className="rounded-md border border-border/70 bg-muted/10 p-3">
      <div className="flex items-center gap-1.5">
        <p className="font-mono text-sm font-semibold">{date}</p>
        <CopyDateButton date={date} />
      </div>
      <p className="mt-2 text-sm leading-relaxed text-foreground">{summary.trim()}</p>
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
          disabled={busy || !summary.trim()}
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

type CalendarConflictPairReviewProps = {
  pair: CalendarReciprocalPair;
  busy?: boolean;
  onKeepDateRerunOther: (keepDate: string, rerunDate: string) => void;
  onKeepBoth: () => void;
};

export function CalendarConflictPairReview({
  pair,
  busy,
  onKeepDateRerunOther,
  onKeepBoth,
}: CalendarConflictPairReviewProps) {
  const { sideA, sideB } = pair;

  return (
    <div className="space-y-3">
      <CalendarFlagReason>
        Both {sideA.date} and {sideB.date} point at each other as the wrong slot. {pair.chronology.rationale}
      </CalendarFlagReason>

      <div className="grid gap-3 md:grid-cols-2">
        <SideCard
          date={sideA.date}
          summary={sideA.summary}
          tags={sideA.tags}
          topics={sideA.topics}
          otherDate={sideB.date}
          busy={busy}
          onKeepThisRerunOther={() => onKeepDateRerunOther(sideA.date, sideB.date)}
        />
        <SideCard
          date={sideB.date}
          summary={sideB.summary}
          tags={sideB.tags}
          topics={sideB.topics}
          otherDate={sideA.date}
          busy={busy}
          onKeepThisRerunOther={() => onKeepDateRerunOther(sideB.date, sideA.date)}
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
