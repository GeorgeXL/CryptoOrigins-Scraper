import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PlayCircle, StopCircle } from "lucide-react";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { useGlobalAnalysis } from "@/contexts/GlobalAnalysisContext";
import MonthCard from "./MonthCard";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { supabase } from "@/lib/supabase";


interface YearProgress {
  totalDays: number;
  analyzedDays: number;
  percentage: number;
}

interface YearCardProps {
  year: number;
}

export default function YearCard({ year }: YearCardProps) {
  const { data: progress, isLoading } = useQuery<YearProgress>({
    queryKey: [`supabase-year-${year}`],
    queryFn: async () => {
      if (!supabase) throw new Error("Supabase not configured");
      
      // Get total days in year
      const isLeapYear = (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
      const totalDays = isLeapYear ? 366 : 365;
      
      // Count analyzed days for this year
      const startDate = `${year}-01-01`;
      const endDate = `${year}-12-31`;
      
      const { count, error } = await supabase
        .from("historical_news_analyses")
        .select("*", { count: "exact", head: true })
        .gte("date", startDate)
        .lte("date", endDate);
      
      if (error) throw error;
      
      const analyzedDays = count || 0;
      const percentage = totalDays > 0 ? Math.round((analyzedDays / totalDays) * 100) : 0;
      
      return {
        totalDays,
        analyzedDays,
        percentage
      };
    },
  });

  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { startAnalysis, updateProgress, completeAnalysis, getAnalysisById } = useGlobalAnalysis();
  
  // Check if this year has an active analysis
  const analysisId = `year-${year}`;
  const activeAnalysis = getAnalysisById(analysisId);

  const currentYear = new Date().getFullYear();
  const isCurrentYear = year === currentYear;
  
  // Generate all dates for the year
  const generateDatesForYear = (year: number): string[] => {
    const dates: string[] = [];
    for (let month = 1; month <= 12; month++) {
      const daysInMonth = new Date(year, month, 0).getDate();
      for (let day = 1; day <= daysInMonth; day++) {
        const dateStr = `${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
        dates.push(dateStr);
      }
    }
    return dates;
  };

  // Year analysis function
  const startYearAnalysis = async () => {
    const allDates = generateDatesForYear(year);
    
    if (allDates.length === 0) {
      toast({ title: "No dates found", description: "No valid dates found for this year." });
      return;
    }

    const controller = new AbortController();
    
    // Register with global analysis tracker
    startAnalysis({
      id: analysisId,
      type: 'year',
      label: `Analyze Year ${year}`,
      completed: 0,
      total: allDates.length,
      year,
      abortController: controller
    });

    // Invalidate the year query immediately to trigger loading states
    queryClient.invalidateQueries({ queryKey: [`supabase-year-${year}`] });

    try {
      await processStreamingBatch(allDates, controller, (progress, currentDate) => {
        updateProgress(analysisId, progress, currentDate);
      });

      if (!controller.signal.aborted) {
        toast({ 
          title: "Year analysis complete", 
          description: `Successfully analyzed all days in ${year}` 
        });
      }
    } catch (error: any) {
      if (error.name !== 'AbortError') {
        toast({ title: "Error", description: "Year analysis failed.", variant: "destructive" });
      }
    } finally {
      completeAnalysis(analysisId);
      queryClient.invalidateQueries({ queryKey: [`supabase-year-${year}`] });
    }
  };

  // Streaming batch processing (similar to MonthView)
  const processStreamingBatch = async (dates: string[], controller: AbortController, onProgress: (completed: number, currentDate?: string) => void) => {
    try {
      const response = await fetch('/api/analysis/batch-analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          dates, 
          aiProvider: 'openai',
          newsProvider: localStorage.getItem('newsProvider') || 'exa'
        }),
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      if (!response.body) {
        throw new Error('No response body available for streaming');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let completed = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done || controller.signal.aborted) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n').filter(line => line.trim());

        for (const line of lines) {
          try {
            const data = JSON.parse(line);
            if (data.completed !== undefined) {
              completed = data.completed;
              onProgress(completed);
            }
          } catch (e) {
            // Skip invalid JSON lines
          }
        }
      }

      return completed;
    } catch (error: any) {
      if (error.name === 'AbortError') throw error;
      console.warn('Streaming batch failed, using fallback:', error);
      return processBatchFallback(dates, controller, onProgress);
    }
  };

  // Fallback batch processing
  const processBatchFallback = async (dates: string[], controller: AbortController, onProgress: (completed: number, currentDate?: string) => void) => {
    const BATCH_SIZE = 2;
    const DELAY_BETWEEN_BATCHES = 100;
    let completed = 0;
    
    for (let i = 0; i < dates.length; i += BATCH_SIZE) {
      if (controller.signal.aborted) break;
      
      const batch = dates.slice(i, i + BATCH_SIZE);
      const batchPromises = batch.map(async (date) => {
        try {
          const response = await fetch(`/api/analysis/date/${date}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ 
              forceReanalysis: false,
              aiProvider: 'openai'
            }),
            signal: controller.signal
          });
          
          if (!response.ok) {
            throw new Error(`Failed to analyze ${date}`);
          }
          
          return { date, success: true };
        } catch (error: any) {
          if (error.name === 'AbortError') throw error;
          console.error(`Failed to analyze ${date}:`, error);
          return { date, success: false, error };
        }
      });
      
      try {
        const results = await Promise.allSettled(batchPromises);
        completed += results.length;
        onProgress(completed);
        
        if (i + BATCH_SIZE < dates.length) {
          await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_BATCHES));
        }
      } catch (error: any) {
        if (error.name === 'AbortError') break;
      }
    }
    
    return completed;
  };

  const getYearStatus = () => {
    if (isLoading) return { label: "Loading...", variant: "secondary" as const };
    if (!progress) return { label: "No Data", variant: "secondary" as const };
    
    if (isCurrentYear) return { label: "Current", variant: "default" as const };
    if (progress.percentage === 100) return { label: "Complete", variant: "secondary" as const };
    if (progress.percentage >= 90) return { label: `${progress.percentage}%`, variant: "secondary" as const };
    if (progress.percentage >= 50) return { label: `${progress.percentage}%`, variant: "outline" as const };
    return { label: `${progress.percentage}%`, variant: "destructive" as const };
  };



  const getProgressColor = () => {
    if (!progress) return "bg-slate-400";
    if (progress.percentage === 100) return "bg-emerald-500";
    if (progress.percentage >= 90) return "bg-blue-500";
    if (progress.percentage >= 50) return "bg-amber-500";
    return "bg-red-400";
  };

  const status = getYearStatus();

  if (isLoading) {
    return (
      <Card className="cursor-pointer hover:shadow-md transition-all animate-pulse">
        <CardContent className="p-4">
          <div className="h-24 bg-slate-200 rounded"></div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className={`rounded-xl border shadow-sm ${
      isCurrentYear 
        ? "bg-gradient-to-br from-blue-50 to-indigo-50 border-2 border-blue-200" 
        : "bg-white border-slate-200"
    }`}>
      {/* Year Header - Full Width */}
      <div className="p-6 border-b border-slate-100">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-2xl font-bold text-slate-900">{year}</h2>
          <div className="flex items-center space-x-4">
            <div className="text-right">
              <p className="text-lg font-semibold text-slate-900">
                {progress?.analyzedDays || 0} / {progress?.totalDays || 0} days
              </p>
            </div>
            <Badge variant={status.variant} className="px-3 py-1 text-sm font-medium">
              {status.label}
            </Badge>
          </div>
        </div>
        
        {/* Year Analysis Buttons */}
        <TooltipProvider>
          <div className="flex justify-end gap-2">
            {activeAnalysis ? (
              <div className="flex items-center space-x-3">
                <div className="text-sm text-slate-600">
                  Analyzing {activeAnalysis.completed} / {activeAnalysis.total} days
                  {activeAnalysis.currentDate && (
                    <div className="text-xs text-slate-500">Current: {activeAnalysis.currentDate}</div>
                  )}
                </div>
                <Badge variant="secondary" className="text-xs">
                  Running in background
                </Badge>
              </div>
            ) : (
              <>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      onClick={startYearAnalysis}
                      variant="outline"
                      size="sm"
                      className="flex items-center space-x-2 hover:bg-blue-50 hover:border-blue-300"
                      disabled={year > currentYear}
                    >
                      <PlayCircle className="h-4 w-4" />
                      <span>Analyze Year</span>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Fetch and analyze Bitcoin news for all 365 days in {year}</p>
                  </TooltipContent>
                </Tooltip>
              </>
            )}
          </div>
        </TooltipProvider>

      </div>
      
      {/* Months Grid - Larger Cards */}
      <div className="p-6">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-4">
          {Array.from({ length: 12 }, (_, i) => i + 1).map((month) => (
            <MonthCard key={month} year={year} month={month} />
          ))}
        </div>
      </div>
    </div>
  );
}
