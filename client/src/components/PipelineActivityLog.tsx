import type { RefObject } from "react";
import { Check, Loader2, UserRound, X } from "lucide-react";
import { motion } from "framer-motion";

import { ScrollArea } from "@/components/ui/scroll-area";
import type { LogLine, LogStatus } from "@/lib/pipelineActivityLog";
import { cn } from "@/lib/utils";

const LUXURY_EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

function StatusGlyph({ status }: { status: LogStatus }) {
  if (status === "pending") {
    return <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-orange-500" aria-hidden />;
  }
  if (status === "approved") {
    return <Check className="h-3.5 w-3.5 shrink-0 text-green-600" strokeWidth={2.5} aria-hidden />;
  }
  if (status === "review") {
    return <UserRound className="h-3.5 w-3.5 shrink-0 text-amber-500" strokeWidth={2.5} aria-hidden />;
  }
  return <X className="h-3.5 w-3.5 shrink-0 text-red-500" strokeWidth={2.5} aria-hidden />;
}

type PipelineActivityLogProps = {
  lines: LogLine[];
  className?: string;
  scrollRef?: RefObject<HTMLDivElement | null>;
  scrollClassName?: string;
};

export function PipelineActivityLog({ lines, className, scrollRef, scrollClassName }: PipelineActivityLogProps) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-border/80 bg-muted/15 shadow-sm",
        "[&_[data-radix-scroll-area-viewport]:focus-visible]:outline-none",
        className,
      )}
    >
      <ScrollArea ref={scrollRef} className={cn("h-[280px]", scrollClassName)}>
        <ul className="space-y-1.5 p-3 font-mono text-[11px] leading-relaxed text-muted-foreground">
          {lines.length === 0 ? (
            <li className="text-muted-foreground/80">Starting editorial agent…</li>
          ) : (
            lines.map((line) => (
              <motion.li
                key={line.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.28, ease: LUXURY_EASE }}
                className="flex items-start gap-2.5"
              >
                <span className="mt-0.5 flex w-4 justify-center">
                  <StatusGlyph status={line.status} />
                </span>
                <span className="min-w-0 flex-1 pt-0.5 text-foreground/90">{line.text}</span>
              </motion.li>
            ))
          )}
        </ul>
      </ScrollArea>
    </div>
  );
}
