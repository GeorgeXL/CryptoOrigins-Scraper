import { useMemo, useState } from "react";
import { Link } from "wouter";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { GoogleGIcon } from "@/components/GoogleGIcon";
import { checkCalendarDatesWithGoogle } from "@/lib/editorial-pipeline";
import { cn } from "@/lib/utils";
import type { CalendarDateEntry } from "@/pages/agents-v2/calendar-date-entries";

type CalendarDatesReviewProps = {
  entries: CalendarDateEntry[];
  flagReason?: string | null;
  busy?: boolean;
  readOnly?: boolean;
  resolutionNote?: string | null;
  onApply: (removeDates: string[]) => void;
};

export function CalendarDatesReview({
  entries,
  flagReason,
  busy,
  readOnly,
  resolutionNote,
  onApply,
}: CalendarDatesReviewProps) {
  const allDates = useMemo(() => entries.map((entry) => entry.date), [entries]);
  const [removeDates, setRemoveDates] = useState<Set<string>>(() => new Set());
  const [checkingGoogle, setCheckingGoogle] = useState(false);
  const [googleNote, setGoogleNote] = useState<string | null>(null);
  const [googleError, setGoogleError] = useState<string | null>(null);

  const toggleRemove = (date: string) => {
    setGoogleNote(null);
    setGoogleError(null);
    setRemoveDates((prev) => {
      const next = new Set(prev);
      if (next.has(date)) next.delete(date);
      else next.add(date);
      return next;
    });
  };

  const keepCount = allDates.length - removeDates.size;
  const canApply = keepCount > 0;
  const actionsBusy = busy || checkingGoogle;

  const applyLabel =
    removeDates.size === 0
      ? `Keep all ${allDates.length} dates`
      : removeDates.size === 1
        ? `Keep ${keepCount} · remove ${[...removeDates][0]}`
        : `Keep ${keepCount} · remove ${removeDates.size} dates`;

  const handleCheckWithGoogle = async () => {
    setCheckingGoogle(true);
    setGoogleNote(null);
    setGoogleError(null);
    try {
      const { removeDates: suggested } = await checkCalendarDatesWithGoogle(
        entries.map((entry) => ({ date: entry.date, summary: entry.summary })),
      );
      setRemoveDates(new Set(suggested));
      if (suggested.length === 0) {
        setGoogleNote("Google: all dates look correct — nothing marked for removal.");
      } else if (suggested.length === 1) {
        setGoogleNote(`Google suggests removing ${suggested[0]}. Review and apply when ready.`);
      } else {
        setGoogleNote(
          `Google suggests removing ${suggested.length} dates (${suggested.join(", ")}). Review and apply when ready.`,
        );
      }
    } catch (error) {
      setGoogleError(error instanceof Error ? error.message : "Google check failed");
    } finally {
      setCheckingGoogle(false);
    }
  };

  return (
    <div className="space-y-3">
      {flagReason ? (
        <p className="text-sm leading-relaxed text-muted-foreground">{flagReason}</p>
      ) : null}

      {!readOnly ? (
        <p className="text-xs text-muted-foreground">Check any date to remove. Everything else stays.</p>
      ) : null}

      <ul className="space-y-2">
        {entries.map((entry) => {
          const removing = removeDates.has(entry.date);
          return (
            <li
              key={entry.date}
              className={cn(
                "rounded-lg border px-3 py-3 transition-colors",
                removing ? "border-destructive/40 bg-destructive/[0.04]" : "border-border/70 bg-muted/10",
              )}
            >
              <div className="flex items-start gap-3">
                {!readOnly ? (
                  <label className="mt-1 flex shrink-0 cursor-pointer items-center gap-2">
                    <input
                      type="checkbox"
                      className="size-4 rounded border-border accent-destructive"
                      checked={removing}
                      disabled={actionsBusy}
                      onChange={() => toggleRemove(entry.date)}
                    />
                    <span className="sr-only">Remove {entry.date}</span>
                  </label>
                ) : null}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <p className="font-mono text-sm font-semibold">{entry.date}</p>
                    {removing ? (
                      <span className="text-[11px] font-medium uppercase tracking-wide text-destructive">
                        Removing
                      </span>
                    ) : null}
                  </div>
                  {entry.summary ? (
                    <p className="mt-1.5 line-clamp-3 text-sm leading-relaxed text-foreground">{entry.summary}</p>
                  ) : (
                    <p className="mt-1.5 text-sm italic text-muted-foreground">No summary on this date.</p>
                  )}
                </div>
                <Button type="button" size="sm" variant="ghost" className="shrink-0 px-2" asChild>
                  <Link href={`/day/${entry.date}`} target="_blank" rel="noopener noreferrer">
                    Open
                  </Link>
                </Button>
              </div>
            </li>
          );
        })}
      </ul>

      {readOnly ? (
        resolutionNote ? (
          <p className="text-xs leading-relaxed text-muted-foreground">Resolution: {resolutionNote}</p>
        ) : null
      ) : (
        <div className="space-y-2">
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <Button
              type="button"
              size="sm"
              className="w-full sm:w-auto"
              disabled={actionsBusy || !canApply}
              onClick={() => onApply([...removeDates].sort())}
            >
              {applyLabel}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="w-full sm:w-auto"
              disabled={actionsBusy || entries.length === 0}
              onClick={() => void handleCheckWithGoogle()}
            >
              {checkingGoogle ? (
                <>
                  <Loader2 className="animate-spin" />
                  Checking…
                </>
              ) : (
                <>
                  <GoogleGIcon className="size-4 shrink-0" />
                  Check with Google
                </>
              )}
            </Button>
          </div>
          {googleNote ? <p className="text-xs leading-relaxed text-muted-foreground">{googleNote}</p> : null}
          {googleError ? <p className="text-xs leading-relaxed text-destructive">{googleError}</p> : null}
        </div>
      )}
    </div>
  );
}
