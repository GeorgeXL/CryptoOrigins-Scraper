import { Link2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { EditorialReviewItem } from "@/lib/editorial-pipeline";

type RemovedDayContext = NonNullable<EditorialReviewItem["removedDayContext"]>;

export function RemovedDayArticlePickBanner({ context }: { context: RemovedDayContext }) {
  return (
    <section className="rounded-lg border border-amber-500/35 bg-amber-500/[0.05] p-3">
      <p className="text-[11px] uppercase tracking-[0.14em] text-amber-500/90">Previously removed</p>
      <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{context.reason}</p>
      {context.previousSummary ? (
        <div className="mt-3 rounded-md border border-border/60 bg-background/40 p-2.5">
          <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Previous summary</p>
          <p className="mt-1 text-sm leading-relaxed text-foreground">{context.previousSummary}</p>
        </div>
      ) : null}
      {context.previousArticle?.url ? (
        <div className="mt-3 rounded-md border border-border/60 bg-background/40 p-2.5">
          <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Previous article</p>
          <p className="mt-1 text-sm font-medium leading-snug text-foreground">{context.previousArticle.title}</p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {context.previousArticle.tier ? `${context.previousArticle.tier} · ` : ""}
            previously selected for this date
          </p>
          <Button type="button" size="sm" variant="outline" className="mt-2 h-8" asChild>
            <a href={context.previousArticle.url} target="_blank" rel="noopener noreferrer">
              <Link2 className="mr-1.5 size-3.5" aria-hidden />
              Open previous source
            </a>
          </Button>
        </div>
      ) : null}
    </section>
  );
}
