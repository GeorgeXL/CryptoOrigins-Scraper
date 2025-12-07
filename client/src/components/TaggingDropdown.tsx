import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Loader2, Tag, ChevronDown, StopCircle } from "lucide-react";
import { SiOpenai } from "react-icons/si";
import { useTagging } from "@/hooks/useTagging";

interface TaggingDropdownProps {
  selectedDates: string[];
  selectAllMatching?: boolean;
  onDatesResolve?: () => string[] | Promise<string[]>; // Function to resolve dates if selectAllMatching is true (can be async)
  disabled?: boolean;
}

export function TaggingDropdown({ 
  selectedDates, 
  selectAllMatching = false,
  onDatesResolve,
  disabled = false 
}: TaggingDropdownProps) {
  const { 
    startBatchTagging, 
    startContextTagging, 
    stopBatchTagging, 
    stopContextTagging,
    isBatchTagging, 
    isContextTagging,
    isTagging 
  } = useTagging();

  const handleBatchTagging = async () => {
    let dates: string[];
    if (selectAllMatching && onDatesResolve) {
      const resolved = onDatesResolve();
      dates = Array.isArray(resolved) ? resolved : await resolved;
    } else {
      dates = selectedDates;
    }
    await startBatchTagging(dates.length > 0 ? dates : undefined);
  };

  const handleContextTagging = async () => {
    let dates: string[];
    if (selectAllMatching && onDatesResolve) {
      const resolved = onDatesResolve();
      dates = Array.isArray(resolved) ? resolved : await resolved;
    } else {
      dates = selectedDates;
    }
    await startContextTagging(dates.length > 0 ? dates : undefined);
  };

  // Show stop button if either is running
  if (isTagging) {
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={isBatchTagging ? stopBatchTagging : stopContextTagging}
        title="Stop tagging"
      >
        <StopCircle className="w-4 h-4 mr-2" />
        Stop ({isBatchTagging ? 'Batch' : 'Context'})
      </Button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          disabled={disabled || (selectedDates.length === 0 && !selectAllMatching)}
          title="Tagging"
        >
          <Tag className="w-4 h-4 mr-2" />
          Tagging
          <ChevronDown className="w-4 h-4 ml-2" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          onClick={handleBatchTagging}
          disabled={isBatchTagging}
        >
          {isBatchTagging ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          ) : (
            <SiOpenai className="w-4 h-4 mr-2" />
          )}
          Batch Tagging
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={handleContextTagging}
          disabled={isContextTagging}
        >
          {isContextTagging ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          ) : (
            <SiOpenai className="w-4 h-4 mr-2" />
          )}
          Tagging with Context
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

