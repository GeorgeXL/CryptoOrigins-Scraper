import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { ApproveReviewOpts, EditorialReviewItem, ArticleCandidate } from "@/lib/editorial-pipeline";
import {
  buildCorrectionApprovePayload,
  formatCorrectionChangeLines,
  summarizeCorrectionProposals,
} from "@/lib/correction-proposal-view";
import {
  CorrectionSummarySourcePanel,
  type SummarySourceAction,
} from "@/pages/agents-v2/CorrectionSummarySourcePanel";
import { CalendarMismatchReview } from "@/pages/agents-v2/CalendarMismatchReview";
import { effectiveReviewItemPhase } from "@/pages/agents-v2/map-review-queue";
import { TOPIC_HIERARCHY, formatTopicLeafWithGroup } from "@shared/topic-hierarchy";

type PanelProps = {
  item: EditorialReviewItem;
  onApprove: (id: string, opts?: ApproveReviewOpts) => void;
  busy?: boolean;
};

function knownEventKindLabel(kind: string | null | undefined): string {
  switch (kind) {
    case "milestone":
      return "Canonical milestone";
    case "manual_override":
      return "Manual override";
    case "manual_entry":
      return "Manual entry";
    case "known_marker":
      return "Known-event marker";
    case "manual_marker":
      return "Manual-event marker";
    default:
      return "Known event";
  }
}

function KnownEventExplanation({ item }: { item: EditorialReviewItem }) {
  const ctx = item.knownEventContext;
  if (!ctx?.isKnownEvent || !ctx.explanation) return null;
  return (
    <div className="rounded-lg border border-sky-500/25 bg-sky-500/[0.07] p-3 text-xs leading-relaxed text-muted-foreground">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="border-sky-500/30 text-[10px] text-sky-500">
          {knownEventKindLabel(ctx.kind)}
        </Badge>
        {ctx.label ? <span className="font-medium text-foreground">{ctx.label}</span> : null}
      </div>
      <p>{ctx.explanation}</p>
      {ctx.referenceText ? (
        <p className="mt-2 text-[11px]">
          <span className="font-medium text-foreground">Reference:</span> {ctx.referenceText}
        </p>
      ) : null}
      <p className="mt-2 text-[11px]">
        Summary Agent validates against this known event, not an Exa article. Uncheck summary edit if you want to keep
        the current line.
      </p>
    </div>
  );
}

