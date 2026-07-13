import type { GoogleCheckSummary, HistoricalNewsAnalysis } from "@/components/AnalysesTable";

export type { GoogleCheckSummary, HistoricalNewsAnalysis };

export const PAGE_SIZE_OPTIONS: number[] = [50, 200, 500];

export interface EntityTag {
  name: string;
  category: string;
}

export interface AnalysesBrowsePagination {
  currentPage: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
}

export interface AnalysesBrowseFilterState {
  selectedEntities: Set<string>;
  showUntagged: boolean;
  debouncedSearchQuery: string;
}

/** Raw row shape returned from Supabase before mapping. */
export interface RawAnalysisRow {
  id?: string;
  date: string;
  summary: string;
  tags_version2?: string[] | null;
  topic_categories?: unknown;
  tier_used?: number;
  is_manual_override?: boolean;
  is_flagged?: boolean;
  is_locked?: unknown;
  google_check_happened?: "yes" | "no" | "uncertain" | null;
  google_check_checked_at?: string | null;
  rarity?: string | null;
}

export interface AnalysesBrowseQueryResult {
  analyses: HistoricalNewsAnalysis[];
  pagination: AnalysesBrowsePagination;
  googleCheckSummary?: GoogleCheckSummary | null;
}

export interface UseAnalysesBrowseOptions {
  /** Extra react-query key segments (page-specific). */
  queryKeyExtra?: unknown[];
  enabled?: boolean;
  refetchOnMount?: boolean | "always";
  staleTime?: number;
  refetchOnWindowFocus?: boolean;
  /** Comma-separated Supabase select columns. */
  selectColumns: string;
  /** Whether topic_categories must be included in select. */
  includeTopicCategories?: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  applyServerQuery?: (query: any, filters: AnalysesBrowseFilterState) => any;
  needsFullFetch?: (filters: AnalysesBrowseFilterState) => boolean;
  filterRow?: (row: RawAnalysisRow, filters: AnalysesBrowseFilterState) => boolean;
  mapRow?: (row: RawAnalysisRow) => HistoricalNewsAnalysis;
  buildExtra?: (
    filteredRows: RawAnalysisRow[],
    filters: AnalysesBrowseFilterState,
  ) => Pick<AnalysesBrowseQueryResult, "googleCheckSummary">;
  onDebouncedSearchChange?: (searchQuery: string) => void;
  /** When false, the Supabase query stays disabled (e.g. Events Manager placeholder view). */
  enabledWhen?: (filters: AnalysesBrowseFilterState) => boolean;
}
