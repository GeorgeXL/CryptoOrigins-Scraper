import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { TOPIC_HIERARCHY } from "@shared/topic-hierarchy";
import { Check, ChevronDown } from "lucide-react";

type TopicBadgeEditorProps = {
  topic: string | null;
  onTopicChange: (topic: string | null) => void;
  disabled?: boolean;
};

export function TopicBadgeEditor({ topic, onTopicChange, disabled }: TopicBadgeEditorProps) {
  const label = topic?.trim() || "No topic";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-md border border-sky-500/30 bg-sky-500/10 px-1.5 py-0.5 text-xs font-semibold text-sky-200 transition-colors hover:bg-sky-500/20 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
          title={topic ? `Storyline: ${topic} (click to change)` : "No topic assigned (click to choose)"}
          aria-label="Change storyline topic"
        >
          <span>{label}</span>
          <ChevronDown className="h-3 w-3 opacity-70" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72 p-0">
        <ScrollArea className="h-72">
          <div className="p-1">
            <DropdownMenuItem
              onClick={() => onTopicChange(null)}
              disabled={!topic}
              className="flex items-center gap-2 text-xs"
            >
              <span className="text-muted-foreground">Clear topic</span>
              {!topic ? <Check className="ml-auto h-3 w-3" /> : null}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {TOPIC_HIERARCHY.map((group) => (
              <div key={group.name}>
                <DropdownMenuLabel className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {group.name}
                </DropdownMenuLabel>
                {group.leaves.map((leaf) => (
                  <DropdownMenuItem
                    key={leaf}
                    onClick={() => onTopicChange(leaf)}
                    className="flex items-center gap-2 pl-4 text-xs"
                  >
                    <span className="truncate">{leaf}</span>
                    {topic === leaf ? <Check className="ml-auto h-3 w-3 shrink-0" /> : null}
                  </DropdownMenuItem>
                ))}
              </div>
            ))}
          </div>
        </ScrollArea>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
