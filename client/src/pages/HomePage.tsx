import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { useBulkReanalyze } from "@/hooks/useBulkReanalyze";
import { useToggleFlag } from "@/hooks/useToggleFlag";
import { 
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { 
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { 
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AnalysesTable, type AnalysisRowAnnotation, type GoogleCheckSummary, type HistoricalNewsAnalysis } from "@/components/AnalysesTable";
import type { LogLine } from "@/lib/pipelineActivityLog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tag,
  ChevronDown,
  Copy,
  Bot,
  Loader2,
  FileText,
  RefreshCw,
  StopCircle,
  Tags,
  MoreVertical,
  Plus,
  X,
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { SiOpenai } from "react-icons/si";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabase";
import { Link } from "wouter";
import { ArticleSelectionDialog } from "@/components/ArticleSelectionDialog";
import { TaggingDropdown } from "@/components/TaggingDropdown";
import { TagsSidebar } from "@/components/TagsSidebar";
import { SidebarProvider } from "@/components/ui/sidebar";
import { getCategoryColor } from "@/utils/tagHelpers";
import { serializePageState, deserializePageState, type HomePageState } from "@/lib/navigationState";
import {
  analysisMatchesTopicLeaf,
  buildTopicCatalogData,
  extractTopicLabelsFromCategories,
  resolveSelectedTopicLeafFromSelection,
  resolveTopicLabelFromSelection,
  type AnalysisTopicRow,
} from "@/lib/topicCatalog";
import {
  analysisMatchesRarity,
  buildRarityCatalogData,
  resolveRarityLabelFromSelection,
  resolveSelectedRarityFromSelection,
  type AnalysisRarityRow,
} from "@/lib/rarityCatalog";
import {
  analysisMatchesTag,
  buildTagCatalogData,
  resolveSelectedTagFromSelection,
  type AnalysisTagRow,
} from "@/lib/tagCatalog";
import { isValidRarity } from "@shared/rarity";
import { fetchAllSupabaseRows } from "@/lib/supabaseBatch";
import { PerplexityIcon } from "@/components/PerplexityIcon";
import { analysisHasStorylineTopic } from "@shared/storyline-topic-eligibility";
import {
  useAnalysesBrowse,
  filterUntaggedRow,
} from "@/features/analyses-browse/useAnalysesBrowse";
import { parseIsLocked } from "@/lib/parseIsLocked";
import { PAGE_SIZE_OPTIONS, type AnalysesBrowseFilterState, type EntityTag, type RawAnalysisRow } from "@/features/analyses-browse/types";
import {
  AnalysesBrowseLayout,
  AnalysesBrowseHeader,
  AnalysesBrowseTableCard,
  AnalysesBrowseBulkActions,
} from "@/features/analyses-browse/AnalysesBrowseLayout";

type BrowseAxis = "topic" | "rarity" | "tags";

function isHomeDefaultBrowseView(
  browseAxis: BrowseAxis,
  showUntagged: boolean,
  selectedEntities: Set<string>,
): boolean {
  return browseAxis === "topic" && !showUntagged && selectedEntities.size === 0;
}

function isRarityDefaultBrowseView(
  browseAxis: BrowseAxis,
  selectedEntities: Set<string>,
): boolean {
  return browseAxis === "rarity" && selectedEntities.size === 0;
}

function isTagsDefaultBrowseView(
  browseAxis: BrowseAxis,
  selectedEntities: Set<string>,
): boolean {
  return browseAxis === "tags" && selectedEntities.size === 0;
}

function buildGoogleCheckSummary(
  analyses: Array<{ google_check_happened?: "yes" | "no" | "uncertain" | null }>,
): GoogleCheckSummary {
  const summary: GoogleCheckSummary = { yes: 0, no: 0, uncertain: 0, unverified: 0 };
  for (const row of analyses) {
    const verdict = row.google_check_happened;
    if (verdict === "yes") summary.yes += 1;
    else if (verdict === "no") summary.no += 1;
    else if (verdict === "uncertain") summary.uncertain += 1;
    else summary.unverified += 1;
  }
  return summary;
}

export default function HomePage() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  
  const prevSearchRef = useRef<string>("");
  const stateRef = useRef({
    selectedEntities: new Set<string>(),
    showUntagged: false,
    searchQuery: "",
    currentPage: 1,
    pageSize: 50,
    browseAxis: "topic" as BrowseAxis,
  });

  const [browseAxis, setBrowseAxis] = useState<BrowseAxis>("topic");

  const updateUrl = (updates: Partial<HomePageState>) => {
    const currentState: HomePageState = {
      page: "home",
      selectedEntities: updates.selectedEntities ?? stateRef.current.selectedEntities,
      showUntagged: updates.showUntagged ?? stateRef.current.showUntagged,
      searchQuery: updates.searchQuery ?? stateRef.current.searchQuery,
      currentPage: updates.currentPage ?? stateRef.current.currentPage,
      pageSize: updates.pageSize ?? stateRef.current.pageSize,
      viewMode: "topics",
      browseAxis: updates.browseAxis ?? stateRef.current.browseAxis,
      sidebarMenu: "topics",
    };
    const params = new URLSearchParams();
    if (currentState.selectedEntities.size > 0) {
      params.set("entities", Array.from(currentState.selectedEntities).join(","));
    }
    if (currentState.showUntagged) {
      params.set("untagged", "1");
    }
    if (currentState.searchQuery) {
      params.set("search", currentState.searchQuery);
    }
    params.set("page", currentState.currentPage.toString());
    params.set("pageSize", currentState.pageSize.toString());
    if (currentState.browseAxis === "rarity" || currentState.browseAxis === "tags") {
      params.set("browse", currentState.browseAxis);
    }
    const query = params.toString();
    const newUrl = `/${query ? `?${query}` : ""}`;
    prevSearchRef.current = query ? `?${query}` : "";
    setLocation(newUrl, { replace: true });
  };

  const onDebouncedSearchChange = useCallback((nextSearchQuery: string) => {
    updateUrl({ searchQuery: nextSearchQuery, currentPage: 1 });
  }, []);

  const { data: analysisTopicRows = [] } = useQuery({
    queryKey: ["supabase-analysis-topic-categories"],
    queryFn: async (): Promise<AnalysisTopicRow[]> =>
      fetchAllSupabaseRows<AnalysisTopicRow>("historical_news_analyses", "id, topic_categories", {
        orderBy: { column: "date", ascending: true },
      }),
    staleTime: 60_000,
  });

  const topicCatalogData = useMemo(
    () => buildTopicCatalogData(analysisTopicRows),
    [analysisTopicRows],
  );

  const { data: analysisRarityRows = [] } = useQuery({
    queryKey: ["supabase-analysis-rarity"],
    queryFn: async (): Promise<AnalysisRarityRow[]> => {
      const rows = await fetchAllSupabaseRows<AnalysisRarityRow>(
        "historical_news_analyses",
        "id, rarity, is_locked",
        { orderBy: { column: "date", ascending: true } },
      );
      return rows.filter((row) => parseIsLocked(row.is_locked));
    },
    staleTime: 60_000,
  });

  const rarityCatalogData = useMemo(
    () => buildRarityCatalogData(analysisRarityRows),
    [analysisRarityRows],
  );

  const { data: analysisTagRows = [] } = useQuery({
    queryKey: ["supabase-analysis-tags-catalog"],
    queryFn: async (): Promise<AnalysisTagRow[]> => {
      const rows = await fetchAllSupabaseRows<AnalysisTagRow>(
        "historical_news_analyses",
        "id, tags_version2, is_locked",
        { orderBy: { column: "date", ascending: true } },
      );
      return rows.filter((row) => parseIsLocked(row.is_locked));
    },
    staleTime: 60_000,
  });

  const tagCatalogData = useMemo(
    () => buildTagCatalogData(analysisTagRows),
    [analysisTagRows],
  );

  const activeCatalogData =
    browseAxis === "rarity"
      ? rarityCatalogData
      : browseAxis === "tags"
        ? tagCatalogData
        : topicCatalogData;

  const browseFilterRow = useCallback(
    (row: RawAnalysisRow, filters: AnalysesBrowseFilterState) => {
      if (browseAxis === "rarity") {
        if (!row.is_locked) return false;
        if (!isValidRarity(row.rarity)) return false;
        const selectedRarity = resolveSelectedRarityFromSelection(filters.selectedEntities);
        if (selectedRarity) return analysisMatchesRarity(row, selectedRarity);
        return true;
      }

      if (browseAxis === "tags") {
        if (!row.is_locked) return false;
        if (!Array.isArray(row.tags_version2) || row.tags_version2.length === 0) return false;
        const selectedTag = resolveSelectedTagFromSelection(filters.selectedEntities);
        if (selectedTag) return analysisMatchesTag(row, selectedTag);
        return true;
      }

      if (filters.showUntagged && !filterUntaggedRow(row)) return false;
      const isDefault = isHomeDefaultBrowseView(browseAxis, filters.showUntagged, filters.selectedEntities);
      if (isDefault && !analysisHasStorylineTopic(row.topic_categories)) return false;
      if (filters.selectedEntities.size > 0 && !filters.showUntagged) {
        const selectedTopicLeaf = resolveSelectedTopicLeafFromSelection(
          filters.selectedEntities,
          topicCatalogData,
        );
        if (selectedTopicLeaf) return analysisMatchesTopicLeaf(row, selectedTopicLeaf);
        return false;
      }
      return true;
    },
    [browseAxis, topicCatalogData],
  );

  const {
    pageSize,
    setPageSize,
    selectedEntities,
    setSelectedEntities,
    showUntagged,
    setShowUntagged,
    selectedDates,
    setSelectedDates,
    currentPage,
    setCurrentPage,
    selectAllMatching,
    setSelectAllMatching,
    searchQuery,
    setSearchQuery,
    debouncedSearchQuery,
    paginatedAnalyses,
    totalCount,
    googleCheckSummary,
    isLoading,
    refetch,
    toggleSelectAll,
    fetchAllMatchingDates,
    fetchAllFilteredRows,
  } = useAnalysesBrowse({
    queryKeyExtra: ["home", browseAxis],
    refetchOnMount: "always",
    staleTime: 0,
    selectColumns:
      "id, date, summary, tags_version2, tier_used, is_manual_override, is_flagged, is_locked, google_check_happened, google_check_checked_at, rarity",
    includeTopicCategories: browseAxis === "topic",
    applyServerQuery: (query, filters) => {
      if (browseAxis === "rarity") {
        return query.eq("is_locked", true).not("rarity", "is", null);
      }
      if (browseAxis === "tags") {
        return query.eq("is_locked", true);
      }
      if (isHomeDefaultBrowseView(browseAxis, filters.showUntagged, filters.selectedEntities)) {
        return query.eq("is_locked", true);
      }
      return query;
    },
    needsFullFetch: (filters) =>
      browseAxis === "rarity" ||
      browseAxis === "tags" ||
      filters.showUntagged ||
      filters.selectedEntities.size > 0 ||
      isHomeDefaultBrowseView(browseAxis, filters.showUntagged, filters.selectedEntities),
    filterRow: browseFilterRow,
    mapRow: (row) => ({
      date: row.date,
      summary: row.summary,
      tags_version2: row.tags_version2,
      tier: row.tier_used,
      isManualOverride: row.is_manual_override,
      isFlagged: row.is_flagged || false,
      isLocked: parseIsLocked(row.is_locked),
      googleCheckHappened: row.google_check_happened ?? null,
      googleCheckCheckedAt: row.google_check_checked_at ?? null,
      topic_categories: row.topic_categories,
      rarity: row.rarity ?? null,
    }),
    buildExtra: (filteredRows, filters) => {
      if (browseAxis === "rarity" || browseAxis === "tags") return { googleCheckSummary: null };
      const topicLeaf =
        filters.selectedEntities.size > 0 && !filters.showUntagged
          ? resolveSelectedTopicLeafFromSelection(filters.selectedEntities, topicCatalogData)
          : null;
      const isDefault = isHomeDefaultBrowseView(browseAxis, filters.showUntagged, filters.selectedEntities);
      return {
        googleCheckSummary:
          topicLeaf || isDefault ? buildGoogleCheckSummary(filteredRows) : null,
      };
    },
    onDebouncedSearchChange,
  });

  useEffect(() => {
    stateRef.current = { selectedEntities, showUntagged, searchQuery, currentPage, pageSize, browseAxis };
  }, [selectedEntities, showUntagged, searchQuery, currentPage, pageSize, browseAxis]);

  // Restore state from URL params on mount and when navigating back
  useEffect(() => {
    const checkAndRestore = () => {
      const currentSearch = window.location.search;

      if (currentSearch === prevSearchRef.current) {
        return;
      }

      prevSearchRef.current = currentSearch;
      const urlParams = new URLSearchParams(currentSearch);
      const restoredState = deserializePageState(urlParams);
      if (restoredState && restoredState.page === "home") {
        const state = restoredState as HomePageState;
        if (state.selectedEntities) setSelectedEntities(state.selectedEntities);
        if (state.showUntagged !== undefined) setShowUntagged(state.showUntagged);
        if (state.searchQuery) setSearchQuery(state.searchQuery);
        if (state.currentPage) setCurrentPage(state.currentPage);
        if (state.pageSize) setPageSize(state.pageSize);
        if (state.browseAxis) setBrowseAxis(state.browseAxis);
      }
    };

    checkAndRestore();
    const interval = setInterval(checkAndRestore, 50);
    window.addEventListener("popstate", checkAndRestore);
    window.addEventListener("hashchange", checkAndRestore);

    return () => {
      clearInterval(interval);
      window.removeEventListener("popstate", checkAndRestore);
      window.removeEventListener("hashchange", checkAndRestore);
    };
  }, [setCurrentPage, setPageSize, setSearchQuery, setSelectedEntities, setShowUntagged, setBrowseAxis]);

  const defaultBrowseView = isHomeDefaultBrowseView(browseAxis, showUntagged, selectedEntities);
  const rarityDefaultView = isRarityDefaultBrowseView(browseAxis, selectedEntities);
  const tagsDefaultView = isTagsDefaultBrowseView(browseAxis, selectedEntities);
  const selectedTopicLabel = resolveTopicLabelFromSelection(selectedEntities, topicCatalogData);
  const selectedRarityLabel = resolveRarityLabelFromSelection(selectedEntities);
  const selectedTagLabel = resolveSelectedTagFromSelection(selectedEntities);
  const canExportTopicExcel =
    selectedEntities.size === 1 && !!selectedTopicLabel && totalCount > 0;
  const selectedTopicLeaf = resolveSelectedTopicLeafFromSelection(selectedEntities, topicCatalogData);
  const canRunTopicChecks = canExportTopicExcel && !!selectedTopicLeaf;

  // New state for the copy dialog
  const [showCopyDialog, setShowCopyDialog] = useState(false);
  const [textToCopy, setTextToCopy] = useState("");
  const [rowAnnotations, setRowAnnotations] = useState<Record<string, AnalysisRowAnnotation>>({});
  const [storylineFitRunning, setStorylineFitRunning] = useState(false);
  const [googleCheckRunning, setGoogleCheckRunning] = useState(false);
  const [checkLogLines, setCheckLogLines] = useState<LogLine[]>([]);
  const checkLogScrollRef = useRef<HTMLDivElement | null>(null);

  // Bulk operations state
  const [showBulkAdd, setShowBulkAdd] = useState(false);
  const [showBulkRemove, setShowBulkRemove] = useState(false);
  const [showManageTags, setShowManageTags] = useState(false);
  const [bulkTagName, setBulkTagName] = useState("");
  const [bulkTagCategory, setBulkTagCategory] = useState("crypto");
  const {
    isReanalyzing,
    reanalyzeDates,
    redoSummaries,
    cancelAnalysis,
    selectionRequest,
    isSelectionDialogOpen,
    setIsSelectionDialogOpen,
    confirmSelection,
    progress,
  } = useBulkReanalyze();

  useEffect(() => {
    setRowAnnotations({});
  }, [selectedEntities, showUntagged, debouncedSearchQuery, currentPage, pageSize]);

  useEffect(() => {
    if (checkLogLines.length === 0) return;
    const root = checkLogScrollRef.current;
    const viewport = root?.querySelector("[data-radix-scroll-area-viewport]") as HTMLElement | null;
    viewport?.scrollTo({ top: viewport.scrollHeight, behavior: "smooth" });
  }, [checkLogLines]);

  // Bulk add tags mutation
  const bulkAddMutation = useMutation({
    mutationFn: async ({ dates, tag }: { dates: string[]; tag: EntityTag }) => {
      return apiRequest('POST', '/api/tags/bulk-add', { dates, tag });
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['supabase-tags-catalog'] });
      queryClient.invalidateQueries({ queryKey: ['supabase-tags-analyses'] });
      toast({
        title: "Tags Added",
        description: `Successfully added tag to ${variables.dates.length} analyses`,
      });
      setShowBulkAdd(false);
      setBulkTagName("");
      setSelectedDates(new Set());
      setSelectAllMatching(false);
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive"
      });
    }
  });

  // Bulk remove tags mutation
  const bulkRemoveMutation = useMutation({
    mutationFn: async ({ dates, tag }: { dates: string[]; tag: EntityTag }) => {
      return apiRequest('POST', '/api/tags/bulk-remove', { dates, tag });
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['supabase-tags-catalog'] });
      queryClient.invalidateQueries({ queryKey: ['supabase-tags-analyses'] });
      queryClient.invalidateQueries({ queryKey: ['supabase-tags-selected-summaries'] });
      toast({
        title: "Tag Removed",
        description: `Successfully removed tag from ${variables.dates.length} analyses`,
      });
      // Don't close the dialog or clear selection - user might want to remove more tags
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive"
      });
    }
  });

  // Toggle flag mutation
  const toggleFlagMutation = useToggleFlag({
    invalidateQueries: [['analyses-browse']],
  });

  // Flush cache mutation
  const flushCacheMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/tags/flush-cache', {
        method: 'POST',
      });

      if (!response.ok) {
        throw new Error('Failed to flush cache');
      }

      return await response.json();
    },
    onSuccess: async () => {
      toast({
        title: 'Cache Flushed',
        description: 'Tag cache has been cleared successfully',
      });
      // Invalidate and refetch all tag-related queries
      await queryClient.invalidateQueries({ queryKey: ['tags-catalog-v2'] });
      await queryClient.invalidateQueries({ queryKey: ['analyses-browse'] });
    },
    onError: (error: Error) => {
      toast({
        title: 'Cache Flush Failed',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const handleBulkAdd = async () => {
    if (!bulkTagName.trim()) {
      toast({
        title: "Error",
        description: "Please enter a tag name",
        variant: "destructive"
      });
      return;
    }

    try {
      let datesToUpdate: string[];
      
      if (selectAllMatching) {
        datesToUpdate = await fetchAllMatchingDates();
      } else {
        datesToUpdate = Array.from(selectedDates);
      }
      
      bulkAddMutation.mutate({
        dates: datesToUpdate,
        tag: {
          name: bulkTagName.trim(),
          category: bulkTagCategory
        }
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to prepare bulk operation",
        variant: "destructive"
      });
    }
  };

  // Fetch unique tags from selected summaries for bulk remove
  const { data: selectedSummariesTags = [], isLoading: isLoadingTags } = useQuery<EntityTag[]>({
    queryKey: ['supabase-tags-selected-summaries', Array.from(selectedDates).sort(), selectAllMatching, debouncedSearchQuery, showUntagged],
    queryFn: async () => {
      if (!supabase) throw new Error("Supabase not configured");

      let datesToCheck: string[];
      
      if (selectAllMatching) {
        try {
          datesToCheck = await fetchAllMatchingDates();
        } catch (e) {
          return [];
        }
      } else {
        if (selectedDates.size === 0) return [];
        datesToCheck = Array.from(selectedDates);
      }
      
      // Fetch analyses for the selected dates
      const { data: analyses, error } = await supabase
        .from("historical_news_analyses")
        .select("tags_version2")
        .in("date", datesToCheck);
      
      if (error) throw error;

      // Extract unique tags from tags_version2
      const uniqueTags = new Map<string, EntityTag>();
      analyses?.forEach((analysis: any) => {
        if (analysis.tags_version2 && Array.isArray(analysis.tags_version2)) {
          analysis.tags_version2.forEach((tagName: string) => {
            const category = "entities";
            const key = `${category}::${tagName}`;
            if (!uniqueTags.has(key)) {
              uniqueTags.set(key, { name: tagName, category });
            }
          });
        }
      });

      return Array.from(uniqueTags.values());
    },
    enabled: (showBulkRemove || showManageTags) && (selectedDates.size > 0 || selectAllMatching),
  });

  const handleBulkRemove = async (tag: EntityTag) => {
    try {
      let datesToUpdate: string[];
      
      if (selectAllMatching) {
        datesToUpdate = await fetchAllMatchingDates();
      } else {
        datesToUpdate = Array.from(selectedDates);
      }

      bulkRemoveMutation.mutate({
        dates: datesToUpdate,
        tag
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to prepare bulk operation",
        variant: "destructive"
      });
    }
  };

  // Copy all filtered results to clipboard as TXT
  const handleCopyToClipboard = async () => {
    try {
      // If selecting all matching (potentially huge), don't allow copy or warn
      // But existing behavior was "Copy filtered results", which implies ALL results.
      // The user requested limiting it to 50 entries or disabling if more.
      
      // Logic:
      // 1. If selectAllMatching is true -> too many -> Disable/Warn
      // 2. If !selectAllMatching but selectedDates.size > 50 -> Disable/Warn
      // 3. Otherwise copy selectedDates only.
      
      // Wait, previously it copied ALL matching filters. Now we want to copy SELECTION.
      // If nothing selected, previously it copied ALL matching.
      // Let's assume we want to copy SELECTION now.
      
      let datesToCopy: string[];
      
      if (selectAllMatching) {
         // User explicitly selected ALL matching items
         toast({
           title: "Too many items",
           description: "Cannot copy more than 50 items at once. Please refine your selection.",
           variant: "destructive"
         });
         return;
      }
      
      if (selectedDates.size > 0) {
        if (selectedDates.size > 50) {
          toast({
            title: "Too many items",
            description: "Cannot copy more than 50 items at once.",
            variant: "destructive"
          });
          return;
        }
        datesToCopy = Array.from(selectedDates);
      } else {
        // If nothing selected, maybe copy current page? 
        // Or revert to old behavior but limited?
        // "the copy TXT button can be limited to 50 entries"
        // Let's default to copying the current page if nothing selected, 
        // OR if the user wants "all matching" logic from before, we limit it.
        
        // Current implementation fetches ALL matching. Let's keep it but limit to 50?
        // Actually, let's rely on explicit selection. If nothing selected, nothing to copy.
        // Or copy visible page.
        datesToCopy = paginatedAnalyses.map(a => a.date);
      }
      
      // We need to fetch the summaries for these dates.
      // We can use the existing paginatedAnalyses if they are all there, 
      // but if selectedDates spans multiple pages we need to fetch.
      // Simpler: just fetch by IDs.
      
      // Actually, we can reuse the fetchAll logic but filter by IDs on client or server.
      // Let's filter on client since we have the IDs.
      // But we need the SUMMARIES.
      
      // If we just want to copy what's on screen (paginatedAnalyses)
      let analysesToCopy = paginatedAnalyses.filter(a => datesToCopy.includes(a.date));
      
      // If we have selected dates that are NOT in paginatedAnalyses (e.g. other pages),
      // we would need to fetch them. 
      // Given the constraint "limit to 50", we can assume they are likely on the current page 
      // or the user manually selected < 50 across pages.
      
      if (analysesToCopy.length < datesToCopy.length) {
         // We are missing some data. Need to fetch from Supabase.
         if (!supabase) throw new Error("Supabase not configured");

         const { data: fetchedAnalyses, error } = await supabase
           .from("historical_news_analyses")
           .select("date, summary, tags")
           .in("date", datesToCopy);

         if (error) throw error;
         analysesToCopy = fetchedAnalyses || [];
      }
      
      if (analysesToCopy.length === 0) {
        toast({
          title: "Nothing to Copy",
          description: "No analyses selected",
          variant: "destructive"
        });
        return;
      }
      
      // Format all filtered analyses
      const textOutput = analysesToCopy
        .map((analysis: HistoricalNewsAnalysis) => {
          const date = new Date(analysis.date).toLocaleDateString('en-GB', {
            year: 'numeric',
            month: 'long',
            day: '2-digit',
          });
          return `${date} - ${analysis.summary}`;
        })
        .join('\n');
      
      // Set the text and show the dialog instead of copying directly
      setTextToCopy(textOutput);
      setShowCopyDialog(true);

    } catch (error) {
      console.error('Copy to clipboard error:', error);
      toast({
        title: "Copy Failed",
        description: error instanceof Error ? error.message : "Failed to prepare text for copying",
        variant: "destructive"
      });
    }
  };

  const getHomepageCheckRows = () => {
    if (selectedDates.size > 0) {
      return paginatedAnalyses.filter((analysis) => selectedDates.has(analysis.date));
    }
    return paginatedAnalyses;
  };

  const pushCheckLog = (line: LogLine) => {
    setCheckLogLines((current) => [...current, line]);
  };

  const replaceCheckLog = (id: string, line: LogLine) => {
    setCheckLogLines((current) => current.map((entry) => (entry.id === id ? line : entry)));
  };

  const formatCheckRangeLabel = (rows: Array<{ date: string }>) => {
    if (rows.length === 0) return "";
    if (rows.length === 1) return rows[0]!.date;
    return `${rows[0]!.date} → ${rows[rows.length - 1]!.date}`;
  };

  const handleStorylineFitCheck = async () => {
    if (!canRunTopicChecks || !selectedTopicLeaf) {
      toast({
        title: "Select one topic",
        description: "Switch to Topics in the sidebar and choose a single storyline to check.",
        variant: "destructive",
      });
      return;
    }

    const rows = getHomepageCheckRows();
    if (rows.length === 0) {
      toast({
        title: "Nothing to check",
        description: "No analyses on this page to review.",
        variant: "destructive",
      });
      return;
    }

    const runId = String(Date.now());
    let totalOk = 0;
    let totalMismatch = 0;
    let totalUncertain = 0;

    setStorylineFitRunning(true);
    pushCheckLog({
      id: `${runId}-start`,
      text: `Starting storyline agent · ${rows.length} row${rows.length === 1 ? "" : "s"} · ${selectedTopicLabel}`,
      status: "approved",
    });

    try {
      for (let index = 0; index < rows.length; index += 1) {
        const analysis = rows[index]!;
        const lineId = `${runId}-${analysis.date}`;
        const progressLabel = `${index + 1} of ${rows.length}`;

        pushCheckLog({
          id: lineId,
          text: `${analysis.date} · Topic agent checking (${progressLabel})…`,
          status: "pending",
        });

        try {
          const response = await fetch("/api/analysis/homepage/storyline-fit-check", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              topicLeaf: selectedTopicLeaf,
              items: [
                {
                  date: analysis.date,
                  summary: analysis.summary,
                  tags: analysis.tags_version2 ?? [],
                  topic_categories: analysis.topic_categories,
                },
              ],
            }),
          });

          if (!response.ok) {
            const payload = await response.json().catch(() => ({}));
            throw new Error(payload.error || response.statusText);
          }

          const report = await response.json();
          totalOk += report.ok ?? 0;
          totalMismatch += report.mismatch ?? 0;
          totalUncertain += report.uncertain ?? 0;

          const row = report.results?.[analysis.date] as
            | {
                status: "ok" | "mismatch" | "uncertain";
                reason?: string;
                suggestedLeaves?: string[];
              }
            | undefined;

          if (row) {
            setRowAnnotations((prev) => ({
              ...prev,
              [analysis.date]: {
                ...prev[analysis.date],
                storylineFit: {
                  status: row.status,
                  reason: row.reason,
                  suggestedLeaves: row.suggestedLeaves,
                },
              },
            }));
          }

          const statusLabel =
            row?.status === "ok" ? "belongs here" : row?.status === "mismatch" ? "mismatch" : "uncertain";
          replaceCheckLog(lineId, {
            id: lineId,
            text: `${analysis.date} · ${statusLabel}${row?.reason ? ` — ${row.reason}` : ""}`,
            status: row?.status === "ok" ? "approved" : row?.status === "mismatch" ? "review" : "review",
          });
        } catch (error) {
          replaceCheckLog(lineId, {
            id: lineId,
            text: `${analysis.date} — ${error instanceof Error ? error.message : "Failed"}`,
            status: "rejected",
          });
        }
      }

      pushCheckLog({
        id: `${runId}-done`,
        text: `Storyline agent complete · ${totalOk} ok · ${totalMismatch} mismatches · ${totalUncertain} uncertain`,
        status: totalMismatch > 0 || totalUncertain > 0 ? "review" : "approved",
      });

      toast({
        title: "Storyline check complete",
        description: `${totalOk} ok · ${totalMismatch} mismatches · ${totalUncertain} uncertain`,
        variant: totalMismatch > 0 ? "destructive" : "default",
      });
    } catch (error) {
      pushCheckLog({
        id: `${runId}-failed`,
        text: error instanceof Error ? error.message : "Storyline check failed",
        status: "rejected",
      });
      toast({
        title: "Storyline check failed",
        description: error instanceof Error ? error.message : "Could not run storyline agent.",
        variant: "destructive",
      });
    } finally {
      setStorylineFitRunning(false);
    }
  };

  const formatGoogleCheckLabel = (happened: "yes" | "no" | "uncertain") => {
    if (happened === "yes") return "Happened";
    if (happened === "no") return "Did not happen";
    return "Uncertain";
  };

  const googleCheckLogStatus = (
    happened: "yes" | "no" | "uncertain",
  ): LogLine["status"] => {
    if (happened === "yes") return "approved";
    if (happened === "no") return "rejected";
    return "review";
  };

  const handleGoogleCheck = async () => {
    const rows = getHomepageCheckRows();
    if (rows.length === 0) {
      toast({
        title: "Nothing to check",
        description: "No analyses on this page to verify.",
        variant: "destructive",
      });
      return;
    }

    const alreadyChecked = rows.filter((row) => row.googleCheckHappened != null);
    const toCheck = rows.filter((row) => row.googleCheckHappened == null);

    if (toCheck.length === 0) {
      pushCheckLog({
        id: `google-${Date.now()}-all-skipped`,
        text: `Skipped ${alreadyChecked.length} already checked`,
        status: "approved",
      });
      toast({
        title: "All rows already checked",
        description: `Skipped ${alreadyChecked.length} row${alreadyChecked.length === 1 ? "" : "s"} with existing Perplexity check.`,
      });
      return;
    }

    const runId = String(Date.now());
    const batchSize = 3;
    let totalYes = 0;
    let totalNo = 0;
    let totalUncertain = 0;
    let totalSkipped = alreadyChecked.length;

    setGoogleCheckRunning(true);
    pushCheckLog({
      id: `${runId}-start`,
      text: `Starting Perplexity check · ${toCheck.length} row${toCheck.length === 1 ? "" : "s"}${alreadyChecked.length > 0 ? ` · ${alreadyChecked.length} skipped` : ""}`,
      status: "approved",
    });

    if (alreadyChecked.length > 0) {
      pushCheckLog({
        id: `${runId}-skipped`,
        text: `Skipped ${alreadyChecked.length} already checked`,
        status: "approved",
      });
    }

    try {
      for (let offset = 0; offset < toCheck.length; offset += batchSize) {
        const chunk = toCheck.slice(offset, offset + batchSize);

        for (const analysis of chunk) {
          pushCheckLog({
            id: `${runId}-${analysis.date}`,
            text: `Checking ${analysis.date}…`,
            status: "pending",
          });
        }

        const response = await fetch("/api/analysis/homepage/google-check-batch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            items: chunk.map((analysis) => ({
              date: analysis.date,
              summary: analysis.summary,
              topicLeaf: canRunTopicChecks ? selectedTopicLeaf : null,
            })),
          }),
        });

        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          throw new Error(payload.error || response.statusText);
        }

        const report = await response.json();
        totalYes += report.yesDays ?? 0;
        totalNo += report.noDays ?? 0;
        totalUncertain += report.uncertainDays ?? 0;
        totalSkipped += report.skippedDays ?? 0;

        for (const analysis of chunk) {
          const lineId = `${runId}-${analysis.date}`;
          const row = report.results?.[analysis.date] as { happened?: "yes" | "no" | "uncertain" } | undefined;

          if (!row?.happened) {
            replaceCheckLog(lineId, {
              id: lineId,
              text: `${analysis.date} — no result returned`,
              status: "rejected",
            });
            continue;
          }

          replaceCheckLog(lineId, {
            id: lineId,
            text: `${analysis.date}: ${formatGoogleCheckLabel(row.happened)}`,
            status: googleCheckLogStatus(row.happened),
          });
        }

        await refetch();
      }

      pushCheckLog({
        id: `${runId}-done`,
        text: `Perplexity check complete · ${totalYes} yes · ${totalNo} no · ${totalUncertain} uncertain${totalSkipped > 0 ? ` · ${totalSkipped} skipped` : ""}`,
        status: totalNo > 0 || totalUncertain > 0 ? "review" : "approved",
      });

      toast({
        title: "Perplexity check complete",
        description: `${totalYes} yes · ${totalNo} no · ${totalUncertain} uncertain${totalSkipped > 0 ? ` · ${totalSkipped} skipped` : ""}`,
      });
    } catch (error) {
      pushCheckLog({
        id: `${runId}-failed`,
        text: error instanceof Error ? error.message : "Perplexity check failed",
        status: "rejected",
      });
      toast({
        title: "Perplexity check failed",
        description: error instanceof Error ? error.message : "Could not verify with Perplexity.",
        variant: "destructive",
      });
    } finally {
      setGoogleCheckRunning(false);
    }
  };

  return (
    <AnalysesBrowseLayout
      sidebar={
        <div className="space-y-3">
          <div className="flex gap-1 rounded-lg border border-border bg-muted/30 p-1">
            <Button
              type="button"
              size="sm"
              variant={browseAxis === "topic" ? "default" : "ghost"}
              className="flex-1 px-2"
              onClick={() => {
                setBrowseAxis("topic");
                setSelectedEntities(new Set());
                setShowUntagged(false);
                setCurrentPage(1);
                updateUrl({ browseAxis: "topic", selectedEntities: new Set(), showUntagged: false, currentPage: 1 });
              }}
            >
              Topic
            </Button>
            <Button
              type="button"
              size="sm"
              variant={browseAxis === "rarity" ? "default" : "ghost"}
              className="flex-1 px-2"
              onClick={() => {
                setBrowseAxis("rarity");
                setSelectedEntities(new Set());
                setShowUntagged(false);
                setCurrentPage(1);
                updateUrl({ browseAxis: "rarity", selectedEntities: new Set(), showUntagged: false, currentPage: 1 });
              }}
            >
              Rarity
            </Button>
            <Button
              type="button"
              size="sm"
              variant={browseAxis === "tags" ? "default" : "ghost"}
              className="flex-1 px-2"
              onClick={() => {
                setBrowseAxis("tags");
                setSelectedEntities(new Set());
                setShowUntagged(false);
                setCurrentPage(1);
                updateUrl({ browseAxis: "tags", selectedEntities: new Set(), showUntagged: false, currentPage: 1 });
              }}
            >
              Tags
            </Button>
          </div>

          {!activeCatalogData ? (
            <Card className="p-4 text-sm text-muted-foreground rounded-xl border bg-sidebar/40">
              {browseAxis === "rarity"
                ? "No locked days with rarity yet. Assign rarity from Quality Check."
                : browseAxis === "tags"
                  ? "No frequent entity tags yet on locked days."
                  : "No storylines in catalog yet. Assign topic_categories on day rows."}
            </Card>
          ) : (
            <TagsSidebar
              catalogData={activeCatalogData}
              selectedEntities={selectedEntities}
              showUntagged={browseAxis === "topic" ? showUntagged : false}
              searchQuery={searchQuery}
              mode="inline"
              showOverview={false}
              onEntitySelect={(entityKey) => {
                const newSelected = selectedEntities.has(entityKey)
                  ? new Set<string>()
                  : new Set([entityKey]);
                setSelectedEntities(newSelected);
                setShowUntagged(false);
                setCurrentPage(1);
                updateUrl({ selectedEntities: newSelected, showUntagged: false, currentPage: 1 });
              }}
              onUntaggedToggle={() => {
                if (browseAxis !== "topic") return;
                const newShowUntagged = !showUntagged;
                setShowUntagged(newShowUntagged);
                setSelectedEntities(new Set());
                setCurrentPage(1);
                updateUrl({ showUntagged: newShowUntagged, selectedEntities: new Set(), currentPage: 1 });
              }}
              onSearchChange={(value) => {
                setSearchQuery(value);
                setCurrentPage(1);
              }}
            />
          )}
        </div>
      }
    >
      <AnalysesBrowseTableCard>
        <AnalysesBrowseHeader
          title={
            browseAxis === "rarity"
              ? selectedRarityLabel
                ? `${selectedRarityLabel} days`
                : rarityDefaultView
                  ? "Locked by rarity"
                  : "Rarity browse"
              : browseAxis === "tags"
                ? selectedTagLabel
                  ? `${selectedTagLabel} days`
                  : tagsDefaultView
                    ? "Locked by tag"
                    : "Tags browse"
              : showUntagged
                ? "Untagged Analyses"
                : "Bitcoinpedia"
          }
          totalCount={totalCount}
          actions={
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0"
                  aria-label="Page actions"
                  data-testid="button-page-actions-menu"
                >
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuItem
                  onClick={handleCopyToClipboard}
                  disabled={selectAllMatching || selectedDates.size > 50}
                  data-testid="button-copy-txt"
                >
                  <Copy className="w-4 h-4 mr-2" />
                  Copy TXT
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={handleStorylineFitCheck}
                  disabled={!canRunTopicChecks || storylineFitRunning || paginatedAnalyses.length === 0}
                  data-testid="button-storyline-fit-check"
                >
                  {storylineFitRunning ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Bot className="w-4 h-4 mr-2" />
                  )}
                  Storyline check
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={handleGoogleCheck}
                  disabled={googleCheckRunning || paginatedAnalyses.length === 0}
                  data-testid="button-perplexity-check"
                >
                  {googleCheckRunning ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <PerplexityIcon className="w-4 h-4 mr-2 shrink-0" />
                  )}
                  Perplexity check
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          }
        />

        <AnalysesTable
              analyses={paginatedAnalyses}
              googleCheckSummary={googleCheckSummary}
              metadataColumn={
                browseAxis === "rarity" ? "rarity" : browseAxis === "tags" ? "tags" : "topic"
              }
              isLoading={isLoading}
              selectedDates={selectedDates}
              onDateSelect={(date) => {
                setSelectedDates((prev) => new Set(prev).add(date));
              }}
              onDateDeselect={(date) => {
                setSelectedDates((prev) => {
                  const next = new Set(prev);
                  next.delete(date);
                  return next;
                });
              }}
              onRowClick={(date) => {
                const state: HomePageState = {
                  page: 'home',
                  selectedEntities,
                  showUntagged,
                  searchQuery,
                  currentPage,
                  pageSize,
                  viewMode: 'topics',
                  browseAxis,
                  sidebarMenu: 'topics',
                };
                const query = serializePageState(state);
                setLocation(`/day/${date}?${query}`);
              }}
              onTagClick={(tagName) => {
                setSearchQuery(tagName);
                setCurrentPage(1);
                // URL will be updated by debounce effect
              }}
              onToggleFlag={(analysis) => {
                toggleFlagMutation.mutate({
                  date: analysis.date,
                  isFlagged: !analysis.isFlagged,
                });
              }}
              rowAnnotations={rowAnnotations}
              emptyMessage={
                debouncedSearchQuery.trim()
                  ? "No matching days"
                  : browseAxis === "rarity"
                    ? selectedRarityLabel
                      ? `No locked days with rarity ${selectedRarityLabel}`
                      : rarityDefaultView
                        ? "No locked days with rarity assigned yet"
                        : "Select a rarity"
                    : browseAxis === "tags"
                      ? selectedTagLabel
                        ? `No locked days tagged ${selectedTagLabel}`
                        : tagsDefaultView
                          ? "No locked days with tags found"
                          : "Select a tag"
                      : showUntagged
                        ? "No untagged analyses found"
                        : selectedEntities.size > 0
                          ? "No analyses match the selected storylines"
                          : defaultBrowseView
                            ? "No locked analyses with a topic found"
                            : "No tagged analyses found"
              }
              emptySearchHint={
                debouncedSearchQuery.trim()
                  ? `Nothing matched "${debouncedSearchQuery.trim()}" in this view. Clear the search to see all results.`
                  : null
              }
              onClearSearch={
                debouncedSearchQuery.trim()
                  ? () => {
                      setSearchQuery("");
                      setCurrentPage(1);
                      updateUrl({ searchQuery: "", currentPage: 1 });
                    }
                  : undefined
              }
              showCheckbox={true}
              pageSize={pageSize}
              currentPage={currentPage}
              totalCount={totalCount}
              catalogData={null}
              onPageChange={(page) => {
                setCurrentPage(page);
                updateUrl({ currentPage: page });
              }}
              onPageSizeChange={(size) => {
                setPageSize(size);
                setCurrentPage(1);
                updateUrl({ pageSize: size, currentPage: 1 });
              }}
              onSelectAll={toggleSelectAll}
              selectAllMatching={selectAllMatching}
              pageSizeOptions={[...PAGE_SIZE_OPTIONS]}
              showPagination={true}
              showSelectAll={true}
              showBulkActions={true}
              bulkActions={{
                showSelectAllLink: true,
                onSelectAllMatching: () => setSelectAllMatching(true),
                onClearSelection: () => {
                  setSelectedDates(new Set());
                  setSelectAllMatching(false);
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
                            title="Re-analyze (R)"
                          >
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

                    {/* Tagging Dropdown */}
                    <TaggingDropdown
                      selectedDates={Array.from(selectedDates)}
                      selectAllMatching={selectAllMatching}
                      onDatesResolve={fetchAllMatchingDates}
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
      </AnalysesBrowseTableCard>

      {/* New Copy to Clipboard Dialog */}
      <Dialog open={showCopyDialog} onOpenChange={setShowCopyDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Copy Analyses to Clipboard</DialogTitle>
            <DialogDescription>
              The text below has been selected for you. Press Ctrl+C or Cmd+C to copy.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-4">
            <textarea
              readOnly
              value={textToCopy}
              className="w-full h-64 p-2 border rounded bg-slate-50 text-sm text-slate-800"
              onFocus={(e) => e.target.select()}
              autoFocus
              data-testid="textarea-copy"
            />
          </div>
          <div className="flex justify-end pt-4">
            <Button
              onClick={() => setShowCopyDialog(false)}
              variant="outline"
              data-testid="button-close-copy-dialog"
            >
              Close
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Bulk Add Dialog */}
      <Dialog open={showBulkAdd} onOpenChange={setShowBulkAdd}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Tag to {selectAllMatching ? totalCount : selectedDates.size} Analyses</DialogTitle>
          </DialogHeader>
          
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium text-slate-700 mb-1 block">
                Tag Name
              </label>
              <Input
                placeholder="Enter tag name"
                value={bulkTagName}
                onChange={(e) => setBulkTagName(e.target.value)}
                data-testid="input-bulk-tag-name"
              />
            </div>

            <div>
              <label className="text-sm font-medium text-slate-700 mb-1 block">
                Category
              </label>
              <select
                value={bulkTagCategory}
                onChange={(e) => setBulkTagCategory(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-md"
                data-testid="select-bulk-category"
              >
                <option value="crypto">Cryptocurrency</option>
                <option value="company">Company</option>
                <option value="person">Person</option>
                <option value="country">Country</option>
                <option value="organization">Organization</option>
                <option value="protocol">Protocol</option>
                <option value="topic">Topic</option>
              </select>
            </div>

            <div className="flex justify-end space-x-2">
              <Button
                variant="outline"
                onClick={() => setShowBulkAdd(false)}
                data-testid="button-cancel-bulk-add"
              >
                Cancel
              </Button>
              <Button
                onClick={handleBulkAdd}
                disabled={bulkAddMutation.isPending}
                data-testid="button-confirm-bulk-add"
              >
                {bulkAddMutation.isPending ? "Adding..." : "Add Tag"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Bulk Remove Dialog */}
      <Dialog open={showBulkRemove} onOpenChange={setShowBulkRemove}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Remove Tags from {selectAllMatching ? totalCount : selectedDates.size} Analyses</DialogTitle>
          </DialogHeader>
          
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              Click on any tag below to remove it from all selected analyses:
            </p>

            {isLoadingTags ? (
              <div className="text-center py-8 text-slate-500">
                Loading tags...
              </div>
            ) : selectedSummariesTags.length === 0 ? (
              <div className="text-center py-8">
                <Tag className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                <p className="text-slate-500">No tags found in selected analyses</p>
              </div>
            ) : (
              <div className="max-h-96 overflow-y-auto">
                <div className="flex flex-wrap gap-2">
                  {selectedSummariesTags.map((tag) => (
                    <Badge
                      key={`${tag.category}::${tag.name}`}
                      variant="outline"
                      className={`${getCategoryColor(tag.category)} cursor-pointer hover:opacity-70 transition-opacity px-3 py-2`}
                      onClick={() => handleBulkRemove(tag)}
                      data-testid={`badge-remove-${tag.category}-${tag.name}`}
                    >
                      <span className="font-medium">{tag.name}</span>
                      <span className="ml-2 text-xs opacity-60">({tag.category})</span>
                      <X className="w-3 h-3 ml-2" />
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            <div className="flex justify-end space-x-2 pt-2 border-t">
              <Button
                variant="outline"
                onClick={() => setShowBulkRemove(false)}
                data-testid="button-cancel-bulk-remove"
              >
                Close
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Manage Tags Dialog */}
      <Dialog open={showManageTags} onOpenChange={setShowManageTags}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Tags className="w-5 h-5" />
              Manage Tags for {selectAllMatching ? totalCount.toLocaleString() : selectedDates.size} Analyses
            </DialogTitle>
            <DialogDescription>
              View, add, or remove tags from all selected analyses
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4">
            {/* Add New Tag Section */}
            <div className="p-4 bg-muted/30 rounded-lg border">
              <h4 className="text-sm font-medium mb-3 flex items-center gap-2">
                <Plus className="w-4 h-4" />
                Add New Tag
              </h4>
              <div className="flex items-end gap-3">
                <div className="flex-1">
                  <label className="text-xs text-muted-foreground mb-1 block">Tag Name</label>
                  <Input
                    placeholder="Enter tag name"
                    value={bulkTagName}
                    onChange={(e) => setBulkTagName(e.target.value)}
                    className="h-9"
                  />
                </div>
                <div className="w-40">
                  <label className="text-xs text-muted-foreground mb-1 block">Category</label>
                  <Select value={bulkTagCategory} onValueChange={setBulkTagCategory}>
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="crypto">Cryptocurrency</SelectItem>
                      <SelectItem value="company">Company</SelectItem>
                      <SelectItem value="person">Person</SelectItem>
                      <SelectItem value="country">Country</SelectItem>
                      <SelectItem value="organization">Organization</SelectItem>
                      <SelectItem value="protocol">Protocol</SelectItem>
                      <SelectItem value="topic">Topic</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  size="sm"
                  onClick={() => {
                    if (bulkTagName.trim()) {
                      handleBulkAdd();
                      setShowManageTags(false);
                    }
                  }}
                  disabled={!bulkTagName.trim() || bulkAddMutation.isPending}
                  className="h-9"
                >
                  {bulkAddMutation.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Plus className="w-4 h-4" />
                  )}
                </Button>
              </div>
            </div>

            {/* Existing Tags Section */}
            <div>
              <h4 className="text-sm font-medium mb-3 flex items-center gap-2">
                <Tag className="w-4 h-4" />
                Existing Tags
                <Badge variant="secondary" className="font-normal ml-1">
                  {selectedSummariesTags.length}
                </Badge>
              </h4>
              
              {isLoadingTags ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
                  Loading tags...
                </div>
              ) : selectedSummariesTags.length === 0 ? (
                <div className="text-center py-8 border border-dashed rounded-lg">
                  <Tag className="w-10 h-10 text-muted-foreground/30 mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">No tags found in selected analyses</p>
                </div>
              ) : (
                <div className="max-h-64 overflow-y-auto border rounded-lg p-3">
                  <div className="flex flex-wrap gap-2">
                    {selectedSummariesTags.map((tag) => (
                      <Badge
                        key={`manage-${tag.category}::${tag.name}`}
                        variant="outline"
                        className={`${getCategoryColor(tag.category)} group cursor-pointer hover:opacity-80 transition-all px-3 py-1.5`}
                        onClick={() => handleBulkRemove(tag)}
                      >
                        <span className="font-medium">{tag.name}</span>
                        <span className="ml-1.5 text-xs opacity-60">({tag.category})</span>
                        <X className="w-3 h-3 ml-2 opacity-0 group-hover:opacity-100 transition-opacity" />
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
              <p className="text-xs text-muted-foreground mt-2">
                Click on a tag to remove it from all selected analyses
              </p>
            </div>

            <div className="flex justify-end pt-2 border-t">
              <Button
                variant="outline"
                onClick={() => setShowManageTags(false)}
              >
                Done
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

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
    </AnalysesBrowseLayout>
  );
}