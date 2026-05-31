import { useState } from "react";

import { Button } from "@/components/ui/button";
import type { ArticleCandidate, EditorialReviewItem } from "@/lib/editorial-pipeline";
import { cn } from "@/lib/utils";

type CorrectionSummarySource = NonNullable<EditorialReviewItem["correctionSummarySource"]>;

export type SummarySourceAction = "patch" | "regenerate" | "replace";

type CorrectionSummarySourcePanelProps = {
  source: CorrectionSummarySource;
  busy?: boolean;
  summaryAction: SummarySourceAction;
  onSummaryActionChange: (action: SummarySourceAction) => void;
  replaceArticleId: string | null;
  onReplaceArticleIdChange: (id: string | null) => void;
};

function CandidateRow({
  candidate,
  selected,
  onSelect,
  disabled,
}: {
  candidate: ArticleCandidate;
  selected: boolean;
  onSelect: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        "w-full rounded-md border p-2 text-left text-[11px] transition-colors",
        selected ? "border-emerald-500/50 bg-emerald-500/10" : "border-border/70 hover:border-border",
        candidate.calendarSanityOk === false && "opacity-60",
      )}
    >
      <p className="font-medium leading-snug">{candidate.title}</p>
      <p className="mt-1 truncate text-muted-foreground">{candidate.url}</p>
      {candidate.summary ? (
        <p className="mt-1 line-clamp-2 text-muted-foreground">{candidate.summary}</p>
      ) : null}
      {candidate.calendarSanityOk === false ? (
        <p className="mt-1 text-amber-600 dark:text-amber-400">
          {(candidate.calendarSanityNotes ?? []).slice(0, 2).join("; ")}
        </p>
      ) : null}
    </button>
  );
}

export function CorrectionSummarySourcePanel({
  source,
  busy,
  summaryAction,
  onSummaryActionChange,
  replaceArticleId,
  onReplaceArticleIdChange,
}: CorrectionSummarySourcePanelProps) {
  const [showAlternates, setShowAlternates] = useState(summaryAction === "replace");

  return (
    <div className="space-y-3 rounded-lg border border-sky-500/30 bg-sky-500/[0.05] p-3">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-sky-300">Summary source</p>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          Choose whether to rewrite from the same article or switch to a different stored candidate. Picking a
          different article regenerates summary, tags, and topics — then opens the summary approval gate.
        </p>
      </div>

      {source.current ? (
        <div className="rounded-md border border-border/70 bg-background/40 p-2">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Current winning article</p>
          <p className="mt-1 text-sm font-medium">{source.current.title}</p>
          {source.current.url ? (
            <a
              href={source.current.url}
              target="_blank"
              rel="noreferrer"
              className="mt-1 block truncate text-[11px] text-muted-foreground hover:text-foreground"
            >
              {source.current.url}
            </a>
          ) : null}
          {source.current.preview ? (
            <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">{source.current.preview}</p>
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-2 md:grid-cols-2">
        {source.hasRedoSummary ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              onSummaryActionChange("regenerate");
              onReplaceArticleIdChange(null);
              setShowAlternates(false);
            }}
            className={cn(
              "rounded-md border p-3 text-left",
              summaryAction === "regenerate"
                ? "border-emerald-500/50 bg-emerald-500/10"
                : "border-border/70 bg-background/30",
            )}
          >
            <p className="text-sm font-medium">Regenerate summary</p>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              Same article. New 100–110 char line only. Tag/topic proposals below still apply.
            </p>
          </button>
        ) : null}
        <button
          type="button"
          disabled={busy || source.alternateCandidates.length === 0}
          onClick={() => {
            onSummaryActionChange("replace");
            setShowAlternates(true);
          }}
          className={cn(
            "rounded-md border p-3 text-left",
            summaryAction === "replace"
              ? "border-emerald-500/50 bg-emerald-500/10"
              : "border-border/70 bg-background/30",
            source.alternateCandidates.length === 0 && "opacity-50",
          )}
        >
          <p className="text-sm font-medium">Pick different article</p>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
            New summary + fresh tags + topics from the chosen candidate. Skips the tag/topic chips below.
          </p>
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            onSummaryActionChange("patch");
            onReplaceArticleIdChange(null);
            setShowAlternates(false);
          }}
          className={cn(
            "rounded-md border p-3 text-left md:col-span-2",
            summaryAction === "patch"
              ? "border-emerald-500/50 bg-emerald-500/10"
              : "border-border/70 bg-background/30",
          )}
        >
          <p className="text-sm font-medium">Fix tags/topics only</p>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
            Keep the current summary and article. Apply the tag/topic proposals below.
          </p>
        </button>
      </div>

      {summaryAction === "replace" && source.alternateCandidates.length > 0 ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] font-medium text-muted-foreground">
              Stored alternatives ({source.alternateCandidates.length})
            </p>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              onClick={() => setShowAlternates((v) => !v)}
            >
              {showAlternates ? "Hide" : "Show"}
            </Button>
          </div>
          {showAlternates ? (
            <div className="max-h-56 space-y-2 overflow-y-auto pr-1">
              {source.alternateCandidates.map((candidate) => (
                <CandidateRow
                  key={candidate.id}
                  candidate={candidate}
                  selected={replaceArticleId === candidate.id}
                  disabled={busy || candidate.calendarSanityOk === false}
                  onSelect={() => onReplaceArticleIdChange(candidate.id)}
                />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {summaryAction === "replace" && source.alternateCandidates.length === 0 ? (
        <p className="text-[11px] text-amber-600 dark:text-amber-400">
          No other stored candidates for this day. Reject and rerun the pipeline to fetch fresh articles, or use
          regenerate/edit instead.
        </p>
      ) : null}
    </div>
  );
}
