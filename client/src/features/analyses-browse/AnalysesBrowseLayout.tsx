import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TaggingDropdown } from "@/components/TaggingDropdown";
import { SidebarProvider } from "@/components/ui/sidebar";
import { ChevronDown, FileText, RefreshCw, StopCircle, Tags } from "lucide-react";

interface AnalysesBrowseLayoutProps {
  sidebar: ReactNode;
  children: ReactNode;
}

export function AnalysesBrowseLayout({ sidebar, children }: AnalysesBrowseLayoutProps) {
  return (
    <SidebarProvider className="w-full" defaultOpen={true}>
      {/* SidebarProvider is `display:flex`; force full remaining width so the table isn't cramped. */}
      <div className="w-full min-w-0 flex-1 space-y-6">
        <div className="flex w-full flex-col gap-6 lg:flex-row">
          <div className="w-full shrink-0 space-y-2 lg:w-72">{sidebar}</div>
          <div className="min-w-0 flex-1 space-y-4">
            <div className="w-full space-y-6">{children}</div>
          </div>
        </div>
      </div>
    </SidebarProvider>
  );
}

interface AnalysesBrowseHeaderProps {
  title: string;
  totalCount: number;
  actions?: ReactNode;
}

export function AnalysesBrowseHeader({ title, totalCount, actions }: AnalysesBrowseHeaderProps) {
  return (
    <div className="flex items-center justify-between mb-3">
      <div className="flex items-center space-x-3">
        <h2 className="text-lg font-semibold text-foreground">{title}</h2>
        <Badge variant="secondary" className="font-normal">
          {totalCount.toLocaleString()} result{totalCount !== 1 ? "s" : ""}
        </Badge>
      </div>
      {totalCount > 0 ? actions : null}
    </div>
  );
}

interface AnalysesBrowseTableCardProps {
  children: ReactNode;
}

export function AnalysesBrowseTableCard({ children }: AnalysesBrowseTableCardProps) {
  return <Card className="w-full min-w-0 border-0 px-6 pb-6 pt-0">{children}</Card>;
}

interface AnalysesBrowseBulkActionsProps {
  isReanalyzing: boolean;
  progress: { completed: number; total: number };
  cancelAnalysis: () => void;
  reanalyzeDates: (dates: string[]) => Promise<void>;
  redoSummaries: (dates: string[]) => Promise<void>;
  selectAllMatching: boolean;
  selectedDates: Set<string>;
  fetchAllMatchingDates: () => Promise<string[]>;
  onManageTags: () => void;
}

export function AnalysesBrowseBulkActions({
  isReanalyzing,
  progress,
  cancelAnalysis,
  reanalyzeDates,
  redoSummaries,
  selectAllMatching,
  selectedDates,
  fetchAllMatchingDates,
  onManageTags,
}: AnalysesBrowseBulkActionsProps) {
  return (
    <>
      {isReanalyzing ? (
        <Button
          variant="outline"
          size="sm"
          onClick={cancelAnalysis}
          title="Stop bulk analysis"
        >
          <StopCircle className="w-4 h-4 mr-2" />
          Stop ({progress.completed}/{progress.total})
        </Button>
      ) : (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" title="Re-analyze (R)">
              <RefreshCw className="w-4 h-4 mr-2" />
              Re-analyze
              <ChevronDown className="w-4 h-4 ml-2" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onClick={async () => {
                const dates = selectAllMatching
                  ? await fetchAllMatchingDates()
                  : Array.from(selectedDates);
                await reanalyzeDates(dates);
              }}
            >
              <RefreshCw className="w-4 h-4 mr-2" />
              Analyse Days
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={async () => {
                const dates = selectAllMatching
                  ? await fetchAllMatchingDates()
                  : Array.from(selectedDates);
                await redoSummaries(dates);
              }}
            >
              <FileText className="w-4 h-4 mr-2" />
              Redo Summaries
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      <TaggingDropdown
        selectedDates={Array.from(selectedDates)}
        selectAllMatching={selectAllMatching}
        onDatesResolve={fetchAllMatchingDates}
      />

      <Button variant="outline" size="sm" onClick={onManageTags}>
        <Tags className="w-4 h-4 mr-2" />
        Manage Tags
      </Button>
    </>
  );
}

interface AnalysesBrowseEmptyPlaceholderProps {
  title: string;
  description: string;
}

export function AnalysesBrowseEmptyPlaceholder({
  title,
  description,
}: AnalysesBrowseEmptyPlaceholderProps) {
  return (
    <div className="flex min-h-[calc(100vh-14rem)] w-full flex-col items-center justify-center text-center">
      <h3 className="text-lg font-semibold text-foreground mb-2">{title}</h3>
      <p className="text-sm text-muted-foreground max-w-md">{description}</p>
    </div>
  );
}
