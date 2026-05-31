import type { ApproveReviewOpts, CorrectionProposal } from "@/lib/editorial-pipeline";
import { formatTopicLeafWithGroup } from "@shared/topic-hierarchy";

export type CorrectionChangeSummary = {
  tagsToAdd: string[];
  tagsToRemove: string[];
  topicsToRemove: string[];
  /** Single high-confidence replacement (formatted for display). */
  topicToAdd: string | null;
  /** Ranked replacement leaves when confidence is low (2–3 options). */
  topicOptions: string[];
  topicProposalId: string | null;
  topicProposalDefault: string | null;
  /** Short topic pick hint (e.g. "Pick: …" / "Pick one: …"). */
  topicAgentNote: string | null;
  topicAgentSource: "llm" | "rules" | "skipped" | null;
  summaryEdit: {
    id: string;
    currentSummary: string;
    targetMin: number;
    targetMax: number;
  } | null;
  /** redo_summary proposal id when the pipeline wants a fresh line from the same article. */
  redoSummaryProposalId: string | null;
  misc: Array<{ id: string; label: string }>;
};

export type CorrectionSummaryAction = "patch" | "regenerate" | "replace";

function tagKey(tag: string): string {
  return tag.trim().toLowerCase();
}

function newTagsFromPromote(p: Extract<CorrectionProposal, { kind: "promote_v1_to_v2_tags" }>): string[] {
  const current = new Set(p.current.map((t) => tagKey(t)));
  return p.proposed.filter((t) => !current.has(tagKey(t)));
}

/** Flatten proposals into operator-friendly add/remove lists (deduped). */
export function summarizeCorrectionProposals(proposals: CorrectionProposal[]): CorrectionChangeSummary {
  const addMap = new Map<string, string>();
  const removeMap = new Map<string, string>();
  let topicsToRemove: string[] = [];
  let topicToAdd: string | null = null;
  let topicOptions: string[] = [];
  let topicProposalId: string | null = null;
  let topicProposalDefault: string | null = null;
  let topicAgentNote: string | null = null;
  let topicAgentSource: CorrectionChangeSummary["topicAgentSource"] = null;
  let redoSummaryProposalId: string | null = null;
  let summaryEdit: CorrectionChangeSummary["summaryEdit"] = null;
  const misc: CorrectionChangeSummary["misc"] = [];

  for (const p of proposals) {
    switch (p.kind) {
      case "promote_v1_to_v2_tags":
        for (const tag of newTagsFromPromote(p)) {
          addMap.set(tagKey(tag), tag);
        }
        break;
      case "add_grounded_tags":
        for (const tag of p.proposedAdd) {
          addMap.set(tagKey(tag), tag);
        }
        break;
      case "drop_ungrounded_tags":
        for (const tag of p.proposedDrop) {
          removeMap.set(tagKey(tag), tag);
        }
        break;
      case "fix_tag_conflict":
        for (const tag of p.proposedDrop) {
          removeMap.set(tagKey(tag), tag);
        }
        break;
      case "merge_redundant_tags":
        for (const merge of p.merges) {
          removeMap.set(tagKey(merge.from), merge.from);
          addMap.set(tagKey(merge.to), merge.to);
        }
        break;
      case "set_topic_categories":
        topicsToRemove = [...p.current];
        topicProposalId = p.id;
        topicAgentNote =
          p.proposed.length === 1
            ? `Pick: ${formatTopicLeafWithGroup(p.proposed[0])}`
            : p.proposed.length > 1
              ? `Pick one: ${p.proposed.map(formatTopicLeafWithGroup).join(" · ")}`
              : null;
        topicAgentSource = p.topicAgentSource ?? null;
        if (p.proposed.length === 1) {
          topicProposalDefault = p.proposed[0];
          topicToAdd = formatTopicLeafWithGroup(p.proposed[0]);
          topicOptions = [];
        } else if (p.proposed.length > 1) {
          topicOptions = [...p.proposed];
          topicProposalDefault = p.proposed[0];
          topicToAdd = null;
        } else {
          topicProposalDefault = null;
          topicToAdd = null;
          topicOptions = [];
        }
        break;
      case "edit_summary":
        summaryEdit = {
          id: p.id,
          currentSummary: p.currentSummary,
          targetMin: p.targetMin,
          targetMax: p.targetMax,
        };
        break;
      case "redo_summary":
        redoSummaryProposalId = p.id;
        misc.push({ id: p.id, label: "Regenerate summary (same article)" });
        break;
      case "clear_orphan_flag":
        misc.push({ id: p.id, label: "Clear orphan marker" });
        break;
      case "clear_manual_flag":
        misc.push({ id: p.id, label: "Clear manual flag" });
        break;
      default:
        break;
    }
  }

  return {
    tagsToAdd: [...addMap.values()].sort((a, b) => a.localeCompare(b)),
    tagsToRemove: [...removeMap.values()].sort((a, b) => a.localeCompare(b)),
    topicsToRemove,
    topicToAdd,
    topicOptions,
    topicProposalId,
    topicProposalDefault,
    topicAgentNote,
    topicAgentSource,
    redoSummaryProposalId,
    summaryEdit,
    misc,
  };
}

