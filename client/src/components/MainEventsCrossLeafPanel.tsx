import { useState } from "react";
import { Link } from "wouter";
import { Database, ExternalLink, Loader2, Lock, Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  MainEventsCrossLeafDuplicate,
  MainEventsCrossLeafQueue,
} from "@shared/leaf-agent-config";
import { canKeepCrossLeafDatabaseEntry } from "@shared/main-events-cross-leaf-apply";
import { cn } from "@/lib/utils";

const importanceClass: Record<string, string> = {
  landmark: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  major: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  notable: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
};

function DateLink({ date }: { date: string }) {
  return (
    <Link href={`/day/${date}`} className="font-mono text-sm font-medium text-primary hover:underline">
      {date}
    </Link>
  );
}

function DuplicateCard({
  item,
  busy,
  onApply,
  onKeepDatabase,
}: {
  item: MainEventsCrossLeafDuplicate;
  busy: boolean;
  onApply: (date: string, ownerLeaf: string) => void;
  onKeepDatabase: (date: string) => void;
}) {
  const [ownerLeaf, setOwnerLeaf] = useState(item.proposals[0]?.leaf ?? "");
  const selectedProposal = item.proposals.find((proposal) => proposal.leaf === ownerLeaf);
  const applyDisabled = busy || !ownerLeaf || item.isLocked;
  const canKeepDb = canKeepCrossLeafDatabaseEntry(item);
  const keepDbDisabled = busy || item.isLocked || !canKeepDb;

  const handleSelectProposal = (leaf: string) => {
    setOwnerLeaf(leaf);
    if (!item.isLocked && !busy) onApply(item.date, leaf);
  };

  const handleApply = () => {
    if (!ownerLeaf || item.isLocked || busy) return;
    onApply(item.date, ownerLeaf);
  };

  const handleKeepDatabase = () => {
    if (keepDbDisabled) return;
    onKeepDatabase(item.date);
  };

  return (
    <div className="rounded-lg border border-border/80 bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <DateLink date={item.date} />
        <Badge variant="outline" className="text-[10px]">
          {item.proposals.length} leaves
        </Badge>
        {item.isLocked ? (
          <Badge variant="outline" className="gap-1 text-[10px]">
            <Lock className="h-3 w-3" />
            Locked
          </Badge>
        ) : null}
      </div>

      <div className="mt-3 space-y-3">
        <div className="rounded-md border border-dashed border-border/70 bg-muted/20 px-3 py-2">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Your database</p>
          {item.dbStatus === "missing" && !item.dbSummary ? (
            <p className="text-sm text-muted-foreground">No row for this date yet.</p>
          ) : (
            <>
              <p className="text-sm text-foreground">{item.dbSummary || "—"}</p>
              {item.dbStatus === "wrong_leaf" && item.wrongLeafLabel ? (
                <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
                  Tagged as {item.wrongLeafLabel} in the database
                </p>
              ) : item.dbStatus === "untagged" || item.dbNote ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  {item.dbNote ?? "Row exists but has no storyline tag yet"}
                </p>
              ) : null}
            </>
          )}
          {canKeepDb && item.dbOwnerLeafLabel ? (
            <div className="mt-3 flex flex-col gap-2 border-t border-border/60 pt-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-muted-foreground">
                Assigns this date to {item.dbOwnerLeafLabel} and hides it on other Gemini lists — your
                summary and tags stay unchanged.
              </p>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={keepDbDisabled}
                onClick={handleKeepDatabase}
                className="shrink-0"
              >
                {busy ? (
                  <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Database className="mr-2 h-3.5 w-3.5" />
                )}
                Keep my database entry
              </Button>
            </div>
          ) : null}
        </div>

        <div className="space-y-2">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Proposed on these leaves — click a proposal to apply
          </p>
          {item.proposals.map((proposal) => {
            const isSelected = ownerLeaf === proposal.leaf;
            return (
              <button
                key={proposal.leaf}
                type="button"
                disabled={busy || item.isLocked}
                onClick={() => handleSelectProposal(proposal.leaf)}
                className={cn(
                  "w-full rounded-md border px-3 py-2 text-left transition-colors",
                  "hover:border-primary/50 hover:bg-primary/5 disabled:cursor-not-allowed disabled:opacity-60",
                  isSelected ? "border-primary/50 bg-primary/10 ring-1 ring-primary/20" : "border-border/60",
                )}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{proposal.leafLabel}</span>
                  <Badge variant="secondary" className={cn("text-[10px]", importanceClass[proposal.importance])}>
                    {proposal.importance}
                  </Badge>
                  {proposal.sourceUrl ? (
                    <a
                      href={proposal.sourceUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      onClick={(event) => event.stopPropagation()}
                      className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary"
                    >
                      <ExternalLink className="h-3 w-3" />
                      Source
                    </a>
                  ) : (
                    <span className="text-[10px] text-muted-foreground">No cached source URL</span>
                  )}
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{proposal.event}</p>
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1 space-y-2">
          <Label htmlFor={`owner-${item.date}`}>Belongs on leaf</Label>
          <Select value={ownerLeaf} onValueChange={setOwnerLeaf} disabled={busy || item.isLocked}>
            <SelectTrigger id={`owner-${item.date}`}>
              <SelectValue placeholder="Choose leaf" />
            </SelectTrigger>
            <SelectContent>
              {item.proposals.map((proposal) => (
                <SelectItem key={proposal.leaf} value={proposal.leaf}>
                  {proposal.leafLabel}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {selectedProposal && !item.isLocked ? (
            <p className="text-xs text-muted-foreground">
              Apply saves a manual entry from this proposal, assigns cross-leaf ownership, and starts the
              editorial agent for tags and summary.
            </p>
          ) : null}
          {item.isLocked ? (
            <p className="text-xs text-amber-700 dark:text-amber-300">
              Unlock this day on the day page before applying a proposal.
            </p>
          ) : null}
        </div>
        <Button type="button" size="sm" disabled={applyDisabled} onClick={handleApply}>
          {busy ? (
            <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Sparkles className="mr-2 h-3.5 w-3.5" />
          )}
          Apply proposal
        </Button>
      </div>
    </div>
  );
}

export function MainEventsCrossLeafPanel({
  queue,
  loading,
  error,
  busyDate,
  onRetry,
  onApply,
  onKeepDatabase,
}: {
  queue: MainEventsCrossLeafQueue | undefined;
  loading: boolean;
  error: string | null;
  busyDate: string | null;
  onRetry: () => void;
  onApply: (date: string, ownerLeaf: string) => void;
  onKeepDatabase: (date: string) => void;
}) {
  if (loading && !queue) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading duplicate dates…
        </CardContent>
      </Card>
    );
  }

  if (error && !queue) {
    return (
      <Card>
        <CardContent className="space-y-3 py-8">
          <p className="text-sm text-destructive">{error}</p>
          <Button type="button" variant="outline" size="sm" onClick={onRetry}>
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (!queue) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Duplicate dates across leaves</CardTitle>
        <CardDescription>
          These dates appear on multiple Gemini main-event lists. Pick a proposal to save it as the manual
          entry, assign the owner leaf, and run the editorial agent — or keep your existing database entry
          to assign ownership without changing your summary. Assigned dates disappear from other leaves&apos;
          review checklists.
          {queue.counts.assigned > 0 ? ` ${queue.counts.assigned} already assigned.` : ""}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {queue.items.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No unresolved duplicate dates — every shared date has an owner leaf, or no date appears on more
            than one list.
          </p>
        ) : (
          <div className="space-y-3">
            {queue.items.map((item) => (
              <DuplicateCard
                key={item.date}
                item={item}
                busy={busyDate === item.date}
                onApply={onApply}
                onKeepDatabase={onKeepDatabase}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
