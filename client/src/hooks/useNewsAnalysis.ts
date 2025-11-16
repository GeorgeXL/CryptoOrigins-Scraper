import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { apiRequest } from "@/lib/queryClient";

export interface NewsAnalysisResult {
  topArticleId: string;
  summary: string;
  reasoning: string;
  confidenceScore: number;
  aiProvider: string;
  articles: Array<{
    id: string;
    title: string;
    url: string;
    publishedDate: string;
    author?: string;
    text: string;
    score?: number;
  }>;
  totalArticlesFetched: number;
  analysisDate: string;
}

export function useNewsAnalysis(date: string) {
  return useQuery({
    queryKey: [`/api/analysis/date/${date}`],
    enabled: !!date,
  });
}

export function useAnalyzeNews() {
  return useMutation({
    mutationFn: async (data: { date: string; forceReanalysis?: boolean; aiProvider?: string }) => {
      const newsProvider = localStorage.getItem('newsProvider') || 'exa';
      const response = await apiRequest('POST', '/api/analysis/analyze', { ...data, newsProvider });
      return response.json();
    },
    onSuccess: (data) => {
      // Invalidate and refetch related queries
      queryClient.invalidateQueries({ queryKey: [`/api/analysis/date/${data.analysisDate}`] });
      queryClient.invalidateQueries({ queryKey: ['/api/analysis/stats'] });
    },
  });
}

export function useCreateManualEntry() {
  return useMutation({
    mutationFn: async (data: { date: string; title: string; summary: string; description?: string }) => {
      const response = await apiRequest('POST', '/api/manual-entries', data);
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: [`/api/analysis/date/${data.date}`] });
      queryClient.invalidateQueries({ queryKey: [`/api/manual-entries/date/${data.date}`] });
    },
  });
}

export function useDeleteAnalysis() {
  return useMutation({
    mutationFn: async (date: string) => {
      await apiRequest('DELETE', `/api/analysis/date/${date}`);
      return date;
    },
    onSuccess: (date) => {
      // Extract year from date for more comprehensive invalidation
      const year = date.split('-')[0];
      
      // Invalidate specific date query
      queryClient.invalidateQueries({ queryKey: [`/api/analysis/date/${date}`] });
      
      // Invalidate year-specific queries
      queryClient.invalidateQueries({ queryKey: [`/api/analysis/year/${year}`] });
      
      // Invalidate general stats
      queryClient.invalidateQueries({ queryKey: ['/api/analysis/stats'] });
      
      // Invalidate filter queries that might include this date
      queryClient.invalidateQueries({ queryKey: ['/api/analysis/filter'] });
      
      // Invalidate any batch analysis queries
      queryClient.invalidateQueries({ queryKey: ['/api/analysis/bulk-analyze'] });
      
      // Remove the specific item from cache entirely
      queryClient.removeQueries({ queryKey: [`/api/analysis/date/${date}`] });
    },
  });
}

export function useBulkAnalyze() {
  return useMutation({
    mutationFn: async (data: { startDate: string; endDate: string }) => {
      const response = await apiRequest('POST', '/api/analysis/bulk-analyze', data);
      return response.json();
    },
    onSuccess: () => {
      // Invalidate stats to show updated progress
      queryClient.invalidateQueries({ queryKey: ['/api/analysis/stats'] });
    },
  });
}
