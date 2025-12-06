import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { useState, useEffect, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/lib/supabase";
import { 
  CheckCircle, 
  Calendar,
  ExternalLink,
  Loader2,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  Shield,
  X,
  XCircle,
  Sword,
  FileQuestion,
  Filter,
  Bot
} from "lucide-react";
import { SiOpenai } from "react-icons/si";
import { useToast } from "@/hooks/use-toast";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";

interface PerplexityVerifiedEntry {
  id: string;
  date: string;
  summary: string;
  perplexity_verdict: string | null;
  perplexity_confidence: number | null;
  perplexity_reasoning: string | null;
  perplexity_checked_at: string | null;
  perplexity_approved: boolean | null;
  perplexity_confidence_score: number | null;
  perplexity_sources: any[] | null;
  perplexity_importance: number | null;
  fact_check_verdict: string | null;
  gemini_approved: boolean | null;
  gemini_confidence: number | null;
  tags: Array<{ name: string; category: string }> | null;
}

interface QualityViolation {
  date: string;
  summary: string;
  violations: string[];
  length: number;
  readyForTagging?: boolean | null;
  doubleCheckReasoning?: string | null;
}

export default function Final() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [currentPage, setCurrentPage] = useState(1);
  const [emptySummaryPage, setEmptySummaryPage] = useState(1);
  const [notVerifiedPage, setNotVerifiedPage] = useState(1);
  const [contradictedPage, setContradictedPage] = useState(1);
  const [readyToTagPage, setReadyToTagPage] = useState(1);
  const [readyForTaggingPage, setReadyForTaggingPage] = useState(1);
  const [notReadyForTaggingPage, setNotReadyForTaggingPage] = useState(1);
  const [orphansPage, setOrphansPage] = useState(1);
  const [qualityCheckPage, setQualityCheckPage] = useState(1);
  const [activeTab, setActiveTab] = useState("empty-summary");
  const [selectedFilters, setSelectedFilters] = useState<Set<string>>(new Set());
  const [bulkActionLoading, setBulkActionLoading] = useState(false);
  const [selectedBulkAction, setSelectedBulkAction] = useState<string>("");
  const [doubleCheckStatus, setDoubleCheckStatus] = useState<{ isRunning: boolean; processed: number; total: number }>({ isRunning: false, processed: 0, total: 0 });
  const [newWayProcessingStatus, setNewWayProcessingStatus] = useState<{ isRunning: boolean; processed: number; total: number; currentDate: string | null }>({ isRunning: false, processed: 0, total: 0, currentDate: null });
  const pageSize = 50;

  // Get total count of entries with empty summary OR missing dates
  const { data: emptySummaryCount, isLoading: emptySummaryCountLoading } = useQuery<number>({
    queryKey: ['empty-summary-count'],
    queryFn: async () => {
      if (!supabase) throw new Error("Supabase not configured");

      // First, get all existing entries to find date range and empty summaries
      let allData: any[] = [];
      let from = 0;
      const batchSize = 1000;
      let hasMore = true;

      while (hasMore) {
        const { data: batchData, error: batchError } = await supabase
          .from("historical_news_analyses")
          .select("date, summary")
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

      // Filter to only dates >= 2009-01-03
      const minValidDate = new Date('2009-01-03');
      const filteredData = allData.filter(entry => {
        const entryDate = new Date(entry.date);
        return entryDate >= minValidDate;
      });

      // Count entries with empty summary (null, empty string, or whitespace only) that are >= 2009-01-03
      const emptySummary = filteredData.filter(entry => {
        const summary = entry.summary;
        return !summary || summary.trim() === '';
      });

      // Find missing dates in the range (only from 2009-01-03 onwards)
      if (filteredData.length > 0) {
        const dates = filteredData.map(e => e.date).sort();
        const minDate = new Date('2009-01-03'); // Start from 2009-01-03, not the actual min date
        const maxDate = new Date(dates[dates.length - 1]);
        
        // Generate all dates in range
        const existingDatesSet = new Set(dates.map(d => d));
        const missingDates: string[] = [];
        
        const currentDate = new Date(minDate);
        while (currentDate <= maxDate) {
          const dateStr = currentDate.toISOString().split('T')[0];
          if (!existingDatesSet.has(dateStr)) {
            missingDates.push(dateStr);
          }
          currentDate.setDate(currentDate.getDate() + 1);
        }
        
        return emptySummary.length + missingDates.length;
      }

      return emptySummary.length;
    },
    refetchOnMount: true,
  });

  // Get paginated entries with empty summary OR missing dates
  const { data: emptySummaryData, isLoading: emptySummaryLoading } = useQuery<{
    entries: PerplexityVerifiedEntry[];
    totalCount: number;
  }>({
    queryKey: ['empty-summary-entries', emptySummaryPage],
    queryFn: async () => {
      if (!supabase) throw new Error("Supabase not configured");

      // Fetch all entries in batches (Supabase limits to 1000 rows per query)
      let allData: any[] = [];
      let from = 0;
      const batchSize = 1000;
      let hasMore = true;

      while (hasMore) {
        const { data: batchData, error: batchError } = await supabase
          .from("historical_news_analyses")
          .select("id, date, summary, perplexity_verdict, perplexity_confidence, perplexity_reasoning, perplexity_checked_at, perplexity_approved, perplexity_confidence_score, perplexity_sources, perplexity_importance, fact_check_verdict, gemini_approved, tags")
          .order("date", { ascending: false })
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

      // Filter to only dates >= 2009-01-03
      const minValidDate = new Date('2009-01-03');
      const filteredData = (allData || []).filter(entry => {
        const entryDate = new Date(entry.date);
        return entryDate >= minValidDate;
      });

      // Filter to entries with empty summary (null, empty string, or whitespace only) that are >= 2009-01-03
      const emptySummary = filteredData.filter(entry => {
        const summary = entry.summary;
        return !summary || summary.trim() === '';
      });

      // Find missing dates in the range (only from 2009-01-03 onwards)
      let missingDates: PerplexityVerifiedEntry[] = [];
      if (filteredData.length > 0) {
        const dates = filteredData.map(e => e.date).sort();
        const minDate = new Date('2009-01-03'); // Start from 2009-01-03, not the actual min date
        const maxDate = new Date(dates[dates.length - 1]);
        
        // Generate all dates in range
        const existingDatesSet = new Set(dates.map(d => d));
        const currentDate = new Date(minDate);
        
        while (currentDate <= maxDate) {
          const dateStr = currentDate.toISOString().split('T')[0];
          if (!existingDatesSet.has(dateStr)) {
            // Create a virtual entry for missing date
            missingDates.push({
              id: `missing-${dateStr}`, // Virtual ID
              date: dateStr,
              summary: '', // Empty summary for missing dates
              perplexity_verdict: null,
              perplexity_confidence: null,
              perplexity_reasoning: null,
              perplexity_checked_at: null,
              perplexity_approved: null,
              perplexity_confidence_score: null,
              perplexity_sources: null,
              perplexity_importance: null,
              fact_check_verdict: null,
              gemini_approved: null,
              gemini_confidence: null,
              tags: null,
            });
          }
          currentDate.setDate(currentDate.getDate() + 1);
        }
      }

      // Combine empty summaries and missing dates, sort by date descending
      const allEmpty = [...emptySummary, ...missingDates].sort((a, b) => {
        return new Date(b.date).getTime() - new Date(a.date).getTime();
      });

      // Apply pagination
      const startIndex = (emptySummaryPage - 1) * pageSize;
      const endIndex = startIndex + pageSize;
      const paginated = allEmpty.slice(startIndex, endIndex);

      return {
        entries: paginated,
        totalCount: allEmpty.length
      };
    },
    refetchOnMount: true,
  });

  // Get total count of NOT verified entries (no verdict at all)
  const { data: notVerifiedCount, isLoading: notVerifiedCountLoading } = useQuery<number>({
    queryKey: ['not-verified-count'],
    queryFn: async () => {
      if (!supabase) throw new Error("Supabase not configured");

      // Fetch all entries in batches (Supabase limits to 1000 rows per query)
      let allData: any[] = [];
      let from = 0;
      const batchSize = 1000;
      let hasMore = true;

      while (hasMore) {
        const { data: batchData, error: batchError } = await supabase
          .from("historical_news_analyses")
          .select("perplexity_verdict, fact_check_verdict")
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

      // Count entries with no verdict at all (both null/empty/undefined)
      // This matches the data query filter logic exactly
      const notVerified = allData.filter(entry => {
        return !entry.perplexity_verdict && !entry.fact_check_verdict;
      });

      return notVerified.length;
    },
    refetchOnMount: true,
  });

  // Get total count of verified entries (verified by ONE service only, not both)
  const { data: totalCount, isLoading: countLoading } = useQuery<number>({
    queryKey: ['perplexity-verified-count'],
    queryFn: async () => {
      if (!supabase) throw new Error("Supabase not configured");

      // Fetch all entries in batches (Supabase limits to 1000 rows per query)
      // We need to fetch all rows to count correctly
      let allData: any[] = [];
      let from = 0;
      const batchSize = 1000;
      let hasMore = true;

      while (hasMore) {
        const { data: batchData, error: batchError } = await supabase
          .from("historical_news_analyses")
          .select("perplexity_verdict, fact_check_verdict, gemini_approved")
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

      // Count entries verified by ONE service only (not both)
      // Exclude entries that already have a Gemini response
      const oneServiceVerified = allData.filter(entry => {
        // Exclude if already processed by Gemini
        if (entry.gemini_approved !== null && entry.gemini_approved !== undefined) {
          return false;
        }
        const isPerplexityVerified = entry.perplexity_verdict === 'verified';
        const isOpenAIVerified = entry.fact_check_verdict === 'verified';
        // XOR: one is verified but not both
        return (isPerplexityVerified && !isOpenAIVerified) || (!isPerplexityVerified && isOpenAIVerified);
      });

      return oneServiceVerified.length;
    },
    refetchOnMount: true,
  });

  // Get total count of entries ready to be tagged (verified by OpenAI/Perplexity AND approved by Gemini)
  const { data: readyToTagCount, isLoading: readyToTagCountLoading } = useQuery<number>({
    queryKey: ['ready-to-tag-count'],
    queryFn: async () => {
      if (!supabase) throw new Error("Supabase not configured");

      // Fetch all entries in batches (Supabase limits to 1000 rows per query)
      let allData: any[] = [];
      let from = 0;
      const batchSize = 1000;
      let hasMore = true;

      while (hasMore) {
        const { data: batchData, error: batchError } = await supabase
          .from("historical_news_analyses")
          .select("perplexity_verdict, fact_check_verdict, gemini_approved, date")
          .order("date", { ascending: false })
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

      // Filter to entries that are:
      // 1. Verified by BOTH OpenAI AND Perplexity (regardless of Gemini), OR
      // 2. Verified by one service AND approved by Gemini
      // This must match the data query logic exactly
      const readyToTag = allData.filter(entry => {
        const isPerplexityVerified = entry.perplexity_verdict === 'verified';
        const isOpenAIVerified = entry.fact_check_verdict === 'verified';
        // Handle boolean or string conversion for gemini_approved (consistent with data query)
        const isGeminiApproved = entry.gemini_approved === true || entry.gemini_approved === 'true' || entry.gemini_approved === 1;
        const isBothVerified = isPerplexityVerified && isOpenAIVerified;
        const isOneVerified = (isPerplexityVerified || isOpenAIVerified) && !isBothVerified;
        return isBothVerified || (isOneVerified && isGeminiApproved);
      });

      console.log('Ready to Tag Count Query:', {
        totalEntries: allData.length,
        readyToTagCount: readyToTag.length,
        sample: readyToTag.slice(0, 3).map(e => ({
          date: e.date,
          perplexity: e.perplexity_verdict,
          openai: e.fact_check_verdict,
          gemini: e.gemini_approved
        }))
      });

      return readyToTag.length;
    },
    refetchOnMount: true,
  });

  // Get total count of contradicted/uncertain entries (has verdict but not verified by either service)
  const { data: contradictedCount, isLoading: contradictedCountLoading } = useQuery<number>({
    queryKey: ['perplexity-contradicted-count'],
    queryFn: async () => {
      if (!supabase) throw new Error("Supabase not configured");

      // Fetch all entries in batches (Supabase limits to 1000 rows per query)
      let allData: any[] = [];
      let from = 0;
      const batchSize = 1000;
      let hasMore = true;

      while (hasMore) {
        const { data: batchData, error: batchError } = await supabase
          .from("historical_news_analyses")
          .select("perplexity_verdict, fact_check_verdict, gemini_approved, is_orphan")
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

      // AI Arena: entries that are NOT in any other tab
      // Excludes: Not Verified (both null), Verified (one service only), Ready to be Tagged (both verified OR one verified AND gemini approved)
      const contradicted = (allData || []).filter(entry => {
        const isPerplexityVerified = entry.perplexity_verdict === 'verified';
        const isOpenAIVerified = entry.fact_check_verdict === 'verified';
        // Handle boolean or string conversion for gemini_approved (consistent with Ready to be Tagged)
        const isGeminiApproved = entry.gemini_approved === true || entry.gemini_approved === 'true' || entry.gemini_approved === 1;
        const isGeminiRejected = entry.gemini_approved === false || entry.gemini_approved === 'false' || entry.gemini_approved === 0;
        const isBothVerified = isPerplexityVerified && isOpenAIVerified;
        const isOneVerified = (isPerplexityVerified || isOpenAIVerified) && !isBothVerified;
        
        // More explicit check for non-verified verdicts (handles null, undefined, empty string)
        const hasPerplexityVerdict = entry.perplexity_verdict != null && entry.perplexity_verdict !== '' && entry.perplexity_verdict !== 'verified';
        const hasOpenAIVerdict = entry.fact_check_verdict != null && entry.fact_check_verdict !== '' && entry.fact_check_verdict !== 'verified';
        
        // Exclude: Not Verified (both null)
        const isNotVerified = !entry.perplexity_verdict && !entry.fact_check_verdict;
        if (isNotVerified) return false;
        
        // Exclude: Ready to be Tagged (both verified OR one verified AND gemini approved)
        const isReadyToTag = isBothVerified || (isOneVerified && isGeminiApproved);
        if (isReadyToTag) return false;
        
        // Exclude: Verified by one service only (unless rejected by Gemini)
        if (isOneVerified && !isGeminiRejected) return false;
        
        // Exclude: Orphans
        if (entry.is_orphan === true) return false;
        
        // Include if:
        // 1. Has a verdict but NOT verified by either service, OR
        // 2. Verified by one service but rejected by Gemini
        return (!isPerplexityVerified && !isOpenAIVerified && (hasPerplexityVerdict || hasOpenAIVerdict)) ||
               (isOneVerified && isGeminiRejected);
      });

      return contradicted.length;
    },
    refetchOnMount: true,
  });

  // Get paginated NOT verified entries (no verdict at all)
  const { data: notVerifiedData, isLoading: notVerifiedLoading } = useQuery<{
    entries: PerplexityVerifiedEntry[];
    totalCount: number;
  }>({
    queryKey: ['not-verified-entries', notVerifiedPage],
    queryFn: async () => {
      if (!supabase) throw new Error("Supabase not configured");

      // Fetch entries with no verdict at all
      const { data: allData, error: allError } = await supabase
        .from("historical_news_analyses")
        .select("id, date, summary, perplexity_verdict, perplexity_confidence, perplexity_reasoning, perplexity_checked_at, perplexity_approved, perplexity_confidence_score, perplexity_sources, perplexity_importance, fact_check_verdict, tags")
        .order("date", { ascending: false });

      if (allError) throw allError;

      // Filter to entries with no verdict at all (both null)
      const notVerified = (allData || []).filter(entry => {
        return !entry.perplexity_verdict && !entry.fact_check_verdict;
      });

      // Apply pagination
      const startIndex = (notVerifiedPage - 1) * pageSize;
      const endIndex = startIndex + pageSize;
      const paginated = notVerified.slice(startIndex, endIndex);

      return {
        entries: paginated,
        totalCount: notVerified.length
      };
    },
    refetchOnMount: true,
  });

  // Get paginated contradicted/uncertain entries (has verdict but not verified)
  const { data: contradictedData, isLoading: contradictedLoading } = useQuery<{
    entries: PerplexityVerifiedEntry[];
    totalCount: number;
  }>({
    queryKey: ['contradicted-entries', contradictedPage],
    queryFn: async () => {
      if (!supabase) throw new Error("Supabase not configured");

      // Fetch all entries in batches (Supabase limits to 1000 rows per query)
      let allData: any[] = [];
      let from = 0;
      const batchSize = 1000;
      let hasMore = true;

      while (hasMore) {
        const { data: batchData, error: batchError } = await supabase
          .from("historical_news_analyses")
          .select("id, date, summary, perplexity_verdict, perplexity_confidence, perplexity_reasoning, perplexity_checked_at, perplexity_approved, perplexity_confidence_score, perplexity_sources, perplexity_importance, fact_check_verdict, gemini_approved, tags, is_orphan")
          .order("date", { ascending: false })
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

      // AI Arena: entries that are NOT in any other tab
      // Excludes: Not Verified (both null), Verified (one service only), Ready to be Tagged (both verified OR one verified AND gemini approved)
      const contradicted = (allData || []).filter(entry => {
        const isPerplexityVerified = entry.perplexity_verdict === 'verified';
        const isOpenAIVerified = entry.fact_check_verdict === 'verified';
        // Handle boolean or string conversion for gemini_approved (consistent with Ready to be Tagged)
        const isGeminiApproved = entry.gemini_approved === true || entry.gemini_approved === 'true' || entry.gemini_approved === 1;
        const isGeminiRejected = entry.gemini_approved === false || entry.gemini_approved === 'false' || entry.gemini_approved === 0;
        const isBothVerified = isPerplexityVerified && isOpenAIVerified;
        const isOneVerified = (isPerplexityVerified || isOpenAIVerified) && !isBothVerified;
        
        // More explicit check for non-verified verdicts (handles null, undefined, empty string)
        const hasPerplexityVerdict = entry.perplexity_verdict != null && entry.perplexity_verdict !== '' && entry.perplexity_verdict !== 'verified';
        const hasOpenAIVerdict = entry.fact_check_verdict != null && entry.fact_check_verdict !== '' && entry.fact_check_verdict !== 'verified';
        
        // Exclude: Not Verified (both null)
        const isNotVerified = !entry.perplexity_verdict && !entry.fact_check_verdict;
        if (isNotVerified) return false;
        
        // Exclude: Ready to be Tagged (both verified OR one verified AND gemini approved)
        const isReadyToTag = isBothVerified || (isOneVerified && isGeminiApproved);
        if (isReadyToTag) return false;
        
        // Exclude: Verified by one service only (unless rejected by Gemini)
        if (isOneVerified && !isGeminiRejected) return false;
        
        // Exclude: Orphans
        if (entry.is_orphan === true) return false;
        
        // Include if:
        // 1. Has a verdict but NOT verified by either service, OR
        // 2. Verified by one service but rejected by Gemini
        return (!isPerplexityVerified && !isOpenAIVerified && (hasPerplexityVerdict || hasOpenAIVerdict)) ||
               (isOneVerified && isGeminiRejected);
      });

      // Apply pagination
      const startIndex = (contradictedPage - 1) * pageSize;
      const endIndex = startIndex + pageSize;
      const paginated = contradicted.slice(startIndex, endIndex);

      return {
        entries: paginated,
        totalCount: contradicted.length
      };
    },
    refetchOnMount: true,
  });

  // Get paginated entries ready to be tagged (verified by OpenAI/Perplexity AND approved by Gemini)
  const { data: readyToTagData, isLoading: readyToTagLoading } = useQuery<{
    entries: PerplexityVerifiedEntry[];
    totalCount: number;
  }>({
    queryKey: ['ready-to-tag-entries', readyToTagPage],
    queryFn: async () => {
      if (!supabase) throw new Error("Supabase not configured");

      // Fetch all entries in batches (Supabase limits to 1000 rows per query)
      let allData: any[] = [];
      let from = 0;
      const batchSize = 1000;
      let hasMore = true;

      while (hasMore) {
        const { data: batchData, error: batchError } = await supabase
          .from("historical_news_analyses")
          .select("id, date, summary, perplexity_verdict, perplexity_confidence, perplexity_reasoning, perplexity_checked_at, perplexity_approved, perplexity_confidence_score, perplexity_sources, perplexity_importance, fact_check_verdict, gemini_approved, gemini_confidence, tags, ready_for_tagging, double_check_reasoning, double_checked_at")
          .order("date", { ascending: false })
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

      // Filter to entries that are:
      // 1. Verified by BOTH OpenAI AND Perplexity (regardless of Gemini), OR
      // 2. Verified by one service AND approved by Gemini
      // AND readyForTagging IS NULL (not yet double-checked)
      const readyToTag = (allData || []).filter(entry => {
        const isPerplexityVerified = entry.perplexity_verdict === 'verified';
        const isOpenAIVerified = entry.fact_check_verdict === 'verified';
        // Handle boolean or string conversion for gemini_approved
        const isGeminiApproved = entry.gemini_approved === true || entry.gemini_approved === 'true' || entry.gemini_approved === 1;
        const isBothVerified = isPerplexityVerified && isOpenAIVerified;
        const isOneVerified = (isPerplexityVerified || isOpenAIVerified) && !isBothVerified;
        const isVerified = isBothVerified || (isOneVerified && isGeminiApproved);
        // Only show entries that haven't been double-checked yet (readyForTagging is null)
        const notDoubleChecked = entry.ready_for_tagging === null || entry.ready_for_tagging === undefined;
        return isVerified && notDoubleChecked;
      });

      // Apply pagination
      const startIndex = (readyToTagPage - 1) * pageSize;
      const endIndex = startIndex + pageSize;
      const paginated = readyToTag.slice(startIndex, endIndex);

      return {
        entries: paginated,
        totalCount: readyToTag.length
      };
    },
    refetchOnMount: true,
  });

  // Get total count of entries ready for tagging (readyForTagging = true)
  const { data: readyForTaggingCount, isLoading: readyForTaggingCountLoading } = useQuery<number>({
    queryKey: ['ready-for-tagging-count'],
    queryFn: async () => {
      if (!supabase) throw new Error("Supabase not configured");

      // Query for count of entries where ready_for_tagging is true
      const { count, error } = await supabase
        .from("historical_news_analyses")
        .select("*", { count: "exact", head: true })
        .eq("ready_for_tagging", true);

      if (error) {
        console.error("Error fetching ready-for-tagging count:", error);
        throw error;
      }

      console.log("Ready-for-tagging count:", count);
      return count || 0;
    },
    refetchOnMount: true,
  });

  // Get paginated entries ready for tagging (readyForTagging = true)
  const { data: readyForTaggingData, isLoading: readyForTaggingLoading } = useQuery<{
    entries: PerplexityVerifiedEntry[];
    totalCount: number;
  }>({
    queryKey: ['ready-for-tagging-entries', readyForTaggingPage],
    queryFn: async () => {
      if (!supabase) throw new Error("Supabase not configured");

      // Query for entries where ready_for_tagging is true
      const { data, error, count } = await supabase
        .from("historical_news_analyses")
        .select("id, date, summary, perplexity_verdict, perplexity_confidence, perplexity_reasoning, perplexity_checked_at, perplexity_approved, perplexity_confidence_score, perplexity_sources, perplexity_importance, fact_check_verdict, gemini_approved, gemini_confidence, tags, ready_for_tagging, double_check_reasoning, double_checked_at", { count: "exact" })
        .eq("ready_for_tagging", true)
        .order("date", { ascending: false })
        .range((readyForTaggingPage - 1) * pageSize, readyForTaggingPage * pageSize - 1);

      if (error) {
        console.error("Error fetching ready-for-tagging entries:", error);
        throw error;
      }

      console.log("Ready-for-tagging query result:", {
        count,
        dataLength: data?.length || 0,
        page: readyForTaggingPage,
        pageSize
      });

      return {
        entries: data || [],
        totalCount: count || 0
      };
    },
    refetchOnMount: true,
  });

  const readyForTaggingEntries = readyForTaggingData?.entries || [];
  const readyForTaggingTotalPages = Math.ceil((readyForTaggingData?.totalCount || readyForTaggingCount || 0) / pageSize);

  // Get total count of entries NOT ready for tagging (readyForTagging = false or null)
  const { data: notReadyForTaggingCount, isLoading: notReadyForTaggingCountLoading } = useQuery<number>({
    queryKey: ['not-ready-for-tagging-count'],
    queryFn: async () => {
      if (!supabase) throw new Error("Supabase not configured");

      // Query for entries where ready_for_tagging is false or null
      const { count, error } = await supabase
        .from("historical_news_analyses")
        .select("*", { count: "exact", head: true })
        .or('ready_for_tagging.is.null,ready_for_tagging.eq.false');

      if (error) {
        console.error("Error fetching not-ready-for-tagging count:", error);
        throw error;
      }

      console.log("Not-ready-for-tagging count:", count);
      return count || 0;
    },
    refetchOnMount: true,
  });

  // Get paginated entries NOT ready for tagging (readyForTagging = false or null)
  const { data: notReadyForTaggingData, isLoading: notReadyForTaggingLoading } = useQuery<{
    entries: PerplexityVerifiedEntry[];
    totalCount: number;
  }>({
    queryKey: ['not-ready-for-tagging-entries', notReadyForTaggingPage],
    queryFn: async () => {
      if (!supabase) throw new Error("Supabase not configured");

      // Query for entries where ready_for_tagging is false or null
      const { data, error, count } = await supabase
        .from("historical_news_analyses")
        .select("id, date, summary, perplexity_verdict, perplexity_confidence, perplexity_reasoning, perplexity_checked_at, perplexity_approved, perplexity_confidence_score, perplexity_sources, perplexity_importance, fact_check_verdict, gemini_approved, gemini_confidence, tags, ready_for_tagging, double_check_reasoning, double_checked_at", { count: "exact" })
        .or('ready_for_tagging.is.null,ready_for_tagging.eq.false')
        .order("date", { ascending: false })
        .range((notReadyForTaggingPage - 1) * pageSize, notReadyForTaggingPage * pageSize - 1);

      if (error) {
        console.error("Error fetching not-ready-for-tagging entries:", error);
        throw error;
      }

      console.log("Not-ready-for-tagging query result:", {
        count,
        dataLength: data?.length || 0,
        page: notReadyForTaggingPage,
        pageSize
      });

      return {
        entries: data || [],
        totalCount: count || 0
      };
    },
    refetchOnMount: true,
  });

  const notReadyForTaggingEntries = notReadyForTaggingData?.entries || [];
  const notReadyForTaggingTotalPages = Math.ceil((notReadyForTaggingData?.totalCount || notReadyForTaggingCount || 0) / pageSize);

  // Get total count of orphan entries (isOrphan = true)
  const { data: orphansCount, isLoading: orphansCountLoading } = useQuery<number>({
    queryKey: ['orphans-count'],
    queryFn: async () => {
      if (!supabase) throw new Error("Supabase not configured");

      // Fetch all entries in batches (Supabase limits to 1000 rows per query)
      let allData: any[] = [];
      let from = 0;
      const batchSize = 1000;
      let hasMore = true;

      while (hasMore) {
        const { data: batchData, error: batchError } = await supabase
          .from("historical_news_analyses")
          .select("is_orphan")
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

      const orphans = (allData || []).filter(entry => entry.is_orphan === true);
      return orphans.length;
    },
    refetchOnMount: true,
  });

  // Get paginated orphan entries (isOrphan = true)
  const { data: orphansData, isLoading: orphansLoading } = useQuery<{
    entries: PerplexityVerifiedEntry[];
    totalCount: number;
  }>({
    queryKey: ['orphans-entries', orphansPage],
    queryFn: async () => {
      if (!supabase) throw new Error("Supabase not configured");

      // Fetch all entries in batches (Supabase limits to 1000 rows per query)
      let allData: any[] = [];
      let from = 0;
      const batchSize = 1000;
      let hasMore = true;

      while (hasMore) {
        const { data: batchData, error: batchError } = await supabase
          .from("historical_news_analyses")
          .select("id, date, summary, perplexity_verdict, perplexity_confidence, perplexity_reasoning, perplexity_checked_at, perplexity_approved, perplexity_confidence_score, perplexity_sources, perplexity_importance, fact_check_verdict, gemini_approved, tags, is_orphan")
          .order("date", { ascending: false })
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

      // Filter to orphan entries
      const orphans = (allData || []).filter(entry => entry.is_orphan === true);

      // Apply pagination
      const startIndex = (orphansPage - 1) * pageSize;
      const endIndex = startIndex + pageSize;
      const paginated = orphans.slice(startIndex, endIndex);

      return {
        entries: paginated,
        totalCount: orphans.length
      };
    },
    refetchOnMount: true,
  });

  // Violation filter types
  const violationTypes = [
    { id: 'too-short', label: 'Too short (< 100 chars)', color: 'bg-red-100 text-red-700 border-red-300' },
    { id: 'too-long', label: 'Too long (> 110 chars)', color: 'bg-red-100 text-red-700 border-red-300' },
    { id: 'ends-period', label: 'Ends with period', color: 'bg-orange-100 text-orange-700 border-orange-300' },
    { id: 'has-hyphen', label: 'Contains space-hyphen ( -)', color: 'bg-yellow-100 text-yellow-700 border-yellow-300' },
    { id: 'truncated', label: 'Truncated ending', color: 'bg-purple-100 text-purple-700 border-purple-300' },
    { id: 'excessive-dots', label: 'Excessive dots', color: 'bg-slate-100 text-slate-700 border-slate-300' },
    { id: 'generic-fallback', label: 'Generic fallback', color: 'bg-slate-100 text-slate-700 border-slate-300' },
    { id: 'repeated-words', label: 'Repeated words', color: 'bg-slate-100 text-slate-700 border-slate-300' },
    { id: 'placeholder-text', label: 'Placeholder text', color: 'bg-slate-100 text-slate-700 border-slate-300' },
    { id: 'duplicate-summary', label: 'Duplicate summary', color: 'bg-slate-100 text-slate-700 border-slate-300' },
    { id: 'similar-summary', label: 'Similar summary', color: 'bg-slate-100 text-slate-700 border-slate-300' },
    { id: 'invalid-links', label: 'Invalid links', color: 'bg-slate-100 text-slate-700 border-slate-300' },
    { id: 'not-a-sentence', label: 'Not a sentence', color: 'bg-blue-100 text-blue-700 border-blue-300' },
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
    // Reset to first page when filters change
    setQualityCheckPage(1);
  };

  // Get all quality violations (not paginated - we'll filter and paginate client-side)
  const { data: allQualityCheckData, isLoading: qualityCheckLoading } = useQuery<{
    data: QualityViolation[];
    total: number;
    violations: number;
  }>({
    queryKey: ['quality-check-all'],
    queryFn: async () => {
      const response = await fetch("/api/quality-check/violations");
      if (!response.ok) throw new Error("Failed to fetch quality violations");
      const data = await response.json();
      const violations = (data.data || []) as QualityViolation[];
      
      // Sort by date descending
      violations.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      
      return {
        data: violations,
        total: data.total || violations.length,
        violations: data.violations || violations.length
      };
    },
    refetchOnMount: true,
  });

  const allQualityViolations = allQualityCheckData?.data || [];
  const qualityCheckCount = allQualityCheckData?.violations || 0;

  // Filter violations based on selected filters
  const filteredViolations = useMemo(() => {
    if (selectedFilters.size === 0) {
      return allQualityViolations;
    }
    
    return allQualityViolations.filter(violation => {
      const matchesFilters = Array.from(selectedFilters).some(filterId => {
        switch(filterId) {
          case 'too-short':
            return violation.violations.some(v => v.includes('too short') || v.includes('Too short'));
          case 'too-long':
            return violation.violations.some(v => v.includes('too long') || v.includes('Too long'));
          case 'ends-period':
            // Check if summary ends with period OR if violation message mentions period
            return violation.summary.trim().endsWith('.') || 
                   violation.violations.some(v => v.includes('Ends with period') || v.includes('ends with period') || v.includes('period'));
          case 'has-hyphen':
            return violation.violations.some(v => v.includes('hyphen') || v.includes('space-hyphen'));
          case 'truncated':
            return violation.violations.some(v => v.includes('Ends with') || v.includes('Truncated'));
          case 'excessive-dots':
            return violation.violations.some(v => v.includes('excessive dots') || v.includes('Excessive dots'));
          case 'generic-fallback':
            return violation.violations.some(v => v.includes('generic') || v.includes('fallback'));
          case 'repeated-words':
            return violation.violations.some(v => v.includes('repeated') || v.includes('Repeated'));
          case 'placeholder-text':
            return violation.violations.some(v => v.includes('placeholder') || v.includes('Placeholder'));
          case 'duplicate-summary':
            return violation.violations.some(v => v.includes('duplicate') || v.includes('Duplicate'));
          case 'similar-summary':
            return violation.violations.some(v => v.includes('similar') || v.includes('Similar'));
          case 'invalid-links':
            return violation.violations.some(v => v.includes('invalid') || v.includes('Invalid') || v.includes('link'));
          case 'not-a-sentence':
            // Filter entries that failed double check (ready_for_tagging = false)
            return violation.readyForTagging === false;
          default:
            return false;
        }
      });
      return matchesFilters;
    });
  }, [allQualityViolations, selectedFilters]);

  // Apply pagination to filtered violations
  const qualityCheckEntries = useMemo(() => {
    const startIndex = (qualityCheckPage - 1) * pageSize;
    const endIndex = startIndex + pageSize;
    return filteredViolations.slice(startIndex, endIndex);
  }, [filteredViolations, qualityCheckPage]);

  // Bulk remove periods mutation
  const removePeriodsMutation = useMutation({
    mutationFn: async () => {
      setBulkActionLoading(true);
      const response = await fetch("/api/quality-check/bulk-remove-periods", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to remove periods");
      }
      return response.json();
    },
    onSuccess: (data) => {
      setBulkActionLoading(false);
      setSelectedBulkAction("");
      toast({
        title: "Periods Removed",
        description: `Successfully removed periods from ${data.updated} summaries${data.errors ? ` (${data.errors.length} errors)` : ''}`,
      });
      // Refetch quality check data
      queryClient.invalidateQueries({ queryKey: ['quality-check-all'] });
    },
    onError: (error: Error) => {
      setBulkActionLoading(false);
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to remove periods",
      });
    },
  });

  // Double-check summaries mutation
  const doubleCheckMutation = useMutation({
    mutationFn: async (entries: Array<{ date: string; summary: string }>) => {
      const response = await fetch("/api/ready-to-tag/double-check-summaries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entries }),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to double-check summaries");
      }
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Double-Check Started",
        description: `Checking ${data.total} summaries. This will run in the background.`,
      });
      // Status polling is handled by useEffect
      setDoubleCheckStatus({ isRunning: true, processed: 0, total: data.total });
    },
    onError: (error: Error) => {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to start double-check",
      });
    },
  });

  // Stop double-check mutation
  const stopDoubleCheckMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/ready-to-tag/stop-double-check", {
        method: "POST",
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to stop double-check");
      }
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Stop Requested",
        description: "Double-check will stop after current entries complete.",
      });
    },
  });

  // Bulk regenerate summaries mutation
  // Process empty summaries one by one using Analyse Day system
  const processEmptySummariesNewWayMutation = useMutation({
    mutationFn: async () => {
      if (!supabase) throw new Error("Supabase not configured");
      
      // Get all empty summary entries
      let allData: any[] = [];
      let from = 0;
      const batchSize = 1000;
      let hasMore = true;

      while (hasMore) {
        const { data: batchData, error: batchError } = await supabase
          .from("historical_news_analyses")
          .select("id, date, summary")
          .order("date", { ascending: false })
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

      // Filter to only dates >= 2009-01-03 (same as count query)
      const minValidDate = new Date('2009-01-03');
      const filteredData = allData.filter(entry => {
        if (!entry.date) return false; // Skip entries without dates
        const entryDate = new Date(entry.date);
        return entryDate >= minValidDate;
      });

      // Filter to entries with empty summary (null, empty string, or whitespace only)
      const emptySummaries = filteredData.filter(entry => {
        const summary = entry.summary;
        return !summary || summary.trim() === '';
      });

      // Find missing dates in the range (only from 2009-01-03 onwards)
      let missingDates: string[] = [];
      if (filteredData.length > 0) {
        const dates = filteredData.map(e => e.date).sort();
        const minDate = new Date('2009-01-03');
        const maxDate = new Date(dates[dates.length - 1]);
        
        // Generate all dates in range
        const existingDatesSet = new Set(dates.map(d => d));
        const currentDate = new Date(minDate);
        
        while (currentDate <= maxDate) {
          const dateStr = currentDate.toISOString().split('T')[0];
          if (!existingDatesSet.has(dateStr)) {
            missingDates.push(dateStr);
          }
          currentDate.setDate(currentDate.getDate() + 1);
        }
      }

      // Combine empty summaries and missing dates
      const allToProcess: Array<{ date: string; isMissing: boolean }> = [
        ...emptySummaries.map(e => ({ date: e.date, isMissing: false })),
        ...missingDates.map(d => ({ date: d, isMissing: true }))
      ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

      const total = allToProcess.length;
      console.log(`📊 [Process Analyse Day] Found ${total} entries to process:`);
      console.log(`   - ${emptySummaries.length} empty summaries`);
      console.log(`   - ${missingDates.length} missing dates`);
      setNewWayProcessingStatus({ isRunning: true, processed: 0, total, currentDate: null });

      // Process one by one
      let processed = 0;
      const errors: Array<{ date: string; error: string }> = [];

      for (const entry of allToProcess) {
        try {
          setNewWayProcessingStatus({ 
            isRunning: true, 
            processed, 
            total, 
            currentDate: entry.date 
          });

          console.log(`🔄 [Process Analyse Day] Processing ${entry.isMissing ? 'missing date' : 'empty summary'}: ${entry.date}`);

          const response = await fetch(`/api/analysis/date/${entry.date}`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ 
              forceReanalysis: !entry.isMissing, // Only force reanalysis for existing entries, not missing dates
              // Using Analyse Day system (default)
            }),
          });

          if (!response.ok) {
            const errorData = await response.json().catch(() => ({ error: response.statusText }));
            throw new Error(errorData.error || `HTTP ${response.status}`);
          }

          processed++;
          setNewWayProcessingStatus({ 
            isRunning: true, 
            processed, 
            total, 
            currentDate: entry.date 
          });

          // Small delay between requests to avoid rate limiting
          await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (error) {
          errors.push({ 
            date: entry.date, 
            error: (error as Error).message 
          });
          processed++;
          setNewWayProcessingStatus({ 
            isRunning: true, 
            processed, 
            total, 
            currentDate: entry.date 
          });
        }
      }

      setNewWayProcessingStatus({ 
        isRunning: false, 
        processed, 
        total, 
        currentDate: null 
      });

      return { processed, total, errors };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['empty-summary-entries'] });
      queryClient.invalidateQueries({ queryKey: ['empty-summary-count'] });
      toast({
        title: "Processing Complete",
        description: `Processed ${data.processed} of ${data.total} entries. ${data.errors.length > 0 ? `${data.errors.length} errors occurred.` : 'All successful!'}`,
      });
    },
    onError: (error: Error) => {
      setNewWayProcessingStatus({ 
        isRunning: false, 
        processed: 0, 
        total: 0, 
        currentDate: null 
      });
      toast({
        title: "Processing Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const regenerateSummariesMutation = useMutation({
    mutationFn: async (testDates?: string[]) => {
      setBulkActionLoading(true);
      const response = await fetch("/api/quality-check/bulk-regenerate-summaries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(testDates ? { testDates } : {}),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to regenerate summaries");
      }
      return response.json();
    },
    onSuccess: (data) => {
      setBulkActionLoading(false);
      setSelectedBulkAction("");
      toast({
        title: "Summaries Regenerated",
        description: `Successfully regenerated ${data.updated} summaries${data.skipped ? ` (${data.skipped.length} skipped)` : ''}${data.errors ? ` (${data.errors.length} errors)` : ''}`,
      });
      // Refetch quality check data
      queryClient.invalidateQueries({ queryKey: ['quality-check-all'] });
    },
    onError: (error: Error) => {
      setBulkActionLoading(false);
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to regenerate summaries",
      });
    },
  });

  const adjustLengthMutation = useMutation({
    mutationFn: async () => {
      setBulkActionLoading(true);
      const response = await fetch("/api/quality-check/bulk-adjust-length", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to adjust summary lengths");
      }
      return response.json();
    },
    onSuccess: (data) => {
      setBulkActionLoading(false);
      setSelectedBulkAction("");
      toast({
        title: "Summary Lengths Adjusted",
        description: `Successfully adjusted ${data.updated} summaries${data.skipped ? ` (${data.skipped} skipped)` : ''}${data.errors ? ` (${data.errors.length} errors)` : ''}`,
      });
      // Refetch quality check data
      queryClient.invalidateQueries({ queryKey: ['quality-check-all'] });
    },
    onError: (error: Error) => {
      setBulkActionLoading(false);
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to adjust summary lengths",
      });
    },
  });

  // Get paginated verified entries (perplexity_verdict = 'verified' OR fact_check_verdict = 'verified')
  const { data: paginatedData, isLoading } = useQuery<{
    entries: PerplexityVerifiedEntry[];
    totalCount: number;
  }>({
    queryKey: ['perplexity-verified-entries', currentPage],
    queryFn: async () => {
      if (!supabase) throw new Error("Supabase not configured");

      // Fetch all entries in batches (Supabase limits to 1000 rows per query)
      // This ensures we get all entries with both verdicts populated
      let allData: any[] = [];
      let from = 0;
      const batchSize = 1000;
      let hasMore = true;

      while (hasMore) {
        const { data: batchData, error: batchError } = await supabase
          .from("historical_news_analyses")
          .select("id, date, summary, perplexity_verdict, perplexity_confidence, perplexity_reasoning, perplexity_checked_at, perplexity_approved, perplexity_confidence_score, perplexity_sources, perplexity_importance, fact_check_verdict, gemini_approved, gemini_confidence, tags, ready_for_tagging, double_check_reasoning, double_checked_at")
          .order("date", { ascending: false })
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

      // Filter to entries verified by ONE service only (not both - those go to Ready to be Tagged)
      // Exclude entries that already have a Gemini response
      const allVerified = (allData || []).filter(entry => {
        // Exclude if already processed by Gemini
        if (entry.gemini_approved !== null && entry.gemini_approved !== undefined) {
          return false;
        }
        const isPerplexityVerified = entry.perplexity_verdict === 'verified';
        const isOpenAIVerified = entry.fact_check_verdict === 'verified';
        // XOR: one is verified but not both
        return (isPerplexityVerified && !isOpenAIVerified) || (!isPerplexityVerified && isOpenAIVerified);
      })
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

      // Apply pagination
      const startIndex = (currentPage - 1) * pageSize;
      const endIndex = startIndex + pageSize;
      const paginated = allVerified.slice(startIndex, endIndex);

      return {
        entries: paginated,
        totalCount: allVerified.length
      };
    },
    refetchOnMount: true,
  });

  const verifiedEntries = paginatedData?.entries || [];
  const verifiedTotalPages = Math.ceil((totalCount || 0) / pageSize);
  
  const emptySummaryEntries = emptySummaryData?.entries || [];
  const emptySummaryTotalPages = Math.ceil((emptySummaryData?.totalCount || emptySummaryCount || 0) / pageSize);
  
  const notVerifiedEntries = notVerifiedData?.entries || [];
  const notVerifiedTotalPages = Math.ceil((notVerifiedData?.totalCount || notVerifiedCount || 0) / pageSize);
  
  const contradictedEntries = contradictedData?.entries || [];
  const contradictedTotalPages = Math.ceil((contradictedData?.totalCount || contradictedCount || 0) / pageSize);
  
  const readyToTagEntries = readyToTagData?.entries || [];
  const readyToTagTotalPages = Math.ceil((readyToTagData?.totalCount || readyToTagCount || 0) / pageSize);
  
  const orphansEntries = orphansData?.entries || [];
  const orphansTotalPages = Math.ceil((orphansData?.totalCount || orphansCount || 0) / pageSize);
  
  const qualityCheckTotalPages = Math.ceil(filteredViolations.length / pageSize);
  
  // Ensure current page doesn't exceed total pages (safety check)
  const safeEmptySummaryPage = emptySummaryTotalPages > 0 
    ? Math.min(emptySummaryPage, emptySummaryTotalPages) 
    : 1;
  
  const safeNotVerifiedPage = notVerifiedTotalPages > 0 
    ? Math.min(notVerifiedPage, notVerifiedTotalPages) 
    : 1;
  
  const safeContradictedPage = contradictedTotalPages > 0 
    ? Math.min(contradictedPage, contradictedTotalPages) 
    : 1;
  
  const safeReadyToTagPage = readyToTagTotalPages > 0 
    ? Math.min(readyToTagPage, readyToTagTotalPages) 
    : 1;
  
  const safeReadyForTaggingPage = readyForTaggingTotalPages > 0 
    ? Math.min(readyForTaggingPage, readyForTaggingTotalPages) 
    : 1;
  
  const safeQualityCheckPage = qualityCheckTotalPages > 0 
    ? Math.min(qualityCheckPage, qualityCheckTotalPages) 
    : 1;

  // Auto-correct page if it goes out of bounds (e.g., when data changes)
  useEffect(() => {
    if (emptySummaryTotalPages > 0 && emptySummaryPage > emptySummaryTotalPages) {
      setEmptySummaryPage(emptySummaryTotalPages);
    }
  }, [emptySummaryTotalPages, emptySummaryPage]);

  useEffect(() => {
    if (notVerifiedTotalPages > 0 && notVerifiedPage > notVerifiedTotalPages) {
      setNotVerifiedPage(notVerifiedTotalPages);
    }
  }, [notVerifiedTotalPages, notVerifiedPage]);

  useEffect(() => {
    if (contradictedTotalPages > 0 && contradictedPage > contradictedTotalPages) {
      setContradictedPage(contradictedTotalPages);
    }
  }, [contradictedTotalPages, contradictedPage]);

  useEffect(() => {
    if (readyToTagTotalPages > 0 && readyToTagPage > readyToTagTotalPages) {
      setReadyToTagPage(readyToTagTotalPages);
    }
  }, [readyToTagTotalPages, readyToTagPage]);

  useEffect(() => {
    if (readyForTaggingTotalPages > 0 && readyForTaggingPage > readyForTaggingTotalPages) {
      setReadyForTaggingPage(readyForTaggingTotalPages);
    }
  }, [readyForTaggingTotalPages, readyForTaggingPage]);

  useEffect(() => {
    if (qualityCheckTotalPages > 0 && qualityCheckPage > qualityCheckTotalPages) {
      setQualityCheckPage(qualityCheckTotalPages);
    }
  }, [qualityCheckTotalPages, qualityCheckPage]);

  // Poll for double-check status when running
  useEffect(() => {
    if (!doubleCheckStatus.isRunning) return;

    const interval = setInterval(async () => {
      try {
        const response = await fetch("/api/ready-to-tag/double-check-status");
        const status = await response.json();
        setDoubleCheckStatus(status);
        
        if (!status.isRunning) {
          // Double-check completed, refresh queries
          queryClient.invalidateQueries({ queryKey: ['ready-to-tag-entries'] });
          queryClient.invalidateQueries({ queryKey: ['ready-to-tag-count'] });
          queryClient.invalidateQueries({ queryKey: ['ready-for-tagging-entries'] });
          queryClient.invalidateQueries({ queryKey: ['ready-for-tagging-count'] });
          queryClient.invalidateQueries({ queryKey: ['not-ready-for-tagging-entries'] });
          queryClient.invalidateQueries({ queryKey: ['not-ready-for-tagging-count'] });
          queryClient.invalidateQueries({ queryKey: ['orphans-entries'] });
          queryClient.invalidateQueries({ queryKey: ['orphans-count'] });
          toast({
            title: "Double-Check Completed",
            description: `Processed ${status.processed} summaries`,
          });
        }
      } catch (error) {
        console.error("Error fetching double-check status:", error);
      }
    }, 2000); // Poll every 2 seconds

    return () => clearInterval(interval);
  }, [doubleCheckStatus.isRunning, queryClient]);

  // Mutation to verify not-verified entries
  const verifyNotVerifiedMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/fact-check/verify-not-verified', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to verify entries');
      }
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Verification Started",
        description: `Verifying ${data.total || 0} not-verified entries. This may take a while.`,
      });
      // Invalidate queries to refresh data
      queryClient.invalidateQueries({ queryKey: ['not-verified-entries'] });
      queryClient.invalidateQueries({ queryKey: ['not-verified-count'] });
      queryClient.invalidateQueries({ queryKey: ['contradicted-entries'] });
      queryClient.invalidateQueries({ queryKey: ['perplexity-contradicted-count'] });
      queryClient.invalidateQueries({ queryKey: ['perplexity-verified-entries'] });
      queryClient.invalidateQueries({ queryKey: ['perplexity-verified-count'] });
    },
    onError: (error: Error) => {
      toast({
        variant: "destructive",
        title: "Verification Failed",
        description: error.message,
      });
    },
  });

  // State for Find New Events status
  const [isFindNewEventsRunning, setIsFindNewEventsRunning] = useState(false);
  const [findNewEventsProgress, setFindNewEventsProgress] = useState({ processed: 0, total: 0 });

  // State for Gemini verification status
  const [isGeminiVerificationRunning, setIsGeminiVerificationRunning] = useState(false);
  const [geminiVerificationProgress, setGeminiVerificationProgress] = useState({ processed: 0, total: 0 });

  // Poll for Find New Events status
  useQuery({
    queryKey: ['find-new-events-status'],
    queryFn: async () => {
      const response = await fetch('/api/fact-check/find-new-events/status');
      if (!response.ok) return { isRunning: false, processed: 0, total: 0 };
      return response.json();
    },
    enabled: isFindNewEventsRunning,
    refetchInterval: isFindNewEventsRunning ? 2000 : false,
    onSuccess: (data) => {
      setIsFindNewEventsRunning(data.isRunning);
      setFindNewEventsProgress({ processed: data.processed || 0, total: data.total || 0 });
      if (!data.isRunning && data.processed > 0) {
        // Process finished, refresh data
        queryClient.invalidateQueries({ queryKey: ['not-verified-entries'] });
        queryClient.invalidateQueries({ queryKey: ['not-verified-count'] });
        queryClient.invalidateQueries({ queryKey: ['contradicted-entries'] });
        queryClient.invalidateQueries({ queryKey: ['perplexity-contradicted-count'] });
        queryClient.invalidateQueries({ queryKey: ['perplexity-verified-entries'] });
        queryClient.invalidateQueries({ queryKey: ['perplexity-verified-count'] });
        queryClient.invalidateQueries({ queryKey: ['ready-to-tag-entries'] });
        queryClient.invalidateQueries({ queryKey: ['ready-to-tag-count'] });
      }
    },
  });

  // Poll for Gemini verification status
  useQuery({
    queryKey: ['gemini-verification-status'],
    queryFn: async () => {
      const response = await fetch('/api/fact-check/verify-with-gemini/status');
      if (!response.ok) return { isRunning: false, processed: 0, total: 0 };
      return response.json();
    },
    enabled: isGeminiVerificationRunning,
    refetchInterval: isGeminiVerificationRunning ? 2000 : false,
    onSuccess: (data) => {
      setIsGeminiVerificationRunning(data.isRunning);
      setGeminiVerificationProgress({ processed: data.processed || 0, total: data.total || 0 });
      if (!data.isRunning && data.processed > 0) {
        // Process finished, refresh data
        queryClient.invalidateQueries({ queryKey: ['perplexity-verified-entries'] });
        queryClient.invalidateQueries({ queryKey: ['perplexity-verified-count'] });
        queryClient.invalidateQueries({ queryKey: ['ready-to-tag-entries'] });
        queryClient.invalidateQueries({ queryKey: ['ready-to-tag-count'] });
        toast({
          title: "Gemini Verification Completed",
          description: `Processed ${data.processed} entries.`,
        });
      }
    },
  });

  // Mutation to verify with Gemini
  const verifyWithGeminiMutation = useMutation({
    mutationFn: async (limit?: number) => {
      const response = await fetch('/api/fact-check/verify-with-gemini', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(limit ? { limit } : {}),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to verify with Gemini');
      }
      return response.json();
    },
    onSuccess: (data) => {
      setIsGeminiVerificationRunning(true);
      setGeminiVerificationProgress({ processed: 0, total: data.total || 0 });
      toast({
        title: "Gemini Verification Started",
        description: `Verifying ${data.total || 0} entries with Gemini. This may take a while.`,
      });
      // Invalidate queries to refresh data
      queryClient.invalidateQueries({ queryKey: ['perplexity-verified-entries'] });
      queryClient.invalidateQueries({ queryKey: ['perplexity-verified-count'] });
    },
    onError: (error: Error) => {
      setIsGeminiVerificationRunning(false);
      toast({
        variant: "destructive",
        title: "Gemini Verification Failed",
        description: error.message,
      });
    },
  });

  // Mutation to stop Gemini verification
  const stopGeminiVerificationMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/fact-check/verify-with-gemini/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to stop Gemini verification');
      }
      return response.json();
    },
    onSuccess: () => {
      setIsGeminiVerificationRunning(false);
      toast({
        title: "Gemini Verification Stopped",
        description: "Verification process has been stopped.",
      });
    },
    onError: (error: Error) => {
      toast({
        variant: "destructive",
        title: "Stop Failed",
        description: error.message,
      });
    },
  });

  // Mutation to find new events for contradicted/uncertain entries
  const findNewEventsMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/fact-check/find-new-events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to find new events');
      }
      return response.json();
    },
    onSuccess: (data) => {
      setIsFindNewEventsRunning(true);
      setFindNewEventsProgress({ processed: 0, total: data.total || 0 });
      toast({
        title: "Finding New Events Started",
        description: `Processing ${data.total || 0} contradicted/uncertain entries. This may take a while.`,
      });
      // Invalidate queries to refresh data
      queryClient.invalidateQueries({ queryKey: ['not-verified-entries'] });
      queryClient.invalidateQueries({ queryKey: ['not-verified-count'] });
      queryClient.invalidateQueries({ queryKey: ['contradicted-entries'] });
      queryClient.invalidateQueries({ queryKey: ['perplexity-contradicted-count'] });
      queryClient.invalidateQueries({ queryKey: ['perplexity-verified-entries'] });
      queryClient.invalidateQueries({ queryKey: ['perplexity-verified-count'] });
    },
    onError: (error: Error) => {
      setIsFindNewEventsRunning(false);
      toast({
        variant: "destructive",
        title: "Find New Events Failed",
        description: error.message,
      });
    },
  });

  // Mutation to stop Find New Events
  const stopFindNewEventsMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/fact-check/find-new-events/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to stop');
      }
      return response.json();
    },
    onSuccess: (data) => {
      setIsFindNewEventsRunning(false);
      toast({
        title: "Stopped",
        description: data.message || `Processed ${data.processed}/${data.total} entries before stopping.`,
      });
      // Refresh data
      queryClient.invalidateQueries({ queryKey: ['perplexity-not-verified-entries'] });
      queryClient.invalidateQueries({ queryKey: ['perplexity-not-verified-count'] });
      queryClient.invalidateQueries({ queryKey: ['perplexity-verified-entries'] });
      queryClient.invalidateQueries({ queryKey: ['perplexity-verified-count'] });
      queryClient.invalidateQueries({ queryKey: ['perplexity-contradicted-count'] });
    },
    onError: (error: Error) => {
      toast({
        variant: "destructive",
        title: "Stop Failed",
        description: error.message,
      });
    },
  });

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { 
      year: 'numeric', 
      month: 'short', 
      day: 'numeric' 
    });
  };

  const getConfidenceColor = (confidence: number | null) => {
    if (!confidence) return "default";
    if (confidence >= 80) return "default";
    if (confidence >= 60) return "secondary";
    return "outline";
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
    if (violation.includes('Ends with') || violation.includes('Truncated')) {
      return 'bg-purple-100 text-purple-700 border-purple-300';
    }
    return 'bg-slate-100 text-slate-700 border-slate-300';
  };

  // Helper function to generate page numbers for pagination
  const getPageNumbers = (currentPage: number, totalPages: number) => {
    const pages: (number | 'ellipsis')[] = [];
    const maxVisible = 7; // Show up to 7 page numbers
    
    // Safety check: ensure currentPage is within valid range
    const safeCurrentPage = Math.max(1, Math.min(currentPage, totalPages));
    const safeTotalPages = Math.max(1, totalPages);
    
    if (safeTotalPages <= maxVisible) {
      // Show all pages if total is less than max visible
      for (let i = 1; i <= safeTotalPages; i++) {
        pages.push(i);
      }
    } else {
      // Always show first page
      pages.push(1);
      
      if (safeCurrentPage <= 3) {
        // Near the start
        for (let i = 2; i <= 4; i++) {
          pages.push(i);
        }
        pages.push('ellipsis');
        pages.push(safeTotalPages);
      } else if (safeCurrentPage >= safeTotalPages - 2) {
        // Near the end
        pages.push('ellipsis');
        for (let i = Math.max(2, safeTotalPages - 3); i <= safeTotalPages; i++) {
          pages.push(i);
        }
      } else {
        // In the middle
        pages.push('ellipsis');
        for (let i = safeCurrentPage - 1; i <= safeCurrentPage + 1; i++) {
          pages.push(i);
        }
        pages.push('ellipsis');
        pages.push(safeTotalPages);
      }
    }
    
    return pages;
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Final!</h1>
          <p className="text-muted-foreground mt-2">
            Verified entries and final analysis results
          </p>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList>
          <TabsTrigger value="empty-summary">
            Empty Summary
            {!emptySummaryCountLoading && emptySummaryCount !== undefined && (
              <Badge variant="secondary" className="ml-2">
                {emptySummaryCount.toLocaleString()}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="not-verified">
            Not Verified
            {!notVerifiedCountLoading && notVerifiedCount !== undefined && (
              <Badge variant="secondary" className="ml-2">
                {notVerifiedCount.toLocaleString()}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="contradicted">
            AI Arena
            {!contradictedCountLoading && contradictedCount !== undefined && (
              <Badge variant="secondary" className="ml-2">
                {contradictedCount.toLocaleString()}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="perplexity-verified">
            OpenAI / Perplexity Verified
            {!countLoading && totalCount !== undefined && (
              <Badge variant="secondary" className="ml-2">
                {totalCount.toLocaleString()}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="ready-to-tag">
            Ready for Soft Check
            {(!readyToTagCountLoading && readyToTagCount !== undefined) || readyToTagData?.totalCount !== undefined ? (
              <Badge variant="secondary" className="ml-2">
                {(readyToTagData?.totalCount ?? readyToTagCount ?? 0).toLocaleString()}
              </Badge>
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="ready-for-tagging">
            Ready for Tagging
            {(!readyForTaggingCountLoading && readyForTaggingCount !== undefined) || readyForTaggingData?.totalCount !== undefined ? (
              <Badge variant="secondary" className="ml-2">
                {(readyForTaggingData?.totalCount ?? readyForTaggingCount ?? 0).toLocaleString()}
              </Badge>
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="not-ready-for-tagging">
            Not Ready for Tagging
            {(!notReadyForTaggingCountLoading && notReadyForTaggingCount !== undefined) || notReadyForTaggingData?.totalCount !== undefined ? (
              <Badge variant="secondary" className="ml-2">
                {(notReadyForTaggingData?.totalCount ?? notReadyForTaggingCount ?? 0).toLocaleString()}
              </Badge>
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="orphans">
            Orphans
            {!orphansCountLoading && orphansCount !== undefined && (
              <Badge variant="secondary" className="ml-2">
                {orphansCount.toLocaleString()}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="quality-check">
            Quality Check
            {!qualityCheckLoading && qualityCheckCount !== undefined && (
              <Badge variant="secondary" className="ml-2">
                {selectedFilters.size > 0 
                  ? `${filteredViolations.length.toLocaleString()}/${qualityCheckCount.toLocaleString()}`
                  : qualityCheckCount.toLocaleString()}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="empty-summary" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Empty Summary Entries</CardTitle>
                  <p className="text-sm text-muted-foreground mt-1">
                    Entries with no summary at all (summary is null, empty string, or whitespace only) OR missing dates (dates with no entry in the database)
                  </p>
                  {newWayProcessingStatus.isRunning && (
                    <div className="mt-2 text-sm text-blue-600">
                      Processing: {newWayProcessingStatus.processed} / {newWayProcessingStatus.total}
                      {newWayProcessingStatus.currentDate && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          (Current: {newWayProcessingStatus.currentDate})
                        </span>
                      )}
                </div>
                  )}
                </div>
                <Button
                  onClick={() => processEmptySummariesNewWayMutation.mutate()}
                  disabled={processEmptySummariesNewWayMutation.isPending || newWayProcessingStatus.isRunning || emptySummaryLoading || (emptySummaryCount || 0) === 0}
                  className="flex items-center gap-2"
                  title="Process all empty summaries using Analyse Day system (Exa + Gemini/Perplexity + OpenAI)"
                >
                  {processEmptySummariesNewWayMutation.isPending || newWayProcessingStatus.isRunning ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Processing...
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4" />
                      Process with Analyse Day
                    </>
                  )}
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {emptySummaryLoading ? (
                <div className="space-y-4">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <Skeleton key={i} className="h-16 w-full" />
                  ))}
                </div>
              ) : !emptySummaryEntries || emptySummaryEntries.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <CheckCircle className="mx-auto h-12 w-12 mb-4 opacity-50" />
                  <p>No empty summary entries found</p>
                </div>
              ) : (
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[120px]">Date</TableHead>
                        <TableHead>Summary</TableHead>
                        <TableHead className="w-[100px]">Verdict</TableHead>
                        <TableHead className="w-[120px]">Confidence</TableHead>
                        <TableHead className="w-[100px]">Importance</TableHead>
                        <TableHead className="w-[100px]">Tags</TableHead>
                        <TableHead className="w-[80px]">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {emptySummaryEntries.map((entry) => (
                        <TableRow key={entry.id}>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <Calendar className="h-4 w-4 text-muted-foreground" />
                              <Link 
                                href={`/day/${entry.date}`}
                                className="text-blue-600 hover:underline font-mono text-sm"
                              >
                                {formatDate(entry.date)}
                              </Link>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="max-w-2xl">
                              {entry.id?.startsWith('missing-') ? (
                                <div className="flex items-center gap-2">
                                  <Badge variant="outline" className="text-xs">Missing Date</Badge>
                                  <p className="text-sm text-muted-foreground italic">
                                    No entry exists for this date
                                  </p>
                                </div>
                              ) : (
                                <p className="text-sm text-muted-foreground italic">
                                  {entry.summary || '(No summary)'}
                                </p>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-col gap-1">
                              {entry.perplexity_verdict === 'verified' ? (
                                <Badge variant="default" className="w-fit flex items-center gap-1.5">
                                  <img src="/perplexity-logo.svg" alt="Perplexity" className="w-3.5 h-3.5" />
                                  <span>Perplexity Verified</span>
                                </Badge>
                              ) : entry.perplexity_verdict && (
                                <Badge 
                                  variant={entry.perplexity_verdict === 'contradicted' ? 'destructive' : entry.perplexity_verdict === 'uncertain' ? 'secondary' : 'outline'}
                                  className="text-xs"
                                >
                                  Perplexity: {entry.perplexity_verdict}
                                </Badge>
                              )}
                              {entry.fact_check_verdict === 'verified' ? (
                                <Badge variant="default" className="w-fit flex items-center gap-1.5">
                                  <SiOpenai className="w-3.5 h-3.5" />
                                  <span>OpenAI Verified</span>
                                </Badge>
                              ) : entry.fact_check_verdict && entry.fact_check_verdict !== 'verified' && (
                                <Badge variant="outline" className="text-xs">
                                  OpenAI: {entry.fact_check_verdict}
                                </Badge>
                              )}
                              {!entry.perplexity_verdict && !entry.fact_check_verdict && (
                                <Badge variant="outline">No Verdict</Badge>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            {entry.perplexity_confidence_score !== null ? (
                              <Badge variant={getConfidenceColor(entry.perplexity_confidence_score)}>
                                {Number(entry.perplexity_confidence_score).toFixed(0)}%
                              </Badge>
                            ) : entry.perplexity_confidence !== null ? (
                              <Badge variant={getConfidenceColor(entry.perplexity_confidence)}>
                                {Number(entry.perplexity_confidence).toFixed(0)}%
                              </Badge>
                            ) : (
                              <span className="text-muted-foreground text-sm">-</span>
                            )}
                          </TableCell>
                          <TableCell>
                            {entry.perplexity_importance !== null ? (
                              <Badge variant="outline">
                                {entry.perplexity_importance}/10
                              </Badge>
                            ) : (
                              <span className="text-muted-foreground text-sm">-</span>
                            )}
                          </TableCell>
                          <TableCell>
                            {entry.tags && entry.tags.length > 0 ? (
                              <div className="flex flex-wrap gap-1">
                                {entry.tags.slice(0, 2).map((tag, idx) => (
                                  <Badge key={idx} variant="outline" className="text-xs">
                                    {tag.name}
                                  </Badge>
                                ))}
                                {entry.tags.length > 2 && (
                                  <Badge variant="outline" className="text-xs">
                                    +{entry.tags.length - 2}
                                  </Badge>
                                )}
                              </div>
                            ) : (
                              <span className="text-muted-foreground text-sm">-</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <Link href={`/day/${entry.date}`}>
                              <ExternalLink className="h-4 w-4 text-muted-foreground hover:text-foreground" />
                            </Link>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}

              {/* Pagination Controls */}
              {emptySummaryEntries.length > 0 && emptySummaryTotalPages > 0 && (
                <div className="flex items-center justify-between mt-4 pt-4 border-t">
                  <div className="text-sm text-muted-foreground">
                    Showing {((safeEmptySummaryPage - 1) * pageSize) + 1} to {Math.min(safeEmptySummaryPage * pageSize, emptySummaryData?.totalCount || emptySummaryCount || 0)} of {(emptySummaryData?.totalCount || emptySummaryCount || 0).toLocaleString()} entries
                  </div>
                  <Pagination>
                    <PaginationContent>
                      <PaginationItem>
                        <PaginationPrevious
                          onClick={(e) => {
                            e.preventDefault();
                            if (safeEmptySummaryPage > 1) setEmptySummaryPage(prev => Math.max(1, prev - 1));
                          }}
                          className={safeEmptySummaryPage === 1 || emptySummaryLoading ? "pointer-events-none opacity-50" : "cursor-pointer"}
                        />
                      </PaginationItem>
                      {getPageNumbers(safeEmptySummaryPage, emptySummaryTotalPages).map((page, idx) => (
                        <PaginationItem key={idx}>
                          {page === 'ellipsis' ? (
                            <PaginationEllipsis />
                          ) : (
                            <PaginationLink
                              onClick={(e) => {
                                e.preventDefault();
                                if (!emptySummaryLoading && typeof page === 'number') {
                                  const targetPage = Math.max(1, Math.min(page, emptySummaryTotalPages));
                                  setEmptySummaryPage(targetPage);
                                }
                              }}
                              isActive={safeEmptySummaryPage === page}
                              className={emptySummaryLoading ? "pointer-events-none opacity-50" : "cursor-pointer"}
                            >
                              {page}
                            </PaginationLink>
                          )}
                        </PaginationItem>
                      ))}
                      <PaginationItem>
                        <PaginationNext
                          onClick={(e) => {
                            e.preventDefault();
                            if (safeEmptySummaryPage < emptySummaryTotalPages) setEmptySummaryPage(prev => Math.min(emptySummaryTotalPages, prev + 1));
                          }}
                          className={safeEmptySummaryPage >= emptySummaryTotalPages || emptySummaryLoading ? "pointer-events-none opacity-50" : "cursor-pointer"}
                        />
                      </PaginationItem>
                    </PaginationContent>
                  </Pagination>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="not-verified" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Not Verified Entries</CardTitle>
                  <p className="text-sm text-muted-foreground mt-1">
                    Entries with no verdict from either OpenAI or Perplexity (both verdicts are null)
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    onClick={() => verifyNotVerifiedMutation.mutate()}
                    disabled={verifyNotVerifiedMutation.isPending || notVerifiedLoading || (notVerifiedCount || 0) === 0}
                    className="flex items-center gap-2"
                    title="Verify all entries - checks if events actually happened on their dates"
                    variant="default"
                  >
                    {verifyNotVerifiedMutation.isPending ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Verifying...
                      </>
                    ) : (
                      <>
                        <Shield className="w-4 h-4" />
                        Verify
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {notVerifiedLoading ? (
                <div className="space-y-4">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <Skeleton key={i} className="h-16 w-full" />
                  ))}
                </div>
              ) : !notVerifiedEntries || notVerifiedEntries.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <CheckCircle className="mx-auto h-12 w-12 mb-4 opacity-50" />
                  <p>No perplexity not verified entries found</p>
                </div>
              ) : (
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[120px]">Date</TableHead>
                        <TableHead>Summary</TableHead>
                        <TableHead className="w-[100px]">Verdict</TableHead>
                        <TableHead className="w-[120px]">Confidence</TableHead>
                        <TableHead className="w-[100px]">Importance</TableHead>
                        <TableHead className="w-[100px]">Tags</TableHead>
                        <TableHead className="w-[80px]">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {notVerifiedEntries.map((entry) => (
                        <TableRow key={entry.id}>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <Calendar className="h-4 w-4 text-muted-foreground" />
                              <Link 
                                href={`/day/${entry.date}`}
                                className="text-blue-600 hover:underline font-mono text-sm"
                              >
                                {formatDate(entry.date)}
                              </Link>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="max-w-2xl">
                              <p className="text-sm line-clamp-2">
                                {entry.summary}
                              </p>
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline">No Verdict</Badge>
                          </TableCell>
                          <TableCell>
                            {entry.perplexity_confidence_score !== null ? (
                              <Badge variant={getConfidenceColor(entry.perplexity_confidence_score)}>
                                {Number(entry.perplexity_confidence_score).toFixed(0)}%
                              </Badge>
                            ) : entry.perplexity_confidence !== null ? (
                              <Badge variant={getConfidenceColor(entry.perplexity_confidence)}>
                                {Number(entry.perplexity_confidence).toFixed(0)}%
                              </Badge>
                            ) : (
                              <span className="text-muted-foreground text-sm">-</span>
                            )}
                          </TableCell>
                          <TableCell>
                            {entry.perplexity_importance !== null ? (
                              <Badge variant="outline">
                                {entry.perplexity_importance}/10
                              </Badge>
                            ) : (
                              <span className="text-muted-foreground text-sm">-</span>
                            )}
                          </TableCell>
                          <TableCell>
                            {entry.tags && entry.tags.length > 0 ? (
                              <div className="flex flex-wrap gap-1">
                                {entry.tags.slice(0, 2).map((tag, idx) => (
                                  <Badge key={idx} variant="outline" className="text-xs">
                                    {tag.name}
                                  </Badge>
                                ))}
                                {entry.tags.length > 2 && (
                                  <Badge variant="outline" className="text-xs">
                                    +{entry.tags.length - 2}
                                  </Badge>
                                )}
                              </div>
                            ) : (
                              <span className="text-muted-foreground text-sm">-</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <Link href={`/day/${entry.date}`}>
                              <ExternalLink className="h-4 w-4 text-muted-foreground hover:text-foreground" />
                            </Link>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}

              {/* Pagination Controls */}
              {notVerifiedEntries.length > 0 && notVerifiedTotalPages > 0 && (
                <div className="flex items-center justify-between mt-4 pt-4 border-t">
                  <div className="text-sm text-muted-foreground">
                    Showing {((safeNotVerifiedPage - 1) * pageSize) + 1} to {Math.min(safeNotVerifiedPage * pageSize, notVerifiedData?.totalCount || notVerifiedCount || 0)} of {(notVerifiedData?.totalCount || notVerifiedCount || 0).toLocaleString()} entries
                  </div>
                  <Pagination>
                    <PaginationContent>
                      <PaginationItem>
                        <PaginationPrevious
                          onClick={(e) => {
                            e.preventDefault();
                            if (safeNotVerifiedPage > 1) setNotVerifiedPage(prev => Math.max(1, prev - 1));
                          }}
                          className={safeNotVerifiedPage === 1 || notVerifiedLoading ? "pointer-events-none opacity-50" : "cursor-pointer"}
                        />
                      </PaginationItem>
                      {getPageNumbers(safeNotVerifiedPage, notVerifiedTotalPages).map((page, idx) => (
                        <PaginationItem key={idx}>
                          {page === 'ellipsis' ? (
                            <PaginationEllipsis />
                          ) : (
                            <PaginationLink
                              onClick={(e) => {
                                e.preventDefault();
                                if (!notVerifiedLoading && typeof page === 'number') {
                                  // Ensure page is within valid range
                                  const targetPage = Math.max(1, Math.min(page, notVerifiedTotalPages));
                                  setNotVerifiedPage(targetPage);
                                }
                              }}
                              isActive={safeNotVerifiedPage === page}
                              className={notVerifiedLoading ? "pointer-events-none opacity-50" : "cursor-pointer"}
                            >
                              {page}
                            </PaginationLink>
                          )}
                        </PaginationItem>
                      ))}
                      <PaginationItem>
                        <PaginationNext
                          onClick={(e) => {
                            e.preventDefault();
                            if (safeNotVerifiedPage < notVerifiedTotalPages) setNotVerifiedPage(prev => Math.min(notVerifiedTotalPages, prev + 1));
                          }}
                          className={safeNotVerifiedPage >= notVerifiedTotalPages || notVerifiedLoading ? "pointer-events-none opacity-50" : "cursor-pointer"}
                        />
                      </PaginationItem>
                    </PaginationContent>
                  </Pagination>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="contradicted" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>AI Arena</CardTitle>
                  <p className="text-sm text-muted-foreground mt-1">
                    Entries with a non-verified verdict from at least one service (perplexity_verdict ∈ {'{'}contradicted, uncertain, ...{'}'} OR fact_check_verdict ∈ {'{'}contradicted, uncertain, ...{'}'}) AND neither service has verified it (perplexity_verdict ≠ 'verified' AND fact_check_verdict ≠ 'verified'), OR entries verified by OpenAI/Perplexity but rejected by Gemini (gemini_approved = false)
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {isFindNewEventsRunning ? (
                    <Button
                      onClick={() => stopFindNewEventsMutation.mutate()}
                      disabled={stopFindNewEventsMutation.isPending}
                      className="flex items-center gap-2"
                      title="Stop finding new events"
                      variant="destructive"
                    >
                      {stopFindNewEventsMutation.isPending ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Stopping...
                        </>
                      ) : (
                        <>
                          <X className="w-4 h-4" />
                          Stop
                          {findNewEventsProgress.total > 0 && (
                            <Badge variant="secondary" className="ml-1">
                              {findNewEventsProgress.processed}/{findNewEventsProgress.total}
                            </Badge>
                          )}
                        </>
                      )}
                    </Button>
                  ) : (
                    <Button
                      onClick={() => findNewEventsMutation.mutate()}
                      disabled={findNewEventsMutation.isPending || contradictedCountLoading || (contradictedCount || 0) === 0}
                      className="flex items-center gap-2 crazy-glow-button sword-hover transition-all duration-300 hover:brightness-125 relative overflow-visible"
                      title="Battle between Perplexity and Gemini to find relevant articles"
                      variant="default"
                    >
                      {findNewEventsMutation.isPending ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Starting...
                        </>
                      ) : (
                        <>
                          <Sword className="w-4 h-4" />
                          Let's Battle!
                        </>
                      )}
                    </Button>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {contradictedLoading ? (
                <div className="space-y-4">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <Skeleton key={i} className="h-16 w-full" />
                  ))}
                </div>
              ) : !contradictedEntries || contradictedEntries.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <CheckCircle className="mx-auto h-12 w-12 mb-4 opacity-50" />
                  <p>No contradicted events found</p>
                </div>
              ) : (
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[120px]">Date</TableHead>
                        <TableHead>Summary</TableHead>
                        <TableHead className="w-[100px]">Verdict</TableHead>
                        <TableHead className="w-[120px]">Confidence</TableHead>
                        <TableHead className="w-[100px]">Importance</TableHead>
                        <TableHead className="w-[100px]">Tags</TableHead>
                        <TableHead className="w-[80px]">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {contradictedEntries.map((entry) => (
                        <TableRow key={entry.id}>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <Calendar className="h-4 w-4 text-muted-foreground" />
                              <Link 
                                href={`/day/${entry.date}`}
                                className="text-blue-600 hover:underline font-mono text-sm"
                              >
                                {formatDate(entry.date)}
                              </Link>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="max-w-2xl">
                              <p className="text-sm line-clamp-2">
                                {entry.summary}
                              </p>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-col gap-1">
                              {entry.perplexity_verdict === 'verified' ? (
                                <Badge variant="default" className="w-fit flex items-center gap-1.5">
                                  <img src="/perplexity-logo.svg" alt="Perplexity" className="w-3.5 h-3.5" />
                                  <span>Perplexity Verified</span>
                                </Badge>
                              ) : entry.perplexity_verdict && (
                                <Badge 
                                  variant={entry.perplexity_verdict === 'contradicted' ? 'destructive' : entry.perplexity_verdict === 'uncertain' ? 'secondary' : 'outline'}
                                  className="text-xs"
                                >
                                  Perplexity: {entry.perplexity_verdict}
                                </Badge>
                              )}
                              {entry.fact_check_verdict === 'verified' ? (
                                <Badge variant="default" className="w-fit flex items-center gap-1.5">
                                  <SiOpenai className="w-3.5 h-3.5" />
                                  <span>OpenAI Verified</span>
                                </Badge>
                              ) : entry.fact_check_verdict && entry.fact_check_verdict !== 'verified' && (
                                <Badge variant="outline" className="text-xs">
                                  OpenAI: {entry.fact_check_verdict}
                                </Badge>
                              )}
                              {entry.gemini_approved === false && (
                                <Badge variant="destructive" className="text-xs">
                                  Gemini Rejected
                                </Badge>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            {entry.perplexity_confidence_score !== null ? (
                              <Badge variant={getConfidenceColor(entry.perplexity_confidence_score)}>
                                {Number(entry.perplexity_confidence_score).toFixed(0)}%
                              </Badge>
                            ) : entry.perplexity_confidence !== null ? (
                              <Badge variant={getConfidenceColor(entry.perplexity_confidence)}>
                                {Number(entry.perplexity_confidence).toFixed(0)}%
                              </Badge>
                            ) : (
                              <span className="text-muted-foreground text-sm">-</span>
                            )}
                          </TableCell>
                          <TableCell>
                            {entry.perplexity_importance !== null ? (
                              <Badge variant="outline">
                                {entry.perplexity_importance}/10
                              </Badge>
                            ) : (
                              <span className="text-muted-foreground text-sm">-</span>
                            )}
                          </TableCell>
                          <TableCell>
                            {entry.tags && entry.tags.length > 0 ? (
                              <div className="flex flex-wrap gap-1">
                                {entry.tags.slice(0, 2).map((tag, idx) => (
                                  <Badge key={idx} variant="outline" className="text-xs">
                                    {tag.name}
                                  </Badge>
                                ))}
                                {entry.tags.length > 2 && (
                                  <Badge variant="outline" className="text-xs">
                                    +{entry.tags.length - 2}
                                  </Badge>
                                )}
                              </div>
                            ) : (
                              <span className="text-muted-foreground text-sm">-</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <Link href={`/day/${entry.date}`}>
                              <ExternalLink className="h-4 w-4 text-muted-foreground hover:text-foreground" />
                            </Link>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}

              {/* Pagination Controls */}
              {contradictedEntries.length > 0 && contradictedTotalPages > 0 && (
                <div className="flex items-center justify-between mt-4 pt-4 border-t">
                  <div className="text-sm text-muted-foreground">
                    Showing {((safeContradictedPage - 1) * pageSize) + 1} to {Math.min(safeContradictedPage * pageSize, contradictedData?.totalCount || contradictedCount || 0)} of {(contradictedData?.totalCount || contradictedCount || 0).toLocaleString()} entries
                  </div>
                  <Pagination>
                    <PaginationContent>
                      <PaginationItem>
                        <PaginationPrevious
                          onClick={(e) => {
                            e.preventDefault();
                            if (safeContradictedPage > 1) setContradictedPage(prev => Math.max(1, prev - 1));
                          }}
                          className={safeContradictedPage === 1 || contradictedLoading ? "pointer-events-none opacity-50" : "cursor-pointer"}
                        />
                      </PaginationItem>
                      {getPageNumbers(safeContradictedPage, contradictedTotalPages).map((page, idx) => (
                        <PaginationItem key={idx}>
                          {page === 'ellipsis' ? (
                            <PaginationEllipsis />
                          ) : (
                            <PaginationLink
                              onClick={(e) => {
                                e.preventDefault();
                                if (!contradictedLoading && typeof page === 'number') {
                                  const targetPage = Math.max(1, Math.min(page, contradictedTotalPages));
                                  setContradictedPage(targetPage);
                                }
                              }}
                              isActive={safeContradictedPage === page}
                              className={contradictedLoading ? "pointer-events-none opacity-50" : "cursor-pointer"}
                            >
                              {page}
                            </PaginationLink>
                          )}
                        </PaginationItem>
                      ))}
                      <PaginationItem>
                        <PaginationNext
                          onClick={(e) => {
                            e.preventDefault();
                            if (safeContradictedPage < contradictedTotalPages) setContradictedPage(prev => Math.min(contradictedTotalPages, prev + 1));
                          }}
                          className={safeContradictedPage >= contradictedTotalPages || contradictedLoading ? "pointer-events-none opacity-50" : "cursor-pointer"}
                        />
                      </PaginationItem>
                    </PaginationContent>
                  </Pagination>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="perplexity-verified" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>OpenAI / Perplexity Verified Entries</CardTitle>
                  <p className="text-sm text-muted-foreground mt-1">
                    Entries verified by ONE service only (OpenAI OR Perplexity, but not both). Excludes entries verified by both services (those are in "Ready to be Tagged") and entries that already have a Gemini response.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {isGeminiVerificationRunning ? (
                    <Button
                      onClick={() => stopGeminiVerificationMutation.mutate()}
                      disabled={stopGeminiVerificationMutation.isPending}
                      className="flex items-center gap-2"
                      title="Stop Gemini verification"
                      variant="destructive"
                    >
                      {stopGeminiVerificationMutation.isPending ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Stopping...
                        </>
                      ) : (
                        <>
                          <X className="w-4 h-4" />
                          Stop
                          {geminiVerificationProgress.total > 0 && (
                            <Badge variant="secondary" className="ml-1">
                              {geminiVerificationProgress.processed}/{geminiVerificationProgress.total}
                            </Badge>
                          )}
                        </>
                      )}
                    </Button>
                  ) : (
                    <Button
                      onClick={() => verifyWithGeminiMutation.mutate()}
                      disabled={verifyWithGeminiMutation.isPending || isLoading || (totalCount || 0) === 0}
                      className="flex items-center gap-2"
                      title="Verify entries that need Gemini verification (excludes entries already processed by Gemini)"
                      variant="default"
                    >
                      {verifyWithGeminiMutation.isPending ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Starting...
                        </>
                      ) : (
                        <>
                          <Shield className="w-4 h-4" />
                          Verify with Gemini
                        </>
                      )}
                    </Button>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="space-y-4">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <Skeleton key={i} className="h-16 w-full" />
                  ))}
                </div>
              ) : !verifiedEntries || verifiedEntries.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <CheckCircle className="mx-auto h-12 w-12 mb-4 opacity-50" />
                  <p>No perplexity verified entries found</p>
                </div>
              ) : (
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[120px]">Date</TableHead>
                        <TableHead>Summary</TableHead>
                        <TableHead className="w-[100px]">Verdict</TableHead>
                        <TableHead className="w-[120px]">Confidence</TableHead>
                        <TableHead className="w-[100px]">Importance</TableHead>
                        <TableHead className="w-[100px]">Tags</TableHead>
                        <TableHead className="w-[80px]">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {verifiedEntries.map((entry) => (
                        <TableRow key={entry.id}>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <Calendar className="h-4 w-4 text-muted-foreground" />
                              <Link 
                                href={`/day/${entry.date}`}
                                className="text-blue-600 hover:underline font-mono text-sm"
                              >
                                {formatDate(entry.date)}
                              </Link>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="max-w-2xl">
                              <p className="text-sm line-clamp-2">
                                {entry.summary}
                              </p>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-col gap-1">
                              {entry.perplexity_verdict === 'verified' ? (
                                <Badge variant="default" className="w-fit flex items-center gap-1.5">
                                  <img src="/perplexity-logo.svg" alt="Perplexity" className="w-3.5 h-3.5" />
                                  <span>Perplexity</span>
                                </Badge>
                              ) : null}
                              {entry.fact_check_verdict === 'verified' ? (
                                <Badge variant="default" className="w-fit flex items-center gap-1.5">
                                  <SiOpenai className="w-3.5 h-3.5" />
                                  <span>OpenAI</span>
                                </Badge>
                              ) : null}
                              {entry.perplexity_verdict !== 'verified' && 
                               entry.fact_check_verdict !== 'verified' && (
                                <Badge variant="outline">Not Verified</Badge>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            {entry.perplexity_confidence_score !== null ? (
                              <Badge variant={getConfidenceColor(entry.perplexity_confidence_score)}>
                                {Number(entry.perplexity_confidence_score).toFixed(0)}%
                              </Badge>
                            ) : entry.perplexity_confidence !== null ? (
                              <Badge variant={getConfidenceColor(entry.perplexity_confidence)}>
                                {Number(entry.perplexity_confidence).toFixed(0)}%
                              </Badge>
                            ) : (
                              <span className="text-muted-foreground text-sm">-</span>
                            )}
                          </TableCell>
                          <TableCell>
                            {entry.perplexity_importance !== null ? (
                              <Badge variant="outline">
                                {entry.perplexity_importance}/10
                              </Badge>
                            ) : (
                              <span className="text-muted-foreground text-sm">-</span>
                            )}
                          </TableCell>
                          <TableCell>
                            {entry.tags && entry.tags.length > 0 ? (
                              <div className="flex flex-wrap gap-1">
                                {entry.tags.slice(0, 2).map((tag, idx) => (
                                  <Badge key={idx} variant="outline" className="text-xs">
                                    {tag.name}
                                  </Badge>
                                ))}
                                {entry.tags.length > 2 && (
                                  <Badge variant="outline" className="text-xs">
                                    +{entry.tags.length - 2}
                                  </Badge>
                                )}
                              </div>
                            ) : (
                              <span className="text-muted-foreground text-sm">-</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <Link href={`/day/${entry.date}`}>
                              <ExternalLink className="h-4 w-4 text-muted-foreground hover:text-foreground" />
                            </Link>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}

              {/* Pagination Controls */}
              {verifiedEntries.length > 0 && verifiedTotalPages > 0 && (
                <div className="flex items-center justify-between mt-4 pt-4 border-t">
                  <div className="text-sm text-muted-foreground">
                    Showing {((currentPage - 1) * pageSize) + 1} to {Math.min(currentPage * pageSize, totalCount || 0)} of {totalCount?.toLocaleString() || 0} entries
                  </div>
                  <Pagination>
                    <PaginationContent>
                      <PaginationItem>
                        <PaginationPrevious
                          onClick={(e) => {
                            e.preventDefault();
                            if (currentPage > 1) setCurrentPage(prev => prev - 1);
                          }}
                          className={currentPage === 1 || isLoading ? "pointer-events-none opacity-50" : "cursor-pointer"}
                        />
                      </PaginationItem>
                      {getPageNumbers(currentPage, verifiedTotalPages).map((page, idx) => (
                        <PaginationItem key={idx}>
                          {page === 'ellipsis' ? (
                            <PaginationEllipsis />
                          ) : (
                            <PaginationLink
                              onClick={(e) => {
                                e.preventDefault();
                                if (!isLoading) setCurrentPage(page);
                              }}
                              isActive={currentPage === page}
                              className={isLoading ? "pointer-events-none opacity-50" : "cursor-pointer"}
                            >
                              {page}
                            </PaginationLink>
                          )}
                        </PaginationItem>
                      ))}
                      <PaginationItem>
                        <PaginationNext
                          onClick={(e) => {
                            e.preventDefault();
                            if (currentPage < verifiedTotalPages) setCurrentPage(prev => prev + 1);
                          }}
                          className={currentPage >= verifiedTotalPages || isLoading ? "pointer-events-none opacity-50" : "cursor-pointer"}
                        />
                      </PaginationItem>
                    </PaginationContent>
                  </Pagination>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="ready-to-tag" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Ready for Soft Check</CardTitle>
                  <p className="text-sm text-muted-foreground mt-1">
                    Entries verified by BOTH OpenAI AND Perplexity (regardless of Gemini), OR entries verified by one service AND approved by Gemini (gemini_approved = true). Double-check summaries before moving to tagging.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {doubleCheckStatus.isRunning ? (
                    <Button
                      onClick={() => stopDoubleCheckMutation.mutate()}
                      disabled={stopDoubleCheckMutation.isPending}
                      variant="destructive"
                      className="flex items-center gap-2"
                    >
                      {stopDoubleCheckMutation.isPending ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Stopping...
                        </>
                      ) : (
                        <>
                          <X className="w-4 h-4" />
                          Stop
                          {doubleCheckStatus.total > 0 && (
                            <Badge variant="secondary" className="ml-1">
                              {doubleCheckStatus.processed}/{doubleCheckStatus.total}
                            </Badge>
                          )}
                        </>
                      )}
                    </Button>
                  ) : (
                    <Button
                      onClick={async () => {
                        // Fetch ALL ready-to-tag entries, not just the current page
                        if (!supabase) {
                          toast({
                            variant: "destructive",
                            title: "Error",
                            description: "Supabase not configured",
                          });
                          return;
                        }

                        try {
                          // Get all ready-to-tag entries
                          let allReadyToTagData: any[] = [];
                          let from = 0;
                          const batchSize = 1000;
                          let hasMore = true;

                          while (hasMore) {
                            const { data: batchData, error: batchError } = await supabase
                              .from("historical_news_analyses")
                              .select("id, date, summary, perplexity_verdict, fact_check_verdict, gemini_approved, ready_for_tagging")
                              .order("date", { ascending: false })
                              .range(from, from + batchSize - 1);

                            if (batchError) throw batchError;

                            if (batchData && batchData.length > 0) {
                              allReadyToTagData = allReadyToTagData.concat(batchData);
                              from += batchSize;
                              hasMore = batchData.length === batchSize;
                            } else {
                              hasMore = false;
                            }
                          }

                          // Filter to ready-to-tag entries (same logic as the query)
                          const readyToTag = allReadyToTagData.filter(entry => {
                            const isPerplexityVerified = entry.perplexity_verdict === 'verified';
                            const isOpenAIVerified = entry.fact_check_verdict === 'verified';
                            const isGeminiApproved = entry.gemini_approved === true || entry.gemini_approved === 'true' || entry.gemini_approved === 1;
                            const isBothVerified = isPerplexityVerified && isOpenAIVerified;
                            const isOneVerified = (isPerplexityVerified || isOpenAIVerified) && !isBothVerified;
                            const isVerified = isBothVerified || (isOneVerified && isGeminiApproved);
                            const notDoubleChecked = entry.ready_for_tagging === null || entry.ready_for_tagging === undefined;
                            return isVerified && notDoubleChecked;
                          });

                          const entries = readyToTag.map(entry => ({
                          date: entry.date,
                            summary: entry.summary || ''
                        }));

                        if (entries.length === 0) {
                          toast({
                            variant: "destructive",
                            title: "No Entries",
                              description: "No ready-to-tag entries found to double-check",
                          });
                          return;
                        }

                          toast({
                            title: "Starting Double-Check",
                            description: `Processing ${entries.length} ready-to-tag entries...`,
                          });

                        doubleCheckMutation.mutate(entries);
                        } catch (error) {
                          toast({
                            variant: "destructive",
                            title: "Error",
                            description: (error as Error).message || "Failed to fetch ready-to-tag entries",
                          });
                        }
                      }}
                      disabled={doubleCheckMutation.isPending || readyToTagLoading || (readyToTagCount || 0) === 0}
                      className="flex items-center gap-2"
                    >
                      {doubleCheckMutation.isPending ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Starting...
                        </>
                      ) : (
                        <>
                          <SiOpenai className="w-4 h-4" />
                          Double Check Summaries
                        </>
                      )}
                    </Button>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {readyToTagLoading ? (
                <div className="space-y-4">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <Skeleton key={i} className="h-16 w-full" />
                  ))}
                </div>
              ) : !readyToTagEntries || readyToTagEntries.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <CheckCircle className="mx-auto h-12 w-12 mb-4 opacity-50" />
                  <p>No entries ready to be tagged found</p>
                  <p className="text-xs mt-2">Entries need to be verified by OpenAI/Perplexity and approved by Gemini</p>
                </div>
              ) : (
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[120px]">Date</TableHead>
                        <TableHead>Summary</TableHead>
                        <TableHead className="w-[100px]">Verdict</TableHead>
                        <TableHead className="w-[120px]">Confidence</TableHead>
                        <TableHead className="w-[100px]">Importance</TableHead>
                        <TableHead className="w-[100px]">Tags</TableHead>
                        <TableHead className="w-[80px]">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {readyToTagEntries.map((entry) => (
                        <TableRow key={entry.id}>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <Calendar className="h-4 w-4 text-muted-foreground" />
                              <Link 
                                href={`/day/${entry.date}`}
                                className="text-blue-600 hover:underline font-mono text-sm"
                              >
                                {formatDate(entry.date)}
                              </Link>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="max-w-2xl">
                              <p className="text-sm line-clamp-2">
                                {entry.summary}
                              </p>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-col gap-1">
                              {entry.perplexity_verdict === 'verified' ? (
                                <Badge variant="default" className="w-fit flex items-center gap-1.5">
                                  <img src="/perplexity-logo.svg" alt="Perplexity" className="w-3.5 h-3.5" />
                                  <span>Perplexity</span>
                                </Badge>
                              ) : null}
                              {entry.fact_check_verdict === 'verified' ? (
                                <Badge variant="default" className="w-fit flex items-center gap-1.5">
                                  <SiOpenai className="w-3.5 h-3.5" />
                                  <span>OpenAI</span>
                                </Badge>
                              ) : null}
                              {entry.gemini_approved && (
                                <Badge variant="default" className="w-fit bg-green-600">
                                  Gemini Approved
                                </Badge>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            {entry.perplexity_confidence_score !== null ? (
                              <Badge variant={getConfidenceColor(entry.perplexity_confidence_score)}>
                                {Number(entry.perplexity_confidence_score).toFixed(0)}%
                              </Badge>
                            ) : entry.perplexity_confidence !== null ? (
                              <Badge variant={getConfidenceColor(entry.perplexity_confidence)}>
                                {Number(entry.perplexity_confidence).toFixed(0)}%
                              </Badge>
                            ) : entry.gemini_confidence !== null ? (
                              <Badge variant={getConfidenceColor(entry.gemini_confidence)}>
                                Gemini: {Number(entry.gemini_confidence).toFixed(0)}%
                              </Badge>
                            ) : (
                              <span className="text-muted-foreground text-sm">-</span>
                            )}
                          </TableCell>
                          <TableCell>
                            {entry.perplexity_importance !== null ? (
                              <Badge variant="outline">
                                {entry.perplexity_importance}/10
                              </Badge>
                            ) : (
                              <span className="text-muted-foreground text-sm">-</span>
                            )}
                          </TableCell>
                          <TableCell>
                            {entry.tags && entry.tags.length > 0 ? (
                              <div className="flex flex-wrap gap-1">
                                {entry.tags.slice(0, 2).map((tag, idx) => (
                                  <Badge key={idx} variant="outline" className="text-xs">
                                    {tag.name}
                                  </Badge>
                                ))}
                                {entry.tags.length > 2 && (
                                  <Badge variant="outline" className="text-xs">
                                    +{entry.tags.length - 2}
                                  </Badge>
                                )}
                              </div>
                            ) : (
                              <span className="text-muted-foreground text-sm">-</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <Link href={`/day/${entry.date}`}>
                              <ExternalLink className="h-4 w-4 text-muted-foreground hover:text-foreground" />
                            </Link>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}

              {/* Pagination Controls */}
              {readyToTagEntries.length > 0 && readyToTagTotalPages > 0 && (
                <div className="flex items-center justify-between mt-4 pt-4 border-t">
                  <div className="text-sm text-muted-foreground">
                    Showing {((safeReadyToTagPage - 1) * pageSize) + 1} to {Math.min(safeReadyToTagPage * pageSize, readyToTagData?.totalCount || readyToTagCount || 0)} of {(readyToTagData?.totalCount || readyToTagCount || 0).toLocaleString()} entries
                  </div>
                  <Pagination>
                    <PaginationContent>
                      <PaginationItem>
                        <PaginationPrevious
                          onClick={(e) => {
                            e.preventDefault();
                            if (safeReadyToTagPage > 1) setReadyToTagPage(prev => Math.max(1, prev - 1));
                          }}
                          className={safeReadyToTagPage === 1 || readyToTagLoading ? "pointer-events-none opacity-50" : "cursor-pointer"}
                        />
                      </PaginationItem>
                      {getPageNumbers(safeReadyToTagPage, readyToTagTotalPages).map((page, idx) => (
                        <PaginationItem key={idx}>
                          {page === 'ellipsis' ? (
                            <PaginationEllipsis />
                          ) : (
                            <PaginationLink
                              onClick={(e) => {
                                e.preventDefault();
                                if (!readyToTagLoading && typeof page === 'number') {
                                  const targetPage = Math.max(1, Math.min(page, readyToTagTotalPages));
                                  setReadyToTagPage(targetPage);
                                }
                              }}
                              isActive={safeReadyToTagPage === page}
                              className={readyToTagLoading ? "pointer-events-none opacity-50" : "cursor-pointer"}
                            >
                              {page}
                            </PaginationLink>
                          )}
                        </PaginationItem>
                      ))}
                      <PaginationItem>
                        <PaginationNext
                          onClick={(e) => {
                            e.preventDefault();
                            if (safeReadyToTagPage < readyToTagTotalPages) setReadyToTagPage(prev => Math.min(readyToTagTotalPages, prev + 1));
                          }}
                          className={safeReadyToTagPage >= readyToTagTotalPages || readyToTagLoading ? "pointer-events-none opacity-50" : "cursor-pointer"}
                        />
                      </PaginationItem>
                    </PaginationContent>
                  </Pagination>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="ready-for-tagging" className="space-y-4">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Ready for Tagging</CardTitle>
                <p className="text-sm text-muted-foreground mt-1">
                  Entries that have passed the double-check and are ready to be tagged
                </p>
              </div>
            </CardHeader>
            <CardContent>
              {readyForTaggingLoading ? (
                <div className="space-y-4">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <Skeleton key={i} className="h-16 w-full" />
                  ))}
                </div>
              ) : !readyForTaggingEntries || readyForTaggingEntries.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <CheckCircle className="mx-auto h-12 w-12 mb-4 opacity-50" />
                  <p>No entries ready for tagging found</p>
                  <p className="text-xs mt-2">Double-check summaries in "Ready for Soft Check" to move them here</p>
                </div>
              ) : (
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[120px]">Date</TableHead>
                        <TableHead>Summary</TableHead>
                        <TableHead className="w-[100px]">Verdict</TableHead>
                        <TableHead className="w-[120px]">Confidence</TableHead>
                        <TableHead className="w-[100px]">Importance</TableHead>
                        <TableHead className="w-[100px]">Tags</TableHead>
                        <TableHead className="w-[80px]">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {readyForTaggingEntries.map((entry) => (
                        <TableRow key={entry.id}>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <Calendar className="h-4 w-4 text-muted-foreground" />
                              <Link 
                                href={`/day/${entry.date}`}
                                className="text-blue-600 hover:underline font-mono text-sm"
                              >
                                {formatDate(entry.date)}
                              </Link>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="max-w-2xl">
                              <p className="text-sm line-clamp-2">
                                {entry.summary}
                              </p>
                              {entry.double_check_reasoning && (
                                <p className="text-xs text-muted-foreground mt-1 italic">
                                  Check: {entry.double_check_reasoning}
                                </p>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-col gap-1">
                              {entry.perplexity_verdict === 'verified' ? (
                                <Badge variant="default" className="w-fit flex items-center gap-1.5">
                                  <img src="/perplexity-logo.svg" alt="Perplexity" className="w-3.5 h-3.5" />
                                  <span>Perplexity</span>
                                </Badge>
                              ) : null}
                              {entry.fact_check_verdict === 'verified' ? (
                                <Badge variant="default" className="w-fit flex items-center gap-1.5">
                                  <SiOpenai className="w-3.5 h-3.5" />
                                  <span>OpenAI</span>
                                </Badge>
                              ) : null}
                              {entry.gemini_approved && (
                                <Badge variant="default" className="w-fit bg-green-600">
                                  Gemini Approved
                                </Badge>
                              )}
                              {entry.ready_for_tagging && (
                                <Badge variant="default" className="w-fit bg-blue-600">
                                  ✓ Double-Checked
                                </Badge>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            {entry.perplexity_confidence_score !== null ? (
                              <Badge variant={getConfidenceColor(entry.perplexity_confidence_score)}>
                                {Number(entry.perplexity_confidence_score).toFixed(0)}%
                              </Badge>
                            ) : entry.perplexity_confidence !== null ? (
                              <Badge variant={getConfidenceColor(entry.perplexity_confidence)}>
                                {Number(entry.perplexity_confidence).toFixed(0)}%
                              </Badge>
                            ) : entry.gemini_confidence !== null ? (
                              <Badge variant={getConfidenceColor(entry.gemini_confidence)}>
                                Gemini: {Number(entry.gemini_confidence).toFixed(0)}%
                              </Badge>
                            ) : (
                              <span className="text-muted-foreground text-sm">-</span>
                            )}
                          </TableCell>
                          <TableCell>
                            {entry.perplexity_importance !== null ? (
                              <Badge variant="outline">
                                {entry.perplexity_importance}/10
                              </Badge>
                            ) : (
                              <span className="text-muted-foreground text-sm">-</span>
                            )}
                          </TableCell>
                          <TableCell>
                            {entry.tags && entry.tags.length > 0 ? (
                              <div className="flex flex-wrap gap-1">
                                {entry.tags.slice(0, 2).map((tag, idx) => (
                                  <Badge key={idx} variant="outline" className="text-xs">
                                    {tag.name}
                                  </Badge>
                                ))}
                                {entry.tags.length > 2 && (
                                  <Badge variant="outline" className="text-xs">
                                    +{entry.tags.length - 2}
                                  </Badge>
                                )}
                              </div>
                            ) : (
                              <span className="text-muted-foreground text-sm">-</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <Link href={`/day/${entry.date}`}>
                              <ExternalLink className="h-4 w-4 text-muted-foreground hover:text-foreground" />
                            </Link>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}

              {/* Pagination Controls */}
              {readyForTaggingEntries.length > 0 && readyForTaggingTotalPages > 0 && (
                <div className="flex items-center justify-between mt-4 pt-4 border-t">
                  <div className="text-sm text-muted-foreground">
                    Showing {((readyForTaggingPage - 1) * pageSize) + 1} to {Math.min(readyForTaggingPage * pageSize, readyForTaggingData?.totalCount || readyForTaggingCount || 0)} of {(readyForTaggingData?.totalCount || readyForTaggingCount || 0).toLocaleString()} entries
                  </div>
                  <Pagination>
                    <PaginationContent>
                      <PaginationItem>
                        <PaginationPrevious
                          onClick={(e) => {
                            e.preventDefault();
                            if (safeReadyForTaggingPage > 1) setReadyForTaggingPage(prev => Math.max(1, prev - 1));
                          }}
                          className={safeReadyForTaggingPage === 1 || readyForTaggingLoading ? "pointer-events-none opacity-50" : "cursor-pointer"}
                        />
                      </PaginationItem>
                      {getPageNumbers(readyForTaggingPage, readyForTaggingTotalPages).map((page, idx) => (
                        <PaginationItem key={idx}>
                          {page === '...' ? (
                            <PaginationEllipsis />
                          ) : (
                            <PaginationLink
                              onClick={(e) => {
                                e.preventDefault();
                                if (!readyForTaggingLoading && typeof page === 'number') {
                                  const targetPage = Math.max(1, Math.min(page, readyForTaggingTotalPages));
                                  setReadyForTaggingPage(targetPage);
                                }
                              }}
                              isActive={safeReadyForTaggingPage === page}
                              className={readyForTaggingLoading ? "pointer-events-none opacity-50" : "cursor-pointer"}
                            >
                              {page}
                            </PaginationLink>
                          )}
                        </PaginationItem>
                      ))}
                      <PaginationItem>
                        <PaginationNext
                          onClick={(e) => {
                            e.preventDefault();
                            if (safeReadyForTaggingPage < readyForTaggingTotalPages) setReadyForTaggingPage(prev => Math.min(readyForTaggingTotalPages, prev + 1));
                          }}
                          className={safeReadyForTaggingPage >= readyForTaggingTotalPages || readyForTaggingLoading ? "pointer-events-none opacity-50" : "cursor-pointer"}
                        />
                      </PaginationItem>
                    </PaginationContent>
                  </Pagination>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="not-ready-for-tagging" className="space-y-4">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Not Ready for Tagging</CardTitle>
                <p className="text-sm text-muted-foreground mt-1">
                  Entries that have not been double-checked (null) or failed the double-check (false)
                </p>
              </div>
            </CardHeader>
            <CardContent>
              {notReadyForTaggingLoading ? (
                <div className="space-y-4">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <Skeleton key={i} className="h-16 w-full" />
                  ))}
                </div>
              ) : !notReadyForTaggingEntries || notReadyForTaggingEntries.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <XCircle className="mx-auto h-12 w-12 mb-4 opacity-50" />
                  <p>No entries found</p>
                </div>
              ) : (
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[120px]">Date</TableHead>
                        <TableHead>Summary</TableHead>
                        <TableHead className="w-[100px]">Verdict</TableHead>
                        <TableHead className="w-[120px]">Status</TableHead>
                        <TableHead className="w-[120px]">Confidence</TableHead>
                        <TableHead className="w-[100px]">Importance</TableHead>
                        <TableHead className="w-[100px]">Tags</TableHead>
                        <TableHead className="w-[80px]">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {notReadyForTaggingEntries.map((entry) => (
                        <TableRow key={entry.id}>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <Calendar className="h-4 w-4 text-muted-foreground" />
                              <Link 
                                href={`/day/${entry.date}`}
                                className="text-blue-600 hover:underline font-mono text-sm"
                              >
                                {formatDate(entry.date)}
                              </Link>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="max-w-2xl">
                              <p className="text-sm line-clamp-2">
                                {entry.summary}
                              </p>
                              {entry.double_check_reasoning && (
                                <p className="text-xs text-muted-foreground mt-1 italic">
                                  Check: {entry.double_check_reasoning}
                                </p>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-col gap-1">
                              {entry.perplexity_verdict === 'verified' ? (
                                <Badge variant="default" className="w-fit flex items-center gap-1.5">
                                  <img src="/perplexity-logo.svg" alt="Perplexity" className="w-3.5 h-3.5" />
                                  <span>Perplexity</span>
                                </Badge>
                              ) : null}
                              {entry.fact_check_verdict === 'verified' ? (
                                <Badge variant="default" className="w-fit flex items-center gap-1.5">
                                  <SiOpenai className="w-3.5 h-3.5" />
                                  <span>OpenAI</span>
                                </Badge>
                              ) : null}
                              {entry.gemini_approved && (
                                <Badge variant="default" className="w-fit bg-green-600">
                                  Gemini Approved
                                </Badge>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            {entry.ready_for_tagging === false ? (
                              <Badge variant="destructive" className="w-fit">
                                ✗ Failed Check
                              </Badge>
                            ) : entry.ready_for_tagging === null || entry.ready_for_tagging === undefined ? (
                              <Badge variant="outline" className="w-fit">
                                Not Checked
                              </Badge>
                            ) : null}
                          </TableCell>
                          <TableCell>
                            {entry.perplexity_confidence_score !== null ? (
                              <Badge variant={getConfidenceColor(entry.perplexity_confidence_score)}>
                                {Number(entry.perplexity_confidence_score).toFixed(0)}%
                              </Badge>
                            ) : entry.perplexity_confidence !== null ? (
                              <Badge variant={getConfidenceColor(entry.perplexity_confidence)}>
                                {Number(entry.perplexity_confidence).toFixed(0)}%
                              </Badge>
                            ) : entry.gemini_confidence !== null ? (
                              <Badge variant={getConfidenceColor(entry.gemini_confidence)}>
                                Gemini: {Number(entry.gemini_confidence).toFixed(0)}%
                              </Badge>
                            ) : (
                              <span className="text-muted-foreground text-sm">-</span>
                            )}
                          </TableCell>
                          <TableCell>
                            {entry.perplexity_importance !== null ? (
                              <Badge variant="outline">
                                {entry.perplexity_importance}/10
                              </Badge>
                            ) : (
                              <span className="text-muted-foreground text-sm">-</span>
                            )}
                          </TableCell>
                          <TableCell>
                            {entry.tags && entry.tags.length > 0 ? (
                              <div className="flex flex-wrap gap-1">
                                {entry.tags.slice(0, 2).map((tag, idx) => (
                                  <Badge key={idx} variant="outline" className="text-xs">
                                    {tag.name}
                                  </Badge>
                                ))}
                                {entry.tags.length > 2 && (
                                  <Badge variant="outline" className="text-xs">
                                    +{entry.tags.length - 2}
                                  </Badge>
                                )}
                              </div>
                            ) : (
                              <span className="text-muted-foreground text-sm">-</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <Link href={`/day/${entry.date}`}>
                              <ExternalLink className="h-4 w-4 text-muted-foreground hover:text-foreground" />
                            </Link>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}

              {/* Pagination Controls */}
              {notReadyForTaggingEntries.length > 0 && notReadyForTaggingTotalPages > 0 && (
                <div className="flex items-center justify-between mt-4 pt-4 border-t">
                  <div className="text-sm text-muted-foreground">
                    Showing {((notReadyForTaggingPage - 1) * pageSize) + 1} to {Math.min(notReadyForTaggingPage * pageSize, notReadyForTaggingData?.totalCount || notReadyForTaggingCount || 0)} of {(notReadyForTaggingData?.totalCount || notReadyForTaggingCount || 0).toLocaleString()} entries
                  </div>
                  <Pagination>
                    <PaginationContent>
                      <PaginationItem>
                        <PaginationPrevious
                          onClick={(e) => {
                            e.preventDefault();
                            const safePage = Math.max(1, notReadyForTaggingPage - 1);
                            if (safePage < notReadyForTaggingPage) setNotReadyForTaggingPage(safePage);
                          }}
                          className={notReadyForTaggingPage === 1 || notReadyForTaggingLoading ? "pointer-events-none opacity-50" : "cursor-pointer"}
                        />
                      </PaginationItem>
                      {getPageNumbers(notReadyForTaggingPage, notReadyForTaggingTotalPages).map((page, idx) => (
                        <PaginationItem key={idx}>
                          {page === 'ellipsis' ? (
                            <PaginationEllipsis />
                          ) : (
                            <PaginationLink
                              onClick={(e) => {
                                e.preventDefault();
                                if (!notReadyForTaggingLoading && typeof page === 'number') {
                                  const targetPage = Math.max(1, Math.min(page, notReadyForTaggingTotalPages));
                                  setNotReadyForTaggingPage(targetPage);
                                }
                              }}
                              isActive={notReadyForTaggingPage === page}
                              className={notReadyForTaggingLoading ? "pointer-events-none opacity-50" : "cursor-pointer"}
                            >
                              {page}
                            </PaginationLink>
                          )}
                        </PaginationItem>
                      ))}
                      <PaginationItem>
                        <PaginationNext
                          onClick={(e) => {
                            e.preventDefault();
                            if (notReadyForTaggingPage < notReadyForTaggingTotalPages) setNotReadyForTaggingPage(prev => Math.min(notReadyForTaggingTotalPages, prev + 1));
                          }}
                          className={notReadyForTaggingPage >= notReadyForTaggingTotalPages || notReadyForTaggingLoading ? "pointer-events-none opacity-50" : "cursor-pointer"}
                        />
                      </PaginationItem>
                    </PaginationContent>
                  </Pagination>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="orphans" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
              <div>
                <CardTitle>Orphans</CardTitle>
                <p className="text-sm text-muted-foreground mt-1">
                  Entries where neither Perplexity nor Gemini found relevant articles during battle
                </p>
                  {doubleCheckStatus.isRunning && (
                    <div className="mt-2 text-sm text-blue-600">
                      Double-checking: {doubleCheckStatus.processed} / {doubleCheckStatus.total}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {doubleCheckStatus.isRunning ? (
                    <Button
                      onClick={() => stopDoubleCheckMutation.mutate()}
                      disabled={stopDoubleCheckMutation.isPending}
                      variant="destructive"
                      className="flex items-center gap-2"
                    >
                      {stopDoubleCheckMutation.isPending ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Stopping...
                        </>
                      ) : (
                        <>
                          <X className="w-4 h-4" />
                          Stop Double-Check
                          {doubleCheckStatus.total > 0 && (
                            <Badge variant="secondary" className="ml-1">
                              {doubleCheckStatus.processed}/{doubleCheckStatus.total}
                            </Badge>
                          )}
                        </>
                      )}
                    </Button>
                  ) : (
                    <Button
                      onClick={async () => {
                        // Fetch ALL orphan entries, not just the current page
                        if (!supabase) {
                          toast({
                            variant: "destructive",
                            title: "Error",
                            description: "Supabase not configured",
                          });
                          return;
                        }

                        try {
                          // Get all orphan entries
                          let allOrphanData: any[] = [];
                          let from = 0;
                          const batchSize = 1000;
                          let hasMore = true;

                          while (hasMore) {
                            const { data: batchData, error: batchError } = await supabase
                              .from("historical_news_analyses")
                              .select("id, date, summary, is_orphan")
                              .eq("is_orphan", true)
                              .order("date", { ascending: false })
                              .range(from, from + batchSize - 1);

                            if (batchError) throw batchError;

                            if (batchData && batchData.length > 0) {
                              allOrphanData = allOrphanData.concat(batchData);
                              from += batchSize;
                              hasMore = batchData.length === batchSize;
                            } else {
                              hasMore = false;
                            }
                          }

                          const entries = allOrphanData.map(entry => ({
                            date: entry.date,
                            summary: entry.summary || ''
                          }));

                          if (entries.length === 0) {
                            toast({
                              variant: "destructive",
                              title: "No Entries",
                              description: "No orphan entries found to double-check",
                            });
                            return;
                          }

                          toast({
                            title: "Starting Double-Check",
                            description: `Processing ${entries.length} orphan entries...`,
                          });

                          doubleCheckMutation.mutate(entries);
                        } catch (error) {
                          toast({
                            variant: "destructive",
                            title: "Error",
                            description: (error as Error).message || "Failed to fetch orphan entries",
                          });
                        }
                      }}
                      disabled={doubleCheckMutation.isPending || orphansLoading || (orphansCount || 0) === 0}
                      className="flex items-center gap-2"
                    >
                      {doubleCheckMutation.isPending ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Starting...
                        </>
                      ) : (
                        <>
                          <Shield className="w-4 h-4" />
                          Double Check Summaries
                        </>
                      )}
                    </Button>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {orphansLoading ? (
                <div className="space-y-4">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <Skeleton key={i} className="h-16 w-full" />
                  ))}
                </div>
              ) : !orphansEntries || orphansEntries.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <FileQuestion className="mx-auto h-12 w-12 mb-4 opacity-50" />
                  <p>No orphan entries found</p>
                  <p className="text-xs mt-2">Orphans are entries where battle found no matching articles</p>
                </div>
              ) : (
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[120px]">Date</TableHead>
                        <TableHead>Summary</TableHead>
                        <TableHead className="w-[100px]">Verdict</TableHead>
                        <TableHead className="w-[120px]">Confidence</TableHead>
                        <TableHead className="w-[100px]">Tags</TableHead>
                        <TableHead className="w-[80px]">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {orphansEntries.map((entry) => (
                        <TableRow key={entry.id}>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <Calendar className="h-4 w-4 text-muted-foreground" />
                              <Link 
                                href={`/day/${entry.date}`}
                                className="text-blue-600 hover:underline font-mono text-sm"
                              >
                                {formatDate(entry.date)}
                              </Link>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="max-w-2xl">
                              <p className="text-sm line-clamp-2">
                                {entry.summary}
                              </p>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-col gap-1">
                              {entry.perplexity_verdict === 'verified' ? (
                                <Badge variant="default" className="w-fit flex items-center gap-1.5">
                                  <img src="/perplexity-logo.svg" alt="Perplexity" className="w-3.5 h-3.5" />
                                  <span>Perplexity</span>
                                </Badge>
                              ) : null}
                              {entry.fact_check_verdict === 'verified' ? (
                                <Badge variant="default" className="w-fit flex items-center gap-1.5">
                                  <SiOpenai className="w-3.5 h-3.5" />
                                  <span>OpenAI</span>
                                </Badge>
                              ) : null}
                              {entry.gemini_approved && (
                                <Badge variant="default" className="w-fit bg-green-600">
                                  Gemini Approved
                                </Badge>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            {entry.perplexity_confidence_score !== null ? (
                              <Badge variant={getConfidenceColor(entry.perplexity_confidence_score)}>
                                {Number(entry.perplexity_confidence_score).toFixed(0)}%
                              </Badge>
                            ) : entry.perplexity_confidence !== null ? (
                              <Badge variant={getConfidenceColor(entry.perplexity_confidence)}>
                                {Number(entry.perplexity_confidence).toFixed(0)}%
                              </Badge>
                            ) : (
                              <span className="text-muted-foreground text-sm">-</span>
                            )}
                          </TableCell>
                          <TableCell>
                            {entry.tags && entry.tags.length > 0 ? (
                              <div className="flex flex-wrap gap-1">
                                {entry.tags.slice(0, 2).map((tag, idx) => (
                                  <Badge key={idx} variant="outline" className="text-xs">
                                    {tag.name}
                                  </Badge>
                                ))}
                                {entry.tags.length > 2 && (
                                  <Badge variant="outline" className="text-xs">
                                    +{entry.tags.length - 2}
                                  </Badge>
                                )}
                              </div>
                            ) : (
                              <span className="text-muted-foreground text-sm">-</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <Link href={`/day/${entry.date}`}>
                              <ExternalLink className="h-4 w-4 text-muted-foreground hover:text-foreground" />
                            </Link>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}

              {/* Pagination Controls */}
              {orphansEntries.length > 0 && orphansTotalPages > 0 && (
                <div className="flex items-center justify-between mt-4 pt-4 border-t">
                  <div className="text-sm text-muted-foreground">
                    Showing {((orphansPage - 1) * pageSize) + 1} to {Math.min(orphansPage * pageSize, orphansData?.totalCount || orphansCount || 0)} of {(orphansData?.totalCount || orphansCount || 0).toLocaleString()} entries
                  </div>
                  <Pagination>
                    <PaginationContent>
                      <PaginationItem>
                        <PaginationPrevious
                          onClick={(e) => {
                            e.preventDefault();
                            if (orphansPage > 1) setOrphansPage(prev => Math.max(1, prev - 1));
                          }}
                          className={orphansPage === 1 || orphansLoading ? "pointer-events-none opacity-50" : "cursor-pointer"}
                        />
                      </PaginationItem>
                      {getPageNumbers(orphansPage, orphansTotalPages).map((page, idx) => (
                        <PaginationItem key={idx}>
                          {page === 'ellipsis' ? (
                            <PaginationEllipsis />
                          ) : (
                            <PaginationLink
                              onClick={(e) => {
                                e.preventDefault();
                                if (!orphansLoading && typeof page === 'number') {
                                  const targetPage = Math.max(1, Math.min(page, orphansTotalPages));
                                  setOrphansPage(targetPage);
                                }
                              }}
                              isActive={page === orphansPage}
                              className={orphansLoading ? "pointer-events-none opacity-50" : "cursor-pointer"}
                            >
                              {page}
                            </PaginationLink>
                          )}
                        </PaginationItem>
                      ))}
                      <PaginationItem>
                        <PaginationNext
                          onClick={(e) => {
                            e.preventDefault();
                            if (orphansPage < orphansTotalPages) setOrphansPage(prev => Math.min(orphansTotalPages, prev + 1));
                          }}
                          className={orphansPage >= orphansTotalPages || orphansLoading ? "pointer-events-none opacity-50" : "cursor-pointer"}
                        />
                      </PaginationItem>
                    </PaginationContent>
                  </Pagination>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="quality-check" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Quality Check</CardTitle>
                  <p className="text-sm text-muted-foreground mt-1">
                    Entries with quality violations in their summaries (too short, too long, formatting issues, etc.)
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Select
                    value={selectedBulkAction}
                    onValueChange={setSelectedBulkAction}
                    disabled={bulkActionLoading || removePeriodsMutation.isPending || adjustLengthMutation.isPending || regenerateSummariesMutation.isPending || qualityCheckLoading}
                  >
                    <SelectTrigger className="w-[280px]">
                      <SelectValue placeholder="Select bulk action" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="remove-periods">
                        Remove periods from all summaries
                      </SelectItem>
                      <SelectItem value="adjust-length">
                        Adjust summary length (OpenAI)
                      </SelectItem>
                      <SelectItem value="regenerate-summaries">
                        Regenerate too short/long summaries (OpenAI)
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <Button
                    onClick={() => {
                      if (!selectedBulkAction) return;
                      
                      if (selectedBulkAction === "remove-periods") {
                        const count = allQualityViolations.filter(v => v.summary.trim().endsWith('.')).length;
                        if (confirm(`Are you sure you want to remove periods from all summaries that end with a period? This will affect approximately ${count} summaries.`)) {
                          removePeriodsMutation.mutate();
                        }
                      } else if (selectedBulkAction === "adjust-length") {
                        const tooShortOrLong = filteredViolations.filter(v => 
                          v.violations.some(viol => viol.includes('too short') || viol.includes('too long'))
                        );
                        const count = tooShortOrLong.length;
                        if (confirm(`Are you sure you want to adjust the length of summaries that are too short or too long? This will affect ${count} summaries and will use OpenAI (gpt-4o-mini) to expand or shorten them while preserving meaning.`)) {
                          adjustLengthMutation.mutate();
                        }
                      } else if (selectedBulkAction === "regenerate-summaries") {
                        const tooShortOrLong = filteredViolations.filter(v => 
                          v.violations.some(viol => viol.includes('too short') || viol.includes('too long'))
                        );
                        const count = tooShortOrLong.length;
                        if (confirm(`Are you sure you want to regenerate summaries for all entries that are too short or too long? This will affect ${count} summaries and will use OpenAI (gpt-4o-mini).`)) {
                          // Process all entries that are too short or too long
                          const allDates = tooShortOrLong.map(v => v.date);
                          console.log(`🔄 Regenerating summaries for ${allDates.length} entries`);
                          regenerateSummariesMutation.mutate(allDates);
                        }
                      }
                    }}
                    disabled={
                      !selectedBulkAction || 
                      bulkActionLoading || 
                      removePeriodsMutation.isPending || 
                      adjustLengthMutation.isPending ||
                      regenerateSummariesMutation.isPending || 
                      qualityCheckLoading
                    }
                    variant="default"
                  >
                    {bulkActionLoading || removePeriodsMutation.isPending || adjustLengthMutation.isPending || regenerateSummariesMutation.isPending ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Processing...
                      </>
                    ) : (
                      "Start"
                    )}
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {/* Filters */}
              {!qualityCheckLoading && allQualityViolations.length > 0 && (
                <Card className="p-4 mb-6 border-dashed">
                  <div className="flex items-center gap-2 mb-3">
                    <Filter className="w-4 h-4 text-muted-foreground" />
                    <h3 className="font-semibold text-sm">Filter by Violation Type</h3>
                    {selectedFilters.size > 0 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setSelectedFilters(new Set());
                          setQualityCheckPage(1);
                        }}
                        className="ml-auto text-xs h-7"
                      >
                        Clear All
                      </Button>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-3">
                    {violationTypes.map((type) => (
                      <div key={type.id} className="flex items-center space-x-2">
                        <Checkbox
                          id={`filter-${type.id}`}
                          checked={selectedFilters.has(type.id)}
                          onCheckedChange={() => toggleFilter(type.id)}
                        />
                        <Label
                          htmlFor={`filter-${type.id}`}
                          className="text-sm font-normal cursor-pointer"
                        >
                          <Badge variant="outline" className={`${type.color} text-xs font-normal`}>
                            {type.label}
                          </Badge>
                        </Label>
                      </div>
                    ))}
                  </div>
                  {selectedFilters.size > 0 && (
                    <div className="mt-3 text-xs text-muted-foreground">
                      Showing {filteredViolations.length.toLocaleString()} of {allQualityViolations.length.toLocaleString()} violations
                    </div>
                  )}
                </Card>
              )}

              {qualityCheckLoading ? (
                <div className="space-y-4">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <Skeleton key={i} className="h-16 w-full" />
                  ))}
                </div>
              ) : !qualityCheckEntries || qualityCheckEntries.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <CheckCircle className="mx-auto h-12 w-12 mb-4 opacity-50" />
                  <p>
                    {selectedFilters.size > 0
                      ? 'No violations match the selected filters. Try adjusting your filter selection.'
                      : 'No quality violations found'}
                  </p>
                  <p className="text-xs mt-2">
                    {selectedFilters.size > 0
                      ? 'All summaries meet quality standards for the selected filters'
                      : 'All summaries meet quality standards'}
                  </p>
                </div>
              ) : (
                <div className="rounded-md border">
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
                      {qualityCheckEntries.map((violation) => (
                        <TableRow key={violation.date}>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <Calendar className="h-4 w-4 text-muted-foreground" />
                              <Link 
                                href={`/day/${violation.date}`}
                                className="text-blue-600 hover:underline font-mono text-sm"
                              >
                                {formatDate(violation.date)}
                              </Link>
                            </div>
                          </TableCell>
                          <TableCell 
                            className="cursor-pointer hover:bg-slate-50"
                            onClick={() => window.location.href = `/day/${violation.date}`}
                          >
                            <div className="text-sm text-slate-700 whitespace-normal max-w-2xl line-clamp-2">
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
                            <Link href={`/day/${violation.date}`}>
                              <ExternalLink className="h-4 w-4 text-muted-foreground hover:text-foreground" />
                            </Link>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}

              {/* Pagination Controls */}
              {qualityCheckEntries.length > 0 && qualityCheckTotalPages > 0 && (
                <div className="flex items-center justify-between mt-4 pt-4 border-t">
                  <div className="text-sm text-muted-foreground">
                    Showing {((safeQualityCheckPage - 1) * pageSize) + 1} to {Math.min(safeQualityCheckPage * pageSize, filteredViolations.length)} of {filteredViolations.length.toLocaleString()} {selectedFilters.size > 0 ? 'filtered ' : ''}entries
                  </div>
                  <Pagination>
                    <PaginationContent>
                      <PaginationItem>
                        <PaginationPrevious
                          onClick={(e) => {
                            e.preventDefault();
                            if (safeQualityCheckPage > 1) setQualityCheckPage(prev => Math.max(1, prev - 1));
                          }}
                          className={safeQualityCheckPage === 1 || qualityCheckLoading ? "pointer-events-none opacity-50" : "cursor-pointer"}
                        />
                      </PaginationItem>
                      {getPageNumbers(safeQualityCheckPage, qualityCheckTotalPages).map((page, idx) => (
                        <PaginationItem key={idx}>
                          {page === 'ellipsis' ? (
                            <PaginationEllipsis />
                          ) : (
                            <PaginationLink
                              onClick={(e) => {
                                e.preventDefault();
                                if (!qualityCheckLoading && typeof page === 'number') {
                                  const targetPage = Math.max(1, Math.min(page, qualityCheckTotalPages));
                                  setQualityCheckPage(targetPage);
                                }
                              }}
                              isActive={safeQualityCheckPage === page}
                              className={qualityCheckLoading ? "pointer-events-none opacity-50" : "cursor-pointer"}
                            >
                              {page}
                            </PaginationLink>
                          )}
                        </PaginationItem>
                      ))}
                      <PaginationItem>
                        <PaginationNext
                          onClick={(e) => {
                            e.preventDefault();
                            if (safeQualityCheckPage < qualityCheckTotalPages) setQualityCheckPage(prev => Math.min(qualityCheckTotalPages, prev + 1));
                          }}
                          className={safeQualityCheckPage >= qualityCheckTotalPages || qualityCheckLoading ? "pointer-events-none opacity-50" : "cursor-pointer"}
                        />
                      </PaginationItem>
                    </PaginationContent>
                  </Pagination>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

