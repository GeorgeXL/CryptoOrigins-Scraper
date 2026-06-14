import type { MainEventsCrossLeafDuplicate, MainEventsCrossLeafProposal } from "./leaf-agent-config";

export const CROSS_LEAF_MANUAL_SOURCE_PLACEHOLDER_HOST = "gemini-main-events.local";

export function findCrossLeafProposal(
  item: Pick<MainEventsCrossLeafDuplicate, "proposals">,
  ownerLeaf: string,
): MainEventsCrossLeafProposal | undefined {
  const normalized = ownerLeaf.trim().toLowerCase();
  return item.proposals.find((proposal) => proposal.leaf.trim().toLowerCase() === normalized);
}

export function ensureCrossLeafProposalSummary(event: string, minLength = 20): string {
  const trimmed = event.trim();
  if (trimmed.length >= minLength) return trimmed;

  const withContext = `${trimmed} — Gemini main event proposal`;
  if (withContext.length >= minLength) return withContext;

  return trimmed.padEnd(minLength, ".");
}

export function resolveCrossLeafProposalSourceUrl(opts: {
  proposal: Pick<MainEventsCrossLeafProposal, "sourceUrl" | "leaf">;
  date: string;
}): string {
  const cached = opts.proposal.sourceUrl?.trim();
  if (cached) return cached;

  const leafSlug = encodeURIComponent(opts.proposal.leaf.trim().toLowerCase().replace(/\s+/g, "-"));
  return `https://${CROSS_LEAF_MANUAL_SOURCE_PLACEHOLDER_HOST}/${leafSlug}/${opts.date}`;
}

export function assertGeminiMainEventApplyable(
  item: { date: string; isLocked?: boolean },
  actionLabel = "applying this Gemini event",
): void {
  if (item.isLocked) {
    throw new Error(`Day ${item.date} is locked — unlock it on the day page before ${actionLabel}`);
  }
}

export function buildGeminiMainEventManualEntryInputs(opts: {
  date: string;
  ownerLeaf: string;
  event: string;
  sourceUrl?: string;
}): { summary: string; sourceUrl: string; topic: string } {
  const ownerLeaf = opts.ownerLeaf.trim();
  return {
    summary: ensureCrossLeafProposalSummary(opts.event),
    sourceUrl: resolveCrossLeafProposalSourceUrl({
      date: opts.date,
      proposal: { leaf: ownerLeaf, sourceUrl: opts.sourceUrl },
    }),
    topic: ownerLeaf,
  };
}

export function geminiMainEventUsedPlaceholderSource(sourceUrl?: string): boolean {
  return !sourceUrl?.trim();
}

export function buildCrossLeafManualEntryInputs(opts: {
  date: string;
  ownerLeaf: string;
  proposal: MainEventsCrossLeafProposal;
}): { summary: string; sourceUrl: string; topic: string } {
  return buildGeminiMainEventManualEntryInputs({
    date: opts.date,
    ownerLeaf: opts.ownerLeaf,
    event: opts.proposal.event,
    sourceUrl: opts.proposal.sourceUrl,
  });
}

export function assertCrossLeafProposalApplyable(item: MainEventsCrossLeafDuplicate, ownerLeaf: string): void {
  assertGeminiMainEventApplyable(item, "applying a proposal");

  const proposal = findCrossLeafProposal(item, ownerLeaf);
  if (!proposal) {
    throw new Error(`"${ownerLeaf}" does not propose ${item.date} as a main event`);
  }
}

export function canKeepCrossLeafDatabaseEntry(item: MainEventsCrossLeafDuplicate): boolean {
  if (!item.dbOwnerLeaf?.trim()) return false;
  if (item.dbStatus === "missing" || item.dbStatus === "untagged") return false;
  return true;
}

export function assertCrossLeafDbEntryKeepable(item: MainEventsCrossLeafDuplicate): void {
  assertGeminiMainEventApplyable(item, "keeping the database entry");

  if (!item.dbOwnerLeaf?.trim()) {
    throw new Error("No tagged database entry to keep for this date");
  }

  if (item.dbStatus === "missing" || item.dbStatus === "untagged") {
    throw new Error("Database row must have a storyline tag before you can keep it");
  }
}
