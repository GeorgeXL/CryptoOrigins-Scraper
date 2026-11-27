import { useEffect, type Ref, type RefObject } from "react";
import { format, parseISO } from "date-fns";
import { Check, ChevronRight, Circle, Loader2, UserRound, X } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";

import { ScrollArea } from "@/components/ui/scroll-area";
import { scrollActivityLogToEnd, type DayActivityGroup, type LogLine, type LogStatus } from "@/lib/pipelineActivityLog";
import { cn } from "@/lib/utils";

const LUXURY_EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];
const RECENT_DONE_DAYS = 8;

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

function DayHeaderGlyph({ group }: { group: DayActivityGroup }) {
  if (group.status === "pending") {
    return <Circle className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" strokeWidth={2} aria-hidden />;
  }
  if (group.status === "running") {
    return <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-orange-500" aria-hidden />;
  }
  return <StatusGlyph status={group.outcome ?? "approved"} />;
}

function formatDayLabel(date: string): string {
  try {
    return format(parseISO(date), "d MMM yyyy");
  } catch {
    return date;
  }
}

function TaskLine({ line }: { line: LogLine }) {
  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -2 }}
      transition={{ duration: 0.22, ease: LUXURY_EASE }}
      className="flex items-start gap-2.5"
    >
      <span className="mt-0.5 flex w-4 justify-center">
        <StatusGlyph status={line.status} />
      </span>
      <span className="min-w-0 flex-1 pt-0.5 text-foreground/90">
        {line.text}
        {line.emphasis ? (
          <>
            {" "}
            <strong className="font-semibold text-foreground">{line.emphasis}</strong>
          </>
        ) : null}
      </span>
    </motion.li>
  );
}

function DayGroupRow({
  group,
  onToggle,
}: {
  group: DayActivityGroup;
  onToggle: () => void;
}) {
  const canExpand = group.status !== "pending" && group.lines.length > 0;
  const isActive = group.status === "running";

  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border transition-colors",
        isActive ? "border-orange-500/30 bg-orange-500/5" : "border-border/60 bg-background/40",
        group.status === "done" && "border-border/50",
      )}
    >
      <button
        type="button"
        onClick={canExpand ? onToggle : undefined}
        disabled={!canExpand}
        className={cn(
          "flex w-full items-center gap-2.5 px-3 py-2 text-left font-mono text-[11px]",
          canExpand ? "cursor-pointer hover:bg-muted/30" : "cursor-default",
        )}
      >
        <DayHeaderGlyph group={group} />
        <span className="min-w-0 flex-1 font-medium text-foreground/95">{formatDayLabel(group.date)}</span>
        <span className="shrink-0 text-muted-foreground">
          {group.dayIndex > 0 ? `${group.dayIndex}/${group.dayTotal}` : "skip"}
        </span>
        {canExpand ? (
          <motion.span
            animate={{ rotate: group.expanded ? 90 : 0 }}
            transition={{ duration: 0.2, ease: LUXURY_EASE }}
            className="text-muted-foreground"
          >
            <ChevronRight className="h-3.5 w-3.5" aria-hidden />
          </motion.span>
        ) : null}
      </button>

      <AnimatePresence initial={false}>
        {group.expanded && group.lines.length > 0 ? (
          <motion.div
            key="body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.32, ease: LUXURY_EASE }}
            className="overflow-hidden"
          >
            <ul className="space-y-1.5 border-t border-border/50 px-3 py-2 font-mono text-[11px] leading-relaxed text-muted-foreground">
              <AnimatePresence initial={false}>
                {group.lines.map((line) => (
                  <TaskLine key={line.id} line={line} />
                ))}
              </AnimatePresence>
            </ul>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

type BulkDayActivityLogProps = {
  planLine: LogLine | null;
  groups: DayActivityGroup[];
  className?: string;
  scrollRef?: RefObject<HTMLDivElement | null>;
  scrollClassName?: string;
  onToggleDay: (id: string) => void;
};

export function BulkDayActivityLog({
  planLine,
  groups,
  className,
  scrollRef,
  scrollClassName,
  onToggleDay,
}: BulkDayActivityLogProps) {
  const pendingCount = groups.reduce((count, group) => (group.status === "pending" ? count + 1 : count), 0);
  const runningPos = groups.findIndex((group) => group.status === "running");
  const doneGroups = groups.filter(
    (group, index) => group.status === "done" && (runningPos === -1 || index < runningPos),
  );
  const activeGroups = groups.filter((group) => group.status === "running");
  const hiddenDoneCount = Math.max(0, doneGroups.length - RECENT_DONE_DAYS);
  const recentDone = hiddenDoneCount > 0 ? doneGroups.slice(-RECENT_DONE_DAYS) : doneGroups;
  const runningGroup = activeGroups[activeGroups.length - 1];
  const scrollToken = runningGroup
    ? `${runningGroup.id}:${runningGroup.lines.length}:${runningGroup.lines[runningGroup.lines.length - 1]?.text ?? ""}`
    : String(recentDone.length);

  useEffect(() => {
    scrollActivityLogToEnd(scrollRef?.current ?? null);
  }, [scrollRef, scrollToken]);

  return (
    <div
      className={cn(
        "rounded-2xl border border-border/80 bg-muted/15 shadow-sm",
        "[&_[data-radix-scroll-area-viewport]:focus-visible]:outline-none",
        className,
      )}
    >
      <ScrollArea ref={scrollRef as Ref<HTMLDivElement>} className={cn("h-[280px]", scrollClassName)}>
        <div className="space-y-1.5 p-3">
          {planLine ? (
            <p className="mb-1 font-mono text-[11px] leading-relaxed text-muted-foreground">{planLine.text}</p>
          ) : null}
          {recentDone.length === 0 && activeGroups.length === 0 ? (
            <p className="font-mono text-[11px] text-muted-foreground/80">Starting editorial agent…</p>
          ) : (
            <>
              {hiddenDoneCount > 0 ? (
                <p className="font-mono text-[10px] text-muted-foreground/70">
                  {hiddenDoneCount} earlier day{hiddenDoneCount === 1 ? "" : "s"} finished
                </p>
              ) : null}
              {recentDone.map((group) => (
                <DayGroupRow key={group.id} group={group} onToggle={() => onToggleDay(group.id)} />
              ))}
              {activeGroups.map((group) => (
                <DayGroupRow key={group.id} group={group} onToggle={() => onToggleDay(group.id)} />
              ))}
            </>
          )}
          {pendingCount > 0 ? (
            <p className="pt-1 font-mono text-[10px] text-muted-foreground/70">
              {pendingCount} day{pendingCount === 1 ? "" : "s"} queued
            </p>
          ) : null}
        </div>
      </ScrollArea>
    </div>
  );
}
