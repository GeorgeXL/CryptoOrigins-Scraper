import { useState, useEffect, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { parseIsLocked } from "@/lib/parseIsLocked";
import type {
  AnalysesBrowseFilterState,
  AnalysesBrowseQueryResult,
  HistoricalNewsAnalysis,
  RawAnalysisRow,
  UseAnalysesBrowseOptions,
} from "./types";

export function filterUntaggedRow(row: RawAnalysisRow): boolean {
  return !row.tags_version2 || row.tags_version2.length === 0;
}

export function filterByEntityTags(
  row: RawAnalysisRow,
  selectedEntities: Set<string>,
): boolean {
  if (!row.tags_version2 || !Array.isArray(row.tags_version2)) return false;
  return Array.from(selectedEntities).some((entityKey) => {
    const [, name] = entityKey.split("::");
    return row.tags_version2!.includes(name);
  });
}

function defaultMapRow(row: RawAnalysisRow): HistoricalNewsAnalysis {
  return {
    date: row.date,
    summary: row.summary,
    tags_version2: row.tags_version2,
    tier: row.tier_used,
    isManualOverride: row.is_manual_override,
    isFlagged: row.is_flagged || false,
    isLocked: parseIsLocked(row.is_locked),
    googleCheckHappened: row.google_check_happened ?? null,
    googleCheckCheckedAt: row.google_check_checked_at ?? null,
  };
}

async function fetchAnalysesBatch(query: {
  range: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
}): Promise<RawAnalysisRow[]> {
  let allAnalyses: RawAnalysisRow[] = [];
  let batchStart = 0;
  const batchSize = 1000;

  while (true) {
    const { data: batch, error } = await query.range(batchStart, batchStart + batchSize - 1);
    if (error) throw error;
    if (!batch || !Array.isArray(batch) || batch.length === 0) break;

    allAnalyses = allAnalyses.concat(batch as RawAnalysisRow[]);
    if (batch.length < batchSize) break;
    batchStart += batchSize;
  }

  return allAnalyses;
}

export function useAnalysesBrowse(options: UseAnalysesBrowseOptions) {
  const {
    queryKeyExtra = [],
    enabled = true,
    refetchOnMount = true,
    staleTime,
    refetchOnWindowFocus,
    selectColumns,
    includeTopicCategories = false,
    applyServerQuery,
    needsFullFetch,
    filterRow,
    mapRow = defaultMapRow,
    buildExtra,
    onDebouncedSearchChange,
    enabledWhen,
  } = options;

  const [pageSize, setPageSize] = useState(50);
  const [selectedEntities, setSelectedEntities] = useState<Set<string>>(new Set());
  const [showUntagged, setShowUntagged] = useState(false);
  const [selectedDates, setSelectedDates] = useState<Set<string>>(new Set());
  const [currentPage, setCurrentPage] = useState(1);
  const [selectAllMatching, setSelectAllMatching] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
      setCurrentPage(1);
      onDebouncedSearchChange?.(searchQuery);
    }, 300);

    return () => clearTimeout(timer);
  }, [searchQuery, onDebouncedSearchChange]);

  const filters: AnalysesBrowseFilterState = {
    selectedEntities,
    showUntagged,
    debouncedSearchQuery,
  };

  const { data: analysesData, isLoading, refetch } = useQuery<AnalysesBrowseQueryResult>({
    queryKey: [
      "supabase-tags-analyses",
      ...queryKeyExtra,
      Array.from(selectedEntities).sort().join(","),
      showUntagged,
      debouncedSearchQuery,
      currentPage,
      pageSize,
    ],
    enabled: enabled && (enabledWhen?.(filters) ?? true),
    refetchOnMount,
    staleTime,
    refetchOnWindowFocus,
    queryFn: async () => {
      if (!supabase) throw new Error("Supabase not configured");

      const columns = includeTopicCategories
        ? `${selectColumns}, topic_categories`
        : selectColumns;

      let query = supabase
        .from("historical_news_analyses")
        .select(columns, { count: "exact" });

      if (applyServerQuery) {
        query = applyServerQuery(query, filters) as typeof query;
      }

      if (debouncedSearchQuery) {
        query = query.ilike("summary", `%${debouncedSearchQuery}%`);
      }

      query = query.order("date", { ascending: true });

      const shouldFetchAll = needsFullFetch?.(filters) ?? false;
      let analyses: RawAnalysisRow[] = [];
      let totalCount: number | null = null;

      if (shouldFetchAll) {
        analyses = await fetchAnalysesBatch(query as Parameters<typeof fetchAnalysesBatch>[0]);
        totalCount = analyses.length;
      } else {
        const from = (currentPage - 1) * pageSize;
        const to = from + pageSize - 1;
        query = query.range(from, to);

        const { data, error, count } = await query;
        if (error) throw error;

        analyses = ((data || []) as unknown) as RawAnalysisRow[];
        totalCount = count;
      }

      let filteredAnalyses = analyses;
      if (filterRow) {
        filteredAnalyses = analyses.filter((row) => filterRow(row, filters));
      }

      const startIndex = (currentPage - 1) * pageSize;
      const endIndex = startIndex + pageSize;
      const paginatedAnalyses = filteredAnalyses.slice(startIndex, endIndex).map(mapRow);

      const actualTotalCount = shouldFetchAll
        ? filteredAnalyses.length
        : totalCount || filteredAnalyses.length;
      const totalPages = Math.ceil(actualTotalCount / pageSize);

      const extra = buildExtra?.(filteredAnalyses, filters) ?? {};

      return {
        analyses: paginatedAnalyses,
        pagination: {
          currentPage,
          pageSize,
          totalCount: actualTotalCount,
          totalPages,
        },
        ...extra,
      };
    },
  });

  const paginatedAnalyses = analysesData?.analyses || [];
  const totalPages = analysesData?.pagination.totalPages || 1;
  const totalCount = analysesData?.pagination.totalCount || 0;
  const googleCheckSummary = analysesData?.googleCheckSummary ?? null;

  const toggleSelectAll = useCallback(() => {
    if (selectAllMatching) {
      setSelectAllMatching(false);
      setSelectedDates(new Set());
      return;
    }

    const allPageSelected =
      paginatedAnalyses.length > 0 &&
      paginatedAnalyses.every((a) => selectedDates.has(a.date));

    if (allPageSelected) {
      setSelectedDates((prev) => {
        const next = new Set(prev);
        paginatedAnalyses.forEach((a) => next.delete(a.date));
        return next;
      });
    } else {
      setSelectedDates((prev) => {
        const next = new Set(prev);
        paginatedAnalyses.forEach((a) => next.add(a.date));
        return next;
      });
    }
  }, [paginatedAnalyses, selectAllMatching, selectedDates]);

  const toggleDateSelection = useCallback((date: string) => {
    if (selectAllMatching) {
      setSelectAllMatching(false);
    }
    setSelectedDates((prev) => {
      const next = new Set(prev);
      if (next.has(date)) {
        next.delete(date);
      } else {
        next.add(date);
      }
      return next;
    });
  }, [selectAllMatching]);

  const fetchAllFilteredRows = useCallback(async (): Promise<RawAnalysisRow[]> => {
    if (!supabase) throw new Error("Supabase not configured");

    const columns = includeTopicCategories
      ? `${selectColumns}, topic_categories`
      : selectColumns;

    const currentFilters: AnalysesBrowseFilterState = {
      selectedEntities,
      showUntagged,
      debouncedSearchQuery,
    };

    let query = supabase.from("historical_news_analyses").select(columns);

    if (applyServerQuery) {
      query = applyServerQuery(query, currentFilters) as typeof query;
    }

    if (debouncedSearchQuery) {
      query = query.ilike("summary", `%${debouncedSearchQuery}%`);
    }

    query = query.order("date", { ascending: true });

    const analyses = await fetchAnalysesBatch(query as Parameters<typeof fetchAnalysesBatch>[0]);
    if (!filterRow) return analyses;
    return analyses.filter((row) => filterRow(row, currentFilters));
  }, [
    applyServerQuery,
    debouncedSearchQuery,
    filterRow,
    includeTopicCategories,
    selectColumns,
    selectedEntities,
    showUntagged,
  ]);

  const fetchAllMatchingDates = useCallback(async (): Promise<string[]> => {
    const rows = await fetchAllFilteredRows();
    return rows.map((row) => row.date);
  }, [fetchAllFilteredRows]);

  const allPageSelected =
    paginatedAnalyses.length > 0 &&
    paginatedAnalyses.every((a) => selectedDates.has(a.date));

  return {
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
    totalPages,
    totalCount,
    googleCheckSummary,
    isLoading,
    refetch,
    toggleSelectAll,
    toggleDateSelection,
    fetchAllMatchingDates,
    fetchAllFilteredRows,
    allPageSelected,
  };
}

export type AnalysesBrowseState = ReturnType<typeof useAnalysesBrowse>;
