import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { ApproveReviewOpts, CorrectionProposal, EditorialReviewItem, ArticleCandidate } from "@/lib/editorial-pipeline";
import { effectiveReviewItemPhase } from "@/pages/agents-v2/map-review-queue";

type PanelProps = {
  item: EditorialReviewItem;
  onApprove: (id: string, opts?: ApproveReviewOpts) => void;
  busy?: boolean;
};

function describeProposal(p: CorrectionProposal): { title: string; current: string; proposed: string } {
  switch (p.kind) {
    case "promote_v1_to_v2_tags": {
      const currentSet = new Set(p.current.map((tag) => tag.toLowerCase()));
      const added = p.proposed.filter((tag) => !currentSet.has(tag.toLowerCase()));
      return {
        title: "Promote legacy tags",
        current: p.current.join(", ") || "(empty)",
        proposed: added.join(", ") || "(no new tags)",
      };
    }
    case "set_topic_categories":
      return {
        title: "Set topics",
        current: p.current.join(", ") || "(empty)",
        proposed: p.proposed.join(", "),
      };
    case "fix_tag_conflict":
      return {
        title: "Tag conflict",
        current: p.conflictingTags.join(" vs "),
        proposed: `drop ${p.proposedDrop.join(", ")}`,
      };
    case "redo_summary":
      return { title: "Redo summary", current: p.currentSummary || "(empty)", proposed: "(regenerate)" };
    case "edit_summary":
      return {
        title: "Edit summary",
        current: p.currentSummary || "(empty)",
        proposed: `${p.targetMin}-${p.targetMax} chars`,
      };
    case "clear_orphan_flag":
      return { title: "Clear orphan", current: "orphan", proposed: "cleared" };
    case "clear_manual_flag":
      return { title: "Clear flag", current: "flagged", proposed: "cleared" };
    case "drop_ungrounded_tags":
      return {
        title: `Remove ${p.proposedDrop.join(", ")}`,
        current: p.proposedDrop.join(", "),
        proposed: "ungrounded tag",
      };
    case "add_grounded_tags":
      return {
        title: `Add tag: ${p.proposedAdd.join(", ")}`,
        current: "(missing tag)",
        proposed: "",
      };
    case "merge_redundant_tags":
      return {
        title: "Merge tags",
        current: p.merges.map((m) => m.from).join(", "),
        proposed: p.merges.map((m) => `${m.from}→${m.to}`).join(", "),
      };
  }
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
    <div className="max-h-52 space-y-2 overflow-y-auto pr-1">
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
  const [selected, setSelected] = useState<Set<string>>(() => new Set(proposals.map((p) => p.id)));
  const editSummaryProposal = proposals.find((p) => p.kind === "edit_summary");
  const addGroundedTagProposals = proposals.filter((p): p is Extract<CorrectionProposal, { kind: "add_grounded_tags" }> => p.kind === "add_grounded_tags");
  const [summaryDraft, setSummaryDraft] = useState(editSummaryProposal?.currentSummary ?? "");
  const [proposalTagSelections, setProposalTagSelections] = useState<Record<string, Set<string>>>(() =>
    Object.fromEntries(addGroundedTagProposals.map((proposal) => [proposal.id, new Set(proposal.proposedAdd)])),
  );

  useEffect(() => {
    setSummaryDraft(editSummaryProposal?.currentSummary ?? "");
    setProposalTagSelections(
      Object.fromEntries(addGroundedTagProposals.map((proposal) => [proposal.id, new Set(proposal.proposedAdd)])),
    );
  }, [proposals, editSummaryProposal?.currentSummary]);

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

  const selectedEditSummary = editSummaryProposal ? selected.has(editSummaryProposal.id) : false;
  const summaryLen = summaryDraft.trim().length;
  const summaryOk = !selectedEditSummary || (summaryLen >= 100 && summaryLen <= 110);

  return (
    <div className="max-h-48 space-y-2 overflow-y-auto">
      {editSummaryProposal ? (
        <div className="rounded-lg border border-border/70 p-2">
          <p className="mb-1 text-[11px] font-medium">Summary edit</p>
          <Textarea
            value={summaryDraft}
            onChange={(e) => setSummaryDraft(e.target.value)}
            rows={3}
            disabled={!isPending || busy || !selectedEditSummary}
            className="text-xs"
          />
          <p className={cn("mt-1 text-[10px]", summaryOk ? "text-emerald-600" : "text-amber-600")}>
            {summaryLen} chars · target 100-110
          </p>
        </div>
      ) : null}
      {proposals.map((p) => {
        const meta = describeProposal(p);
        const on = selected.has(p.id);
        const tagSelection = p.kind === "add_grounded_tags" ? (proposalTagSelections[p.id] ?? new Set(p.proposedAdd)) : null;
        return (
          <div
            key={p.id}
            className={cn(
              "w-full rounded-lg border p-2 text-left text-[11px]",
              on ? "border-primary bg-primary/5" : "border-border/70",
            )}
          >
            <button
              type="button"
              disabled={!isPending || busy}
              onClick={() =>
                setSelected((prev) => {
                  const next = new Set(prev);
                  if (next.has(p.id)) next.delete(p.id);
                  else next.add(p.id);
                  return next;
                })
              }
              className="w-full text-left"
            >
              <p className="font-medium">{meta.title}</p>
              {meta.proposed ? <p className="text-muted-foreground">{meta.proposed}</p> : null}
            </button>
            {p.kind === "add_grounded_tags" ? (
              <div className="mt-2 space-y-2">
                <div className="flex flex-wrap gap-1.5">
                  {p.proposedAdd.map((tag) => {
                    const enabled = tagSelection?.has(tag) ?? false;
                    return (
                      <button
                        key={`${p.id}:${tag}`}
                        type="button"
                        disabled={!isPending || busy || !on}
                        onClick={() =>
                          setProposalTagSelections((prev) => {
                            const next = { ...prev };
                            const values = new Set(next[p.id] ?? p.proposedAdd);
                            if (values.has(tag)) values.delete(tag);
                            else values.add(tag);
                            next[p.id] = values;
                            return next;
                          })
                        }
                        className={cn(
                          "rounded-full border px-2 py-0.5 text-[11px]",
                          enabled ? "border-emerald-500 bg-emerald-500/10" : "border-border/70 text-muted-foreground",
                        )}
                      >
                        {enabled ? "✓ " : ""}{tag}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </div>
        );
      })}
      {isPending ? (
        <Button
          type="button"
          size="sm"
          className="w-full"
          disabled={busy || selected.size === 0 || !summaryOk}
          onClick={() =>
            onApprove(item.id, {
              acceptedProposalIds: Array.from(selected),
              proposalTagSelections: Object.fromEntries(
                Object.entries(proposalTagSelections).map(([proposalId, values]) => [proposalId, Array.from(values)]),
              ),
              editedSummary: selectedEditSummary ? summaryDraft : undefined,
            })
          }
        >
          Apply {selected.size} fix{selected.size === 1 ? "" : "es"}
        </Button>
      ) : null}
    </div>
  );
}

function CalendarPanel({ item, onApprove, busy }: PanelProps) {
  const p = item.calendarDecision;
  const isPending = item.status === "pending";
  if (!p) return null;
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[11px] text-muted-foreground">{p.reason}</p>
      {isPending ? (
        <>
          <Button
            type="button"
            size="sm"
            disabled={busy || p.canonicalDateOccupied}
            onClick={() => onApprove(item.id, { calendarDecision: "move_to_canonical" })}
          >
            Move to {p.expectedDate}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => onApprove(item.id, { calendarDecision: "keep_as_is" })}
          >
            Keep on {p.currentDate}
          </Button>
        </>
      ) : null}
    </div>
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
