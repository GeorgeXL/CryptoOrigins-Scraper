import { useState, useMemo, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, ChevronRight, RefreshCw, FileText, Tags, ChevronDown, StopCircle } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { SiOpenai } from "react-icons/si";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarMenuSub,
  SidebarMenuSubItem,
  SidebarProvider,
} from "@/components/ui/sidebar";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { AnalysesTable, HistoricalNewsAnalysis } from "@/components/AnalysesTable";
import { supabase } from "@/lib/supabase";
import { useBulkReanalyze } from "@/hooks/useBulkReanalyze";
import { TaggingDropdown } from "@/components/TaggingDropdown";
import { ArticleSelectionDialog } from "@/components/ArticleSelectionDialog";
import { serializePageState, deserializePageState, type MonthlyViewState } from "@/lib/navigationState";

const YEARS = Array.from({ length: 16 }, (_, i) => 2009 + i); // 2009-2024
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

const MONTH_NUMBERS: Record<string, number> = {
  "January": 1, "February": 2, "March": 3, "April": 4, "May": 5, "June": 6,
  "July": 7, "August": 8, "September": 9, "October": 10, "November": 11, "December": 12
};

export default function MonthlyView() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);
  const [openYear, setOpenYear] = useState<number | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [selectedDates, setSelectedDates] = useState<Set<string>>(new Set());
  const { 
    isReanalyzing, 
    reanalyzeDates, 
    redoSummaries,
    cancelAnalysis,
    selectionRequest,
    isSelectionDialogOpen,
    setIsSelectionDialogOpen,
    confirmSelection,
    progress
  } = useBulkReanalyze();
  const [showManageTags, setShowManageTags] = useState(false);
  
  // Track previous search string to detect URL changes
  const prevSearchRef = useRef<string>(window.location.search);

  // Restore state from URL params on mount and when navigating back
  useEffect(() => {
    const checkAndRestore = () => {
      const currentSearch = window.location.search;
      
      // Only restore if URL actually changed (to avoid resetting user actions)
      if (currentSearch === prevSearchRef.current) {
        return;
      }
      
      prevSearchRef.current = currentSearch;
      const urlParams = new URLSearchParams(currentSearch);
      
      // Check for year/month params directly (from navigation back) or via deserializePageState
      const yearParam = urlParams.get('year');
      const monthParam = urlParams.get('month');
      const pageParam = urlParams.get('page');
      const pageSizeParam = urlParams.get('pageSize');
      
      // If we have year/month params, restore state directly
      if (yearParam || monthParam) {
        if (yearParam) {
          const year = parseInt(yearParam, 10);
          setSelectedYear(year);
          setOpenYear(year);
        }
        if (monthParam) {
          const monthNum = parseInt(monthParam, 10);
          const monthName = MONTHS[monthNum - 1];
          setSelectedMonth(monthName);
        }
        if (pageParam) setCurrentPage(parseInt(pageParam, 10));
        if (pageSizeParam) setPageSize(parseInt(pageSizeParam, 10));
      } else {
        // Fallback to deserializePageState for from=monthly format
        const restoredState = deserializePageState(urlParams);
        if (restoredState && restoredState.page === 'monthly') {
          const state = restoredState as MonthlyViewState;
          if (state.selectedYear !== null && state.selectedYear !== undefined) {
            setSelectedYear(state.selectedYear);
            setOpenYear(state.selectedYear);
          }
          if (state.selectedMonth !== null && state.selectedMonth !== undefined) {
            const monthName = MONTHS[state.selectedMonth - 1];
            setSelectedMonth(monthName);
          }
          if (state.currentPage) setCurrentPage(state.currentPage);
          if (state.pageSize) setPageSize(state.pageSize);
        }
      }
    };

    // Check immediately on mount
    checkAndRestore();

    // Check more frequently for programmatic navigation (setLocation from wouter)
    const interval = setInterval(checkAndRestore, 50);
    
    // Listen to popstate for browser back/forward
    window.addEventListener('popstate', checkAndRestore);
    
    // Also listen to hashchange as fallback
    window.addEventListener('hashchange', checkAndRestore);
    
    return () => {
      clearInterval(interval);
      window.removeEventListener('popstate', checkAndRestore);
      window.removeEventListener('hashchange', checkAndRestore);
    };
  }, []);

  // Generate date range for selected month/year
  const dateRange = useMemo(() => {
    if (!selectedYear || !selectedMonth) return null;
    
    const monthNum = MONTH_NUMBERS[selectedMonth];
    const startDate = `${selectedYear}-${String(monthNum).padStart(2, '0')}-01`;
    
    // Get last day of month
    const lastDay = new Date(selectedYear, monthNum, 0).getDate();
    const endDate = `${selectedYear}-${String(monthNum).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    
    return { startDate, endDate };
  }, [selectedYear, selectedMonth]);

  // Fetch analyses for selected month
  const { data: analysesData, isLoading } = useQuery<{
    analyses: HistoricalNewsAnalysis[];
    pagination: { totalCount: number; totalPages: number };
  }>({
    queryKey: ['monthly-analyses', selectedYear, selectedMonth, currentPage, pageSize],
    queryFn: async () => {
      if (!supabase || !dateRange) {
        return { analyses: [], pagination: { totalCount: 0, totalPages: 0 } };
      }

      const { startDate, endDate } = dateRange;

      // Get total count
      const { count } = await supabase
        .from("historical_news_analyses")
        .select("*", { count: "exact", head: true })
        .gte("date", startDate)
        .lte("date", endDate);

      const totalCount = count || 0;
      const totalPages = Math.ceil(totalCount / pageSize);

      // Get paginated results
      const { data, error } = await supabase
        .from("historical_news_analyses")
        .select("date, summary, tags_version2, tier_used, is_manual_override")
        .gte("date", startDate)
        .lte("date", endDate)
        .order("date", { ascending: false })
        .range((currentPage - 1) * pageSize, currentPage * pageSize - 1);

      if (error) throw error;

      return {
        analyses: (data || []).map((item): HistoricalNewsAnalysis => ({
          date: item.date,
          summary: item.summary,
          tags_version2: item.tags_version2 || null,
          tier: item.tier_used || undefined,
          url: undefined,
          source_url: undefined,
          isManualOverride: item.is_manual_override || false,
        })),
        pagination: { totalCount, totalPages },
      };
    },
    enabled: !!dateRange,
  });

  const analyses = analysesData?.analyses || [];
  const totalCount = analysesData?.pagination.totalCount || 0;
  const totalPages = analysesData?.pagination.totalPages || 1;
  
  // Check if all items on current page are selected
  const allPageSelected = analyses.length > 0 && analyses.every(a => selectedDates.has(a.date));

  const handleMonthSelect = (year: number, month: string) => {
    setSelectedYear(year);
    setSelectedMonth(month);
    setOpenYear(year);
    setCurrentPage(1);
    setSelectedDates(new Set());
    
    // Update URL to match the new selection
    const params = new URLSearchParams();
    params.set('year', year.toString());
    params.set('month', MONTH_NUMBERS[month].toString());
    params.set('page', '1');
    params.set('pageSize', pageSize.toString());
    const newUrl = `/monthly?${params.toString()}`;
    prevSearchRef.current = `?${params.toString()}`; // Update ref to prevent polling from resetting
    navigate(newUrl, { replace: true });
  };

  const toggleDateSelection = (date: string) => {
    setSelectedDates((prev) => {
      const next = new Set(prev);
      if (next.has(date)) {
        next.delete(date);
      } else {
        next.add(date);
      }
      return next;
    });
  };

  return (
    <SidebarProvider className="w-full">
      <div className="flex flex-col gap-6 lg:flex-row">
        {/* Sidebar */}
        <div className="lg:w-72 shrink-0">
          <Sidebar collapsible="none" className="rounded-xl bg-sidebar/40">
            <SidebarHeader className="pt-0" />
            <SidebarContent>
              <SidebarGroup>
                <SidebarGroupLabel>Years</SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {YEARS.map((year) => (
                      <SidebarMenuItem key={year}>
                        <Collapsible
                          className="group/collapsible [&[data-state=open]>button>svg:first-child]:rotate-90"
                          open={openYear === year}
                          onOpenChange={(open) => setOpenYear(open ? year : null)}
                        >
                          <CollapsibleTrigger asChild>
                            <SidebarMenuButton className="justify-start gap-2">
                              <ChevronRight className="h-3 w-3 transition-transform" />
                              <span>{year}</span>
                            </SidebarMenuButton>
                          </CollapsibleTrigger>
                          <CollapsibleContent>
                            <SidebarMenuSub>
                              {MONTHS.map((month) => {
                                const isSelected = selectedYear === year && selectedMonth === month;
                                return (
                                  <SidebarMenuSubItem key={month}>
                                    <SidebarMenuButton
                                      isActive={isSelected}
                                      className="w-full justify-start text-xs h-7 data-[active=true]:bg-white data-[active=true]:text-black"
                                      onClick={() => handleMonthSelect(year, month)}
                                    >
                                      {month}
                                    </SidebarMenuButton>
                                  </SidebarMenuSubItem>
                                );
                              })}
                            </SidebarMenuSub>
                          </CollapsibleContent>
                        </Collapsible>
                      </SidebarMenuItem>
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            </SidebarContent>
          </Sidebar>
        </div>

      {/* Main Content */}
      <div className="flex-1 space-y-4">
        <Card className="pt-0 px-6 pb-6 border-0">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center space-x-3">
              <h2 className="text-lg font-semibold text-foreground">
                {selectedYear && selectedMonth
                  ? `${selectedMonth} ${selectedYear}`
                  : "Select a month"}
              </h2>
              {totalCount > 0 && (
                <Badge variant="secondary" className="font-normal">
                  {totalCount.toLocaleString()} result{totalCount !== 1 ? "s" : ""}
                </Badge>
              )}
            </div>
          </div>

          {!selectedYear || !selectedMonth ? (
            <div className="text-center py-12">
              <p className="text-muted-foreground">
                Select a year and month from the sidebar to view analyses
              </p>
            </div>
          ) : (
            <>
              {/* Analyses Table */}
              <AnalysesTable
                analyses={analyses}
                isLoading={isLoading}
                selectedDates={selectedDates}
                onDateSelect={toggleDateSelection}
                onDateDeselect={toggleDateSelection}
                onRowClick={(date) => {
                  const state: MonthlyViewState = {
                    page: 'monthly',
                    selectedYear,
                    selectedMonth: selectedMonth ? MONTH_NUMBERS[selectedMonth] : null,
                    currentPage,
                    pageSize,
                  };
                  const query = serializePageState(state);
                  navigate(`/day/${date}?${query}`);
                }}
                emptyMessage={`No analyses found for ${selectedMonth} ${selectedYear}`}
                showCheckbox={true}
                pageSize={pageSize}
                currentPage={currentPage}
                totalCount={totalCount}
                onPageChange={(page) => setCurrentPage(page)}
                onPageSizeChange={(size) => {
                  setPageSize(size);
                  setCurrentPage(1);
                }}
                pageSizeOptions={[50, 200, 500]}
                showPagination={true}
                showSelectAll={false}
                showBulkActions={true}
                bulkActions={{
                  showSelectAllLink: false,
                  onClearSelection: () => {
                    setSelectedDates(new Set());
                  },
                  customActions: (
                    <>
                      {/* Re-analyze Dropdown or Stop Button */}
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
                            <Button
                              variant="outline"
                              size="sm"
                              title="Re-analyze"
                            >
                              <RefreshCw className="w-4 h-4 mr-2" />
                              Re-analyze
                              <ChevronDown className="w-4 h-4 ml-2" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onClick={async () => {
                                const dates = Array.from(selectedDates);
                                await reanalyzeDates(dates);
                              }}
                            >
                              <RefreshCw className="w-4 h-4 mr-2" />
                              Analyse Days
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={async () => {
                                const dates = Array.from(selectedDates);
                                await redoSummaries(dates);
                              }}
                            >
                              <FileText className="w-4 h-4 mr-2" />
                              Redo Summaries
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}

                      {/* Tagging Dropdown */}
                      <TaggingDropdown
                        selectedDates={Array.from(selectedDates)}
                        selectAllMatching={false}
                        onDatesResolve={() => analyses.map(a => a.date)}
                      />

                      {/* Manage Tags Button */}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setShowManageTags(true)}
                      >
                        <Tags className="w-4 h-4 mr-2" />
                        Manage Tags
                      </Button>
                    </>
                  ),
                }}
              />
            </>
          )}
        </Card>

        {/* Article Selection Dialog for Bulk Re-analyze */}
        {selectionRequest && (
          <ArticleSelectionDialog
            open={isSelectionDialogOpen}
            onOpenChange={setIsSelectionDialogOpen}
            date={selectionRequest.date}
            selectionMode={selectionRequest.selectionData.selectionMode}
            tieredArticles={selectionRequest.selectionData.tieredArticles || { bitcoin: [], crypto: [], macro: [] }}
            geminiSelectedIds={selectionRequest.selectionData.geminiSelectedIds}
            perplexitySelectedIds={selectionRequest.selectionData.perplexitySelectedIds}
            intersectionIds={selectionRequest.selectionData.intersectionIds}
            openaiSuggestedId={selectionRequest.selectionData.openaiSuggestedId}
            onConfirm={confirmSelection}
          />
        )}
      </div>
    </div>
    </SidebarProvider>
  );
}

