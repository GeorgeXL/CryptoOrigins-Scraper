import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, ChevronRight, RefreshCw, FileText, Tags, ChevronDown } from "lucide-react";
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
  const [isReanalyzing, setIsReanalyzing] = useState(false);
  const [isCategorizing, setIsCategorizing] = useState(false);
  const [showManageTags, setShowManageTags] = useState(false);

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
                  navigate(`/day/${date}?from=monthly`);
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
                      {/* Re-analyze Dropdown */}
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={isReanalyzing}
                            title="Re-analyze"
                          >
                            <RefreshCw className={`w-4 h-4 mr-2 ${isReanalyzing ? 'animate-spin' : ''}`} />
                            Re-analyze
                            <ChevronDown className="w-4 h-4 ml-2" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={async () => {
                              setIsReanalyzing(true);
                              const dates = Array.from(selectedDates);
                              
                              for (const date of dates) {
                                try {
                                  await fetch(`/api/analysis/date/${date}`, { method: 'POST' });
                                } catch (err) {
                                  console.error(`Failed to analyze ${date}:`, err);
                                }
                              }
                              setIsReanalyzing(false);
                              queryClient.invalidateQueries({ queryKey: ['monthly-analyses'] });
                              toast({
                                title: "Re-analysis complete",
                                description: `Analyzed ${dates.length} date(s)`,
                              });
                            }}
                            disabled={isReanalyzing}
                          >
                            <RefreshCw className="w-4 h-4 mr-2" />
                            Analyse Days
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={async () => {
                              setIsReanalyzing(true);
                              const dates = Array.from(selectedDates);
                              
                              for (const date of dates) {
                                try {
                                  await fetch(`/api/analysis/date/${date}/redo-summary`, { method: 'POST' });
                                } catch (err) {
                                  console.error(`Failed to redo summary for ${date}:`, err);
                                }
                              }
                              setIsReanalyzing(false);
                              queryClient.invalidateQueries({ queryKey: ['monthly-analyses'] });
                              toast({
                                title: "Summaries updated",
                                description: `Redid summaries for ${dates.length} date(s)`,
                              });
                            }}
                            disabled={isReanalyzing}
                          >
                            <FileText className="w-4 h-4 mr-2" />
                            Redo Summaries
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>

                      {/* Auto Tagging Button */}
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={isCategorizing}
                        onClick={async () => {
                          setIsCategorizing(true);
                          try {
                            await fetch('/api/tags/categorize/start', { method: 'POST' });
                            toast({
                              title: "Auto Tagging started",
                              description: "AI is categorizing tags in the background",
                            });
                          } catch (err) {
                            toast({
                              title: "Error",
                              description: "Failed to start auto tagging",
                              variant: "destructive",
                            });
                          }
                          setIsCategorizing(false);
                        }}
                      >
                        {isCategorizing ? (
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        ) : (
                          <SiOpenai className="w-4 h-4 mr-2" />
                        )}
                        Auto Tagging
                      </Button>

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
      </div>
    </div>
    </SidebarProvider>
  );
}

