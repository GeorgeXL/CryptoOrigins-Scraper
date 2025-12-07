import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Tag, Check, X, RefreshCw, FileText, ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getCategoryIcon, getCategoryColor, getTagCategory } from "@/utils/tagHelpers";

export interface HistoricalNewsAnalysis {
  date: string;
  summary: string;
  tags_version2?: string[] | null;
  tier?: number;
  url?: string;
  source_url?: string;
  isManualOverride?: boolean;
}

interface CategoryData {
  category: string;
  name: string;
  count: number;
  isParent: boolean;
  isTag?: boolean;
  children?: CategoryData[];
}

interface BulkAction {
  label: string;
  icon?: React.ReactNode;
  onClick: (selectedDates: string[]) => void | Promise<void>;
  disabled?: boolean;
  variant?: "default" | "outline" | "ghost";
  size?: "sm" | "default";
}

interface BulkActionsConfig {
  actions?: BulkAction[];
  customActions?: React.ReactNode; // For complex actions like dropdowns
  showSelectAllLink?: boolean;
  onSelectAllMatching?: () => void;
  onClearSelection?: () => void;
}

interface AnalysesTableProps {
  analyses: HistoricalNewsAnalysis[];
  isLoading?: boolean;
  selectedDates?: Set<string>;
  onDateSelect?: (date: string) => void;
  onDateDeselect?: (date: string) => void;
  onRowClick?: (date: string) => void;
  onTagClick?: (tagName: string) => void;
  emptyMessage?: string;
  showCheckbox?: boolean;
  pageSize?: number;
  currentPage?: number;
  totalCount?: number;
  catalogData?: { entitiesByCategory: Record<string, CategoryData[]> } | null;
  // New props for pagination and select all
  onPageChange?: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
  onSelectAll?: () => void;
  selectAllMatching?: boolean;
  pageSizeOptions?: number[];
  showPagination?: boolean;
  showSelectAll?: boolean;
  // Bulk actions panel
  bulkActions?: BulkActionsConfig;
  showBulkActions?: boolean;
}

