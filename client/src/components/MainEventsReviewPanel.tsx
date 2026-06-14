import { useState } from "react";
import { Link } from "wouter";
import { Check, ExternalLink, Loader2, Lock, Sparkles, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { MainEventsReviewDecision, MainEventsReviewItem, MainEventsReviewQueue } from "@/lib/leaf-agent";
import { cn } from "@/lib/utils";

const importanceClass: Record<string, string> = {
  landmark: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  major: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  notable: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
};

type ActionPreview = "accept" | "reject" | "apply" | null;

const contentHighlightBase = "rounded-md px-2 py-1.5 transition-colors duration-200";

function geminiHighlightClass(preview: ActionPreview): string {
  if (preview === "accept") return "bg-green-500/20";
  if (preview === "reject") return "bg-red-500/20";
  if (preview === "apply") return "bg-amber-500/20";
  return "bg-transparent";
}

function dbHighlightClass(preview: ActionPreview): string {
  if (preview === "accept") return "bg-green-500/20";
  if (preview === "reject") return "bg-red-500/20";
  return "bg-muted/20";
}

function DateLink({ date }: { date: string }) {
  return (
    <Link href={`/day/${date}`} className="font-mono text-sm font-medium text-primary hover:underline">
      {date}
    </Link>
  );
}

function DbStatusBadge({ item }: { item: MainEventsReviewItem }) {
  if (item.dbStatus === "in_db") {
    return (
      <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
        In database
      </Badge>
    );
  }
  if (item.dbStatus === "untagged") {
    return (
      <Badge variant="outline" className="border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300">
        Untagged row
      </Badge>
    );
  }
  if (item.dbStatus === "wrong_leaf") {
    return (
      <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300">
        Wrong leaf{item.wrongLeafLabel ? ` · ${item.wrongLeafLabel}` : ""}
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300">
      Not in database
    </Badge>
  );
}

function ReviewCard({
  item,
  busyDates,
  onDecision,
  onApply,
}: {
  item: MainEventsReviewItem;
  busyDates: ReadonlySet<string>;
  onDecision: (date: string, decision: MainEventsReviewDecision) => void;
  onApply: (date: string) => void;
}) {
  const busy = busyDates.has(item.date);
  const applyDisabled = busy || Boolean(item.isLocked);
  const [actionPreview, setActionPreview] = useState<ActionPreview>(null);

  return (
    <div className="rounded-lg border border-border/80 bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <DateLink date={item.date} />
        <Badge variant="secondary" className={cn("text-[10px]", importanceClass[item.importance])}>
          {item.importance}
        </Badge>
        <DbStatusBadge item={item} />
        {item.isLocked ? (
          <Badge variant="outline" className="gap-1 text-[10px]">
            <Lock className="h-3 w-3" />
            Locked
          </Badge>
        ) : null}
        {item.sourceUrl ? (
          <a
            href={item.sourceUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary"
          >
            <ExternalLink className="h-3 w-3" />
            Source
          </a>
        ) : null}
      </div>

      <div className="mt-3 space-y-2">
        <div className={cn(contentHighlightBase, geminiHighlightClass(actionPreview))}>
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Gemini main event</p>
          <p className="text-sm font-medium text-foreground">{item.event}</p>
        </div>
        <div
          className={cn(
            "rounded-md border border-dashed border-border/70 px-3 py-2 transition-colors duration-200",
            dbHighlightClass(actionPreview),
          )}
        >
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Your database</p>
          {item.dbStatus === "missing" && !item.dbSummary ? (
            <p className="text-sm text-muted-foreground">No row for this date yet.</p>
          ) : (
            <>
              <p className="text-sm text-foreground">{item.dbSummary || "—"}</p>
              {item.dbStatus === "untagged" ? (
                <p className="mt-1 text-xs text-muted-foreground">Row exists but has no storyline tag yet</p>
              ) : null}
            </>
          )}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {item.reviewStatus === "pending" ? (
          <>
            <Button
              type="button"
              size="sm"
              disabled={busy}
              onMouseEnter={() => setActionPreview("accept")}
              onMouseLeave={() => setActionPreview(null)}
              onClick={() => onDecision(item.date, "accepted")}
            >
              {busy ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Check className="mr-2 h-3.5 w-3.5" />}
              Accept
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              onMouseEnter={() => setActionPreview("reject")}
              onMouseLeave={() => setActionPreview(null)}
              onClick={() => onDecision(item.date, "rejected")}
            >
              {busy ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <X className="mr-2 h-3.5 w-3.5" />}
              Reject
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={applyDisabled}
              onMouseEnter={() => !applyDisabled && setActionPreview("apply")}
              onMouseLeave={() => setActionPreview(null)}
              onClick={() => onApply(item.date)}
            >
              {busy ? (
                <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="mr-2 h-3.5 w-3.5" />
              )}
              Apply to database
            </Button>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">
            This review decision is locked{item.isLocked ? " and the day row is locked in the database" : ""}.
          </p>
        )}
      </div>
      {item.reviewStatus === "pending" && !item.isLocked ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Apply to database saves a manual entry from this Gemini event and starts the editorial agent for
          tags and summary.
        </p>
      ) : null}
      {item.reviewStatus === "pending" && item.isLocked ? (
        <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
          Unlock this day on the day page before applying to the database.
        </p>
      ) : null}
    </div>
  );
}

type ReviewTab = "pending" | "accepted" | "rejected";

export function MainEventsReviewPanel({
  queue,
  loading,
  error,
  busyDates,
  onRetry,
  onDecision,
  onApply,
}: {
  queue: MainEventsReviewQueue | undefined;
  loading: boolean;
  error: string | null;
  busyDates: ReadonlySet<string>;
  onRetry: () => void;
  onDecision: (date: string, decision: MainEventsReviewDecision) => void;
  onApply: (date: string) => void;
}) {
  if (loading && !queue) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading review checklist…
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

  const filterItems = (tab: ReviewTab) => queue.items.filter((item) => item.reviewStatus === tab);

  const renderTab = (tab: ReviewTab, emptyMessage: string) => {
    const items = filterItems(tab);
    if (items.length === 0) {
      return <p className="py-8 text-center text-sm text-muted-foreground">{emptyMessage}</p>;
    }
    return (
      <div className="space-y-3">
        {items.map((item) => (
          <ReviewCard
            key={item.date}
            item={item}
            busyDates={busyDates}
            onDecision={onDecision}
            onApply={onApply}
          />
        ))}
      </div>
    );
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{queue.leafLabel}</CardTitle>
        <CardDescription>
          Review Gemini main events against your database — accept events you want on this leaf, reject the rest.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="pending" className="space-y-4">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="pending">Pending ({queue.counts.pending})</TabsTrigger>
            <TabsTrigger value="accepted">Accepted ({queue.counts.accepted})</TabsTrigger>
            <TabsTrigger value="rejected">Rejected ({queue.counts.rejected})</TabsTrigger>
          </TabsList>
          <TabsContent value="pending" className="mt-0">
            {renderTab("pending", "All main events reviewed for this leaf.")}
          </TabsContent>
          <TabsContent value="accepted" className="mt-0">
            {renderTab("accepted", "No accepted events yet.")}
          </TabsContent>
          <TabsContent value="rejected" className="mt-0">
            {renderTab("rejected", "No rejected events.")}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