export function buildCorrectionApprovePayload(opts: {
  proposals: CorrectionProposal[];
  summary: CorrectionChangeSummary;
  selectedAdds: Set<string>;
  selectedRemoves: Set<string>;
  includeTopic: boolean;
  topicSelection: string;
  selectedMisc: Set<string>;
  includeSummaryEdit: boolean;
  editedSummary?: string;
  summaryAction?: CorrectionSummaryAction;
}): ApproveReviewOpts {
  const addKeys = new Set([...opts.selectedAdds].map(tagKey));
  const removeKeys = new Set([...opts.selectedRemoves].map(tagKey));
  const acceptedProposalIds: string[] = [];
  const proposalTagSelections: Record<string, string[]> = {};
  const proposalTopicSelections: Record<string, string[]> = {};

  for (const p of opts.proposals) {
    switch (p.kind) {
      case "promote_v1_to_v2_tags":
        if (newTagsFromPromote(p).some((tag) => addKeys.has(tagKey(tag)))) {
          acceptedProposalIds.push(p.id);
        }
        break;
      case "add_grounded_tags": {
        const chosen = p.proposedAdd.filter((tag) => addKeys.has(tagKey(tag)));
        if (chosen.length > 0) {
          acceptedProposalIds.push(p.id);
          proposalTagSelections[p.id] = chosen;
        }
        break;
      }
      case "drop_ungrounded_tags":
        if (p.proposedDrop.some((tag) => removeKeys.has(tagKey(tag)))) {
          acceptedProposalIds.push(p.id);
        }
        break;
      case "fix_tag_conflict":
        if (p.proposedDrop.some((tag) => removeKeys.has(tagKey(tag)))) {
          acceptedProposalIds.push(p.id);
        }
        break;
      case "merge_redundant_tags":
        if (
          p.merges.some((m) => removeKeys.has(tagKey(m.from)) || addKeys.has(tagKey(m.to)))
        ) {
          acceptedProposalIds.push(p.id);
        }
        break;
      case "set_topic_categories":
        if (opts.includeTopic && opts.topicSelection.trim()) {
          acceptedProposalIds.push(p.id);
          proposalTopicSelections[p.id] = [opts.topicSelection.trim()];
        }
        break;
      case "edit_summary":
        if (opts.includeSummaryEdit) acceptedProposalIds.push(p.id);
        break;
      case "redo_summary":
        break;
      default:
        if (opts.selectedMisc.has(p.id)) acceptedProposalIds.push(p.id);
        break;
    }
  }

  if (
    opts.summaryAction === "regenerate" &&
    opts.summary.redoSummaryProposalId &&
    !acceptedProposalIds.includes(opts.summary.redoSummaryProposalId)
  ) {
    acceptedProposalIds.push(opts.summary.redoSummaryProposalId);
  }

  return {
    acceptedProposalIds,
    proposalTagSelections,
    proposalTopicSelections,
    editedSummary: opts.includeSummaryEdit ? opts.editedSummary : undefined,
  };
}

export function formatCorrectionChangeLines(summary: CorrectionChangeSummary): string[] {
  const lines: string[] = [];
  if (summary.tagsToAdd.length) lines.push(`Add: ${summary.tagsToAdd.join(", ")}`);
  if (summary.tagsToRemove.length) lines.push(`Remove: ${summary.tagsToRemove.join(", ")}`);
  if (summary.topicsToRemove.length && summary.topicOptions.length > 1) {
    lines.push(
      `Topic: ${summary.topicsToRemove.join(", ")} → pick one of ${summary.topicOptions.map(formatTopicLeafWithGroup).join(", ")}`,
    );
  } else if (summary.topicsToRemove.length && summary.topicToAdd) {
    lines.push(`Topic: ${summary.topicsToRemove.join(", ")} → ${summary.topicToAdd}`);
  } else if (summary.topicToAdd) {
    lines.push(`Add topic: ${summary.topicToAdd}`);
  } else if (summary.topicsToRemove.length) {
    lines.push(
      summary.topicProposalId
        ? `Topic: ${summary.topicsToRemove.join(", ")} → choose replacement`
        : `Remove topic: ${summary.topicsToRemove.join(", ")}`,
    );
  }
  if (summary.summaryEdit) lines.push("Edit summary");
  for (const item of summary.misc) lines.push(item.label);
  return lines;
}