function ChipEditor({
  values,
  onChange,
  placeholder,
  prefix,
  disabled,
}: {
  values: string[];
  onChange: (v: string[]) => void;
  placeholder: string;
  prefix?: string;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState("");
  const commit = (raw: string) => {
    const parts = raw.split(",").map((s) => s.trim()).filter(Boolean);
    if (!parts.length) return;
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
    <div className="flex flex-wrap gap-1.5 rounded-lg border border-border/60 bg-background/50 p-2">
      {values.map((v) => (
        <span
          key={v}
          className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-muted/60 px-2 py-0.5 text-[11px]"
        >
          {prefix}
          {v}
          {!disabled ? (
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground"
              onClick={() => onChange(values.filter((x) => x !== v))}
              aria-label={`Remove ${v}`}
            >
              ×
            </button>
          ) : null}
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
          }
        }}
        onBlur={() => draft.trim() && commit(draft)}
        placeholder={values.length ? "add…" : placeholder}
        className="min-w-[5rem] flex-1 border-0 bg-transparent text-xs outline-none"
      />
    </div>
  );
}

function articleCandidatesFromItem(item: EditorialReviewItem): ArticleCandidate[] {
  const top = item.candidates;
  if (Array.isArray(top) && top.length) return top;
  const raw = (item.package as { candidates?: unknown } | null)?.candidates;
  return Array.isArray(raw) ? (raw as ArticleCandidate[]) : [];
}

function ArticlePickPanel({ item, onApprove, busy }: PanelProps) {
  const isPending = item.status === "pending";
  const candidates = articleCandidatesFromItem(item);
  const recommended = candidates.find((c) => c.recommended) ?? candidates[0] ?? null;
  const betterStoryline = item.scenario === "better_storyline";
  const [selected, setSelected] = useState<string | null>(recommended?.id ?? null);
  const selectedCandidate = candidates.find((c) => c.id === selected) ?? null;
  const selectedBlocked = selectedCandidate?.calendarSanityOk === false;

  useEffect(() => {
    setSelected((prev) => prev ?? recommended?.id ?? null);
  }, [recommended?.id]);

  if (!candidates.length) {
    return (
      <div className="space-y-2 rounded-lg border border-border/70 p-2.5 text-xs">
        <p className="font-medium">Recommended action</p>
        <p className="leading-relaxed text-muted-foreground">
          Confirm empty only if this date has no Bitcoin, crypto/Web3, regulatory, market, or macro event worth keeping.
          Otherwise reject and rerun candidate search.
        </p>
      </div>
    );
  }

  return (
    <div className="max-h-[min(60vh,20rem)] space-y-2 overflow-y-auto pr-1 sm:max-h-52">
      {recommended ? (
        <div className="rounded-lg border border-primary/30 bg-primary/5 p-2.5 text-xs">
          <p className="font-medium">Recommended action</p>
          <p className="mt-1 leading-relaxed text-muted-foreground">
            {betterStoryline
              ? `Switch to "${recommended.title}" unless another stored article is more Bitcoin-specific.`
              : `Approve "${recommended.title}" unless another candidate is more date-accurate or relevant.`}
          </p>
          {recommended.relevanceNotes?.length ? (
            <p className="mt-1 text-[10px] text-muted-foreground">
              Why: {recommended.relevanceNotes.slice(0, 3).join("; ")}
            </p>
          ) : null}
        </div>
      ) : null}
      {candidates.map((c) => {
        const isSelected = selected === c.id;
        const blocked = c.calendarSanityOk === false;
        return (
          <button
            key={c.id}
            type="button"
            disabled={!isPending || busy}
            onClick={() => setSelected(c.id)}
            className={cn(
              "w-full rounded-lg border p-2.5 text-left text-xs transition-colors",
              blocked && "border-red-500/35 bg-red-500/[0.04]",
              isSelected ? "border-primary bg-primary/5" : "border-border/70 hover:bg-muted/30",
            )}
          >
            <div className="flex flex-wrap items-center gap-1">
              {c.recommended ? (
                <Badge className="h-4 px-1 text-[9px]">Top</Badge>
              ) : null}
              <Badge variant="outline" className="h-4 px-1 text-[9px] capitalize">
                {c.tier}
              </Badge>
              {blocked ? (
                <Badge variant="destructive" className="h-4 px-1 text-[9px]">
                  Date issue
                </Badge>
              ) : null}
            </div>
            <p className="mt-1 font-medium leading-snug text-foreground">{c.title}</p>
            {blocked && c.calendarSanityNotes?.length ? (
              <p className="mt-1 text-[10px] leading-snug text-red-300">
                {c.calendarSanityNotes.slice(0, 2).join("; ")}
              </p>
            ) : null}
          </button>
        );
      })}
      {isPending ? (
        <Button
          type="button"
          size="sm"
          className="w-full"
          disabled={!selected || selectedBlocked || busy}
          onClick={() => selected && onApprove(item.id, { selectedArticleId: selected })}
        >
          Approve pick
        </Button>
      ) : null}
    </div>
  );
}

function SummaryApprovalPanel({ item, onApprove, busy }: PanelProps) {
  const payload = item.summaryApproval;
  const isPending = item.status === "pending";
  const [summaryDraft, setSummaryDraft] = useState(payload?.generatedSummary ?? "");
  const [tagsDraft, setTagsDraft] = useState<string[]>(payload?.proposedTags ?? []);
  const [topicsDraft, setTopicsDraft] = useState<string[]>(payload?.proposedTopics ?? []);
  const currentTags = Array.isArray(item.dayTags)
    ? item.dayTags.filter((t): t is string => typeof t === "string" && t.trim().length > 0)
    : [];
  const proposedTags = payload?.proposedTags ?? [];
  const currentSet = new Set(currentTags.map((t) => t.toLowerCase()));
  const proposedSet = new Set(proposedTags.map((t) => t.toLowerCase()));
  const suggestedAdds = proposedTags.filter((t) => !currentSet.has(t.toLowerCase()));
  const suggestedRemoves = currentTags.filter((t) => !proposedSet.has(t.toLowerCase()));
  const [selectedAdds, setSelectedAdds] = useState<Set<string>>(() => new Set(suggestedAdds));
  const [selectedRemoves, setSelectedRemoves] = useState<Set<string>>(() => new Set(suggestedRemoves));

  const applyTagChoices = (adds: Set<string>, removes: Set<string>) => {
    const removeLower = new Set(Array.from(removes).map((t) => t.toLowerCase()));
    const out: string[] = [];
    const seen = new Set<string>();
    for (const t of currentTags) {
      const k = t.toLowerCase();
      if (removeLower.has(k)) continue;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(t);
    }
    for (const t of adds) {
      const k = t.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(t);
    }
    setTagsDraft(out);
  };

  useEffect(() => {
    setSummaryDraft(payload?.generatedSummary ?? "");
    setTagsDraft(payload?.proposedTags ?? []);
    setTopicsDraft(payload?.proposedTopics ?? []);
    setSelectedAdds(new Set(suggestedAdds));
    setSelectedRemoves(new Set(suggestedRemoves));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payload?.generatedSummary, payload?.proposedTags, payload?.proposedTopics]);

  if (!payload) return null;

  const len = summaryDraft.trim().length;
  const lengthOk = len >= 100 && len <= 110;

  return (
    <div className="space-y-2.5">
      <Textarea
        value={summaryDraft}
        onChange={(e) => setSummaryDraft(e.target.value)}
        rows={3}
        disabled={!isPending || busy}
        className="text-xs"
      />
      <p className={cn("text-[10px]", lengthOk ? "text-emerald-600" : "text-amber-600")}>
        {len} chars · target 100–110
      </p>
      <ChipEditor
        values={tagsDraft}
        onChange={setTagsDraft}
        placeholder="tags"
        prefix="#"
        disabled={!isPending || busy}
      />
      {(suggestedAdds.length > 0 || suggestedRemoves.length > 0) ? (
        <div className="space-y-2 rounded-lg border border-border/70 p-2">
          <p className="text-[11px] font-medium">Suggested tag changes</p>
          {suggestedAdds.length > 0 ? (
            <div className="space-y-1">
              <p className="text-[10px] uppercase tracking-wide text-emerald-500">Add</p>
              <div className="flex flex-wrap gap-1.5">
                {suggestedAdds.map((t) => {
                  const on = selectedAdds.has(t);
                  return (
                    <button
                      key={`add-${t}`}
                      type="button"
                      disabled={!isPending || busy}
                      onClick={() =>
                        setSelectedAdds((prev) => {
                          const next = new Set(prev);
                          if (next.has(t)) next.delete(t);
                          else next.add(t);
                          return next;
                        })
                      }
                      className={cn(
                        "rounded-full border px-2 py-0.5 text-[11px]",
                        on ? "border-emerald-500 bg-emerald-500/10" : "border-border/70",
                      )}
                    >
                      {on ? "✓ " : ""}{t}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}
          {suggestedRemoves.length > 0 ? (
            <div className="space-y-1">
              <p className="text-[10px] uppercase tracking-wide text-red-500">Remove</p>
              <div className="flex flex-wrap gap-1.5">
                {suggestedRemoves.map((t) => {
                  const on = selectedRemoves.has(t);
                  return (
                    <button
                      key={`remove-${t}`}
                      type="button"
                      disabled={!isPending || busy}
                      onClick={() =>
                        setSelectedRemoves((prev) => {
                          const next = new Set(prev);
                          if (next.has(t)) next.delete(t);
                          else next.add(t);
                          return next;
                        })
                      }
                      className={cn(
                        "rounded-full border px-2 py-0.5 text-[11px]",
                        on ? "border-red-500 bg-red-500/10" : "border-border/70",
                      )}
                    >
                      {on ? "✓ " : ""}{t}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!isPending || busy}
            onClick={() => applyTagChoices(selectedAdds, selectedRemoves)}
          >
            Apply selected changes
          </Button>
        </div>
      ) : null}
      <ChipEditor values={topicsDraft} onChange={setTopicsDraft} placeholder="topics" disabled={!isPending || busy} />
      {isPending ? (
        <Button
          type="button"
          size="sm"
          className="w-full"
          disabled={busy || !summaryDraft.trim() || !lengthOk}
          onClick={() =>
            onApprove(item.id, {
              editedSummary: summaryDraft !== payload.generatedSummary ? summaryDraft : undefined,
              editedTags: tagsDraft,
              editedTopics: topicsDraft,
            })
          }
        >
          Approve summary
        </Button>
      ) : null}
    </div>
  );
}

function CorrectionPanel({ item, onApprove, busy }: PanelProps) {
  const proposals = item.proposals ?? [];
  const isPending = item.status === "pending";
  const changeSummary = useMemo(() => summarizeCorrectionProposals(proposals), [proposals]);
  const summarySource = item.correctionSummarySource;
  const showSummarySourcePanel = Boolean(
    summarySource && (summarySource.hasRedoSummary || summarySource.hasEditSummary),
  );
  const [summaryAction, setSummaryAction] = useState<SummarySourceAction>("patch");
  const [replaceArticleId, setReplaceArticleId] = useState<string | null>(null);
  const [selectedAdds, setSelectedAdds] = useState<Set<string>>(
    () => new Set(changeSummary.tagsToAdd),
  );
  const [selectedRemoves, setSelectedRemoves] = useState<Set<string>>(
    () => new Set(changeSummary.tagsToRemove),
  );
  const [includeTopic, setIncludeTopic] = useState(() => Boolean(changeSummary.topicProposalId));
  const [topicSelection, setTopicSelection] = useState(
    () => changeSummary.topicProposalDefault ?? "",
  );
  const [includeSummaryEdit, setIncludeSummaryEdit] = useState(() => Boolean(changeSummary.summaryEdit));
  const [selectedMisc, setSelectedMisc] = useState<Set<string>>(
    () => new Set(changeSummary.misc.map((m) => m.id)),
  );
  const [summaryDraft, setSummaryDraft] = useState(changeSummary.summaryEdit?.currentSummary ?? "");
  const topicGroups = useMemo(
    () =>
      TOPIC_HIERARCHY.map((group) => ({
        name: group.name,
        leaves: [...group.leaves].sort((a, b) => a.localeCompare(b)),
      })),
    [],
  );

  useEffect(() => {
    const next = summarizeCorrectionProposals(proposals);
    setSelectedAdds(new Set(next.tagsToAdd));
    setSelectedRemoves(new Set(next.tagsToRemove));
    setIncludeTopic(Boolean(next.topicProposalId));
    setTopicSelection(next.topicProposalDefault ?? "");
    setIncludeSummaryEdit(Boolean(next.summaryEdit));
    setSelectedMisc(new Set(next.misc.map((m) => m.id)));
    setSummaryDraft(next.summaryEdit?.currentSummary ?? "");
    setSummaryAction("patch");
    setReplaceArticleId(null);
  }, [item.id, proposals]);

  const toggleInSet = (value: string, checked: boolean, setter: Dispatch<SetStateAction<Set<string>>>) => {
    setter((prev) => {
      const next = new Set(prev);
      if (checked) next.add(value);
      else next.delete(value);
      return next;
    });
  };

  if (!proposals.length) {
    return (
      <div className="space-y-2">
        <p className="text-xs text-muted-foreground">
          No safe automatic fix is available. Use the day page to edit the record, or reject this item and rerun
          candidate selection.
        </p>
        {isPending ? (
          <Button
            type="button"
            size="sm"
            className="w-full"
            disabled={busy}
            onClick={() => onApprove(item.id)}
          >
            Approve manual correction
          </Button>
        ) : null}
      </div>
    );
  }

  const summaryLen = summaryDraft.trim().length;
  const summaryOk =
    !includeSummaryEdit ||
    (summaryLen >= (changeSummary.summaryEdit?.targetMin ?? 100) &&
      summaryLen <= (changeSummary.summaryEdit?.targetMax ?? 110));
  const isReplaceMode = showSummarySourcePanel && summaryAction === "replace";
  const topicOk =
    isReplaceMode ||
    !changeSummary.topicProposalId ||
    (includeTopic && Boolean(topicSelection.trim()));
  const needsTopicPick = Boolean(changeSummary.topicProposalId);
  const hasTopicSuggestions =
    Boolean(changeSummary.topicToAdd) || changeSummary.topicOptions.length > 0;
  const showAddSection =
    !isReplaceMode &&
    (changeSummary.tagsToAdd.length > 0 || hasTopicSuggestions || needsTopicPick);
  const hasAdds = changeSummary.tagsToAdd.length > 0 || hasTopicSuggestions || needsTopicPick;
  const hasRemoves = changeSummary.tagsToRemove.length > 0 || changeSummary.topicsToRemove.length > 0;
  const visibleMisc = changeSummary.misc.filter(
    (entry) => !(showSummarySourcePanel && entry.id === changeSummary.redoSummaryProposalId),
  );
  const hasChanges =
    isReplaceMode ||
    hasAdds ||
    hasRemoves ||
    changeSummary.summaryEdit ||
    visibleMisc.length > 0 ||
    (showSummarySourcePanel && summaryAction === "regenerate");

  const approveDisabled =
    busy ||
    (isReplaceMode
      ? !replaceArticleId
      : summaryAction === "regenerate"
        ? !changeSummary.redoSummaryProposalId
        : !summaryOk || !topicOk);

  const approveLabel = isReplaceMode
    ? "Switch article & re-run tags/topics"
    : summaryAction === "regenerate"
      ? "Regenerate summary & apply fixes"
      : "Apply changes";

  return (
    <div className="max-h-none space-y-3 sm:max-h-56 sm:overflow-y-auto">
      <KnownEventExplanation item={item} />
      {showSummarySourcePanel && summarySource ? (
        <CorrectionSummarySourcePanel
          source={summarySource}
          busy={busy}
          summaryAction={summaryAction}
          onSummaryActionChange={setSummaryAction}
          replaceArticleId={replaceArticleId}
          onReplaceArticleIdChange={setReplaceArticleId}
        />
      ) : null}
      {!isReplaceMode && changeSummary.summaryEdit ? (
        <div className="rounded-lg border border-border/70 p-2">
          <label className="mb-1 flex items-center gap-2 text-[11px] font-medium">
            <input
              type="checkbox"
              checked={includeSummaryEdit}
              disabled={!isPending || busy}
              onChange={(e) => setIncludeSummaryEdit(e.target.checked)}
            />
            Summary edit
          </label>
          <Textarea
            value={summaryDraft}
            onChange={(e) => setSummaryDraft(e.target.value)}
            rows={3}
            disabled={!isPending || busy || !includeSummaryEdit}
            className="text-xs"
          />
          <p className={cn("mt-1 text-[10px]", summaryOk ? "text-emerald-600" : "text-amber-600")}>
            {summaryLen} chars · target {changeSummary.summaryEdit.targetMin}-{changeSummary.summaryEdit.targetMax}
          </p>
        </div>
      ) : null}

      {showAddSection ? (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/[0.04] p-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-400">Add</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {changeSummary.tagsToAdd.map((tag) => {
              const on = selectedAdds.has(tag);
              return (
                <button
                  key={`add-${tag}`}
                  type="button"
                  disabled={!isPending || busy}
                  onClick={() => toggleInSet(tag, !on, setSelectedAdds)}
                  className={cn(
                    "rounded-full border px-2 py-0.5 text-[11px]",
                    on ? "border-emerald-500 bg-emerald-500/10" : "border-border/70 text-muted-foreground",
                  )}
                >
                  {on ? "✓ " : ""}{tag}
                </button>
              );
            })}
            {changeSummary.topicOptions.map((leaf) => {
              const label = formatTopicLeafWithGroup(leaf);
              const selected = includeTopic && topicSelection === leaf;
              return (
                <button
                  key={`topic-opt-${leaf}`}
                  type="button"
                  disabled={!isPending || busy}
                  onClick={() => {
                    setIncludeTopic(true);
                    setTopicSelection(leaf);
                  }}
                  className={cn(
                    "rounded-full border px-2 py-0.5 text-[11px]",
                    selected ? "border-emerald-500 bg-emerald-500/10" : "border-border/70 text-muted-foreground",
                  )}
                >
                  {selected ? "✓ " : ""}Topic: {label}
                </button>
              );
            })}
            {changeSummary.topicToAdd ? (
              <button
                type="button"
                disabled={!isPending || busy}
                onClick={() => setIncludeTopic((v) => !v)}
                className={cn(
                  "rounded-full border px-2 py-0.5 text-[11px]",
                  includeTopic ? "border-emerald-500 bg-emerald-500/10" : "border-border/70 text-muted-foreground",
                )}
              >
                {includeTopic ? "✓ " : ""}Topic: {changeSummary.topicToAdd}
              </button>
            ) : null}
          </div>
          {needsTopicPick && changeSummary.topicOptions.length === 0 ? (
            <div className="mt-2 space-y-1">
              {!changeSummary.topicToAdd ? (
                <p className="text-[11px] text-muted-foreground">
                  Choose a replacement topic for this summary.
                </p>
              ) : null}
              <Select
                value={topicSelection || undefined}
                disabled={!isPending || busy || !includeTopic}
                onValueChange={setTopicSelection}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Choose topic">
                    {topicSelection ? formatTopicLeafWithGroup(topicSelection) : undefined}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {topicGroups.map((group) => (
                    <SelectGroup key={group.name}>
                      <SelectLabel className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        {group.name}
                      </SelectLabel>
                      {group.leaves.map((leaf) => (
                        <SelectItem key={leaf} value={leaf} className="pl-6 text-xs">
                          {leaf}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : changeSummary.topicOptions.length > 1 ? (
            <p className="mt-2 text-[11px] text-muted-foreground">
              Pick the topic that best matches the summary.
            </p>
          ) : null}
        </div>
      ) : null}

      {!isReplaceMode && hasRemoves ? (
        <div className="rounded-lg border border-red-500/30 bg-red-500/[0.04] p-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-red-400">Remove</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {changeSummary.tagsToRemove.map((tag) => {
              const on = selectedRemoves.has(tag);
              return (
                <button
                  key={`remove-${tag}`}
                  type="button"
                  disabled={!isPending || busy}
                  onClick={() => toggleInSet(tag, !on, setSelectedRemoves)}
                  className={cn(
                    "rounded-full border px-2 py-0.5 text-[11px]",
                    on ? "border-red-500 bg-red-500/10" : "border-border/70 text-muted-foreground",
                  )}
                >
                  {on ? "✓ " : ""}{tag}
                </button>
              );
            })}
            {changeSummary.topicsToRemove.map((topic) => (
              <span
                key={`topic-remove-${topic}`}
                className="rounded-full border border-red-500/40 bg-red-500/10 px-2 py-0.5 text-[11px] text-red-200"
              >
                Topic: {topic}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {!isReplaceMode && visibleMisc.length > 0 ? (
        <div className="space-y-1 rounded-lg border border-border/70 p-2">
          {visibleMisc.map((entry) => (
            <label key={entry.id} className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <input
                type="checkbox"
                checked={selectedMisc.has(entry.id)}
                disabled={!isPending || busy}
                onChange={(e) => {
                  setSelectedMisc((prev) => {
                    const next = new Set(prev);
                    if (e.target.checked) next.add(entry.id);
                    else next.delete(entry.id);
                    return next;
                  });
                }}
              />
              {entry.label}
            </label>
          ))}
        </div>
      ) : null}

      {!hasChanges ? (
        <p className="text-xs text-muted-foreground">No metadata changes proposed.</p>
      ) : null}

      {isPending ? (
        <Button
          type="button"
          size="sm"
          className="w-full"
          disabled={approveDisabled}
          onClick={() => {
            if (isReplaceMode && replaceArticleId) {
              onApprove(item.id, { replaceArticleId });
              return;
            }
            onApprove(
              item.id,
              buildCorrectionApprovePayload({
                proposals,
                summary: changeSummary,
                selectedAdds,
                selectedRemoves,
                includeTopic,
                topicSelection,
                selectedMisc,
                includeSummaryEdit,
                editedSummary: summaryDraft,
                summaryAction: showSummarySourcePanel ? summaryAction : "patch",
              }),
            );
          }}
        >
          {approveLabel}
        </Button>
      ) : null}
    </div>
  );
}

function CalendarPanel({ item, onApprove, busy }: PanelProps) {
  const p = item.calendarDecision;
  const isPending = item.status === "pending";
  if (!p) return null;
  if (!isPending) {
    return <p className="text-[11px] text-muted-foreground">Calendar decision already resolved.</p>;
  }
  return (
    <CalendarMismatchReview
      decision={p}
      currentSummary={item.daySummary}
      currentTags={item.dayTags}
      currentTopics={item.dayTopicCategories}
      busy={busy}
      compact
      onKeepBoth={() => onApprove(item.id, { calendarDecision: "keep_as_is" })}
      onKeepDateRerunOther={(keepDate, rerunDate) =>
        onApprove(item.id, { calendarKeepDate: keepDate, calendarRerunDate: rerunDate })
      }
    />
  );
}

function DuplicatePanel({ item, onApprove, busy }: PanelProps) {
  const p = item.duplicateDecision;
  const isPending = item.status === "pending";
  const [neighbor, setNeighbor] = useState<string | null>(null);
  if (!p) return null;
  return (
    <div className="space-y-2">
      <div className="rounded-lg border border-border/70 p-2 text-[11px]">
        <p className="font-medium">Recommended action</p>
        <p className="mt-1 text-muted-foreground">
          If this repeats an existing storyline, send it back to candidate selection and choose a different event.
        </p>
      </div>
      {p.neighbors.slice(0, 3).map((n) => (
        <button
          key={n.date}
          type="button"
          disabled={!isPending || busy}
          onClick={() => setNeighbor(n.date)}
          className={cn(
            "w-full rounded-lg border p-2 text-left text-[11px]",
            neighbor === n.date ? "border-primary bg-primary/5" : "border-border/70",
          )}
        >
          {n.date}
        </button>
      ))}
      {isPending ? (
        <div>
          <Button
            type="button"
            size="sm"
            className="w-full"
            disabled={busy}
            onClick={() => onApprove(item.id, { duplicateDecision: "find_another_event" })}
          >
            Find another event
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => onApprove(item.id, { duplicateDecision: "keep_both" })}
          >
            Keep both
          </Button>
          <Button
            type="button"
            size="sm"
            variant="destructive"
            disabled={busy}
            onClick={() => onApprove(item.id, { duplicateDecision: "delete_focal" })}
          >
            Delete focal
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy || !neighbor}
            onClick={() =>
              neighbor &&
              onApprove(item.id, { duplicateDecision: "delete_neighbor", duplicateNeighborDate: neighbor })
            }
          >
            Delete neighbor
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export function AgentsV2ReviewPhasePanel({ item, onApprove, busy }: PanelProps) {
  const phase = effectiveReviewItemPhase(item) ?? item.reviewPhase ?? "legacy";
  switch (phase) {
    case "awaiting_article_pick":
      return <ArticlePickPanel item={item} onApprove={onApprove} busy={busy} />;
    case "awaiting_summary_approval":
      return <SummaryApprovalPanel item={item} onApprove={onApprove} busy={busy} />;
    case "awaiting_correction_approval":
      return <CorrectionPanel item={item} onApprove={onApprove} busy={busy} />;
    case "awaiting_calendar_decision":
      return <CalendarPanel item={item} onApprove={onApprove} busy={busy} />;
    case "awaiting_duplicate_decision":
      return <DuplicatePanel item={item} onApprove={onApprove} busy={busy} />;
    default:
      if (item.status === "pending" && item.actionPlan?.approveEnabled) {
        return (
          <div className="space-y-3">
            <p className="rounded-lg border border-border/70 bg-muted/20 p-3 text-xs leading-relaxed text-muted-foreground">
              {item.actionPlan.approveSummary || "Approve this review item."}
            </p>
            <Button type="button" size="sm" className="w-full" disabled={busy} onClick={() => onApprove(item.id)}>
              Approve recommended action
            </Button>
          </div>
        );
      }
      return item.actionPlan ? (
        <div className="space-y-3 rounded-lg border border-amber-500/25 bg-amber-500/10 p-3 text-xs">
          <p className="font-medium text-amber-200">Approve is not ready yet</p>
          <p className="leading-relaxed text-muted-foreground">{item.actionPlan.approveSummary}</p>
          {item.actionPlan.manualFixes?.length ? (
            <ul className="space-y-1.5">
              {item.actionPlan.manualFixes.map((fix) => (
                <li key={`${fix.code}-${fix.label}`} className="leading-relaxed text-muted-foreground">
                  <span className="font-medium text-foreground">{fix.label}:</span> {fix.suggestion}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null;
  }
}
