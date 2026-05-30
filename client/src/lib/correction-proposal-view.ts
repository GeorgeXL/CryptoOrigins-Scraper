import type { ApproveReviewOpts, CorrectionProposal } from "@/lib/editorial-pipeline";
import { formatTopicLeafWithGroup } from "@shared/topic-hierarchy";

export type CorrectionChangeSummary = {
  tagsToAdd: string[];
  tagsToRemove: string[];
  topicsToRemove: string[];
  topicToAdd: string | null;
  topicProposalId: string | null;
  topicProposalDefault: string | null;
  summaryEdit: {
    id: string;
    currentSummary: string;
    targetMin: number;
    targetMax: number;
  } | null;
  misc: Array<{ id: string; label: string }>;
};

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
  let topicProposalId: string | null = null;
  let topicProposalDefault: string | null = null;
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
        topicProposalDefault = p.proposed[0] ?? null;
        topicToAdd = p.proposed[0] ? formatTopicLeafWithGroup(p.proposed[0]) : null;
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
        misc.push({ id: p.id, label: "Regenerate summary from article" });
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
    topicProposalId,
    topicProposalDefault,
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
      default:
        if (opts.selectedMisc.has(p.id)) acceptedProposalIds.push(p.id);
        break;
    }
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
  if (summary.topicsToRemove.length && summary.topicToAdd) {
    lines.push(`Topic: ${summary.topicsToRemove.join(", ")} → ${summary.topicToAdd}`);
  } else if (summary.topicToAdd) {
    lines.push(`Add topic: ${summary.topicToAdd}`);
  } else if (summary.topicsToRemove.length) {
    lines.push(`Remove topic: ${summary.topicsToRemove.join(", ")}`);
  }
  if (summary.summaryEdit) lines.push("Edit summary");
  for (const item of summary.misc) lines.push(item.label);
  return lines;
}
