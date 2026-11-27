import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { useBulkReanalyze } from "@/hooks/useBulkReanalyze";
import { useQualityCheckAgentRun } from "@/hooks/useQualityCheckAgentRun";
import { useToggleFlag } from "@/hooks/useToggleFlag";
import { QualityCheckAgentToolbar } from "@/components/QualityCheckAgentToolbar";
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
import { AnalysesTable, type HistoricalNewsAnalysis } from "@/components/AnalysesTable";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tag,
  Copy,
  Tags,
  Plus,
  X,
  Loader2,
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { SiOpenai } from "react-icons/si";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabase";
import { Link } from "wouter";
import { ArticleSelectionDialog } from "@/components/ArticleSelectionDialog";
import { getCategoryDisplayMeta } from "@shared/taxonomy";
import { TagsSidebar, QualityCheckItem, type LockStatsItem } from "@/components/TagsSidebar";
import { getCategoryColor, buildFlatEntityCatalog } from "@/utils/tagHelpers";
import { serializePageState, deserializePageState, type HomePageState } from "@/lib/navigationState";
import { extractTopicLabelsFromCategories } from "@/lib/topicCatalog";
import { rarityIsInvalid, rarityIsMissing } from "@shared/rarity";
import type { QualityCheckDateInput } from "@shared/quality-check-agent-actions";
import { getQualityCheckAgentAction, isEmptyQualityCheckSummary } from "@shared/quality-check-agent-actions";
import { parseIsLocked } from "@/lib/parseIsLocked";
import {
  useAnalysesBrowse,
  filterUntaggedRow,
  filterByEntityTags,
} from "@/features/analyses-browse/useAnalysesBrowse";
import { PAGE_SIZE_OPTIONS, type EntityTag, type RawAnalysisRow, type AnalysesBrowseFilterState } from "@/features/analyses-browse/types";
import {
  AnalysesBrowseLayout,
  AnalysesBrowseHeader,
  AnalysesBrowseTableCard,
  AnalysesBrowseBulkActions,
  AnalysesBrowseEmptyPlaceholder,
} from "@/features/analyses-browse/AnalysesBrowseLayout";

function qualityCheckRowHasSummary(row: { summary?: string | null }): boolean {
  return !isEmptyQualityCheckSummary(row.summary);
}

function tagsVersion2IsEmpty(tags: unknown): boolean {
  if (!Array.isArray(tags) || tags.length === 0) return true;
  return tags.every((tag) => String(tag ?? "").trim() === "");
}

function parseIsoDateParts(value: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value).trim());
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

/** Empty days belong only on the Empty Summary tab; month-gap rows are month-level, not day summaries. */
function applyQualityCheckSummaryFilter(
  rows: QualityViolation[],
  checkId: string | null,
): QualityViolation[] {
  if (!checkId || checkId === "empty-summary" || checkId === "missing-months" || checkId === "unlocked-url-no-summary") {
    return rows;
  }
  return rows.filter(qualityCheckRowHasSummary);
}

// Quality violation types for filtering
const VIOLATION_TYPES = [
  { id: 'empty-summary', label: 'Empty Summary', filterFn: (v: QualityViolation) => !v.summary || v.summary.trim() === '' },
  { id: 'untagged', label: 'Untagged', filterFn: (v: QualityViolation) => !v.tags_version2 || v.tags_version2.length === 0 },
  { id: 'too-short', label: 'Too short (< 100 chars)', filterFn: (v: QualityViolation) => v.length > 0 && v.length < 100 },
  { id: 'too-long', label: 'Too long (> 110 chars)', filterFn: (v: QualityViolation) => v.length > 110 },
  { id: 'ends-period', label: 'Ends with period', filterFn: (v: QualityViolation) => v.summary?.trim().endsWith('.') || v.violations.some(x => x.toLowerCase().includes('trailing period')) },
  { id: 'has-hyphen', label: 'Contains unusual symbols', filterFn: (v: QualityViolation) => v.violations.some(x => /unusual symbols|disallowed symbol/i.test(x)) },
  { id: 'truncated', label: 'Truncated ending', filterFn: (v: QualityViolation) => v.violations.some(x => x.toLowerCase().includes('truncated ending')) },
  { id: 'excessive-dots', label: 'Excessive dots', filterFn: (v: QualityViolation) => v.violations.some(x => x.toLowerCase().includes('excessive dots')) },
  { id: 'generic-fallback', label: 'Generic fallback', filterFn: (v: QualityViolation) => v.violations.some(x => x.toLowerCase().includes('generic') || x.toLowerCase().includes('fallback')) },
  { id: 'repeated-words', label: 'Repeated words', filterFn: (v: QualityViolation) => v.violations.some(x => x.toLowerCase().includes('repeated')) },
  { id: 'placeholder-text', label: 'Placeholder text', filterFn: (v: QualityViolation) => v.violations.some(x => x.toLowerCase().includes('placeholder')) },
  { id: 'duplicate-summary', label: 'Duplicate summary', filterFn: (v: QualityViolation) => v.violations.some(x => x.toLowerCase().includes('duplicate')) },
  { id: 'missing-months', label: 'Incomplete months', filterFn: (v: QualityViolation) => v.violations.some(x => x.includes('Missing month')) },
] as const;

interface QualityViolation {
  date: string;
  summary: string;
  violations: string[];
  length: number;
  tags_version2?: string[] | null;
  readyForTagging?: boolean | null;
  doubleCheckReasoning?: string | null;
  isLocked?: boolean;
}

function resolveQualityCheckRowLocked(
  date: string,
  opts: { selectedLocked: boolean; rowLocked?: unknown; lockedDates: ReadonlySet<string> },
): boolean {
  if (opts.selectedLocked) return true;
  if (parseIsLocked(opts.rowLocked)) return true;
  return opts.lockedDates.has(date);
}

