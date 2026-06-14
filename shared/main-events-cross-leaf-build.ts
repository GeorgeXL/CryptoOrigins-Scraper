import { formatTopicLeafWithGroup } from "./topic-hierarchy";
import type {
  MainEventsCrossLeafDuplicate,
  MainEventsCrossLeafProposal,
  MainEventsCrossLeafQueue,
  MainEventsReviewDbStatus,
} from "./leaf-agent-config";
import {
  crossCheckCanonicalDates,
  normalizeMainEventsLeafKey,
  resolveDbOwnerLeafFromTopics,
  type CanonicalDateEntry,
  type ReviewAnalysisRow,
} from "./main-events-review-build";

export type CrossLeafCacheRow = {
  leaf: string;
  canonical: CanonicalDateEntry[];
};

export type CrossLeafAssignmentRow = {
  date: string;
  owner_leaf: string;
};

function readSourceUrl(entry: CanonicalDateEntry): string | undefined {
  return entry.sourceUrl ?? entry.source_url;
}

export function parseCrossLeafAssignments(rows: CrossLeafAssignmentRow[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const row of rows) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date)) continue;
    if (typeof row.owner_leaf === "string" && row.owner_leaf.trim()) {
      map.set(row.date, row.owner_leaf.trim());
    }
  }
  return map;
}

export function isDateAssignedToOtherLeaf(
  date: string,
  currentLeaf: string,
  assignments: Map<string, string>,
): boolean {
  const owner = assignments.get(date);
  if (!owner) return false;
  return normalizeMainEventsLeafKey(owner) !== normalizeMainEventsLeafKey(currentLeaf);
}

export function buildCrossLeafDuplicateQueue(opts: {
  cacheRows: CrossLeafCacheRow[];
  assignments: Map<string, string>;
  analyses: ReviewAnalysisRow[];
}): MainEventsCrossLeafQueue {
  const proposalsByDate = new Map<string, MainEventsCrossLeafProposal[]>();

  for (const row of opts.cacheRows) {
    for (const entry of row.canonical) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.date)) continue;
      const list = proposalsByDate.get(entry.date) ?? [];
      list.push({
        leaf: row.leaf,
        leafLabel: formatTopicLeafWithGroup(row.leaf),
        event: entry.event,
        importance: entry.importance,
        ...(readSourceUrl(entry) ? { sourceUrl: readSourceUrl(entry) } : {}),
      });
      proposalsByDate.set(entry.date, list);
    }
  }

  const analysisByDate = new Map(opts.analyses.map((row) => [row.date, row]));
  const items: MainEventsCrossLeafDuplicate[] = [];

  for (const [date, proposals] of proposalsByDate.entries()) {
    if (proposals.length < 2) continue;
    if (opts.assignments.has(date)) continue;

    const uniqueLeaves = new Set(proposals.map((p) => normalizeMainEventsLeafKey(p.leaf)));
    if (uniqueLeaves.size < 2) continue;

    proposals.sort((a, b) => a.leafLabel.localeCompare(b.leafLabel));

    const analysis = analysisByDate.get(date);
    let dbStatus: MainEventsReviewDbStatus | undefined;
    let dbSummary: string | undefined;
    let wrongLeafLabel: string | undefined;
    let isLocked: boolean | undefined;

    let dbNote: string | undefined;

    let dbOwnerLeaf: string | undefined;
    let dbOwnerLeafLabel: string | undefined;

    if (analysis) {
      dbSummary = (analysis.summary ?? "").trim() || undefined;
      isLocked = Boolean(analysis.isLocked);

      const dbOwner = resolveDbOwnerLeafFromTopics(analysis.topicCategories);
      if (dbOwner) {
        dbOwnerLeaf = dbOwner.leaf;
        dbOwnerLeafLabel = dbOwner.leafLabel;
      }

      let matchedOnProposal = false;
      let misplacedLabel: string | undefined;
      let untaggedOnProposal = false;

      for (const proposal of proposals) {
        const check = crossCheckCanonicalDates(
          proposal.leaf,
          [analysis],
          [{ date, event: proposal.event, importance: proposal.importance }],
        );
        if (check.matched.length > 0) {
          matchedOnProposal = true;
          break;
        }
        if (check.untagged.length > 0) {
          untaggedOnProposal = true;
        }
        if (!misplacedLabel && check.misplaced.length > 0) {
          misplacedLabel = check.misplaced[0]?.wrongLeafLabel;
        }
      }

      if (matchedOnProposal) {
        dbStatus = "in_db";
      } else if (misplacedLabel) {
        dbStatus = "wrong_leaf";
        wrongLeafLabel = misplacedLabel;
      } else if (untaggedOnProposal) {
        dbStatus = "untagged";
        dbNote = "Row exists but has no storyline tag yet";
      } else {
        dbStatus = "in_db";
        dbNote = "Row exists but no storyline tag on any of these leaves yet";
      }
    } else {
      dbStatus = "missing";
    }

    items.push({
      date,
      proposals,
      ...(dbSummary ? { dbSummary } : {}),
      ...(dbStatus ? { dbStatus } : {}),
      ...(dbNote ? { dbNote } : {}),
      ...(wrongLeafLabel ? { wrongLeafLabel } : {}),
      ...(dbOwnerLeaf ? { dbOwnerLeaf } : {}),
      ...(dbOwnerLeafLabel ? { dbOwnerLeafLabel } : {}),
      ...(isLocked ? { isLocked } : {}),
    });
  }

  items.sort((a, b) => a.date.localeCompare(b.date));

  return {
    items,
    counts: {
      unresolved: items.length,
      assigned: opts.assignments.size,
    },
  };
}
