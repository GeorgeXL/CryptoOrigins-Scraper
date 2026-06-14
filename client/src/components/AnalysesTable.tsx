import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
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
import { Loader2, Tag, Check, X, RefreshCw, FileText, ChevronDown, Lock, LockOpen, AlertTriangle } from "lucide-react";
import { formatTopicLeafWithGroup } from "@shared/topic-hierarchy";
import { parseIsLocked } from "@/lib/parseIsLocked";
import { fetchPendingAgentQueueByDates } from "@/lib/pendingAgentQueue";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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
   isFlagged?: boolean;
  isLocked?: boolean;
  googleCheckHappened?: "yes" | "no" | "uncertain" | null;
  googleCheckCheckedAt?: string | null;
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

export type AnalysisRowAnnotation = {
  storylineFit?: {
    status: "ok" | "mismatch" | "uncertain";
    reason?: string;
    suggestedLeaves?: string[];
  };
};

export type GoogleCheckSummary = {
  yes: number;
  no: number;
  uncertain: number;
  unverified: number;
};

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
  // Row context actions
  getRowHref?: (analysis: HistoricalNewsAnalysis) => string;
  onOpenInNewTab?: (analysis: HistoricalNewsAnalysis) => void;
  onToggleFlag?: (analysis: HistoricalNewsAnalysis) => void;
  rowAnnotations?: Record<string, AnalysisRowAnnotation>;
  googleCheckSummary?: GoogleCheckSummary | null;
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
  getRowHref,
  onOpenInNewTab,
  onToggleFlag,
  rowAnnotations,
  googleCheckSummary,
}: AnalysesTableProps) {
  const [contextMenuOpen, setContextMenuOpen] = useState(false);
  const [contextMenuPos, setContextMenuPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [contextTarget, setContextTarget] = useState<HistoricalNewsAnalysis | null>(null);

  const visibleDates = useMemo(
    () => analyses.map((analysis) => analysis.date).sort().join(","),
    [analyses],
  );

  const { data: pendingQueueByDate = {} } = useQuery({
    queryKey: ["pending-agent-queue-batch", visibleDates],
    queryFn: () => fetchPendingAgentQueueByDates(analyses.map((analysis) => analysis.date)),
    enabled: analyses.length > 0,
    staleTime: 30_000,
    retry: false,
  });

  const resolveRowHref = (analysis: HistoricalNewsAnalysis) => {
    return getRowHref ? getRowHref(analysis) : `/day/${analysis.date}`;
  };

  const handleOpenInNewTab = () => {
    if (!contextTarget) return;
    if (onOpenInNewTab) {
      onOpenInNewTab(contextTarget);
    } else {
      const url = resolveRowHref(contextTarget);
      window.open(url, "_blank", "noreferrer");
    }
    setContextMenuOpen(false);
  };

  const handleToggleFlag = () => {
    if (!contextTarget || !onToggleFlag) return;
    onToggleFlag(contextTarget);
    setContextMenuOpen(false);
  };

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
        <div className="flex items-center justify-between gap-4 mb-2 pb-2">
          {showSelectAll && showCheckbox ? (
            <div className="flex items-center space-x-4 shrink-0">
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
          ) : (
            <div className="shrink-0" />
          )}

          {googleCheckSummary ? (
            <div className="flex flex-1 flex-wrap items-center justify-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" aria-hidden />
                {googleCheckSummary.yes} happened
              </span>
              {googleCheckSummary.no > 0 ? (
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 shrink-0 rounded-full bg-red-500" aria-hidden />
                  {googleCheckSummary.no} didn&apos;t happen
                </span>
              ) : null}
              {googleCheckSummary.uncertain > 0 ? (
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 shrink-0 rounded-full bg-amber-500" aria-hidden />
                  {googleCheckSummary.uncertain} uncertain
                </span>
              ) : null}
              {googleCheckSummary.unverified === 0 ? (
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" aria-hidden />
                  all verified
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 shrink-0 rounded-full bg-muted-foreground/40" aria-hidden />
                  {googleCheckSummary.unverified} not verified
                </span>
              )}
            </div>
          ) : (
            <div className="flex-1" />
          )}
          
          {onPageSizeChange ? (
            <div className="flex items-center space-x-3 shrink-0">
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
          ) : (
            <div className="shrink-0" />
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
            {((bulkActions.actions?.length ?? 0) > 0 || bulkActions.customActions || bulkActions.onClearSelection || (onDateDeselect && selectedDates.size > 0)) && (
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
            <TableHead className="w-8 px-1"><span className="sr-only">Lock</span></TableHead>
            <TableHead>Summary</TableHead>
            <TableHead className="w-32">Tags</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {analyses.map((analysis) => {
            const isSelected = selectedDates.has(analysis.date);
            const isLocked = parseIsLocked(analysis.isLocked);
            const pendingItems = pendingQueueByDate[analysis.date] ?? [];

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
                onContextMenu={(e) => {
                  if (isLocked) return;
                  e.preventDefault();
                  setContextTarget(analysis);
                  setContextMenuPos({ x: e.clientX, y: e.clientY });
                  setContextMenuOpen(true);
                }}
              >
                {showCheckbox && (
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      checked={isSelected}
                      disabled={isLocked}
                      onCheckedChange={() => {
                        if (!isLocked) toggleDateSelection(analysis.date);
                      }}
                    />
                  </TableCell>
                )}
                <TableCell className="font-medium text-sm whitespace-nowrap">
                  <div className="flex items-center gap-1.5">
                    {pendingItems.length > 0 ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span
                            className="inline-flex shrink-0 items-center justify-center"
                            aria-label="Pending admin agent review"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <AlertTriangle className="h-3.5 w-3.5 text-orange-400" strokeWidth={2.25} />
                          </span>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="max-w-xs">
                          <p className="font-medium text-foreground">Pending admin agent review</p>
                          <ul className="mt-1.5 space-y-1 text-xs text-muted-foreground">
                            {pendingItems.map((item) => (
                              <li key={item.id}>
                                <span className="font-medium text-orange-300">{item.queue}</span>
                                {" — "}
                                {item.label}
                              </li>
                            ))}
                          </ul>
                        </TooltipContent>
                      </Tooltip>
                    ) : (
                      <span className="inline-flex h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    )}
                    <span>
                      {(() => {
                        const date = new Date(analysis.date);
                        const day = date.getDate();
                        const month = date.toLocaleDateString("en-US", { month: "short" });
                        const year = date.getFullYear();
                        return `${day} ${month} ${year}`;
                      })()}
                    </span>
                  </div>
                </TableCell>
                <TableCell className="w-8 px-1">
                  {isLocked ? (
                    <Lock className="h-3.5 w-3.5 text-amber-400" aria-label="Locked" />
                  ) : (
                    <LockOpen className="h-3.5 w-3.5 text-muted-foreground" aria-label="Unlocked" />
                  )}
                </TableCell>
                <TableCell>
                  <div className="space-y-1.5">
                    <p className="text-sm text-foreground/90">{analysis.summary}</p>
                    {(() => {
                      const annotation = rowAnnotations?.[analysis.date];
                      const fit = annotation?.storylineFit;
                      const googleHappened = analysis.googleCheckHappened;
                      if (!fit && !googleHappened) return null;

                      return (
                        <div className="space-y-1.5">
                          {fit && fit.status !== "ok" ? (
                            <div className="rounded-lg border border-amber-500/30 bg-amber-500/[0.04] p-2">
                              <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-400">
                                {fit.status === "mismatch" ? "May not belong here" : "Storyline uncertain"}
                              </p>
                              {fit.reason ? (
                                <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{fit.reason}</p>
                              ) : null}
                              {fit.suggestedLeaves && fit.suggestedLeaves.length > 0 ? (
                                <div className="mt-2 flex flex-wrap gap-1.5">
                                  {fit.suggestedLeaves.map((leaf) => (
                                    <span
                                      key={`${analysis.date}-${leaf}`}
                                      className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-200"
                                    >
                                      {formatTopicLeafWithGroup(leaf)}
                                    </span>
                                  ))}
                                </div>
                              ) : null}
                            </div>
                          ) : null}
                          {googleHappened ? (
                            <span
                              className={
                                googleHappened === "yes"
                                  ? "inline-flex items-center gap-1 text-[11px] font-medium text-emerald-400"
                                  : googleHappened === "uncertain"
                                    ? "inline-flex items-center gap-1 text-[11px] font-medium text-amber-400"
                                    : "inline-flex items-center gap-1 text-[11px] font-medium text-red-400"
                              }
                            >
                              {googleHappened === "yes" ? (
                                <>
                                  <Check className="h-3 w-3" aria-hidden />
                                  Happened
                                </>
                              ) : googleHappened === "uncertain" ? (
                                <>
                                  <AlertTriangle className="h-3 w-3" aria-hidden />
                                  Couldn&apos;t verify
                                </>
                              ) : (
                                <>
                                  <X className="h-3 w-3" aria-hidden />
                                  Didn&apos;t happen
                                </>
                              )}
                            </span>
                          ) : null}
                        </div>
                      );
                    })()}
                  </div>
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
      <DropdownMenu
        open={contextMenuOpen}
        onOpenChange={(open) => {
          setContextMenuOpen(open);
          if (!open) setContextTarget(null);
        }}
      >
        <DropdownMenuTrigger asChild>
          <button className="hidden" aria-label="Row actions trigger" />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          className="w-44"
          style={{ position: "fixed", left: contextMenuPos.x, top: contextMenuPos.y }}
        >
          <DropdownMenuItem onSelect={(e) => { e.preventDefault(); handleOpenInNewTab(); }}>
            Open in new tab
          </DropdownMenuItem>
          {onToggleFlag && (
            <DropdownMenuItem onSelect={(e) => { e.preventDefault(); handleToggleFlag(); }}>
              {contextTarget?.isFlagged ? "Unflag" : "Flag"}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