export function AnalysesTable({
  analyses,
  isLoading = false,
  selectedDates = new Set(),
  onDateSelect,
  onDateDeselect,
  onRowClick,
  onTagClick,
  emptyMessage = "No analyses found",
  showCheckbox = true,
  pageSize = 50,
  currentPage = 1,
  totalCount = 0,
  catalogData,
  onPageChange,
  onPageSizeChange,
  onSelectAll,
  selectAllMatching = false,
  pageSizeOptions = [50, 200, 500],
  showPagination = true,
  showSelectAll = true,
  bulkActions,
  showBulkActions = true,
}: AnalysesTableProps) {
  const toggleDateSelection = (date: string) => {
    if (selectedDates.has(date)) {
      onDateDeselect?.(date);
    } else {
      onDateSelect?.(date);
    }
  };

  // Check if all items on current page are selected
  const allPageSelected = analyses.length > 0 && analyses.every(a => selectedDates.has(a.date));
  
  // Calculate total pages
  const totalPages = Math.ceil(totalCount / pageSize);
  
  // Handle select all toggle
  const handleSelectAll = () => {
    if (onSelectAll) {
      onSelectAll();
    } else {
      // Default behavior: select/deselect all on current page
      if (allPageSelected || selectAllMatching) {
        // Deselect all on current page
        analyses.forEach(a => {
          if (selectedDates.has(a.date)) {
            onDateDeselect?.(a.date);
          }
        });
      } else {
        // Select all on current page
        analyses.forEach(a => {
          if (!selectedDates.has(a.date)) {
            onDateSelect?.(a.date);
          }
        });
      }
    }
  };

  if (isLoading) {
    return (
      <div className="rounded-md border">
        <div className="flex items-center justify-center py-12">
          <div className="text-center">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">Loading results...</p>
          </div>
        </div>
      </div>
    );
  }

  if (analyses.length === 0) {
    return (
      <div className="rounded-md border">
        <div className="text-center py-12">
          <Tag className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground">{emptyMessage}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Top Controls: Select All and Per page */}
      {totalCount > 0 && (showSelectAll || onPageSizeChange) && (
        <div className="flex items-center justify-between mb-2 pb-2">
          {showSelectAll && showCheckbox && (
            <div className="flex items-center space-x-4">
              <div className="flex items-center space-x-2">
                <Checkbox
                  checked={allPageSelected || selectAllMatching}
                  onCheckedChange={handleSelectAll}
                  data-testid="checkbox-select-all"
                />
                <span className="text-sm text-muted-foreground">
                  Select All
                </span>
              </div>
            </div>
          )}
          
          {onPageSizeChange && (
            <div className="flex items-center space-x-3">
              <div className="flex items-center space-x-2">
                <span className="text-sm text-muted-foreground">Per page:</span>
                <Select
                  value={pageSize.toString()}
                  onValueChange={(value) => {
                    onPageSizeChange(Number(value));
                  }}
                >
                  <SelectTrigger className="w-20 h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {pageSizeOptions.map(size => (
                      <SelectItem key={size} value={size.toString()}>
                        {size}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Bulk Actions Panel */}
      {showBulkActions && (selectedDates.size > 0 || selectAllMatching) && bulkActions && (
        <div className="mb-4 p-4 bg-muted/50 border border-border rounded-lg">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <Check className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm font-medium text-foreground">
                {selectAllMatching 
                  ? `${totalCount.toLocaleString()} selected` 
                  : `${selectedDates.size} selected`}
              </span>
              {bulkActions.showSelectAllLink && 
               !selectAllMatching && 
               allPageSelected && 
               totalCount > analyses.length && (
                <Button
                  variant="link"
                  size="sm"
                  onClick={bulkActions.onSelectAllMatching}
                  className="text-muted-foreground hover:text-foreground h-auto p-0"
                >
                  Select all {totalCount.toLocaleString()}
                </Button>
              )}
            </div>
            {(bulkActions.actions?.length > 0 || bulkActions.customActions || bulkActions.onClearSelection || (onDateDeselect && selectedDates.size > 0)) && (
              <div className="flex items-center space-x-2">
                {bulkActions.actions?.map((action, index) => (
                  <Button
                    key={index}
                    variant={action.variant || "outline"}
                    size={action.size || "sm"}
                    disabled={action.disabled}
                    onClick={async () => {
                      const dates = selectAllMatching 
                        ? analyses.map(a => a.date) 
                        : Array.from(selectedDates);
                      await action.onClick(dates);
                    }}
                  >
                    {action.icon}
                    {action.label}
                  </Button>
                ))}
                {bulkActions.customActions}
                {(bulkActions.onClearSelection || (onDateDeselect && selectedDates.size > 0)) && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={bulkActions.onClearSelection || (() => {
                      // Default clear behavior: deselect all selected dates
                      selectedDates.forEach(date => onDateDeselect?.(date));
                    })}
                    className="text-muted-foreground hover:text-foreground"
                    title="Clear selection"
                  >
                    <X className="w-4 h-4" />
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Table */}
      <div className="rounded-md border">
        <Table>
        <TableHeader>
          <TableRow>
            {showCheckbox && (
              <TableHead className="w-12">
                <span className="sr-only">Select</span>
              </TableHead>
            )}
            <TableHead className="w-36">Date</TableHead>
            <TableHead>Summary</TableHead>
            <TableHead className="w-32">Tags</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {analyses.map((analysis) => {
            const isSelected = selectedDates.has(analysis.date);

            return (
              <TableRow
                key={analysis.date}
                data-state={isSelected ? "selected" : undefined}
                className={`cursor-pointer transition-colors ${
                  isSelected 
                    ? "bg-blue-500/10 hover:bg-blue-500/15" 
                    : "hover:bg-sidebar-accent"
                }`}
                onClick={() => onRowClick?.(analysis.date)}
              >
                {showCheckbox && (
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      checked={isSelected}
                      onCheckedChange={() => toggleDateSelection(analysis.date)}
                    />
                  </TableCell>
                )}
                <TableCell className="font-medium text-sm whitespace-nowrap">
                  {(() => {
                    const date = new Date(analysis.date);
                    const day = date.getDate();
                    const month = date.toLocaleDateString("en-US", { month: "short" });
                    const year = date.getFullYear();
                    return `${day} ${month} ${year}`;
                  })()}
                </TableCell>
                <TableCell>
                  <p className="text-sm text-foreground/90">{analysis.summary}</p>
                </TableCell>
                <TableCell>
                  {analysis.tags_version2 && analysis.tags_version2.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {analysis.tags_version2.slice(0, 3).map((tagName, idx) => {
                        const category = getTagCategory(tagName, catalogData);
                        const Icon = getCategoryIcon(category);
                        return (
                          <Badge
                            key={`${tagName}-${idx}`}
                            variant="outline"
                            className={`${getCategoryColor(category)} text-xs px-1.5 py-0.5 flex items-center space-x-1 ${
                              onTagClick ? "cursor-pointer hover:opacity-80 transition-opacity" : ""
                            }`}
                            title={tagName}
                            onClick={onTagClick ? (e) => {
                              e.stopPropagation();
                              onTagClick(tagName);
                            } : undefined}
                          >
                            <Icon className="w-2.5 h-2.5" />
                            <span className="truncate max-w-[60px]">{tagName}</span>
                          </Badge>
                        );
                      })}
                      {analysis.tags_version2.length > 3 && (
                        <Badge variant="secondary" className="text-xs">
                          +{analysis.tags_version2.length - 3}
                        </Badge>
                      )}
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      </div>

      {/* Pagination Controls - Bottom */}
      {showPagination && totalCount > 0 && totalPages > 0 && (
        <div className="flex items-center justify-between mt-4 pt-4 border-t">
          <div className="text-sm text-muted-foreground">
            Showing {((currentPage - 1) * pageSize) + 1}-{Math.min(currentPage * pageSize, totalCount).toLocaleString()} of {totalCount.toLocaleString()}
          </div>
          {onPageChange && (
            <div className="flex items-center space-x-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => onPageChange(Math.max(1, currentPage - 1))}
                disabled={currentPage === 1}
                data-testid="button-prev-page"
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
                disabled={currentPage === totalPages}
                data-testid="button-next-page"
              >
                Next
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