export default function EventsManager() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  
  const [viewMode, setViewMode] = useState<'keywords' | 'topics'>('keywords');

  // Quality check state
  const [selectedQualityCheck, setSelectedQualityCheck] = useState<string | null>(null);
  const [selectedVeriBadge, setSelectedVeriBadge] = useState<string | null>(null);
  const [selectedLocked, setSelectedLocked] = useState(false);
  const [selectedUnlocked, setSelectedUnlocked] = useState(false);
  const [qualityCheckPage, setQualityCheckPage] = useState(1);

  const prevSearchRef = useRef<string>("");
  const stateRef = useRef({
    selectedEntities: new Set<string>(),
    showUntagged: false,
    searchQuery: "",
    currentPage: 1,
    pageSize: 50,
    viewMode: "keywords" as "keywords" | "topics",
    selectedQualityCheck: null as string | null,
    selectedVeriBadge: null as string | null,
    qualityCheckPage: 1,
  });

  const updateUrl = (updates: Partial<HomePageState>) => {
    const currentState: HomePageState = {
      page: 'events-manager',
      selectedEntities: updates.selectedEntities ?? stateRef.current.selectedEntities,
      showUntagged: updates.showUntagged ?? stateRef.current.showUntagged,
      searchQuery: updates.searchQuery ?? stateRef.current.searchQuery,
      currentPage: updates.currentPage ?? stateRef.current.currentPage,
      pageSize: updates.pageSize ?? stateRef.current.pageSize,
      viewMode: updates.viewMode ?? stateRef.current.viewMode,
      selectedQualityCheck: updates.selectedQualityCheck ?? stateRef.current.selectedQualityCheck,
      selectedVeriBadge: updates.selectedVeriBadge ?? stateRef.current.selectedVeriBadge,
      qualityCheckPage: updates.qualityCheckPage ?? stateRef.current.qualityCheckPage,
    };
    // Build URL without 'from' parameter (only used when navigating to day view)
    const params = new URLSearchParams();
    if (currentState.selectedEntities.size > 0) {
      params.set('entities', Array.from(currentState.selectedEntities).join(','));
    }
    if (currentState.showUntagged) {
      params.set('untagged', '1');
    }
    if (currentState.searchQuery) {
      params.set('search', currentState.searchQuery);
    }
    params.set('page', currentState.currentPage.toString());
    params.set('pageSize', currentState.pageSize.toString());
    params.set('viewMode', currentState.viewMode);
    // EventsManager-specific fields
    if (currentState.selectedQualityCheck) {
      params.set('qualityCheck', currentState.selectedQualityCheck);
    }
    if (currentState.selectedVeriBadge) {
      params.set('veriBadge', currentState.selectedVeriBadge);
    }
    if (currentState.qualityCheckPage) {
      params.set('qualityCheckPage', currentState.qualityCheckPage.toString());
    }
    const query = params.toString();
    const newUrl = `/events-manager${query ? `?${query}` : ''}`;
    prevSearchRef.current = query ? `?${query}` : ''; // Update ref to prevent polling from resetting
    setLocation(newUrl, { replace: true });
  };

  const onDebouncedSearchChange = useCallback((nextSearchQuery: string) => {
    updateUrl({ searchQuery: nextSearchQuery, currentPage: 1 });
  }, []);

  const eventsFilterRow = useCallback((row: RawAnalysisRow, filters: AnalysesBrowseFilterState) => {
    if (filters.showUntagged && !filterUntaggedRow(row)) return false;
    if (filters.selectedEntities.size > 0 && !filters.showUntagged) {
      return filterByEntityTags(row, filters.selectedEntities);
    }
    return true;
  }, []);

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
    isLoading,
    toggleSelectAll,
    fetchAllMatchingDates,
  } = useAnalysesBrowse({
    queryKeyExtra: ["events-manager"],
    refetchOnMount: true,
    refetchOnWindowFocus: false,
    selectColumns: "date, summary, tags_version2, tier_used, is_manual_override, is_flagged",
    needsFullFetch: (filters) =>
      filters.showUntagged || filters.selectedEntities.size > 0,
    filterRow: eventsFilterRow,
    mapRow: (row) => ({
      date: row.date,
      summary: row.summary,
      tags_version2: row.tags_version2,
      tier: row.tier_used,
      isManualOverride: row.is_manual_override,
      isFlagged: row.is_flagged || false,
    }),
    enabledWhen: (filters) =>
      filters.selectedEntities.size > 0 ||
      filters.showUntagged ||
      filters.debouncedSearchQuery.length > 0,
    onDebouncedSearchChange,
  });

  useEffect(() => {
    stateRef.current = {
      selectedEntities,
      showUntagged,
      searchQuery,
      currentPage,
      pageSize,
      viewMode,
      selectedQualityCheck,
      selectedVeriBadge,
      qualityCheckPage,
    };
  }, [
    selectedEntities,
    showUntagged,
    searchQuery,
    currentPage,
    pageSize,
    viewMode,
    selectedQualityCheck,
    selectedVeriBadge,
    qualityCheckPage,
  ]);

  // New state for the copy dialog
  const [showCopyDialog, setShowCopyDialog] = useState(false);
  const [textToCopy, setTextToCopy] = useState("");

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
      const restoredState = deserializePageState(urlParams);
      if (restoredState && restoredState.page === 'events-manager') {
        const state = restoredState as HomePageState;
        if (state.selectedEntities) setSelectedEntities(state.selectedEntities);
        if (state.showUntagged !== undefined) setShowUntagged(state.showUntagged);
        if (state.searchQuery) setSearchQuery(state.searchQuery);
        if (state.currentPage) setCurrentPage(state.currentPage);
        if (state.pageSize) setPageSize(state.pageSize);
        if (state.viewMode) setViewMode(state.viewMode);
        // Restore quality check and veri badge state
        if (state.selectedQualityCheck !== undefined) setSelectedQualityCheck(state.selectedQualityCheck);
        if (state.selectedVeriBadge !== undefined) setSelectedVeriBadge(state.selectedVeriBadge);
        if (state.qualityCheckPage !== undefined) setQualityCheckPage(state.qualityCheckPage);
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
    progress
  } = useBulkReanalyze();

  const {
    running: qualityAgentRunning,
    activityStore: qualityAgentActivity,
    progressLabel: qualityAgentProgressLabel,
    logScrollRef: qualityAgentLogScrollRef,
    runQualityCheckAgent,
    stopRun: stopQualityCheckAgent,
    toggleDayExpanded: toggleQualityAgentDay,
    clearLog: clearQualityAgentLog,
  } = useQualityCheckAgentRun();

  // Fetch quality violations data
  const { data: qualityViolationsData, isLoading: qualityLoading } = useQuery<QualityViolation[]>({
    queryKey: ['quality-violations'],
    queryFn: async () => {
      const response = await fetch('/api/quality-check/violations');
      if (!response.ok) {
        throw new Error('Failed to fetch quality violations');
      }
      const result = await response.json();
      // API returns { data: violations[], total, violations: count }
      return result.data || [];
    },
    staleTime: 1000 * 60 * 5, // 5 minutes
  });

  // Fetch empty summaries (via backend to avoid client-side RLS/cache issues)
  const { data: emptySummaryData, isLoading: emptySummaryLoading } = useQuery<{ entries: any[]; totalCount: number }>({
    queryKey: ['events-manager-empty-summaries'],
    queryFn: async () => {
      const res = await fetch('/api/quality-check/empty-summaries');
      if (!res.ok) throw new Error('Failed to fetch empty summaries');
      return res.json();
    },
    staleTime: 1000 * 60 * 5,
  });

  const { data: unlockedUrlNoSummaryData, isLoading: unlockedUrlNoSummaryLoading } = useQuery<{
    entries: { date: string; summary: string; topArticleUrl: string }[];
    totalCount: number;
  }>({
    queryKey: ['events-manager-unlocked-url-no-summary'],
    queryFn: async () => {
      const res = await fetch('/api/quality-check/unlocked-url-no-summary');
      if (!res.ok) throw new Error('Failed to fetch unlocked URL / no summary rows');
      return res.json();
    },
    staleTime: 1000 * 60 * 5,
  });

  // Fetch untagged analyses (summaries without tags)
  const { data: untaggedData, isLoading: untaggedLoading } = useQuery<{ entries: any[]; totalCount: number }>({
    queryKey: ['events-manager-untagged'],
    queryFn: async () => {
      if (!supabase) {
        console.warn('Supabase not configured for untagged check');
        return { entries: [], totalCount: 0 };
      }
      
      let allData: any[] = [];
      let from = 0;
      const batchSize = 1000;
      let hasMore = true;

      while (hasMore) {
        const { data: batchData, error: batchError } = await supabase
          .from("historical_news_analyses")
          .select("date, summary, tags_version2")
          .range(from, from + batchSize - 1);

        if (batchError) {
          console.error('Error fetching untagged analyses:', batchError);
          throw batchError;
        }

        if (batchData && batchData.length > 0) {
          allData = allData.concat(batchData);
          from += batchSize;
          hasMore = batchData.length === batchSize;
        } else {
          hasMore = false;
        }
      }

      // Filter for entries without tags (tags_version2 is null or empty array)
      const untagged = allData.filter(entry => tagsVersion2IsEmpty(entry.tags_version2));

      console.log(`Untagged analyses: ${untagged.length}`);

      return {
        entries: untagged,
        totalCount: untagged.length
      };
    },
    staleTime: 1000 * 60 * 5,
  });

  // Fetch flagged analyses
  const { data: flaggedData, isLoading: flaggedLoading } = useQuery<{ entries: any[]; totalCount: number }>({
    queryKey: ['events-manager-flagged'],
    queryFn: async () => {
      if (!supabase) {
        console.warn('Supabase not configured for flagged check');
        return { entries: [], totalCount: 0 };
      }

      let allData: any[] = [];
      let from = 0;
      const batchSize = 1000;
      let hasMore = true;

      while (hasMore) {
        const { data: batchData, error: batchError } = await supabase
          .from("historical_news_analyses")
          .select("date, summary, is_flagged")
          .eq("is_flagged", true)
          .range(from, from + batchSize - 1);

        if (batchError) {
          console.error('Error fetching flagged analyses:', batchError);
          throw batchError;
        }

        if (batchData && batchData.length > 0) {
          allData = allData.concat(batchData);
          from += batchSize;
          hasMore = batchData.length === batchSize;
        } else {
          hasMore = false;
        }
      }

      return {
        entries: allData,
        totalCount: allData.length,
      };
    },
    staleTime: 1000 * 60 * 5,
  });

  // Fetch topic assignment quality (no topic / multiple topics)
  const { data: topicQualityData, isLoading: topicQualityLoading } = useQuery<{
    noTopic: { entries: { date: string; summary: string; topic_categories: unknown }[]; totalCount: number };
    googleYesNoTopic: {
      entries: { date: string; summary: string; topic_categories: unknown; google_check_happened: "yes" }[];
      totalCount: number;
    };
    notApprovedHasTopic: {
      entries: {
        date: string;
        summary: string;
        topic_categories: unknown;
        topics: string[];
        google_check_happened: "yes" | "no" | "uncertain" | null;
      }[];
      totalCount: number;
    };
    lockedNoTopic: {
      entries: { date: string; summary: string; topic_categories: unknown }[];
      totalCount: number;
    };
    lockedNotApproved: {
      entries: {
        date: string;
        summary: string;
        topic_categories: unknown;
        topics: string[];
        google_check_happened: "yes" | "no" | "uncertain" | null;
      }[];
      totalCount: number;
    };
    multiTopic: { entries: { date: string; summary: string; topic_categories: unknown; topics: string[] }[]; totalCount: number };
  }>({
    queryKey: ["events-manager-topic-quality"],
    queryFn: async () => {
      if (!supabase) {
        console.warn("Supabase not configured for topic quality check");
        return {
          noTopic: { entries: [], totalCount: 0 },
          googleYesNoTopic: { entries: [], totalCount: 0 },
          notApprovedHasTopic: { entries: [], totalCount: 0 },
          lockedNoTopic: { entries: [], totalCount: 0 },
          lockedNotApproved: { entries: [], totalCount: 0 },
          multiTopic: { entries: [], totalCount: 0 },
        };
      }

      let allData: {
        date: string;
        summary: string | null;
        topic_categories: unknown;
        google_check_happened: "yes" | "no" | "uncertain" | null;
        is_locked: boolean | null;
      }[] = [];
      let from = 0;
      const batchSize = 1000;
      let hasMore = true;

      while (hasMore) {
        const { data: batchData, error: batchError } = await supabase
          .from("historical_news_analyses")
          .select("date, summary, topic_categories, google_check_happened, is_locked")
          .range(from, from + batchSize - 1);

        if (batchError) {
          console.error("Error fetching topic quality analyses:", batchError);
          throw batchError;
        }

        if (batchData && batchData.length > 0) {
          allData = allData.concat(batchData);
          from += batchSize;
          hasMore = batchData.length === batchSize;
        } else {
          hasMore = false;
        }
      }

      const noTopicEntries: { date: string; summary: string; topic_categories: unknown }[] = [];
      const googleYesNoTopicEntries: {
        date: string;
        summary: string;
        topic_categories: unknown;
        google_check_happened: "yes";
      }[] = [];
      const notApprovedHasTopicEntries: {
        date: string;
        summary: string;
        topic_categories: unknown;
        topics: string[];
        google_check_happened: "yes" | "no" | "uncertain" | null;
      }[] = [];
      const lockedNoTopicEntries: { date: string; summary: string; topic_categories: unknown }[] = [];
      const lockedNotApprovedEntries: {
        date: string;
        summary: string;
        topic_categories: unknown;
        topics: string[];
        google_check_happened: "yes" | "no" | "uncertain" | null;
      }[] = [];
      const multiTopicEntries: {
        date: string;
        summary: string;
        topic_categories: unknown;
        topics: string[];
      }[] = [];

      for (const entry of allData) {
        const topics = extractTopicLabelsFromCategories(entry.topic_categories);
        const uniqueTopicCount = new Set(
          topics.map((topic) => topic.trim().toLowerCase().replace(/\s+/g, " ")),
        ).size;
        const summary = entry.summary || "";
        const isLocked = parseIsLocked(entry.is_locked);

        if (isLocked) {
          if (topics.length === 0) {
            lockedNoTopicEntries.push({
              date: entry.date,
              summary,
              topic_categories: entry.topic_categories,
            });
          }
          if (entry.google_check_happened !== "yes") {
            lockedNotApprovedEntries.push({
              date: entry.date,
              summary,
              topic_categories: entry.topic_categories,
              topics,
              google_check_happened: entry.google_check_happened ?? null,
            });
          }
        }

        if (topics.length === 0) {
          if (entry.google_check_happened === "yes") {
            googleYesNoTopicEntries.push({
              date: entry.date,
              summary,
              topic_categories: entry.topic_categories,
              google_check_happened: "yes",
            });
          } else {
            noTopicEntries.push({
              date: entry.date,
              summary,
              topic_categories: entry.topic_categories,
            });
          }
        } else {
          if (entry.google_check_happened !== "yes") {
            notApprovedHasTopicEntries.push({
              date: entry.date,
              summary,
              topic_categories: entry.topic_categories,
              topics,
              google_check_happened: entry.google_check_happened ?? null,
            });
          }
          if (uniqueTopicCount >= 2) {
            multiTopicEntries.push({
              date: entry.date,
              summary,
              topic_categories: entry.topic_categories,
              topics,
            });
          }
        }
      }

      return {
        noTopic: { entries: noTopicEntries, totalCount: noTopicEntries.length },
        googleYesNoTopic: {
          entries: googleYesNoTopicEntries,
          totalCount: googleYesNoTopicEntries.length,
        },
        notApprovedHasTopic: {
          entries: notApprovedHasTopicEntries,
          totalCount: notApprovedHasTopicEntries.length,
        },
        lockedNoTopic: {
          entries: lockedNoTopicEntries,
          totalCount: lockedNoTopicEntries.length,
        },
        lockedNotApproved: {
          entries: lockedNotApprovedEntries,
          totalCount: lockedNotApprovedEntries.length,
        },
        multiTopic: { entries: multiTopicEntries, totalCount: multiTopicEntries.length },
      };
    },
    staleTime: 1000 * 60 * 5,
  });

  const { data: rarityQualityData, isLoading: rarityQualityLoading } = useQuery<{
    lockedNoRarity: { entries: { date: string; summary: string; rarity: string | null }[]; totalCount: number };
    lockedInvalidRarity: {
      entries: { date: string; summary: string; rarity: string }[];
      totalCount: number;
    };
  }>({
    queryKey: ["events-manager-rarity-quality"],
    queryFn: async () => {
      if (!supabase) {
        return {
          lockedNoRarity: { entries: [], totalCount: 0 },
          lockedInvalidRarity: { entries: [], totalCount: 0 },
        };
      }

      let allData: {
        date: string;
        summary: string | null;
        rarity: string | null;
        is_locked: boolean | null;
      }[] = [];
      let from = 0;
      const batchSize = 1000;
      let hasMore = true;

      while (hasMore) {
        const { data: batchData, error: batchError } = await supabase
          .from("historical_news_analyses")
          .select("date, summary, rarity, is_locked")
          .range(from, from + batchSize - 1);

        if (batchError) throw batchError;

        if (batchData && batchData.length > 0) {
          allData = allData.concat(batchData);
          from += batchSize;
          hasMore = batchData.length === batchSize;
        } else {
          hasMore = false;
        }
      }

      const lockedNoRarityEntries: { date: string; summary: string; rarity: string | null }[] = [];
      const lockedInvalidRarityEntries: { date: string; summary: string; rarity: string }[] = [];

      for (const entry of allData) {
        if (!parseIsLocked(entry.is_locked)) continue;
        const summary = entry.summary || "";
        if (rarityIsMissing(entry.rarity)) {
          lockedNoRarityEntries.push({
            date: entry.date,
            summary,
            rarity: entry.rarity,
          });
        } else if (rarityIsInvalid(entry.rarity)) {
          lockedInvalidRarityEntries.push({
            date: entry.date,
            summary,
            rarity: String(entry.rarity),
          });
        }
      }

      return {
        lockedNoRarity: {
          entries: lockedNoRarityEntries,
          totalCount: lockedNoRarityEntries.length,
        },
        lockedInvalidRarity: {
          entries: lockedInvalidRarityEntries,
          totalCount: lockedInvalidRarityEntries.length,
        },
      };
    },
    staleTime: 1000 * 60 * 5,
  });

  // Locked days count + entries for sidebar stats / filter view
  const { data: lockedDaysData, isLoading: lockedDaysLoading } = useQuery<{
    entries: { date: string; summary: string }[];
    lockedCount: number;
    unlockedCount: number;
    totalCount: number;
  }>({
    queryKey: ["events-manager-locked-days"],
    queryFn: async () => {
      if (!supabase) {
        return { entries: [], lockedCount: 0, unlockedCount: 0, totalCount: 0 };
      }

      const { count: totalCount, error: totalError } = await supabase
        .from("historical_news_analyses")
        .select("*", { count: "exact", head: true });

      if (totalError) throw totalError;

      const { count: lockedCount, error: lockedCountError } = await supabase
        .from("historical_news_analyses")
        .select("*", { count: "exact", head: true })
        .eq("is_locked", true);

      if (lockedCountError) throw lockedCountError;

      let entries: { date: string; summary: string }[] = [];
      let from = 0;
      const batchSize = 1000;
      let hasMore = true;

      while (hasMore) {
        const { data: batchData, error: batchError } = await supabase
          .from("historical_news_analyses")
          .select("date, summary")
          .eq("is_locked", true)
          .order("date", { ascending: true })
          .range(from, from + batchSize - 1);

        if (batchError) throw batchError;
        if (!batchData || batchData.length === 0) break;

        entries = entries.concat(
          batchData.map((row) => ({
            date: row.date,
            summary: row.summary || "",
          })),
        );
        from += batchSize;
        hasMore = batchData.length === batchSize;
      }

      const total = totalCount ?? 0;
      const locked = lockedCount ?? entries.length;

      return {
        entries,
        lockedCount: locked,
        unlockedCount: Math.max(0, total - locked),
        totalCount: total,
      };
    },
    staleTime: 1000 * 60 * 5,
  });

  // Unlocked days entries — loaded when the unlocked filter is selected
  const { data: unlockedDaysData, isLoading: unlockedDaysLoading } = useQuery<{
    entries: { date: string; summary: string }[];
  }>({
    queryKey: ["events-manager-unlocked-days"],
    enabled: selectedUnlocked,
    queryFn: async () => {
      if (!supabase) {
        return { entries: [] };
      }

      let entries: { date: string; summary: string }[] = [];
      let from = 0;
      const batchSize = 1000;
      let hasMore = true;

      while (hasMore) {
        const { data: batchData, error: batchError } = await supabase
          .from("historical_news_analyses")
          .select("date, summary")
          .or("is_locked.eq.false,is_locked.is.null")
          .order("date", { ascending: true })
          .range(from, from + batchSize - 1);

        if (batchError) throw batchError;
        if (!batchData || batchData.length === 0) break;

        entries = entries.concat(
          batchData.map((row) => ({
            date: row.date,
            summary: row.summary || "",
          })),
        );
        from += batchSize;
        hasMore = batchData.length === batchSize;
      }

      return { entries };
    },
    staleTime: 1000 * 60 * 5,
  });

  const lockedDateSet = useMemo(
    () => new Set((lockedDaysData?.entries ?? []).map((entry) => entry.date)),
    [lockedDaysData],
  );

  // Fetch missing months (months with incomplete data)
  const { data: missingMonthsData, isLoading: missingMonthsLoading } = useQuery({
    queryKey: ['events-manager-missing-months'],
    queryFn: async () => {
      if (!supabase) {
        console.warn('Supabase not configured for missing months check');
        return { entries: [], totalCount: 0 };
      }
      
      // Fetch all dates
      let allData: any[] = [];
      let from = 0;
      const batchSize = 1000;
      let hasMore = true;

      while (hasMore) {
        const { data: batchData, error: batchError } = await supabase
          .from("historical_news_analyses")
          .select("date")
          .range(from, from + batchSize - 1);

        if (batchError) {
          console.error('Error fetching dates:', batchError);
          throw batchError;
        }

        if (batchData && batchData.length > 0) {
          allData = allData.concat(batchData);
          from += batchSize;
          hasMore = batchData.length === batchSize;
        } else {
          hasMore = false;
        }
      }

      // Group dates by calendar month using ISO YYYY-MM-DD (not local Date parsing)
      const monthDataMap = new Map<string, { year: number; month: number; daysPresent: Set<string> }>();
      let maxYear = 2009;
      let maxMonth = 1;
      allData.forEach(entry => {
        const parts = parseIsoDateParts(String(entry.date ?? ""));
        if (!parts) return;
        const yearMonth = `${parts.year}-${String(parts.month).padStart(2, "0")}`;
        const isoDay = `${yearMonth}-${String(parts.day).padStart(2, "0")}`;
        if (!monthDataMap.has(yearMonth)) {
          monthDataMap.set(yearMonth, { year: parts.year, month: parts.month, daysPresent: new Set() });
        }
        monthDataMap.get(yearMonth)!.daysPresent.add(isoDay);
        if (parts.year > maxYear || (parts.year === maxYear && parts.month > maxMonth)) {
          maxYear = parts.year;
          maxMonth = parts.month;
        }
      });

      const incompleteMonths: any[] = [];
      const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

      const today = new Date();
      const currentYear = today.getFullYear();
      const currentMonth = today.getMonth() + 1;
      const currentDay = today.getDate();

      let year = 2009;
      let month = 1;
      while (year < maxYear || (year === maxYear && month <= maxMonth)) {
        const yearMonth = `${year}-${String(month).padStart(2, '0')}`;
        const daysInMonth = new Date(year, month, 0).getDate();
        
        let expectedDays = daysInMonth;
        
        if (year === 2009 && month === 1) {
          expectedDays = daysInMonth - 2; // Skip Jan 1 and 2
        }
        
        if (year === currentYear && month === currentMonth) {
          expectedDays = currentDay;
        }
        
        const monthInfo = monthDataMap.get(yearMonth);
        const daysPresent = monthInfo ? monthInfo.daysPresent.size : 0;
        
        if (daysPresent < expectedDays) {
          const monthName = monthNames[month - 1];
          const missingDays = expectedDays - daysPresent;
          incompleteMonths.push({
            date: `${year}-${String(month).padStart(2, '0')}-01`,
            summary: `${monthName} ${year}: ${daysPresent}/${expectedDays} days${year === currentYear && month === currentMonth ? ' (current month)' : ''}`,
            violations: [`Missing ${missingDays} day${missingDays !== 1 ? 's' : ''} in ${monthName} ${year}`],
            length: 0,
            year,
            month,
            monthName,
            daysPresent,
            totalDays: expectedDays,
            missingDays,
          });
        }

        month += 1;
        if (month > 12) {
          month = 1;
          year += 1;
        }
      }

      // Sort by year and month
      incompleteMonths.sort((a, b) => {
        if (a.year !== b.year) return a.year - b.year;
        return a.month - b.month;
      });

      console.log(`Incomplete months: ${incompleteMonths.length}`);

      return {
        entries: incompleteMonths,
        totalCount: incompleteMonths.length
      };
    },
    staleTime: 1000 * 60 * 5,
  });

  const fetchGoogleCheckCategory = async (
    happened: "yes" | "no" | "uncertain" | null,
  ): Promise<{ entries: any[]; totalCount: number }> => {
    if (!supabase) {
      console.warn("Supabase not configured for google check sidebar");
      return { entries: [], totalCount: 0 };
    }

    let allData: any[] = [];
    let from = 0;
    const batchSize = 1000;
    let hasMore = true;

    while (hasMore) {
      let query = supabase
        .from("historical_news_analyses")
        .select("date, summary, google_check_happened, is_locked")
        .range(from, from + batchSize - 1);

      query =
        happened === null
          ? query.is("google_check_happened", null)
          : query.eq("google_check_happened", happened);

      const { data: batchData, error: batchError } = await query;

      if (batchError) {
        console.error("Error fetching google check analyses:", batchError);
        throw batchError;
      }

      if (batchData && batchData.length > 0) {
        allData = allData.concat(batchData);
        from += batchSize;
        hasMore = batchData.length === batchSize;
      } else {
        hasMore = false;
      }
    }

    const entries = allData.map((entry: any) => ({
      date: entry.date,
      summary: entry.summary || "",
      google_check_happened: entry.google_check_happened ?? null,
      is_locked: entry.is_locked ?? false,
    }));

    return {
      entries,
      totalCount: entries.length,
    };
  };

  const { data: datesApprovedData, isLoading: datesApprovedLoading } = useQuery<{ entries: any[]; totalCount: number }>({
    queryKey: ["events-manager-google-check-dates-approved"],
    queryFn: () => fetchGoogleCheckCategory("yes"),
    staleTime: 1000 * 60 * 5,
  });

  const { data: uncertainData, isLoading: uncertainLoading } = useQuery<{ entries: any[]; totalCount: number }>({
    queryKey: ["events-manager-google-check-uncertain"],
    queryFn: () => fetchGoogleCheckCategory("uncertain"),
    staleTime: 1000 * 60 * 5,
  });

  const { data: notVerifiedData, isLoading: notVerifiedLoading } = useQuery<{ entries: any[]; totalCount: number }>({
    queryKey: ["events-manager-google-check-not-verified"],
    queryFn: () => fetchGoogleCheckCategory(null),
    staleTime: 1000 * 60 * 5,
  });

  const { data: didntHappenData, isLoading: didntHappenLoading } = useQuery<{ entries: any[]; totalCount: number }>({
    queryKey: ["events-manager-google-check-didnt-happen"],
    queryFn: () => fetchGoogleCheckCategory("no"),
    staleTime: 1000 * 60 * 5,
  });

  // Build quality check items for sidebar
  const qualityCheckItems = useMemo<QualityCheckItem[]>(() => {
    const items: QualityCheckItem[] = [];
    const violations = qualityViolationsData || [];
    const emptyCount = emptySummaryData?.totalCount || 0;
    const unlockedUrlNoSummaryCount = unlockedUrlNoSummaryData?.totalCount || 0;
    const untaggedCount = (untaggedData?.entries || []).filter(qualityCheckRowHasSummary).length;
    const missingMonthsCount = missingMonthsData?.totalCount || 0;
    const flaggedCount = (flaggedData?.entries || []).filter(qualityCheckRowHasSummary).length;
    const noTopicCount = (topicQualityData?.noTopic.entries || []).filter(qualityCheckRowHasSummary).length;
    const googleYesNoTopicCount = (topicQualityData?.googleYesNoTopic.entries || []).filter(
      qualityCheckRowHasSummary,
    ).length;
    const notApprovedHasTopicCount = (topicQualityData?.notApprovedHasTopic.entries || []).filter(
      qualityCheckRowHasSummary,
    ).length;
    const lockedNoTopicCount = (topicQualityData?.lockedNoTopic.entries || []).filter(
      qualityCheckRowHasSummary,
    ).length;
    const lockedNotApprovedCount = (topicQualityData?.lockedNotApproved.entries || []).filter(
      qualityCheckRowHasSummary,
    ).length;
    const multiTopicCount = (topicQualityData?.multiTopic.entries || []).filter(qualityCheckRowHasSummary).length;
    const lockedNoRarityCount = (rarityQualityData?.lockedNoRarity.entries || []).filter(
      qualityCheckRowHasSummary,
    ).length;
    const lockedInvalidRarityCount = (rarityQualityData?.lockedInvalidRarity.entries || []).filter(
      qualityCheckRowHasSummary,
    ).length;
    const isEmptyLoading = emptySummaryLoading;
    const isUnlockedUrlNoSummaryLoading = unlockedUrlNoSummaryLoading;
    const isUntaggedLoading = untaggedLoading;
    const isMissingMonthsLoading = missingMonthsLoading;
    const isFlaggedLoading = flaggedLoading;
    const isTopicQualityLoading = topicQualityLoading;
    const isRarityQualityLoading = rarityQualityLoading;
    const isViolationsLoading = !qualityViolationsData && qualityLoading;

    // Empty summary
    items.push({
      id: 'empty-summary',
      label: 'Empty Summary',
      count: emptyCount,
      hasIssues: emptyCount > 0,
      isLoading: isEmptyLoading,
    });

    items.push({
      id: 'unlocked-url-no-summary',
      label: 'Unlocked with URL, no summary',
      count: unlockedUrlNoSummaryCount,
      hasIssues: unlockedUrlNoSummaryCount > 0,
      isLoading: isUnlockedUrlNoSummaryLoading,
    });

    // Untagged
    items.push({
      id: 'untagged',
      label: 'Untagged',
      count: untaggedCount,
      hasIssues: untaggedCount > 0,
      isLoading: isUntaggedLoading,
    });

    // Flagged
    items.push({
      id: 'flagged',
      label: 'Flagged',
      count: flaggedCount,
      hasIssues: flaggedCount > 0,
      isLoading: isFlaggedLoading,
    });

    // No topic assigned
    items.push({
      id: 'no-topic',
      label: 'Not yes, no topic',
      count: noTopicCount,
      hasIssues: noTopicCount > 0,
      isLoading: isTopicQualityLoading,
    });

    items.push({
      id: 'google-yes-no-topic',
      label: 'Google yes, no topic',
      count: googleYesNoTopicCount,
      hasIssues: googleYesNoTopicCount > 0,
      isLoading: isTopicQualityLoading,
    });

    items.push({
      id: 'not-approved-has-topic',
      label: 'Not yes, has topic',
      count: notApprovedHasTopicCount,
      hasIssues: notApprovedHasTopicCount > 0,
      isLoading: isTopicQualityLoading,
    });

    items.push({
      id: 'locked-no-topic',
      label: 'Locked, no topic',
      count: lockedNoTopicCount,
      hasIssues: lockedNoTopicCount > 0,
      isLoading: isTopicQualityLoading,
    });

    items.push({
      id: 'locked-not-approved',
      label: 'Locked, not yes',
      count: lockedNotApprovedCount,
      hasIssues: lockedNotApprovedCount > 0,
      isLoading: isTopicQualityLoading,
    });

    // Multiple topics (should be exactly one leaf)
    items.push({
      id: 'multi-topic',
      label: '2+ topics',
      count: multiTopicCount,
      hasIssues: multiTopicCount > 0,
      isLoading: isTopicQualityLoading,
    });

    items.push({
      id: 'locked-no-rarity',
      label: 'Locked, no rarity',
      count: lockedNoRarityCount,
      hasIssues: lockedNoRarityCount > 0,
      isLoading: isRarityQualityLoading,
    });

    items.push({
      id: 'locked-invalid-rarity',
      label: 'Locked, bad rarity',
      count: lockedInvalidRarityCount,
      hasIssues: lockedInvalidRarityCount > 0,
      isLoading: isRarityQualityLoading,
    });

    // Incomplete months
    items.push({
      id: 'missing-months',
      label: 'Incomplete months',
      count: missingMonthsCount,
      hasIssues: missingMonthsCount > 0,
      isLoading: isMissingMonthsLoading,
    });

    // Other violation types
    for (const type of VIOLATION_TYPES) {
      if (type.id === 'empty-summary' || type.id === 'untagged' || type.id === 'missing-months') continue;
      const count = isViolationsLoading
        ? 0
        : violations.filter((v) => type.filterFn(v) && qualityCheckRowHasSummary(v)).length;
      items.push({
        id: type.id,
        label: type.label,
        count,
        hasIssues: count > 0,
        isLoading: isViolationsLoading,
      });
    }

    return items;
  }, [qualityViolationsData, emptySummaryData, unlockedUrlNoSummaryData, untaggedData, missingMonthsData, flaggedData, topicQualityData, rarityQualityData, qualityLoading, emptySummaryLoading, unlockedUrlNoSummaryLoading, untaggedLoading, missingMonthsLoading, flaggedLoading, topicQualityLoading, rarityQualityLoading]);

  // Build Google Check items for sidebar
  const veriBadgeItems = useMemo<QualityCheckItem[]>(() => {
    return [
      {
        id: "dates-approved",
        label: "Dates approved",
        count: datesApprovedData?.totalCount || 0,
        hasIssues: false,
        isLoading: datesApprovedLoading,
      },
      {
        id: "uncertain",
        label: "Uncertain",
        count: uncertainData?.totalCount || 0,
        hasIssues: false,
        isLoading: uncertainLoading,
      },
      {
        id: "not-verified",
        label: "Not verified",
        count: notVerifiedData?.totalCount || 0,
        hasIssues: false,
        isLoading: notVerifiedLoading,
      },
      {
        id: "didnt-happen",
        label: "Didn't happen",
        count: didntHappenData?.totalCount || 0,
        hasIssues: false,
        isLoading: didntHappenLoading,
      },
    ];
  }, [datesApprovedData, uncertainData, notVerifiedData, didntHappenData, datesApprovedLoading, uncertainLoading, notVerifiedLoading, didntHappenLoading]);

  const lockStats = useMemo<LockStatsItem>(
    () => ({
      lockedCount: lockedDaysData?.lockedCount ?? 0,
      unlockedCount: lockedDaysData?.unlockedCount ?? 0,
      totalCount: lockedDaysData?.totalCount ?? 0,
      isLoading: lockedDaysLoading || (selectedUnlocked && unlockedDaysLoading),
    }),
    [lockedDaysData, lockedDaysLoading, selectedUnlocked, unlockedDaysLoading],
  );

  // Get filtered violations based on selected quality check or veriBadge
  const filteredQualityViolations = useMemo(() => {
    if (selectedLocked) {
      return (lockedDaysData?.entries || []).map((entry) => ({
        date: entry.date,
        summary: entry.summary || "",
        violations: ["Locked"],
        length: entry.summary?.length || 0,
        tags_version2: null,
      }));
    }

    if (selectedUnlocked) {
      return (unlockedDaysData?.entries || []).map((entry) => ({
        date: entry.date,
        summary: entry.summary || "",
        violations: ["Unlocked"],
        length: entry.summary?.length || 0,
        tags_version2: null,
        isLocked: false,
      }));
    }

    // Handle Google Check sidebar selections
    if (selectedVeriBadge) {
      const mapGoogleCheckEntry = (entry: any, label: string) => ({
        date: entry.date,
        summary: entry.summary || "",
        violations: [label],
        length: entry.summary?.length || 0,
        tags_version2: null,
        isLocked: parseIsLocked(entry.is_locked),
        googleCheckHappened: entry.google_check_happened ?? null,
      });

      if (selectedVeriBadge === "dates-approved") {
        return (datesApprovedData?.entries || []).map((entry: any) =>
          mapGoogleCheckEntry(entry, "Google Check: Approved (yes)"),
        );
      }
      if (selectedVeriBadge === "uncertain") {
        return (uncertainData?.entries || []).map((entry: any) =>
          mapGoogleCheckEntry(entry, "Google Check: Uncertain"),
        );
      }
      if (selectedVeriBadge === "not-verified") {
        return (notVerifiedData?.entries || []).map((entry: any) =>
          mapGoogleCheckEntry(entry, "Google Check: Not verified"),
        );
      }
      if (selectedVeriBadge === "didnt-happen") {
        return (didntHappenData?.entries || []).map((entry: any) =>
          mapGoogleCheckEntry(entry, "Google Check: Didn't happen"),
        );
      }
    }

    if (!selectedQualityCheck) return [];
    
    if (selectedQualityCheck === 'empty-summary') {
      return (emptySummaryData?.entries || []).map((entry: { date: string; summary?: string; kind?: string }) => {
        const isMissingDay = entry.kind === 'missing-day';
        return {
          date: entry.date,
          summary: isMissingDay ? 'Missing day — no analysis row' : (entry.summary || ''),
          violations: [isMissingDay ? 'Missing day' : 'Empty summary'],
          length: 0,
          tags_version2: null,
        };
      });
    }

    if (selectedQualityCheck === 'unlocked-url-no-summary') {
      return (unlockedUrlNoSummaryData?.entries || []).map((entry) => ({
        date: entry.date,
        summary: entry.topArticleUrl,
        violations: ['Unlocked with URL, no summary'],
        length: 0,
        tags_version2: null,
      }));
    }

    if (selectedQualityCheck === 'untagged') {
      return applyQualityCheckSummaryFilter(
        (untaggedData?.entries || []).map((entry: any) => ({
          date: entry.date,
          summary: entry.summary || '',
          violations: ['Untagged'],
          length: entry.summary?.length || 0,
          tags_version2: entry.tags_version2 || null,
        })),
        selectedQualityCheck,
      );
    }

    if (selectedQualityCheck === 'flagged') {
      return applyQualityCheckSummaryFilter(
        (flaggedData?.entries || []).map((entry: any) => ({
          date: entry.date,
          summary: entry.summary || '',
          violations: ['Flagged'],
          length: entry.summary?.length || 0,
          tags_version2: entry.tags_version2 || null,
        })),
        selectedQualityCheck,
      );
    }

    if (selectedQualityCheck === 'no-topic') {
      return applyQualityCheckSummaryFilter(
        (topicQualityData?.noTopic.entries || []).map((entry) => ({
          date: entry.date,
          summary: entry.summary || '',
          violations: ['Not yes, no topic assigned'],
          length: entry.summary?.length || 0,
          tags_version2: null,
        })),
        selectedQualityCheck,
      );
    }

    if (selectedQualityCheck === 'google-yes-no-topic') {
      return applyQualityCheckSummaryFilter(
        (topicQualityData?.googleYesNoTopic.entries || []).map((entry) => ({
          date: entry.date,
          summary: entry.summary || '',
          violations: ['Google Check yes, no topic assigned'],
          length: entry.summary?.length || 0,
          tags_version2: null,
          googleCheckHappened: entry.google_check_happened,
        })),
        selectedQualityCheck,
      );
    }

    if (selectedQualityCheck === 'not-approved-has-topic') {
      return applyQualityCheckSummaryFilter(
        (topicQualityData?.notApprovedHasTopic.entries || []).map((entry) => ({
          date: entry.date,
          summary: entry.summary || '',
          violations: [
            entry.google_check_happened === "no"
              ? "Google Check no, topic assigned"
              : entry.google_check_happened === "uncertain"
                ? "Google Check uncertain, topic assigned"
                : "Google Check not yes, topic assigned",
            entry.topics.length === 1
              ? `Topic: ${entry.topics[0]}`
              : `${entry.topics.length} topics: ${entry.topics.join(", ")}`,
          ],
          length: entry.summary?.length || 0,
          tags_version2: null,
          googleCheckHappened: entry.google_check_happened,
        })),
        selectedQualityCheck,
      );
    }

    if (selectedQualityCheck === 'locked-no-topic') {
      return applyQualityCheckSummaryFilter(
        (topicQualityData?.lockedNoTopic.entries || []).map((entry) => ({
          date: entry.date,
          summary: entry.summary || '',
          violations: ['Locked but no storyline topic assigned'],
          length: entry.summary?.length || 0,
          tags_version2: null,
          isLocked: true,
        })),
        selectedQualityCheck,
      );
    }

    if (selectedQualityCheck === 'locked-not-approved') {
      return applyQualityCheckSummaryFilter(
        (topicQualityData?.lockedNotApproved.entries || []).map((entry) => ({
          date: entry.date,
          summary: entry.summary || '',
          violations: [
            entry.google_check_happened === "no"
              ? "Locked but Google Check is no"
              : entry.google_check_happened === "uncertain"
                ? "Locked but Google Check is uncertain"
                : "Locked but Google Check is not yes",
            ...(entry.topics.length > 0
              ? [
                  entry.topics.length === 1
                    ? `Topic: ${entry.topics[0]}`
                    : `${entry.topics.length} topics: ${entry.topics.join(", ")}`,
                ]
              : ["No topic assigned"]),
          ],
          length: entry.summary?.length || 0,
          tags_version2: null,
          isLocked: true,
          googleCheckHappened: entry.google_check_happened,
        })),
        selectedQualityCheck,
      );
    }

    if (selectedQualityCheck === 'multi-topic') {
      return applyQualityCheckSummaryFilter(
        (topicQualityData?.multiTopic.entries || []).map((entry) => ({
          date: entry.date,
          summary: entry.summary || '',
          violations: [`${entry.topics.length} topics: ${entry.topics.join(", ")}`],
          length: entry.summary?.length || 0,
          tags_version2: null,
        })),
        selectedQualityCheck,
      );
    }

    if (selectedQualityCheck === 'locked-no-rarity') {
      return applyQualityCheckSummaryFilter(
        (rarityQualityData?.lockedNoRarity.entries || []).map((entry) => ({
          date: entry.date,
          summary: entry.summary || '',
          violations: ['Locked but no collector rarity assigned'],
          length: entry.summary?.length || 0,
          tags_version2: null,
          isLocked: true,
        })),
        selectedQualityCheck,
      );
    }

    if (selectedQualityCheck === 'locked-invalid-rarity') {
      return applyQualityCheckSummaryFilter(
        (rarityQualityData?.lockedInvalidRarity.entries || []).map((entry) => ({
          date: entry.date,
          summary: entry.summary || '',
          violations: [`Invalid rarity: ${entry.rarity}`],
          length: entry.summary?.length || 0,
          tags_version2: null,
          isLocked: true,
        })),
        selectedQualityCheck,
      );
    }

    if (selectedQualityCheck === 'missing-months') {
      return (missingMonthsData?.entries || []).map((entry: any) => ({
        date: entry.date,
        summary: entry.summary || `${entry.monthName} ${entry.year}: ${entry.daysPresent}/${entry.totalDays} days`,
        violations: entry.violations || [`Missing ${entry.missingDays} day${entry.missingDays !== 1 ? 's' : ''} in ${entry.monthName} ${entry.year}`],
        length: 0,
        tags_version2: null,
        monthName: entry.monthName,
        year: entry.year,
        month: entry.month,
        daysPresent: entry.daysPresent,
        totalDays: entry.totalDays,
        missingDays: entry.missingDays,
      }));
    }

    const violations = qualityViolationsData || [];
    const type = VIOLATION_TYPES.find(t => t.id === selectedQualityCheck);
    if (!type) return violations;

    return applyQualityCheckSummaryFilter(violations.filter(type.filterFn), selectedQualityCheck);
  }, [selectedLocked, selectedUnlocked, selectedQualityCheck, selectedVeriBadge, qualityViolationsData, emptySummaryData, unlockedUrlNoSummaryData, untaggedData, missingMonthsData, flaggedData, topicQualityData, rarityQualityData, lockedDaysData, unlockedDaysData, datesApprovedData, uncertainData, notVerifiedData, didntHappenData]);

  const qualityCheckAgentRows = useMemo<QualityCheckDateInput[]>(() => {
    return filteredQualityViolations.map((violation) => ({
      date: violation.date,
      summary: violation.summary ?? "",
      year: (violation as { year?: number }).year,
      month: (violation as { month?: number }).month,
    }));
  }, [filteredQualityViolations]);

  useEffect(() => {
    if (qualityAgentRunning) return;
    clearQualityAgentLog();
  }, [selectedQualityCheck, clearQualityAgentLog, qualityAgentRunning]);

  // Paginated quality violations
  const paginatedQualityViolations = useMemo(() => {
    const startIndex = (qualityCheckPage - 1) * pageSize;
    return filteredQualityViolations.slice(startIndex, startIndex + pageSize);
  }, [filteredQualityViolations, qualityCheckPage, pageSize]);

  // Fetch flat tags from new v2 endpoint for frontend grouping
  const { data: catalogV2Data, error: catalogError } = useQuery<{
    tags: { name: string; count: number }[];
    taggedCount: number;
    untaggedCount: number;
    totalAnalyses: number;
  }>({
    queryKey: ['tags-catalog-v2'],
    queryFn: async () => {
      const response = await fetch(`/api/tags/catalog-v2`);
      if (!response.ok) {
        const errorText = await response.text();
        console.error('Catalog v2 API error:', response.status, errorText);
        throw new Error(`Failed to fetch catalog: ${response.statusText}`);
      }
      const data = await response.json();
      console.log('Catalog v2 data received:', {
        tagCount: data.tags?.length || 0,
        taggedCount: data.taggedCount
      });
      return data;
    },
    retry: 1,
  });

  const catalogData = useMemo(
    () => buildFlatEntityCatalog(catalogV2Data),
    [catalogV2Data],
  );

  // Select/deselect all on current page for quality violations
  const toggleSelectAllQualityViolations = () => {
    // If currently selecting all matching, clear everything
    if (selectAllMatching) {
      setSelectAllMatching(false);
      setSelectedDates(new Set());
      return;
    }

    // Check if all items on current page are selected (ignore other pages)
    const allPageSelected = paginatedQualityViolations.length > 0 && paginatedQualityViolations.every(v => selectedDates.has(v.date));
    
    if (allPageSelected) {
      // Deselect all on current page
      setSelectedDates(prev => {
        const next = new Set(prev);
        paginatedQualityViolations.forEach(v => next.delete(v.date));
        return next;
      });
    } else {
      // Select all on current page
      setSelectedDates(prev => {
        const next = new Set(prev);
        paginatedQualityViolations.forEach(v => next.add(v.date));
        return next;
      });
    }
  };

  // Helper to fetch all matching quality violation dates
  const fetchAllQualityViolationDates = (): string[] => {
    // Return all dates from filtered quality violations (already filtered by selectedQualityCheck/selectedVeriBadge)
    return filteredQualityViolations.map(v => v.date);
  };

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
    invalidateQueries: [['supabase-tags-analyses']],
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
      await queryClient.invalidateQueries({ queryKey: ['supabase-tags-analyses'] });
      await queryClient.refetchQueries({ queryKey: ['tags-catalog-v2'] });
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

  const allPageSelected = paginatedAnalyses.length > 0 && 
    paginatedAnalyses.every(a => selectedDates.has(a.date));

  return (
    <AnalysesBrowseLayout
      sidebar={
        <TagsSidebar
              catalogData={catalogData}
              selectedEntities={selectedEntities}
              showUntagged={showUntagged}
              searchQuery={searchQuery}
              showSearch={false}
              mode="inline"
              showCategories={false}
              showOverview={false}
              qualityCheckItems={qualityCheckItems}
              selectedQualityCheck={selectedQualityCheck}
              onQualityCheckSelect={(id) => {
                const newQualityCheck = selectedQualityCheck === id ? null : id;
                setSelectedQualityCheck(newQualityCheck);
                setSelectedVeriBadge(null); // Clear VeriBadge selection
                setSelectedLocked(false);
                setSelectedUnlocked(false);
                setQualityCheckPage(1);
                setShowUntagged(false);
                setSelectedEntities(new Set());
                updateUrl({ selectedQualityCheck: newQualityCheck, selectedVeriBadge: null, qualityCheckPage: 1, selectedEntities: new Set() });
              }}
              lockStats={lockStats}
              selectedLocked={selectedLocked}
              onLockedSelect={() => {
                const next = !selectedLocked;
                setSelectedLocked(next);
                setSelectedUnlocked(false);
                setSelectedQualityCheck(null);
                setSelectedVeriBadge(null);
                setQualityCheckPage(1);
                setShowUntagged(false);
                setSelectedEntities(new Set());
                updateUrl({ selectedQualityCheck: null, selectedVeriBadge: null, qualityCheckPage: 1, selectedEntities: new Set() });
              }}
              selectedUnlocked={selectedUnlocked}
              onUnlockedSelect={() => {
                const next = !selectedUnlocked;
                setSelectedUnlocked(next);
                setSelectedLocked(false);
                setSelectedQualityCheck(null);
                setSelectedVeriBadge(null);
                setQualityCheckPage(1);
                setShowUntagged(false);
                setSelectedEntities(new Set());
                updateUrl({ selectedQualityCheck: null, selectedVeriBadge: null, qualityCheckPage: 1, selectedEntities: new Set() });
              }}
              veriBadgeItems={veriBadgeItems}
              selectedVeriBadge={selectedVeriBadge}
              onVeriBadgeSelect={(id) => {
                const newVeriBadge = selectedVeriBadge === id ? null : id;
                setSelectedVeriBadge(newVeriBadge);
                setSelectedQualityCheck(null); // Clear quality check selection
                setSelectedLocked(false);
                setSelectedUnlocked(false);
                setQualityCheckPage(1);
                setShowUntagged(false);
                setSelectedEntities(new Set());
                updateUrl({ selectedVeriBadge: newVeriBadge, selectedQualityCheck: null, qualityCheckPage: 1, selectedEntities: new Set() });
              }}
              onEntitySelect={(entityKey) => {
                const newSelected = new Set(selectedEntities);
                if (newSelected.has(entityKey)) {
                  newSelected.delete(entityKey);
                } else {
                  newSelected.add(entityKey);
                }
                setSelectedEntities(newSelected);
                setShowUntagged(false);
                setSelectedQualityCheck(null);
                setSelectedVeriBadge(null);
                setSelectedLocked(false);
                setSelectedUnlocked(false);
                setCurrentPage(1);
                updateUrl({ selectedEntities: newSelected, showUntagged: false, currentPage: 1, selectedQualityCheck: null, selectedVeriBadge: null });
              }}
              onUntaggedToggle={() => {
                const newShowUntagged = !showUntagged;
                setShowUntagged(newShowUntagged);
                setSelectedEntities(new Set());
                setSelectedQualityCheck(null);
                setSelectedVeriBadge(null);
                setSelectedLocked(false);
                setSelectedUnlocked(false);
                setCurrentPage(1);
                updateUrl({ showUntagged: newShowUntagged, selectedEntities: new Set(), currentPage: 1, selectedQualityCheck: null, selectedVeriBadge: null });
              }}
              onSearchChange={(value) => {
                setSearchQuery(value);
                setCurrentPage(1);
                // Note: search query is debounced, so URL update happens in debounce effect
              }}
            />
      }
    >
      <AnalysesBrowseTableCard>
            {(selectedQualityCheck || selectedVeriBadge || selectedLocked || selectedUnlocked) ? (
              <>
                {/* Quality Check, Locked, Unlocked, or Google Check View */}
                <div className="mb-3 flex items-start justify-between gap-4">
                  <div className="flex items-center space-x-3">
                    <h2 className="text-lg font-semibold text-foreground">
                      {selectedLocked
                        ? "Locked"
                        : selectedUnlocked
                          ? "Unlocked"
                        : selectedVeriBadge 
                        ? veriBadgeItems.find(t => t.id === selectedVeriBadge)?.label || 'Google Check'
                        : qualityCheckItems.find(t => t.id === selectedQualityCheck)?.label || 'Quality Check'}
                    </h2>
                    <Badge variant="secondary" className="font-normal">
                      {selectedLocked
                        ? `${lockStats.lockedCount.toLocaleString()} / ${lockStats.totalCount.toLocaleString()} locked`
                        : selectedUnlocked
                          ? `${lockStats.unlockedCount.toLocaleString()} / ${lockStats.totalCount.toLocaleString()} unlocked`
                        : `${filteredQualityViolations.length.toLocaleString()} ${selectedVeriBadge 
                        ? `entr${filteredQualityViolations.length !== 1 ? 'ies' : 'y'}`
                        : `issue${filteredQualityViolations.length !== 1 ? 's' : ''}`}`}
                    </Badge>
                  </div>
                  {selectedQualityCheck && getQualityCheckAgentAction(selectedQualityCheck) ? (
                    <div className="shrink-0">
                      <QualityCheckAgentToolbar
                        checkId={selectedQualityCheck}
                        selectedCount={selectedDates.size}
                        totalCount={filteredQualityViolations.length}
                        running={qualityAgentRunning}
                        progressLabel={qualityAgentProgressLabel}
                        activityStore={qualityAgentActivity}
                        logScrollRef={qualityAgentLogScrollRef}
                        onRun={() =>
                          void runQualityCheckAgent({
                            checkId: selectedQualityCheck,
                            rows: qualityCheckAgentRows,
                            selectedDates,
                          })
                        }
                        onStop={() => void stopQualityCheckAgent()}
                        compact
                      />
                    </div>
                  ) : null}
                </div>

                {selectedQualityCheck && getQualityCheckAgentAction(selectedQualityCheck) ? (
                  <QualityCheckAgentToolbar
                    checkId={selectedQualityCheck}
                    selectedCount={selectedDates.size}
                    totalCount={filteredQualityViolations.length}
                    running={qualityAgentRunning}
                    progressLabel={qualityAgentProgressLabel}
                    activityStore={qualityAgentActivity}
                    logScrollRef={qualityAgentLogScrollRef}
                    onToggleDay={toggleQualityAgentDay}
                    onRun={() =>
                      void runQualityCheckAgent({
                        checkId: selectedQualityCheck,
                        rows: qualityCheckAgentRows,
                        selectedDates,
                      })
                    }
                    onStop={() => void stopQualityCheckAgent()}
                    logOnly
                  />
                ) : null}

                {/* Quality violations table - using AnalysesTable */}
                <AnalysesTable
                  analyses={paginatedQualityViolations.map((violation): HistoricalNewsAnalysis => ({
                    date: violation.date,
                    summary: violation.summary || '',
                    tags_version2: [],
                    tier: undefined,
                    url: undefined,
                    source_url: undefined,
                    isManualOverride: false,
                    isLocked: resolveQualityCheckRowLocked(violation.date, {
                      selectedLocked,
                      rowLocked: (violation as { isLocked?: boolean }).isLocked,
                      lockedDates: lockedDateSet,
                    }),
                    googleCheckHappened: (violation as { googleCheckHappened?: "yes" | "no" | "uncertain" | null }).googleCheckHappened ?? null,
                  }))}
                  isLoading={
                    selectedLocked
                      ? lockedDaysLoading
                      : selectedUnlocked
                      ? unlockedDaysLoading
                      : selectedVeriBadge === "dates-approved"
                      ? datesApprovedLoading
                      : selectedVeriBadge === "uncertain"
                      ? uncertainLoading
                      : selectedVeriBadge === "not-verified"
                      ? notVerifiedLoading
                      : selectedVeriBadge === "didnt-happen"
                      ? didntHappenLoading
                      : selectedQualityCheck === 'empty-summary' 
                      ? emptySummaryLoading
                      : selectedQualityCheck === 'unlocked-url-no-summary'
                      ? unlockedUrlNoSummaryLoading
                      : selectedQualityCheck === 'untagged'
                      ? untaggedLoading
                      : selectedQualityCheck === 'no-topic' ||
                        selectedQualityCheck === 'google-yes-no-topic' ||
                        selectedQualityCheck === 'not-approved-has-topic' ||
                        selectedQualityCheck === 'locked-no-topic' ||
                        selectedQualityCheck === 'locked-not-approved' ||
                        selectedQualityCheck === 'multi-topic'
                      ? topicQualityLoading
                      : selectedQualityCheck === 'locked-no-rarity' ||
                        selectedQualityCheck === 'locked-invalid-rarity'
                      ? rarityQualityLoading
                      : selectedQualityCheck === 'flagged'
                      ? flaggedLoading
                      : selectedQualityCheck === 'missing-months'
                      ? missingMonthsLoading
                      : qualityLoading
                  }
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
                      page: 'events-manager',
                      selectedEntities,
                      showUntagged,
                      searchQuery,
                      currentPage,
                      pageSize,
                      viewMode,
                      selectedQualityCheck,
                      selectedVeriBadge,
                      qualityCheckPage,
                    };
                    const query = serializePageState(state);
                    setLocation(`/day/${date}?${query}`);
                  }}
                  getRowHref={(analysis) => {
                    const state: HomePageState = {
                      page: 'events-manager',
                      selectedEntities,
                      showUntagged,
                      searchQuery,
                      currentPage,
                      pageSize,
                      viewMode,
                      selectedQualityCheck,
                      selectedVeriBadge,
                      qualityCheckPage,
                    };
                    return `/day/${analysis.date}?${serializePageState(state)}`;
                  }}
                  onTagClick={(tagName) => setSearchQuery(tagName)}
                  emptyMessage="No issues found in this category"
                  showCheckbox={true}
                  pageSize={pageSize}
                  currentPage={qualityCheckPage}
                  totalCount={filteredQualityViolations.length}
                  catalogData={catalogData}
                  onPageChange={(page) => {
                    setQualityCheckPage(page);
                    updateUrl({ qualityCheckPage: page });
                  }}
                  onPageSizeChange={(size) => {
                    setPageSize(size);
                    setQualityCheckPage(1);
                    updateUrl({ pageSize: size, qualityCheckPage: 1 });
                  }}
                  onSelectAll={toggleSelectAllQualityViolations}
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
                      <AnalysesBrowseBulkActions
                        isReanalyzing={isReanalyzing}
                        progress={progress}
                        cancelAnalysis={cancelAnalysis}
                        reanalyzeDates={reanalyzeDates}
                        redoSummaries={redoSummaries}
                        selectAllMatching={selectAllMatching}
                        selectedDates={selectedDates}
                        fetchAllMatchingDates={async () => fetchAllQualityViolationDates()}
                        onManageTags={() => setShowManageTags(true)}
                      />
                    ),
                  }}
                />
              </>
            ) : (
              <>
                {/* Show placeholder when no selection is made */}
                {selectedEntities.size === 0 && !showUntagged && !debouncedSearchQuery ? (
                  <AnalysesBrowseEmptyPlaceholder
                    title="Select tags to view analyses"
                    description="Please pick a tag to see the analyses"
                  />
                ) : (
                  <>
                    <AnalysesBrowseHeader
                      title={showUntagged ? "Untagged Analyses" : "Events Manager"}
                      totalCount={totalCount}
                      actions={
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleCopyToClipboard}
                          disabled={selectAllMatching || selectedDates.size > 50}
                          className="flex items-center space-x-2"
                          data-testid="button-copy-txt"
                        >
                          <Copy className="w-4 h-4" />
                          <span>Copy TXT</span>
                        </Button>
                      }
                    />

                    <AnalysesTable
                  analyses={paginatedAnalyses}
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
                      page: 'events-manager',
                      selectedEntities,
                      showUntagged,
                      searchQuery,
                      currentPage,
                      pageSize,
                      viewMode,
                      selectedQualityCheck,
                      selectedVeriBadge,
                      qualityCheckPage,
                    };
                    const query = serializePageState(state);
                    setLocation(`/day/${date}?${query}`);
                  }}
                  getRowHref={(analysis) => {
                    const state: HomePageState = {
                      page: 'events-manager',
                      selectedEntities,
                      showUntagged,
                      searchQuery,
                      currentPage,
                      pageSize,
                      viewMode,
                      selectedQualityCheck,
                      selectedVeriBadge,
                      qualityCheckPage,
                    };
                    return `/day/${analysis.date}?${serializePageState(state)}`;
                  }}
                  onTagClick={(tagName) => setSearchQuery(tagName)}
                  onToggleFlag={(analysis) => {
                    toggleFlagMutation.mutate({
                      date: analysis.date,
                      isFlagged: !analysis.isFlagged,
                    });
                  }}
                  emptyMessage={
                    showUntagged
                      ? "No untagged analyses found"
                      : selectedEntities.size > 0
                      ? "No analyses match the selected entities"
                      : debouncedSearchQuery
                      ? "No analyses match your search"
                      : "No tagged analyses found"
                  }
                  showCheckbox={true}
                  pageSize={pageSize}
                  currentPage={currentPage}
                  totalCount={totalCount}
                  catalogData={catalogData}
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
                      <AnalysesBrowseBulkActions
                        isReanalyzing={isReanalyzing}
                        progress={progress}
                        cancelAnalysis={cancelAnalysis}
                        reanalyzeDates={reanalyzeDates}
                        redoSummaries={redoSummaries}
                        selectAllMatching={selectAllMatching}
                        selectedDates={selectedDates}
                        fetchAllMatchingDates={fetchAllMatchingDates}
                        onManageTags={() => setShowManageTags(true)}
                      />
                    ),
                  }}
                />
                  </>
                )}
              </>
            )}
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
