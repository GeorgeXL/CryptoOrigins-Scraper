import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { apiRequest } from "@/lib/queryClient";
import { getCurrentYear, getCurrentDate } from "@/lib/utils";

export interface TimelineStats {
  totalDays: number;
  analyzedDays: number;
  completionPercentage: number;
  recentAnalyses: Array<{
    date: string;
    summary: string;
    aiProvider: string;
  }>;
}

export interface YearProgress {
  totalDays: number;
  analyzedDays: number;
  percentage: number;
}

export interface YearData {
  progress: YearProgress;
  analyses: Array<{
    date: string;
    summary: string;
    hasManualEntry: boolean;
    confidenceScore: number;
  }>;
  monthlyBreakdown: Array<{
    month: number;
    analyzedDays: number;
    totalDays: number;
    percentage: number;
  }>;
}

export interface MonthAnalysis {
  date: string;
  summary: string;
  hasManualEntry: boolean;
  confidenceScore: number;
  status: 'complete' | 'missing' | 'manual' | 'low-confidence';
}

export function useTimelineStats() {
  return useQuery<TimelineStats>({
    queryKey: ['/api/analysis/stats'],
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

export function useYearData(year: number) {
  return useQuery<YearData>({
    queryKey: [`/api/analysis/year/${year}`],
    enabled: year >= 2008 && year <= getCurrentYear(),
    staleTime: 10 * 60 * 1000, // 10 minutes
  });
}

export function useYearProgress(year: number) {
  return useQuery<YearData, Error, YearProgress>({
    queryKey: [`/api/analysis/year/${year}`],
    select: (data: YearData) => data.progress,
    enabled: year >= 2008 && year <= getCurrentYear(),
    staleTime: 10 * 60 * 1000,
  });
}

export function useMonthAnalyses(year: number, month: number) {
  return useQuery<YearData, Error, MonthAnalysis[]>({
    queryKey: [`/api/analysis/year/${year}`],
    select: (data: YearData) => {
      // Filter analyses for the specific month and enhance with status
      return data.analyses
        .filter(analysis => {
          const analysisDate = new Date(analysis.date);
          return analysisDate.getFullYear() === year && 
                 analysisDate.getMonth() + 1 === month;
        })
        .map(analysis => ({
          ...analysis,
          status: getAnalysisStatus(analysis)
        }));
    },
    enabled: year >= 2008 && year <= getCurrentYear() && month >= 1 && month <= 12,
  });
}

export function useAnalyzeDate() {
  return useMutation({
    mutationFn: async (data: { 
      date: string; 
      forceReanalysis?: boolean; 
      aiProvider?: 'openai' | 'claude' | 'dual';
    }) => {
      const newsProvider = localStorage.getItem('newsProvider') || 'exa';
      const response = await apiRequest('POST', '/api/analysis/analyze', { ...data, newsProvider });
      return response.json();
    },
    onSuccess: (data) => {
      const date = new Date(data.analysisDate);
      const year = date.getFullYear();
      
      // Invalidate related queries
      queryClient.invalidateQueries({ 
        queryKey: [`/api/analysis/date/${data.analysisDate}`] 
      });
      queryClient.invalidateQueries({ 
        queryKey: [`/api/analysis/year/${year}`] 
      });
      queryClient.invalidateQueries({ 
        queryKey: ['/api/analysis/stats'] 
      });
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
      // Invalidate all timeline-related queries
      queryClient.invalidateQueries({ queryKey: ['/api/analysis/stats'] });
      // Note: Individual year queries will be invalidated as analyses complete
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
      const year = new Date(date).getFullYear();
      
      queryClient.invalidateQueries({ 
        queryKey: [`/api/analysis/date/${date}`] 
      });
      queryClient.invalidateQueries({ 
        queryKey: [`/api/analysis/year/${year}`] 
      });
      queryClient.invalidateQueries({ 
        queryKey: ['/api/analysis/stats'] 
      });
    },
  });
}

export function useCreateManualEntry() {
  return useMutation({
    mutationFn: async (data: {
      date: string;
      title: string;
      summary: string;
      description?: string;
    }) => {
      const response = await apiRequest('POST', '/api/manual-entries', data);
      return response.json();
    },
    onSuccess: (data) => {
      const year = new Date(data.date).getFullYear();
      
      queryClient.invalidateQueries({ 
        queryKey: [`/api/analysis/date/${data.date}`] 
      });
      queryClient.invalidateQueries({ 
        queryKey: [`/api/manual-entries/date/${data.date}`] 
      });
      queryClient.invalidateQueries({ 
        queryKey: [`/api/analysis/year/${year}`] 
      });
    },
  });
}

// Utility functions
function getAnalysisStatus(analysis: {
  hasManualEntry: boolean;
  confidenceScore: number;
}): 'complete' | 'missing' | 'manual' | 'low-confidence' {
  if (analysis.hasManualEntry) return 'manual';
  if (analysis.confidenceScore >= 60) return 'complete';
  if (analysis.confidenceScore > 0) return 'low-confidence';
  return 'missing';
}

export function getYearRange(): number[] {
  const currentYear = getCurrentYear();
  // Exclude 2025 from the year range
  const maxYear = Math.min(currentYear, 2024);
  return Array.from({ length: maxYear - 2008 + 1 }, (_, i) => maxYear - i);
}

export function getMonthName(month: number): string {
  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];
  return monthNames[month - 1] || '';
}

export function getMonthShortName(month: number): string {
  const monthNames = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
  ];
  return monthNames[month - 1] || '';
}

export function isCurrentYear(year: number): boolean {
  return year === getCurrentYear();
}

export function isCurrentMonth(year: number, month: number): boolean {
  const now = new Date();
  return year === now.getFullYear() && month === now.getMonth() + 1;
}

export function isFutureDate(date: string): boolean {
  return new Date(date) > new Date(getCurrentDate());
}

export function getProgressVariant(percentage: number): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (percentage === 100) return 'secondary';
  if (percentage >= 90) return 'default';
  if (percentage >= 50) return 'outline';
  return 'destructive';
}

export function getProgressColorClass(percentage: number): string {
  if (percentage === 100) return 'progress-complete';
  if (percentage >= 90) return 'progress-high';
  if (percentage >= 50) return 'progress-medium';
  return 'progress-low';
}

export function getStatusColorClass(status: string): string {
  switch (status) {
    case 'complete': return 'analysis-complete';
    case 'manual': return 'analysis-manual';
    case 'missing': return 'analysis-missing';
    case 'low-confidence': return 'analysis-processing';
    default: return 'analysis-missing';
  }
}

export function calculateTotalDaysInYear(year: number): number {
  const isLeap = (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
  return isLeap ? 366 : 365;
}

export function generateMonthDates(year: number, month: number): string[] {
  const daysInMonth = new Date(year, month, 0).getDate();
  const dates: string[] = [];
  
  for (let day = 1; day <= daysInMonth; day++) {
    const date = `${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
    dates.push(date);
  }
  
  return dates;
}
