import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Trash2, Calendar, Loader2, ChevronRight, AlertTriangle, X, Pencil, CheckCircle2, Filter, Check, AlertCircle, XCircle, ArrowUpDown } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface ConflictCluster {
  clusterId: string;
  dates: string[];
  conflictIds: number[];
}

interface QualityViolation {
  date: string;
  summary: string;
  violations: string[];
  length: number;
}

interface FactCheckResult {
  date: string;
  summary: string;
  verdict: 'verified' | 'contradicted' | 'uncertain';
  confidence: number;
  reasoning: string;
  checkedAt: string;
}

interface PerplexityFactCheckResult {
  date: string;
  summary: string;
  verdict: 'verified' | 'contradicted' | 'uncertain';
  confidence: number;
  reasoning: string;
  correctDateText?: string | null;
  citations: string[];
  checkedAt: string;
  manualEntryProtected: boolean;
  reVerified?: boolean;
  reVerificationSummary?: string;
  reVerificationDate?: string | null;
  reVerificationStatus?: 'success' | 'problem';
  reVerificationWinner?: 'original' | 'corrected';
  reVerificationReasoning?: string;
  otherDuplicateDates?: string[];
}

export default function Cleaner() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [selectedYear, setSelectedYear] = useState<string>("2009");
  const [showAllYearsWarning, setShowAllYearsWarning] = useState(false);
  const [sortOrder, setSortOrder] = useState<"fewest" | "most">("fewest");
  const [activeTab, setActiveTab] = useState<"conflicts" | "quality" | "factcheck" | "perplexity">("conflicts");
  
  // Fact-check filters and sorting
  const [factCheckFilter, setFactCheckFilter] = useState<string>("all");
  const [factCheckSort, setFactCheckSort] = useState<"date-desc" | "confidence-asc">("date-desc");
  
  // Perplexity fact-check filters and sorting
  const [perplexityFilter, setPerplexityFilter] = useState<string>("all");
  const [perplexitySort, setPerplexitySort] = useState<"date-desc" | "confidence-asc">("date-desc");
  
  // Bulk selection for Perplexity fact-check
  const [selectedPerplexityDates, setSelectedPerplexityDates] = useState<Set<string>>(new Set());
  const [bulkProcessing, setBulkProcessing] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<{ current: number; total: number } | null>(null);
  const [bulkAbortController, setBulkAbortController] = useState<AbortController | null>(null);
  
  // Violation filters
  const [selectedFilters, setSelectedFilters] = useState<Set<string>>(new Set());
  
  const violationTypes = [
    { id: 'too-short', label: 'Too short (< 100 chars)', color: 'bg-red-100 text-red-700 border-red-300' },
    { id: 'too-long', label: 'Too long (> 110 chars)', color: 'bg-red-100 text-red-700 border-red-300' },
    { id: 'ends-period', label: 'Ends with period', color: 'bg-orange-100 text-orange-700 border-orange-300' },
    { id: 'has-hyphen', label: 'Contains space-hyphen ( -)', color: 'bg-yellow-100 text-yellow-700 border-yellow-300' },
    { id: 'truncated', label: 'Truncated ending', color: 'bg-purple-100 text-purple-700 border-purple-300' },
  ];
  
  const toggleFilter = (filterId: string) => {
    setSelectedFilters(prev => {
      const newSet = new Set(prev);
      if (newSet.has(filterId)) {
        newSet.delete(filterId);
      } else {
        newSet.add(filterId);
      }
      return newSet;
    });
  };

  // Generate year options (2009-2025)
  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: currentYear - 2008 }, (_, i) => 2009 + i);

  // Fetch conflicts based on selected year
  const { data: conflicts = [], isLoading: conflictsLoading, refetch: refetchConflicts } = useQuery<ConflictCluster[]>({
    queryKey: ["/api/conflicts", selectedYear],
    queryFn: async () => {
      if (selectedYear === "all") {
        const allConflicts = await fetch("/api/conflicts/all").then(r => r.json());
        
        // Group conflicts by clusterId
        const clusters = new Map<string, { clusterId: string; dateSet: Set<string>; conflictIds: number[] }>();
        
        for (const conflict of allConflicts) {
          const clusterId = conflict.clusterId;
          
          if (!clusters.has(clusterId)) {
            clusters.set(clusterId, {
              clusterId,
              dateSet: new Set<string>(),
              conflictIds: [],
            });
          }
          
          const cluster = clusters.get(clusterId)!;
          
          // Add both source and related dates to the cluster
          cluster.dateSet.add(conflict.sourceDate);
          cluster.dateSet.add(conflict.relatedDate);
          cluster.conflictIds.push(conflict.id);
        }
        
        // Convert to final cluster format (no summaries)
        const clustersArray: ConflictCluster[] = [];
        
        for (const cluster of clusters.values()) {
          const dates = Array.from(cluster.dateSet).sort();
          
          clustersArray.push({
            clusterId: cluster.clusterId,
            dates,
            conflictIds: cluster.conflictIds,
          });
        }
        
        return clustersArray.sort((a, b) => 
          b.clusterId.localeCompare(a.clusterId)
        );
      } else {
        const response = await fetch(`/api/conflicts/year/${selectedYear}`);
        return response.json();
      }
    },
    enabled: activeTab === "conflicts"
  });

  // Fetch quality violations
  const { data: qualityData, isLoading: qualityLoading, refetch: refetchQuality } = useQuery({
    queryKey: ["/api/quality-check/violations"],
    queryFn: async () => {
      const response = await fetch("/api/quality-check/violations");
      return response.json();
    },
    enabled: activeTab === "quality"
  });

  // Fetch fact-check results
  const { data: factCheckData, isLoading: factCheckLoading } = useQuery({
    queryKey: ["/api/fact-check/results"],
    queryFn: async () => {
      const response = await fetch("/api/fact-check/results");
      return response.json();
    },
    enabled: activeTab === "factcheck"
  });

  // Fetch Perplexity fact-check results
  const { data: perplexityData, isLoading: perplexityLoading } = useQuery({
    queryKey: ["/api/perplexity-fact-check/results"],
    queryFn: async () => {
      const response = await fetch("/api/perplexity-fact-check/results");
      return response.json();
    },
    enabled: activeTab === "perplexity",
    // Disable automatic refetching during bulk processing to prevent UI freeze
    refetchOnWindowFocus: !bulkProcessing,
    refetchOnMount: !bulkProcessing,
    refetchOnReconnect: !bulkProcessing,
  });

  const allViolations = (qualityData?.data || []) as QualityViolation[];
  const allFactCheckResults = (factCheckData?.data || []) as FactCheckResult[];
  const allPerplexityResults = (perplexityData?.data || []) as PerplexityFactCheckResult[];
  
  // Filter and sort fact-check results
  const factCheckResults = useMemo(() => {
    let filtered = [...allFactCheckResults];
    
    // Apply filter
    if (factCheckFilter !== "all") {
      filtered = filtered.filter(result => result.verdict === factCheckFilter);
    }
    
    // Apply sort
    if (factCheckSort === "date-desc") {
      filtered.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    } else if (factCheckSort === "confidence-asc") {
      filtered.sort((a, b) => a.confidence - b.confidence);
    }
    
    return filtered;
  }, [allFactCheckResults, factCheckFilter, factCheckSort]);
  
  // Calculate fact-check stats
  const factCheckStats = useMemo(() => {
    const verified = allFactCheckResults.filter(r => r.verdict === 'verified').length;
    const contradicted = allFactCheckResults.filter(r => r.verdict === 'contradicted').length;
    const uncertain = allFactCheckResults.filter(r => r.verdict === 'uncertain').length;
    return { verified, contradicted, uncertain, total: allFactCheckResults.length };
  }, [allFactCheckResults]);

  // Filter and sort Perplexity fact-check results
  const perplexityResults = useMemo(() => {
    let filtered = [...allPerplexityResults];
    
    // Apply filter
    if (perplexityFilter !== "all") {
      filtered = filtered.filter(result => result.verdict === perplexityFilter);
    }
    
    // Apply sort
    if (perplexitySort === "date-desc") {
      filtered.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    } else if (perplexitySort === "confidence-asc") {
      filtered.sort((a, b) => a.confidence - b.confidence);
    }
    
    return filtered;
  }, [allPerplexityResults, perplexityFilter, perplexitySort]);
  
  // Calculate Perplexity fact-check stats
  const perplexityStats = useMemo(() => {
    const verified = allPerplexityResults.filter(r => r.verdict === 'verified').length;
    const contradicted = allPerplexityResults.filter(r => r.verdict === 'contradicted').length;
    const uncertain = allPerplexityResults.filter(r => r.verdict === 'uncertain').length;
    return { verified, contradicted, uncertain, total: allPerplexityResults.length };
  }, [allPerplexityResults]);
  
  // Filter violations based on selected filters
  const violations = useMemo(() => {
    if (selectedFilters.size === 0) {
      return allViolations;
    }
    
    return allViolations.filter(violation => {
      const matchesFilters = Array.from(selectedFilters).some(filterId => {
        switch(filterId) {
          case 'too-short':
            return violation.violations.some(v => v.startsWith('Too short'));
          case 'too-long':
            return violation.violations.some(v => v.startsWith('Too long'));
          case 'ends-period':
            return violation.violations.some(v => v.startsWith('Ends with period'));
          case 'has-hyphen':
            return violation.violations.some(v => v.startsWith('Contains hyphen'));
          case 'truncated':
            return violation.violations.some(v => v.startsWith('Ends with "'));
          default:
            return false;
        }
      });
      return matchesFilters;
    });
  }, [allViolations, selectedFilters]);

  const handleDismissConflict = async (conflictId: number) => {
    try {
      await apiRequest("DELETE", `/api/conflicts/${conflictId}`);

      toast({
        title: "Conflict dismissed",
        description: "The conflict has been removed",
      });

      refetchConflicts();
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to dismiss conflict",
      });
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    });
  };

  const handleYearChange = (year: string) => {
    setSelectedYear(year);
    if (year === "all") {
      setShowAllYearsWarning(true);
    }
  };

  const handleEditViolation = (date: string) => {
    // Navigate to the ViolationCockpit
    navigate(`/violation/${date}`);
  };

  const handleEditFactCheck = (date: string) => {
    // Navigate to the FactCheckCockpit
    navigate(`/fact-check/${date}`);
  };

  // Cleanup handlers (new system using Perplexity comparison + replacement)
  const [cleanupDialogOpen, setCleanupDialogOpen] = useState(false);
  const [cleanupResult, setCleanupResult] = useState<any>(null);
  const [cleanupLoading, setCleanupLoading] = useState(false);

  const handleCleanupSingle = async (date: string) => {
    try {
      setCleanupLoading(true);
      setCleanupDialogOpen(true);
      setCleanupResult(null);

      const response = await apiRequest("POST", '/api/cleanup/single', { date });
      const data = await response.json();

      setCleanupResult(data);
      setCleanupLoading(false);

      if (data.success) {
        toast({
          title: 'Cleanup successful',
          description: `Updated ${data.updatedDate} with new ${data.newTier} coverage`,
          variant: 'default'
        });

        // Refetch Perplexity data to show updated results
        await queryClient.invalidateQueries({ queryKey: ['/api/perplexity-fact-check/results'] });
      } else {
        toast({
          title: 'Cleanup completed with issues',
          description: data.message || 'Manual review required',
          variant: 'destructive'
        });
      }
    } catch (error) {
      setCleanupLoading(false);
      setCleanupResult({ error: (error as Error).message });
      toast({
        variant: 'destructive',
        title: 'Cleanup failed',
        description: (error as Error).message
      });
    }
  };

  // Toggle selection for a single date
  const togglePerplexitySelection = (date: string) => {
    setSelectedPerplexityDates(prev => {
      const newSet = new Set(prev);
      if (newSet.has(date)) {
        newSet.delete(date);
      } else {
        newSet.add(date);
      }
      return newSet;
    });
  };

  // Toggle select all
  const toggleSelectAllPerplexity = () => {
    if (selectedPerplexityDates.size === perplexityResults.length) {
      setSelectedPerplexityDates(new Set());
    } else {
      setSelectedPerplexityDates(new Set(perplexityResults.map(r => r.date)));
    }
  };

  // Stop bulk analysis
  const handleStopBulkAnalysis = () => {
    if (bulkAbortController) {
      bulkAbortController.abort();
      setBulkAbortController(null);
      setBulkProcessing(false);
      setBulkProgress(null);
      toast({
        title: 'Bulk analysis stopped',
        description: 'Processing has been cancelled',
      });
    }
  };

  // Bulk analyze selected items one by one
  const handleBulkAnalyzeSelected = async () => {
    if (selectedPerplexityDates.size === 0) {
      toast({
        title: 'No items selected',
        description: 'Please select at least one item to analyze',
        variant: 'destructive'
      });
      return;
    }

    // SNAPSHOT: Store selected dates at start to avoid issues when items change state
    const selectedDates = Array.from(selectedPerplexityDates);
    const abortController = new AbortController();
    setBulkAbortController(abortController);
    setBulkProcessing(true);
    setBulkProgress({ current: 0, total: selectedDates.length });

    try {
      let processedCount = 0;
      for (let i = 0; i < selectedDates.length; i++) {
        // Check if cancelled
        if (abortController.signal.aborted) {
          break;
        }

        const date = selectedDates[i];
        setBulkProgress({ current: i + 1, total: selectedDates.length });

        try {
          const response = await apiRequest("POST", '/api/cleaner/resolve-contradiction', { date });
          const data = await response.json();

          if (!data.success) {
            console.warn(`Failed to resolve ${date}:`, data.message);
          } else {
            processedCount++;
            
            // Remove processed date from selection immediately to prevent UI conflicts
            // This prevents the filtered view from causing issues as items change state
            setSelectedPerplexityDates(prev => {
              const newSet = new Set(prev);
              newSet.delete(date);
              return newSet;
            });
          }
        } catch (error) {
          // Don't log abort errors
          if (!abortController.signal.aborted) {
            console.error(`Error resolving ${date}:`, error);
          }
          // Continue with next item even if one fails (unless aborted)
          if (abortController.signal.aborted) {
            break;
          }
        }

        // Small delay between requests to avoid overwhelming the API
        if (i < selectedDates.length - 1 && !abortController.signal.aborted) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }

      if (!abortController.signal.aborted) {
        toast({
          title: 'Bulk analysis complete',
          description: `Processed ${processedCount} of ${selectedDates.length} item(s)`,
        });

        // Clear any remaining selection
        setSelectedPerplexityDates(new Set());
        
        // Only invalidate queries ONCE at the end, not during processing
        // Use a small delay to allow UI to settle before refreshing
        setTimeout(async () => {
          await queryClient.invalidateQueries({ queryKey: ['/api/perplexity-fact-check/results'] });
        }, 100);
      }
    } catch (error) {
      if (!abortController.signal.aborted) {
        toast({
          variant: 'destructive',
          title: 'Bulk analysis error',
          description: (error as Error).message
        });
      }
    } finally {
      setBulkProcessing(false);
      setBulkProgress(null);
      setBulkAbortController(null);
    }
  };

  const handleBulkReVerify = async () => {
    try {
      // Count how many events can be re-verified
      const toReVerify = allPerplexityResults.filter(
        r => r.verdict === 'contradicted' && r.correctDateText && !r.reVerified
      );

      if (toReVerify.length === 0) {
        toast({
          title: 'No events to re-verify',
          description: 'All contradicted events with corrected dates have already been re-verified',
        });
        return;
      }

      const response = await apiRequest("POST", '/api/re-verify/bulk');
      const data = await response.json();

      toast({
        title: 'Bulk re-verification started',
        description: `Processing ${data.total} events in the background`,
      });

      // Poll for updates (simple implementation - could be improved with WebSockets)
      const pollInterval = setInterval(async () => {
        await queryClient.invalidateQueries({ queryKey: ['/api/perplexity-fact-check/results'] });
      }, 5000); // Refresh every 5 seconds

      // Stop polling after 2 minutes (could be improved with completion detection)
      setTimeout(() => clearInterval(pollInterval), 120000);

    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Bulk re-verification failed',
        description: (error as Error).message
      });
    }
  };

  const getVerdictBadge = (verdict: 'verified' | 'contradicted' | 'uncertain' | null) => {
    switch (verdict) {
      case 'verified':
        return { icon: Check, color: 'bg-green-100 text-green-700 border-green-300', label: 'Verified' };
      case 'contradicted':
        return { icon: XCircle, color: 'bg-red-100 text-red-700 border-red-300', label: 'Contradicted' };
      case 'uncertain':
        return { icon: AlertCircle, color: 'bg-amber-100 text-amber-700 border-amber-300', label: 'Uncertain' };
      default:
        return { icon: AlertCircle, color: 'bg-slate-100 text-slate-700 border-slate-300', label: 'Unknown' };
    }
  };

  const getViolationBadgeColor = (violation: string): string => {
    if (violation.includes('short') || violation.includes('long')) {
      return 'bg-red-100 text-red-700 border-red-300';
    }
    if (violation.includes('period')) {
      return 'bg-orange-100 text-orange-700 border-orange-300';
    }
    if (violation.includes('hyphen')) {
      return 'bg-yellow-100 text-yellow-700 border-yellow-300';
    }
    if (violation.includes('Ends with')) {
      return 'bg-purple-100 text-purple-700 border-purple-300';
    }
    return 'bg-slate-100 text-slate-700 border-slate-300';
  };

  // Sort conflicts when in "All Years" mode
  const sortedConflicts = useMemo(() => {
    if (selectedYear !== "all") {
      return conflicts;
    }

    const sorted = [...conflicts];
    sorted.sort((a, b) => {
      if (sortOrder === "fewest") {
        return a.dates.length - b.dates.length;
      } else {
        return b.dates.length - a.dates.length;
      }
    });

    return sorted;
  }, [conflicts, selectedYear, sortOrder]);

  return (
    <div className="container mx-auto p-6 max-w-6xl">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-slate-900 mb-2">
          🧹 Event Cleaner
        </h1>
        <p className="text-slate-600">
          Review and manage duplicate events and quality issues
        </p>
      </div>

      {/* Main Tabs: Conflict Clusters vs Light Check vs Fact Check vs Perplexity Fact Check */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "conflicts" | "quality" | "factcheck" | "perplexity")} className="mb-6">
        <TabsList className="grid w-full max-w-3xl grid-cols-4">
          <TabsTrigger value="conflicts" data-testid="tab-conflict-clusters">
            Duplicates
          </TabsTrigger>
          <TabsTrigger value="quality" data-testid="tab-light-check">
            Quality
          </TabsTrigger>
          <TabsTrigger value="factcheck" data-testid="tab-fact-check">
            Fact Check
          </TabsTrigger>
          <TabsTrigger value="perplexity" data-testid="tab-perplexity">
            Fact Check 2 - Perplexity
          </TabsTrigger>
        </TabsList>

        {/* CONFLICT CLUSTERS TAB */}
        <TabsContent value="conflicts" className="mt-6">
          {/* Year Tabs */}
          <div className="mb-6">
            <Tabs value={selectedYear} onValueChange={handleYearChange}>
              <TabsList className="flex-wrap h-auto">
                {years.map(year => (
                  <TabsTrigger key={year} value={year.toString()} data-testid={`tab-year-${year}`}>
                    {year}
                  </TabsTrigger>
                ))}
                <TabsTrigger value="all" data-testid="tab-all-years">
                  All Years
                </TabsTrigger>
              </TabsList>
            </Tabs>

            {/* Warning for All Years */}
            {showAllYearsWarning && selectedYear === "all" && (
              <Alert className="mt-4 bg-yellow-50 border-yellow-200">
                <AlertTriangle className="h-4 w-4 text-yellow-600" />
                <AlertDescription className="flex items-center justify-between">
                  <span className="text-yellow-800">
                    Loading all years may slow down the page if you have many conflict clusters.
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowAllYearsWarning(false)}
                    className="ml-4 h-6 px-2 text-yellow-600 hover:text-yellow-700 hover:bg-yellow-100"
                    data-testid="dismiss-all-years-warning"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </AlertDescription>
              </Alert>
            )}

            {conflicts.length > 0 && (
              <div className="flex items-center justify-between mt-4">
                <div className="text-sm text-slate-600">
                  Found <span className="font-semibold text-slate-900">{conflicts.length}</span> conflict {conflicts.length === 1 ? 'cluster' : 'clusters'}
                </div>
                
                {selectedYear === "all" && (
                  <div className="flex items-center gap-2">
                    <label className="text-sm text-slate-600">Sort by:</label>
                    <Select value={sortOrder} onValueChange={(value: "fewest" | "most") => setSortOrder(value)}>
                      <SelectTrigger className="w-[180px]" data-testid="sort-order-select">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="fewest" data-testid="sort-fewest">Fewest Days First</SelectItem>
                        <SelectItem value="most" data-testid="sort-most">Most Days First</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Loading State */}
          {conflictsLoading && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
            </div>
          )}

          {/* Empty State */}
          {!conflictsLoading && sortedConflicts.length === 0 && (
            <Card className="p-12 text-center">
              <Calendar className="w-16 h-16 mx-auto mb-4 text-slate-300" />
              <h3 className="text-lg font-semibold text-slate-900 mb-2">
                No duplicates found
              </h3>
              <p className="text-slate-600">
                {selectedYear === "all" 
                  ? "No duplicate events have been detected yet. Run analysis from the Event Cockpit to find duplicates."
                  : `No duplicate events found for ${selectedYear}. Try analyzing this year for duplicates.`
                }
              </p>
            </Card>
          )}

          {/* Conflicts List */}
          {!conflictsLoading && sortedConflicts.length > 0 && (
            <div className="space-y-6">
              {sortedConflicts.filter(cluster => cluster && cluster.dates && cluster.dates.length > 0).map((cluster) => (
                <Card 
                  key={cluster.clusterId} 
                  className="p-6 cursor-pointer hover:shadow-lg transition-shadow" 
                  onClick={() => navigate(`/conflict/${cluster.dates[0]}`)}
                  data-testid={`conflict-cluster-${cluster.clusterId}`}
                >
                  {/* Cluster Header */}
                  <div className="mb-4">
                    <div className="flex items-center gap-2 mb-2">
                      <Calendar className="w-5 h-5 text-blue-600" />
                      <span className="font-semibold text-slate-900" data-testid={`cluster-id-${cluster.clusterId}`}>
                        Conflict Cluster
                      </span>
                      <span className="text-sm text-slate-500">
                        → {cluster.dates.length} duplicate {cluster.dates.length === 1 ? 'date' : 'dates'}
                      </span>
                      <ChevronRight className="w-5 h-5 text-slate-400 ml-auto" />
                    </div>
                  </div>

                  {/* All Dates in Cluster */}
                  <div className="pl-6 border-l-2 border-slate-200">
                    <div className="text-sm font-medium text-slate-600 mb-3">
                      Dates in this cluster:
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {cluster.dates.map((date) => (
                        <div 
                          key={date} 
                          className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 rounded-md text-sm font-medium text-slate-700 transition-colors"
                          data-testid={`cluster-date-${date}`}
                        >
                          {formatDate(date)}
                        </div>
                      ))}
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* LIGHT CHECK TAB */}
        <TabsContent value="quality" className="mt-6">
          {/* Filters */}
          {!qualityLoading && allViolations.length > 0 && (
            <Card className="p-4 mb-6">
              <div className="flex items-center gap-2 mb-3">
                <Filter className="w-4 h-4 text-slate-600" />
                <h3 className="font-semibold text-slate-900">Filter by Violation Type</h3>
                {selectedFilters.size > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelectedFilters(new Set())}
                    className="ml-auto text-xs"
                    data-testid="clear-filters"
                  >
                    Clear All
                  </Button>
                )}
              </div>
              <div className="flex flex-wrap gap-4">
                {violationTypes.map((type) => (
                  <div key={type.id} className="flex items-center space-x-2">
                    <Checkbox
                      id={type.id}
                      checked={selectedFilters.has(type.id)}
                      onCheckedChange={() => toggleFilter(type.id)}
                      data-testid={`filter-${type.id}`}
                    />
                    <Label
                      htmlFor={type.id}
                      className="text-sm font-normal cursor-pointer"
                    >
                      <Badge variant="outline" className={`${type.color} text-xs`}>
                        {type.label}
                      </Badge>
                    </Label>
                  </div>
                ))}
              </div>
              {selectedFilters.size > 0 && (
                <div className="mt-3 text-xs text-slate-600">
                  Showing {violations.length} of {allViolations.length} violations
                </div>
              )}
            </Card>
          )}

          {/* Stats Header */}
          {qualityData && (
            <div className="mb-6 flex items-center gap-4">
              <Card className="p-4 flex-1">
                <div className="flex items-center gap-3">
                  <CheckCircle2 className="w-8 h-8 text-green-600" />
                  <div>
                    <div className="text-2xl font-bold text-slate-900">
                      {qualityData.total - qualityData.violations}
                    </div>
                    <div className="text-sm text-slate-600">Clean Summaries</div>
                  </div>
                </div>
              </Card>
              <Card className="p-4 flex-1">
                <div className="flex items-center gap-3">
                  <AlertTriangle className="w-8 h-8 text-red-600" />
                  <div>
                    <div className="text-2xl font-bold text-slate-900">
                      {selectedFilters.size > 0 ? violations.length : qualityData.violations}
                    </div>
                    <div className="text-sm text-slate-600">
                      {selectedFilters.size > 0 ? 'Filtered Violations' : 'Violations Found'}
                    </div>
                  </div>
                </div>
              </Card>
            </div>
          )}

          {/* Loading State */}
          {qualityLoading && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
            </div>
          )}

          {/* Empty State */}
          {!qualityLoading && violations.length === 0 && (
            <Card className="p-12 text-center">
              <CheckCircle2 className="w-16 h-16 mx-auto mb-4 text-green-500" />
              <h3 className="text-lg font-semibold text-slate-900 mb-2">
                {selectedFilters.size > 0 ? 'No matches found' : 'All summaries are clean!'}
              </h3>
              <p className="text-slate-600">
                {selectedFilters.size > 0 
                  ? 'No violations match the selected filters. Try adjusting your filter selection.'
                  : 'No quality violations detected in the database.'
                }
              </p>
            </Card>
          )}

          {/* Violations Table */}
          {!qualityLoading && violations.length > 0 && (
            <Card>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[120px]">Date</TableHead>
                    <TableHead>Summary</TableHead>
                    <TableHead className="w-[80px] text-center">Length</TableHead>
                    <TableHead className="w-[250px]">Violations</TableHead>
                    <TableHead className="w-[80px]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {violations.map((violation) => (
                    <TableRow key={violation.date} data-testid={`violation-row-${violation.date}`}>
                      <TableCell className="font-medium">
                        {formatDate(violation.date)}
                      </TableCell>
                      <TableCell 
                        className="cursor-pointer hover:bg-slate-50"
                        onClick={() => handleEditViolation(violation.date)}
                      >
                        <div className="text-sm text-slate-700 whitespace-normal">
                          {violation.summary}
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge 
                          variant="outline" 
                          className={
                            violation.length < 100 || violation.length > 110
                              ? 'bg-red-100 text-red-700 border-red-300'
                              : 'bg-slate-100 text-slate-700'
                          }
                        >
                          {violation.length}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {violation.violations.map((v, i) => (
                            <Badge 
                              key={i} 
                              variant="outline" 
                              className={`text-xs ${getViolationBadgeColor(v)}`}
                            >
                              {v}
                            </Badge>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleEditViolation(violation.date)}
                          data-testid={`edit-violation-${violation.date}`}
                        >
                          <Pencil className="w-4 h-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          )}
        </TabsContent>

        {/* FACT CHECK TAB */}
        <TabsContent value="factcheck" className="mt-6">
          {/* Stats Header */}
          {factCheckData && (
            <div className="mb-6 grid grid-cols-4 gap-4">
              <Card className="p-4">
                <div className="flex items-center gap-3">
                  <Check className="w-8 h-8 text-green-600" />
                  <div>
                    <div className="text-2xl font-bold text-slate-900">{factCheckStats.verified}</div>
                    <div className="text-sm text-slate-600">Verified</div>
                  </div>
                </div>
              </Card>
              <Card className="p-4">
                <div className="flex items-center gap-3">
                  <XCircle className="w-8 h-8 text-red-600" />
                  <div>
                    <div className="text-2xl font-bold text-slate-900">{factCheckStats.contradicted}</div>
                    <div className="text-sm text-slate-600">Contradicted</div>
                  </div>
                </div>
              </Card>
              <Card className="p-4">
                <div className="flex items-center gap-3">
                  <AlertCircle className="w-8 h-8 text-amber-600" />
                  <div>
                    <div className="text-2xl font-bold text-slate-900">{factCheckStats.uncertain}</div>
                    <div className="text-sm text-slate-600">Uncertain</div>
                  </div>
                </div>
              </Card>
              <Card className="p-4">
                <div className="flex items-center gap-3">
                  <CheckCircle2 className="w-8 h-8 text-blue-600" />
                  <div>
                    <div className="text-2xl font-bold text-slate-900">{factCheckStats.total}</div>
                    <div className="text-sm text-slate-600">Total Checked</div>
                  </div>
                </div>
              </Card>
            </div>
          )}

          {/* Filters and Sort */}
          {!factCheckLoading && allFactCheckResults.length > 0 && (
            <div className="flex items-center gap-4 mb-6">
              <div className="flex items-center gap-2">
                <Filter className="w-4 h-4 text-slate-600" />
                <label className="text-sm text-slate-600 font-medium">Filter:</label>
                <Select value={factCheckFilter} onValueChange={setFactCheckFilter}>
                  <SelectTrigger className="w-[180px]" data-testid="fact-check-filter">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Results</SelectItem>
                    <SelectItem value="verified">Verified Only</SelectItem>
                    <SelectItem value="contradicted">Contradicted Only</SelectItem>
                    <SelectItem value="uncertain">Uncertain Only</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
              <div className="flex items-center gap-2">
                <ArrowUpDown className="w-4 h-4 text-slate-600" />
                <label className="text-sm text-slate-600 font-medium">Sort:</label>
                <Select value={factCheckSort} onValueChange={(v) => setFactCheckSort(v as "date-desc" | "confidence-asc")}>
                  <SelectTrigger className="w-[200px]" data-testid="fact-check-sort">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="date-desc">Date (Newest First)</SelectItem>
                    <SelectItem value="confidence-asc">Confidence (Low to High)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {factCheckFilter !== "all" && (
                <div className="ml-auto text-sm text-slate-600">
                  Showing {factCheckResults.length} of {allFactCheckResults.length} results
                </div>
              )}
            </div>
          )}

          {/* Loading State */}
          {factCheckLoading && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
            </div>
          )}

          {/* Empty State */}
          {!factCheckLoading && factCheckResults.length === 0 && (
            <Card className="p-12 text-center">
              <CheckCircle2 className="w-16 h-16 mx-auto mb-4 text-slate-300" />
              <h3 className="text-lg font-semibold text-slate-900 mb-2">
                {factCheckFilter !== "all" ? 'No matches found' : 'No fact-check results yet'}
              </h3>
              <p className="text-slate-600">
                {factCheckFilter !== "all" 
                  ? 'No results match the selected filter. Try adjusting your filter selection.'
                  : 'No analyses have been fact-checked yet. Run a fact-check from the settings to verify summaries.'
                }
              </p>
            </Card>
          )}

          {/* Fact Check Results Table */}
          {!factCheckLoading && factCheckResults.length > 0 && (
            <Card>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[120px]">Date</TableHead>
                    <TableHead>Summary</TableHead>
                    <TableHead className="w-[120px]">Verdict</TableHead>
                    <TableHead className="w-[100px] text-center">Confidence</TableHead>
                    <TableHead className="w-[300px]">Reasoning</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {factCheckResults.map((result) => {
                    const badge = getVerdictBadge(result.verdict);
                    return (
                      <TableRow key={result.date} data-testid={`fact-check-row-${result.date}`}>
                        <TableCell className="font-medium">
                          {formatDate(result.date)}
                        </TableCell>
                        <TableCell 
                          className="cursor-pointer hover:bg-slate-50"
                          onClick={() => handleEditFactCheck(result.date)}
                          data-testid={`fact-check-summary-${result.date}`}
                        >
                          <div className="text-sm text-slate-700 whitespace-normal">
                            {result.summary}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={`${badge.color} flex items-center gap-1 w-fit`}>
                            <badge.icon className="w-3 h-3" />
                            {badge.label}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge 
                            variant="outline" 
                            className={
                              result.confidence >= 80
                                ? 'bg-green-100 text-green-700 border-green-300'
                                : result.confidence >= 60
                                ? 'bg-amber-100 text-amber-700 border-amber-300'
                                : 'bg-red-100 text-red-700 border-red-300'
                            }
                          >
                            {Math.round(result.confidence)}%
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="text-sm text-slate-600 whitespace-normal line-clamp-2">
                            {result.reasoning}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </Card>
          )}
        </TabsContent>

        {/* PERPLEXITY FACT CHECK TAB */}
        <TabsContent value="perplexity" className="mt-6">
          {/* Stats Header */}
          {perplexityData && (
            <div className="mb-6 grid grid-cols-4 gap-4">
              <Card className="p-4">
                <div className="flex items-center gap-3">
                  <Check className="w-8 h-8 text-green-600" />
                  <div>
                    <div className="text-2xl font-bold text-slate-900">{perplexityStats.verified}</div>
                    <div className="text-sm text-slate-600">Verified</div>
                  </div>
                </div>
              </Card>
              <Card className="p-4">
                <div className="flex items-center gap-3">
                  <XCircle className="w-8 h-8 text-red-600" />
                  <div>
                    <div className="text-2xl font-bold text-slate-900">{perplexityStats.contradicted}</div>
                    <div className="text-sm text-slate-600">Contradicted</div>
                  </div>
                </div>
              </Card>
              <Card className="p-4">
                <div className="flex items-center gap-3">
                  <AlertCircle className="w-8 h-8 text-amber-600" />
                  <div>
                    <div className="text-2xl font-bold text-slate-900">{perplexityStats.uncertain}</div>
                    <div className="text-sm text-slate-600">Uncertain</div>
                  </div>
                </div>
              </Card>
              <Card className="p-4">
                <div className="flex items-center gap-3">
                  <CheckCircle2 className="w-8 h-8 text-blue-600" />
                  <div>
                    <div className="text-2xl font-bold text-slate-900">{perplexityStats.total}</div>
                    <div className="text-sm text-slate-600">Total Checked</div>
                  </div>
                </div>
              </Card>
            </div>
          )}

          {/* Filters and Sort */}
          {!perplexityLoading && allPerplexityResults.length > 0 && (
            <div className="flex items-center gap-4 mb-6">
              <div className="flex items-center gap-2">
                <Filter className="w-4 h-4 text-slate-600" />
                <label className="text-sm text-slate-600 font-medium">Filter:</label>
                <Select value={perplexityFilter} onValueChange={setPerplexityFilter}>
                  <SelectTrigger className="w-[180px]" data-testid="perplexity-filter">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Results</SelectItem>
                    <SelectItem value="verified">Verified Only</SelectItem>
                    <SelectItem value="contradicted">Contradicted Only</SelectItem>
                    <SelectItem value="uncertain">Uncertain Only</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
              <div className="flex items-center gap-2">
                <ArrowUpDown className="w-4 h-4 text-slate-600" />
                <label className="text-sm text-slate-600 font-medium">Sort:</label>
                <Select value={perplexitySort} onValueChange={(v) => setPerplexitySort(v as "date-desc" | "confidence-asc")}>
                  <SelectTrigger className="w-[200px]" data-testid="perplexity-sort">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="date-desc">Date (Newest First)</SelectItem>
                    <SelectItem value="confidence-asc">Confidence (Low to High)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {perplexityFilter !== "all" && (
                <div className="ml-auto text-sm text-slate-600">
                  Showing {perplexityResults.length} of {allPerplexityResults.length} results
                </div>
              )}

              <div className="ml-auto flex items-center gap-2">
                {selectedPerplexityDates.size > 0 && (
                  <Button
                    variant={bulkProcessing ? "destructive" : "default"}
                    size="sm"
                    className={bulkProcessing ? "bg-red-600 hover:bg-red-700" : "bg-blue-600 hover:bg-blue-700"}
                    onClick={bulkProcessing ? handleStopBulkAnalysis : handleBulkAnalyzeSelected}
                    data-testid="button-bulk-analyze-selected"
                  >
                    {bulkProcessing ? (
                      <>
                        <X className="w-4 h-4 mr-2" />
                        Stop Analysis ({bulkProgress?.current}/{bulkProgress?.total})
                      </>
                    ) : (
                      `Analyze Selected (${selectedPerplexityDates.size})`
                    )}
                  </Button>
                )}
                <Button
                  variant="default"
                  size="sm"
                  className="bg-orange-600 hover:bg-orange-700"
                  onClick={handleBulkReVerify}
                  data-testid="button-bulk-reverify"
                >
                  Bulk Re-Verify All
                </Button>
              </div>
            </div>
          )}

          {/* Loading State */}
          {perplexityLoading && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
            </div>
          )}

          {/* Empty State */}
          {!perplexityLoading && perplexityResults.length === 0 && (
            <Card className="p-12 text-center">
              <CheckCircle2 className="w-16 h-16 mx-auto mb-4 text-slate-300" />
              <h3 className="text-lg font-semibold text-slate-900 mb-2">
                {perplexityFilter !== "all" ? 'No matches found' : 'No Perplexity fact-check results yet'}
              </h3>
              <p className="text-slate-600">
                {perplexityFilter !== "all" 
                  ? 'No results match the selected filter. Try adjusting your filter selection.'
                  : 'No contradicted analyses have been re-checked with Perplexity yet. Run a Perplexity fact-check to verify with grounded search.'
                }
              </p>
            </Card>
          )}

          {/* Perplexity Fact Check Results Table */}
          {!perplexityLoading && perplexityResults.length > 0 && (
            <Card>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[50px]">
                      <Checkbox
                        checked={selectedPerplexityDates.size === perplexityResults.length && perplexityResults.length > 0}
                        onCheckedChange={toggleSelectAllPerplexity}
                        data-testid="select-all-perplexity"
                      />
                    </TableHead>
                    <TableHead className="w-[120px]">Date</TableHead>
                    <TableHead>Summary</TableHead>
                    <TableHead className="w-[120px]">Verdict</TableHead>
                    <TableHead className="w-[100px] text-center">Confidence</TableHead>
                    <TableHead className="w-[120px]">Correct Date</TableHead>
                    <TableHead className="w-[150px]">Re-Verification</TableHead>
                    <TableHead className="w-[300px]">Reasoning</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {perplexityResults.map((result) => {
                    const badge = getVerdictBadge(result.verdict);
                    const isSelected = selectedPerplexityDates.has(result.date);
                    return (
                      <TableRow 
                        key={result.date} 
                        data-testid={`perplexity-row-${result.date}`}
                        className={isSelected ? "bg-blue-50" : ""}
                      >
                        <TableCell>
                          <Checkbox
                            checked={isSelected}
                            onCheckedChange={() => togglePerplexitySelection(result.date)}
                            data-testid={`checkbox-perplexity-${result.date}`}
                          />
                        </TableCell>
                        <TableCell className="font-medium">
                          {formatDate(result.date)}
                        </TableCell>
                        <TableCell 
                          className="cursor-pointer hover:bg-slate-50"
                          onClick={() => handleEditFactCheck(result.date)}
                          data-testid={`perplexity-summary-${result.date}`}
                        >
                          <div className="text-sm text-slate-700 whitespace-normal">
                            {result.summary}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={`${badge.color} flex items-center gap-1 w-fit`}>
                            <badge.icon className="w-3 h-3" />
                            {badge.label}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge 
                            variant="outline" 
                            className={
                              result.confidence >= 80
                                ? 'bg-green-100 text-green-700 border-green-300'
                                : result.confidence >= 60
                                ? 'bg-amber-100 text-amber-700 border-amber-300'
                                : 'bg-red-100 text-red-700 border-red-300'
                            }
                          >
                            {Math.round(result.confidence)}%
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {result.correctDateText ? (
                            <span className="text-sm text-orange-700 font-medium">
                              {/^\d{4}-\d{2}-\d{2}$/.test(result.correctDateText) 
                                ? formatDate(result.correctDateText)
                                : result.correctDateText}
                            </span>
                          ) : (
                            <span className="text-sm text-slate-400">-</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {/* Manual Entry Protection - Show ALWAYS when protected, regardless of reVerified status */}
                          {result.manualEntryProtected ? (
                            <div className="flex flex-col gap-1">
                              <Badge variant="outline" className="bg-purple-100 text-purple-700 border-purple-300">
                                🛡️ PROTECTED
                              </Badge>
                              <span className="text-xs text-slate-600">
                                Manual entries prevent changes
                              </span>
                              <Button
                                size="sm"
                                variant="outline"
                                className="text-xs opacity-50 cursor-not-allowed"
                                disabled
                                data-testid={`button-reverify-disabled-${result.date}`}
                              >
                                Re-Verify (Disabled)
                              </Button>
                            </div>
                          ) : result.reVerified ? (
                            <div className="flex flex-col gap-1">
                              {/* Verification Flow Badge */}
                              {result.reVerificationReasoning?.includes('OpenAI Analysis:') ? (
                                <Badge variant="outline" className="bg-blue-100 text-blue-700 border-blue-300 text-xs">
                                  OpenAI + Perplexity
                                </Badge>
                              ) : result.reVerificationReasoning?.includes('No corrected date') ? (
                                <Badge variant="outline" className="bg-indigo-100 text-indigo-700 border-indigo-300 text-xs">
                                  Perplexity Only
                                </Badge>
                              ) : null}
                              
                              {/* Status Badge */}
                              <Badge 
                                variant="outline" 
                                className={
                                  result.reVerificationStatus === 'success'
                                    ? 'bg-green-100 text-green-700 border-green-300'
                                    : 'bg-red-100 text-red-700 border-red-300'
                                }
                              >
                                {result.reVerificationStatus === 'success' ? '✓ SUCCESS' : '⚠ PROBLEM'}
                              </Badge>
                              
                              {/* Winner Info */}
                              {result.reVerificationWinner && (
                                <span className="text-xs text-slate-600">
                                  Winner: <span className="font-medium">{result.reVerificationWinner}</span>
                                </span>
                              )}
                              
                              {/* Suggested Date */}
                              {result.reVerificationDate && result.reVerificationWinner === 'corrected' && (
                                <span className="text-xs text-orange-700 font-medium mt-1">
                                  Suggested: {/^\d{4}-\d{2}-\d{2}$/.test(result.reVerificationDate) 
                                    ? formatDate(result.reVerificationDate)
                                    : result.reVerificationDate}
                                </span>
                              )}
                            </div>
                          ) : result.verdict === 'contradicted' ? (
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-xs"
                              onClick={() => navigate(`/conflict/${result.date}`)}
                              disabled={bulkProcessing}
                            >
                              AI Resolve
                            </Button>
                          ) : (
                            <span className="text-xs text-slate-400">N/A</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="text-sm text-slate-600 whitespace-normal max-w-md">
                            {result.reVerified && result.reVerificationReasoning ? (
                              <div className="space-y-2">
                                <div className="text-sm font-medium text-slate-700">Re-Verification Analysis:</div>
                                <div className="text-xs text-slate-600 whitespace-pre-wrap">
                                  {result.reVerificationReasoning}
                                </div>
                                <div className="border-t pt-2 mt-2">
                                  <div className="text-xs font-medium text-slate-700 mb-1">Original Perplexity Check:</div>
                                  <div className="text-xs text-slate-600">
                                    {result.reasoning}
                                  </div>
                                </div>
                              </div>
                            ) : (
                              <div className="text-sm text-slate-600">
                                {result.reasoning}
                              </div>
                            )}
                          </div>
                          {result.citations && result.citations.length > 0 && (
                            <div className="mt-1 text-xs text-blue-600">
                              {result.citations.length} citation{result.citations.length > 1 ? 's' : ''}
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      {/* Cleanup Results Dialog */}
      <Dialog open={cleanupDialogOpen} onOpenChange={setCleanupDialogOpen}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Cleanup Process</DialogTitle>
            <DialogDescription>
              Perplexity summary comparison + intelligent article replacement
            </DialogDescription>
          </DialogHeader>

          {cleanupLoading ? (
            <div className="space-y-4 py-8">
              <div className="text-center">
                <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-current border-r-transparent" />
                <p className="mt-4 text-sm text-slate-600">Running cleanup...</p>
                <p className="mt-2 text-xs text-slate-500">Check API Monitor for real-time progress</p>
              </div>
            </div>
          ) : cleanupResult?.error ? (
            <div className="space-y-4 py-4">
              <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                <h3 className="text-sm font-medium text-red-800 mb-2">Error</h3>
                <p className="text-sm text-red-700">{cleanupResult.error}</p>
              </div>
            </div>
          ) : cleanupResult ? (
            <div className="space-y-4 py-4">
              {/* Success/Problem Status */}
              <div className={`border rounded-lg p-4 ${
                cleanupResult.success ? 'bg-green-50 border-green-200' : 'bg-amber-50 border-amber-200'
              }`}>
                <h3 className={`text-sm font-medium mb-2 ${
                  cleanupResult.success ? 'text-green-800' : 'text-amber-800'
                }`}>
                  {cleanupResult.success ? '✅ Cleanup Successful' : '⚠️ Manual Review Required'}
                </h3>
                <p className={`text-sm ${
                  cleanupResult.success ? 'text-green-700' : 'text-amber-700'
                }`}>
                  {cleanupResult.message}
                </p>
              </div>

              {/* Comparison Results (if available) */}
              {cleanupResult.comparison && (
                <div className="border rounded-lg p-4 bg-blue-50 border-blue-200">
                  <h3 className="text-sm font-medium text-blue-800 mb-2">
                    🔍 Perplexity Comparison
                  </h3>
                  <div className="space-y-2">
                    <div className="text-sm">
                      <span className="font-medium">Winner:</span>{' '}
                      <Badge className="ml-2">{cleanupResult.comparison.winner}</Badge>
                    </div>
                    <div className="text-sm">
                      <span className="font-medium">Confidence:</span> {cleanupResult.comparison.confidence}%
                    </div>
                    <div className="text-sm mt-2">
                      <span className="font-medium">Reasoning:</span>
                      <p className="text-xs text-slate-600 mt-1 whitespace-pre-wrap">
                        {cleanupResult.comparison.reasoning}
                      </p>
                    </div>
                    {cleanupResult.comparison.citations?.length > 0 && (
                      <div className="text-xs text-blue-600 mt-2">
                        {cleanupResult.comparison.citations.length} citation(s)
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Replacement Article */}
              {cleanupResult.replacement && (
                <div className="border rounded-lg p-4 bg-purple-50 border-purple-200">
                  <h3 className="text-sm font-medium text-purple-800 mb-2">
                    📄 Replacement Article
                  </h3>
                  <div className="space-y-2">
                    <div className="text-sm">
                      <span className="font-medium">Tier:</span>{' '}
                      <Badge className="ml-2">{cleanupResult.replacement.tier}</Badge>
                    </div>
                    <div className="text-sm">
                      <span className="font-medium">Title:</span>
                      <p className="text-xs text-slate-600 mt-1">
                        {cleanupResult.replacement.article.title}
                      </p>
                    </div>
                    <div className="text-sm">
                      <span className="font-medium">URL:</span>
                      <a 
                        href={cleanupResult.replacement.article.url} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="text-xs text-blue-600 hover:underline block mt-1"
                      >
                        {cleanupResult.replacement.article.url}
                      </a>
                    </div>
                  </div>
                </div>
              )}

              {/* New Summary */}
              {cleanupResult.newSummary && (
                <div className="border rounded-lg p-4 bg-green-50 border-green-200">
                  <h3 className="text-sm font-medium text-green-800 mb-2">
                    ✨ New Summary ({cleanupResult.newSummary.length} characters)
                  </h3>
                  <p className="text-sm text-slate-700">
                    {cleanupResult.newSummary}
                  </p>
                  <div className="mt-2 text-xs text-slate-500">
                    Updated date: {cleanupResult.updatedDate}
                  </div>
                </div>
              )}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
