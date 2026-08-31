import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { RARITY_LABELS, RARITY_VALUES, type Rarity } from "@shared/rarity";
import { Check, ChevronDown } from "lucide-react";

type RarityBadgeEditorProps = {
  rarity: Rarity | null;
  onRarityChange: (rarity: Rarity | null) => void;
  disabled?: boolean;
};

export function RarityBadgeEditor({ rarity, onRarityChange, disabled }: RarityBadgeEditorProps) {
  const label = rarity ? RARITY_LABELS[rarity] : "No rarity";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-md border border-violet-500/30 bg-violet-500/10 px-1.5 py-0.5 text-xs font-semibold text-violet-200 transition-colors hover:bg-violet-500/20 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
          title={rarity ? `Rarity: ${label} (click to change)` : "No rarity assigned (click to choose)"}
          aria-label="Change collector rarity"
        >
          <span>{label}</span>
          <ChevronDown className="h-3 w-3 opacity-70" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56 p-1">
        <DropdownMenuItem
          onClick={() => onRarityChange(null)}
          disabled={!rarity}
          className="flex items-center gap-2 text-xs"
        >
          <span className="text-muted-foreground">Clear rarity</span>
          {!rarity ? <Check className="ml-auto h-3 w-3" /> : null}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Collector rarity
        </DropdownMenuLabel>
        {RARITY_VALUES.map((value) => (
          <DropdownMenuItem
            key={value}
            onClick={() => onRarityChange(value)}
            className="flex items-center gap-2 text-xs"
          >
            <span>{RARITY_LABELS[value]}</span>
            {rarity === value ? <Check className="ml-auto h-3 w-3 shrink-0" /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
