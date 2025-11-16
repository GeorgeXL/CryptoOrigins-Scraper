import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { FlagButton } from "@/components/FlagButton";

import { useToast } from "@/hooks/use-toast";
import { useAiProvider } from "@/hooks/useAiProvider";
import { useGlobalAnalysis } from "@/contexts/GlobalAnalysisContext";


import { queryClient, apiRequest } from "@/lib/queryClient";
import { 
  ArrowLeft, 
  Wand2, 
  Play, 
  Edit, 
  Trash2,
  Calendar,
  CheckCircle,
  Bot,
  User,
  RefreshCw,
  Sprout, 
  TrendingUp, 
  AlertTriangle, 
  Coins, 
  Snowflake, 
  Building, 
  Rocket, 
  Star,
  ChevronLeft,
  ChevronRight,
  Square,
  Loader2,
  ExternalLink,
  Sparkles
} from "lucide-react";
import { SiGoogle } from "react-icons/si";

interface MonthData {
  progress: {
    totalDays: number;
    analyzedDays: number;
    percentage: number;
  };
  analyses: Array<{
    date: string;
    summary: string;

    hasManualEntry: boolean;
    confidenceScore: number;
    isFlagged?: boolean;
    flagReason?: string;
    isManualOverride?: boolean;
    tieredArticles?: any;
    analyzedArticles?: any;
  }>;
  monthlyBreakdown: Array<{
    month: number;
    analyzedDays: number;
    totalDays: number;
    percentage: number;
  }>;
}

export default function MonthView() {
  const { year, month } = useParams();
  const { toast } = useToast();

  const [selectedDates, setSelectedDates] = useState<Set<string>>(new Set());
  const { aiProvider } = useAiProvider();
  const { startAnalysis, updateProgress, completeAnalysis, getAnalysisById } = useGlobalAnalysis();

  // Safety check for route parameters
  if (!year || !month) {
    return (
      <div className="p-6 text-center">
        <h1 className="text-xl font-semibold text-red-600">Invalid Route</h1>
        <p className="text-slate-600">Year and month parameters are required.</p>
        <Link href="/">
          <Button className="mt-4">Return Home</Button>
        </Link>
      </div>
    );
  }

  // Validate year and month values
  const yearNum = parseInt(year);
  const monthNum = parseInt(month);
  
  if (isNaN(yearNum) || isNaN(monthNum) || monthNum < 1 || monthNum > 12) {
    return (
      <div className="p-6 text-center">
        <h1 className="text-xl font-semibold text-red-600">Invalid Date</h1>
        <p className="text-slate-600">Please provide valid year and month values.</p>
        <Link href="/">
          <Button className="mt-4">Return Home</Button>
        </Link>
      </div>
    );
  }
  // Check if this month has an active analysis
  const analysisId = `month-${year}-${month}`;
  const activeAnalysis = getAnalysisById(analysisId);
  
  const [currentAnalyzingDates, setCurrentAnalyzingDates] = useState<Set<string>>(new Set());
  // Force UI re-render on progress updates to ensure the counter updates in real-time
  const [progressTick, setProgressTick] = useState(0);
  
  // Quality check state
  const [qualityIssues, setQualityIssues] = useState<Map<string, any[]>>(new Map());
  const [qualityCheckRunning, setQualityCheckRunning] = useState(false);
  const [affectedDates, setAffectedDates] = useState<Set<string>>(new Set());
  const [qualityResults, setQualityResults] = useState<any>(null);

  // Google check state
  const [googleCheckRunning, setGoogleCheckRunning] = useState(false);
  const [googleResults, setGoogleResults] = useState<any>(null);
  const [googleAffectedDates, setGoogleAffectedDates] = useState<Set<string>>(new Set());
  const [showEarlyYearWarning, setShowEarlyYearWarning] = useState(false);
  
  const { data: monthData, isLoading } = useQuery<MonthData>({
    queryKey: [`/api/analysis/year/${year}`],
  });

  // Auto fetch mutation
  const autoFetchMutation = useMutation({
    mutationFn: async (date: string) => {
      const response = await fetch(`/api/analysis/analyze`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ 
          date, 
          aiProvider,
          newsProvider: localStorage.getItem('newsProvider') || 'exa'
        }),
      });
      if (!response.ok) {
        throw new Error(`Failed to analyze: ${response.statusText}`);
      }
      return response.json();
    },
    onSuccess: (data) => {
      const dateStr = data.analysisDate || 'Unknown date';
      const formattedDate = new Date(dateStr).toLocaleDateString('en-US', { 
        month: 'long', 
        day: 'numeric', 
        year: 'numeric' 
      });
      toast({
        title: "Analysis completed",
        description: `Bitcoin news analysis for ${formattedDate} has been generated successfully.`,
      });
      queryClient.invalidateQueries({ queryKey: [`/api/analysis/year/${year}`] });
    },
    onError: (error: any) => {
      toast({
        title: "Analysis failed",
        description: error.message || "Failed to analyze Bitcoin news for this date.",
        variant: "destructive",
      });
    },
  });

  // Handle checkbox selections
  const handleDateSelection = (date: string, checked: boolean) => {
    const newSelected = new Set(selectedDates);
    if (checked) {
      newSelected.add(date);
    } else {
      newSelected.delete(date);
    }
    setSelectedDates(newSelected);
  };

  const handleSelectAll = () => {
    if (selectedDates.size === generateDatesForMonth(parseInt(year!), parseInt(month!)).length) {
      setSelectedDates(new Set());
    } else {
      setSelectedDates(new Set(generateDatesForMonth(parseInt(year!), parseInt(month!))));
    }
  };

  // Bulk delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (dates: string[]) => {
      const deletePromises = dates.map(date => 
        fetch(`/api/analysis/date/${date}`, { method: 'DELETE' })
      );
      await Promise.all(deletePromises);
    },
    onSuccess: () => {
      toast({ title: "Success", description: "Selected analyses deleted successfully." });
      setSelectedDates(new Set());
      queryClient.invalidateQueries({ queryKey: [`/api/analysis/year/${year}`] });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to delete some analyses.", variant: "destructive" });
    },
  });

  // Bulk recreate mutation  
  const recreateMutation = useMutation({
    mutationFn: async (dates: string[]) => {
      const recreatePromises = dates.map(date => 
        fetch(`/api/analysis/analyze`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ date, forceReanalysis: true }),
        })
      );
      await Promise.all(recreatePromises);
    },
    onSuccess: () => {
      toast({ title: "Success", description: "Selected analyses recreated successfully." });
      setSelectedDates(new Set());
      queryClient.invalidateQueries({ queryKey: [`/api/analysis/year/${year}`] });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to recreate some analyses.", variant: "destructive" });
    },
  });

  // Navigation helpers
  const getPreviousMonth = () => {
    const currentMonth = parseInt(month!);
    const currentYear = parseInt(year!);
    
    if (currentMonth === 1) {
      return { year: currentYear - 1, month: 12 };
    } else {
      return { year: currentYear, month: currentMonth - 1 };
    }
  };

  const getNextMonth = () => {
    const currentMonth = parseInt(month!);
    const currentYear = parseInt(year!);
    
    if (currentMonth === 12) {
      return { year: currentYear + 1, month: 1 };
    } else {
      return { year: currentYear, month: currentMonth + 1 };
    }
  };

  // Streaming batch processing for maximum speed with proper JSON buffer handling
  const processStreamingBatch = async (dates: string[], controller: AbortController, onProgress: (completed: number, currentDate?: string) => void) => {
    try {
      const response = await fetch('/api/analysis/batch-analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          dates, 
          concurrency: 2, // FIXED: Process 2 dates concurrently to prevent article bleeding
          aiProvider,
          newsProvider: localStorage.getItem('newsProvider') || 'exa'
        }),
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(`Batch analysis failed: ${response.statusText}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('Response body is not readable');
      }

      const decoder = new TextDecoder();
      let completed = 0;
      const currentlyAnalyzing = new Set<string>();
      let jsonBuffer = ''; // Buffer to accumulate partial JSON objects

      while (true) {
        if (controller.signal.aborted) {
          reader.cancel();
          break;
        }

        const { done, value } = await reader.read();
        if (done) break;

        // Decode the chunk and add it to our buffer
        const chunk = decoder.decode(value, { stream: true });
        jsonBuffer += chunk;

        // Split buffer by newlines and process complete JSON objects
        const lines = jsonBuffer.split('\n');
        
        // Keep the last line in the buffer (might be partial)
        jsonBuffer = lines.pop() || '';
        
        // Process complete lines (those that ended with \n)
        for (const line of lines) {
          try {
            // Skip empty lines
            if (!line || line.trim().length === 0) continue;
            
            console.log('🔄 Parsing JSON line:', line.substring(0, 100) + (line.length > 100 ? '...' : ''));
            const data = JSON.parse(line);
            
            // Validate data structure before using it
            if (!data || typeof data !== 'object') continue;
            
            if (data.completed === true) {
              // Final result
              console.log('✅ Batch analysis complete:', data.summary);
              setCurrentAnalyzingDates(new Set());
              return data.results?.length || completed;
            } else if (typeof data.completed === 'number' && data.completed >= 0) {
              // Progress update - validate completed is a valid number
              completed = data.completed;
              console.log(`📊 Progress update: ${completed} completed`);
              
              // Handle concurrent analyzing dates
              if (data.analyzingDates && Array.isArray(data.analyzingDates)) {
                console.log(`📊 Currently analyzing: ${data.analyzingDates.join(', ')}`);
                setCurrentAnalyzingDates(new Set(data.analyzingDates));
              } else if (data.lastResult?.date) {
                // Remove completed date from analyzing set
                currentlyAnalyzing.delete(data.lastResult.date);
                console.log(`✅ Completed: ${data.lastResult.date}`);
                setCurrentAnalyzingDates(new Set(currentlyAnalyzing));
              }
              
              // This is the critical call that updates the progress counter
              console.log(`🚀 Calling onProgress(${completed}, ${data.lastResult?.date})`);
              onProgress(completed, data.lastResult?.date);
              
              // Update cache every few completions for better UX
              if (completed > 0 && completed % 3 === 0) {
                queryClient.invalidateQueries({ queryKey: [`/api/analysis/year/${year}`] });
              }
            }
          } catch (parseError) {
            // Enhanced error logging for debugging
            console.error('❌ JSON parse error:', parseError);
            console.error('❌ Failed line:', line);
            if (import.meta.env.MODE === 'development') {
              console.warn('Failed to parse streaming response:', parseError);
            }
          }
        }
      }

      // Process any remaining complete JSON in the buffer
      if (jsonBuffer.trim()) {
        try {
          const data = JSON.parse(jsonBuffer.trim());
          if (data && typeof data === 'object' && typeof data.completed === 'number') {
            onProgress(data.completed, data.lastResult?.date);
          }
        } catch (parseError) {
          console.warn('Failed to parse final buffer:', parseError);
        }
      }

      return completed;
    } catch (error: any) {
      if (error.name === 'AbortError') {
        throw error;
      }
      
      // Fallback to original batch processing if streaming fails
      console.warn('Streaming batch failed, falling back to traditional method:', error);
      return processBatchFallback(dates, controller, onProgress);
    }
  };

  // FIXED: Fallback batch processing with safer concurrency
  const processBatchFallback = async (dates: string[], controller: AbortController, onProgress: (completed: number, currentDate?: string) => void) => {
    const BATCH_SIZE = 2; // FIXED: Reduced from 3 to 2 to prevent article bleeding
    const DELAY_BETWEEN_BATCHES = 100; // FIXED: Add small delay to respect rate limits
    
    let completed = 0;
    
    for (let i = 0; i < dates.length; i += BATCH_SIZE) {
      if (controller.signal.aborted) break;
      
      const batch = dates.slice(i, i + BATCH_SIZE);
      
      // Add all dates in this batch to the analyzing set
      setCurrentAnalyzingDates(prev => new Set([...prev, ...batch]));
      
      // Process each date in the batch with proper loading state management
      const batchPromises = batch.map(async (date) => {
        try {
          const response = await fetch(`/api/analysis/analyze`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ 
              date, 
              aiProvider,
              newsProvider: localStorage.getItem('newsProvider') || 'exa'
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
        } finally {
          // Remove this date from the analyzing set when done
          setCurrentAnalyzingDates(prev => {
            const newSet = new Set(prev);
            newSet.delete(date);
            return newSet;
          });
        }
      });
      
      try {
        const results = await Promise.allSettled(batchPromises);
        
        // Update progress after batch completion
        completed += results.length;
        onProgress(completed);
        
        // FIXED: Add delay between batches to respect rate limits
        if (i + BATCH_SIZE < dates.length) {
          await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_BATCHES));
        }
      } catch (error: any) {
        if (error.name === 'AbortError') break;
      }
    }
    
    return completed;
  };

  // Bulk analysis functions
  const startBulkAnalysis = async () => {
    // If dates are selected via checkboxes, analyze those; otherwise analyze all unanalyzed dates
    const targetDates = selectedDates.size > 0 
      ? Array.from(selectedDates)
      : generateDatesForMonth(parseInt(year!), parseInt(month!))
          .filter(date => !getAnalysisForDate(date));
    
    if (targetDates.length === 0) {
      const message = selectedDates.size > 0 
        ? "No selected dates need analysis."
        : "All days in this month are already analyzed.";
      toast({ title: "No work needed", description: message });
      return;
    }

    const controller = new AbortController();
    const targetName = selectedDates.size > 0 ? "selected dates" : `${monthNames[parseInt(month!) - 1]} ${year}`;
    
    // Register with global analysis tracker
    startAnalysis({
      id: analysisId,
      type: 'month',
      label: `Analyze ${targetName}`,
      completed: 0,
      total: targetDates.length,
      year: parseInt(year!),
      month: parseInt(month!),
      abortController: controller
    });

    setCurrentAnalyzingDates(new Set());

    try {
      const completed = await processStreamingBatch(targetDates, controller, (progress, currentDate) => {
        // Update the global progress counter
        updateProgress(analysisId, progress, currentDate);
        // Force a re-render to avoid any batching delaying UI updates
        setProgressTick((t) => t + 1);
        // Note: Individual date tracking is now handled within the streaming batch function
      });

      if (!controller.signal.aborted) {
        const analysisType = selectedDates.size > 0 ? "selected dates" : "days";
        toast({ 
          title: "⚡ Fast batch analysis complete", 
          description: `Successfully analyzed ${completed} ${analysisType} using streaming concurrency (3x faster).` 
        });
        // Clear selected dates after successful analysis
        if (selectedDates.size > 0) {
          setSelectedDates(new Set());
        }
      }
    } catch (error: any) {
      if (error.name !== 'AbortError') {
        toast({ title: "Error", description: "Bulk analysis failed.", variant: "destructive" });
      }
    } finally {
      completeAnalysis(analysisId);
      setCurrentAnalyzingDates(new Set());
      queryClient.invalidateQueries({ queryKey: [`/api/analysis/year/${year}`] });
    }
  };

  const stopBulkAnalysis = () => {
    // Stop analysis through global context - no longer need local state
    setCurrentAnalyzingDates(new Set());
  };

  // Start cleanup analysis for duplicates
  const startCleanupAnalysis = async () => {
    try {
      const response = await apiRequest('POST', `/api/conflicts/analyze-month/${year}/${month}`);
      const result = await response.json();

      if (result.success) {
        toast({
          title: "Cleanup started",
          description: `Analyzing ${year}-${month} for duplicate events...`,
        });
      }
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to start cleanup analysis",
      });
    }
  };

  // Handle individual day click - analyze if no data exists, navigate if data exists
  const handleIndividualDayClick = async (date: string, isAnalyzed: boolean) => {
    console.log(`🔄 [Individual Day] Clicked ${date}, isAnalyzed: ${isAnalyzed}`);
    
    if (isAnalyzed) {
      // If already analyzed, navigate to day view
      console.log(`📍 [Individual Day] Navigating to analyzed day: ${date}`);
      window.location.href = `/day/${date}?from=month`;
    } else {
      // If not analyzed, trigger analysis with loading animation
      console.log(`📊 [Individual Day] Starting analysis for ${date}`);
      setCurrentAnalyzingDates(prev => {
        const newSet = new Set([...prev, date]);
        console.log(`🔄 [Individual Day] Updated analyzing dates:`, Array.from(newSet));
        return newSet;
      });
      
      try {
        const response = await fetch(`/api/analysis/date/${date}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            forceReanalysis: false,
            aiProvider: 'openai',
            newsProvider: localStorage.getItem('newsProvider') || 'exa'
          }),
        });

        if (response.ok) {
          // Analysis completed successfully, refresh data and wait for cache update
          await queryClient.invalidateQueries({ queryKey: [`/api/analysis/year/${year}`] });
          await queryClient.refetchQueries({ queryKey: [`/api/analysis/year/${year}`] });
          toast({ title: "Success", description: `Analysis completed for ${formatDate(date)}` });
        } else {
          throw new Error('Analysis failed');
        }
      } catch (error) {
        console.error('Individual day analysis error:', error);
        toast({ 
          title: "Error", 
          description: `Failed to analyze ${formatDate(date)}`, 
          variant: "destructive" 
        });
      } finally {
        // Remove from analyzing set
        console.log(`✅ [Individual Day] Completed analysis for ${date}`);
        setCurrentAnalyzingDates(prev => {
          const newSet = new Set(prev);
          newSet.delete(date);
          console.log(`🔄 [Individual Day] Removed ${date} from analyzing dates:`, Array.from(newSet));
          return newSet;
        });
      }
    }
  };

  const getYearPeriod = (year: number) => {
    if (year <= 2010) return { icon: Sprout, text: "Early Era", color: "text-green-500" };
    if (year <= 2013) return { icon: TrendingUp, text: "First Bubble", color: "text-blue-500" };
    if (year <= 2015) return { icon: AlertTriangle, text: "Mt. Gox Crisis", color: "text-red-500" };
    if (year <= 2017) return { icon: Coins, text: "Altcoin Era", color: "text-yellow-500" };
    if (year <= 2020) return { icon: Snowflake, text: "Crypto Winter", color: "text-cyan-500" };
    if (year <= 2022) return { icon: Building, text: "Institutional", color: "text-indigo-500" };
    if (year <= 2023) return { icon: Rocket, text: "DeFi/NFT", color: "text-purple-500" };
    return { icon: Star, text: "ETF Era", color: "text-amber-500" };
  };

  const getMonthName = (monthNum: number) => {
    const months = [
      "January", "February", "March", "April", "May", "June",
      "July", "August", "September", "October", "November", "December"
    ];
    return months[monthNum - 1];
  };

  const generateDatesForMonth = (year: number, month: number) => {
    const dates = [];
    const daysInMonth = new Date(year, month, 0).getDate();
    for (let day = 1; day <= daysInMonth; day++) {
      const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      dates.push(date);
    }
    return dates;
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.getDate().toString();
  };

  const getAnalysisForDate = (date: string) => {
    if (!monthData?.analyses || !Array.isArray(monthData.analyses)) {
      return null;
    }
    return monthData.analyses.find(analysis => analysis?.date === date) || null;
  };

  // Quality check function
  const checkSummaryQuality = async () => {
    if (!monthData?.analyses || monthData.analyses.length === 0) {
      toast({
        title: "No data to check",
        description: "No analyses available for quality checking.",
        variant: "destructive",
      });
      return;
    }

    // 🔧 FIX: Filter analyses to only the current month being viewed
    const currentMonthPrefix = `${year}-${String(monthNum).padStart(2, '0')}`;
    const currentMonthAnalyses = monthData.analyses.filter(analysis => 
      analysis.date.startsWith(currentMonthPrefix)
    );

    if (currentMonthAnalyses.length === 0) {
      toast({
        title: "No data for this month",
        description: `No analyses available for ${year}-${String(monthNum).padStart(2, '0')}.`,
        variant: "destructive",
      });
      return;
    }

    setQualityCheckRunning(true);
    setQualityIssues(new Map());
    setAffectedDates(new Set());
    setQualityResults(null);

    try {
      console.log(`🔍 Quality check: Filtering to ${currentMonthAnalyses.length} analyses for ${currentMonthPrefix}`);
      
      const response = await fetch('/api/analysis/check-quality', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          analyses: currentMonthAnalyses.map(analysis => ({
            analysisDate: analysis.date,
            summary: analysis.summary,
            tieredArticles: analysis.tieredArticles,
            analyzedArticles: analysis.analyzedArticles
          }))
        }),
      });

      if (!response.ok) {
        throw new Error(`Quality check failed: ${response.statusText}`);
      }

      const results = await response.json();
      
      // Convert Map to regular object for state
      const qualityIssuesMap = new Map();
      for (const [date, issues] of Object.entries(results.qualityIssues)) {
        qualityIssuesMap.set(date, issues);
      }
      
      setQualityIssues(qualityIssuesMap);
      setAffectedDates(new Set(results.affectedDates));
      setQualityResults(results);

      const totalIssues = results.totalIssues;
      const affectedCount = results.affectedDates.length;
      
      toast({
        title: "Quality check complete",
        description: `Found ${totalIssues} issues across ${affectedCount} dates.`,
        variant: totalIssues > 0 ? "destructive" : "default",
      });
    } catch (error: any) {
      console.error('Quality check error:', error);
      toast({
        title: "Quality check failed",
        description: error.message || "Failed to check summary quality.",
        variant: "destructive",
      });
    } finally {
      setQualityCheckRunning(false);
    }
  };

  // Helper function to get quality issues for a specific date
  const getQualityIssues = (date: string) => {
    return qualityIssues.get(date) || [];
  };

  // Google verification function
  const checkGoogleAccuracy = async () => {
    if (!monthData?.analyses || monthData.analyses.length === 0) {
      toast({
        title: "No data to verify",
        description: "No analyses available for Google verification.",
        variant: "destructive",
      });
      return;
    }

    // Check if this is an early Bitcoin year (2009-2012) and show warning
    const currentYear = parseInt(year!);
    if (currentYear >= 2009 && currentYear <= 2012) {
      setShowEarlyYearWarning(true);
      return;
    }

    // If not an early year, proceed directly
    await performGoogleCheck();
  };

  // Actual Google verification logic
  const performGoogleCheck = async () => {

    if (!monthData?.analyses || monthData.analyses.length === 0) {
      toast({
        title: "No data to verify",
        description: "No analyses available for Google verification.",
        variant: "destructive",
      });
      return;
    }

    setGoogleCheckRunning(true);
    const isSelection = selectedDates.size > 0;
    const currentMonthPrefix = `${year}-${month?.padStart(2, '0')}`;
    
    try {
      let analysesToCheck = monthData.analyses;
      
      if (isSelection) {
        analysesToCheck = monthData.analyses.filter(analysis => 
          selectedDates.has(analysis.date)
        );
        console.log(`🔍 Google Check: Using selected dates (${analysesToCheck.length} selected)`);
      } else {
        analysesToCheck = monthData.analyses.filter(analysis => 
          analysis.date.startsWith(currentMonthPrefix)
        );
        console.log(`🔍 Google Check: Filtering to ${analysesToCheck.length} analyses for ${currentMonthPrefix}`);
      }
      
      const response = await fetch('/api/analysis/google-check-month', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          analyses: analysesToCheck.map(analysis => ({
            analysisDate: analysis.date,
            summary: analysis.summary
          }))
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to verify summaries with Google');
      }

      const results = await response.json();
      
      console.log(`🎯 Google Check completed: ${results.validDays} valid, ${results.incorrectDays} incorrect, ${results.cannotVerifyDays} cannot verify`);
      
      setGoogleResults(results);
      setGoogleAffectedDates(new Set(results.affectedDates));

      toast({
        title: "Google verification completed",
        description: `${results.validDays} valid, ${results.incorrectDays} incorrect, ${results.cannotVerifyDays} cannot verify`,
      });

    } catch (error: any) {
      console.error('Google verification error:', error);
      toast({
        title: "Google verification failed",
        description: error.message || "Failed to verify summaries with Google.",
        variant: "destructive",
      });
    } finally {
      setGoogleCheckRunning(false);
    }
  };

  // Helper function to get Google verification result for a specific date
  const getGoogleVerification = (date: string) => {
    return googleResults?.results?.[date]?.assessment;
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="animate-pulse">
          <div className="h-8 bg-slate-200 rounded w-64 mb-4"></div>
          <div className="h-4 bg-slate-200 rounded w-96"></div>
        </div>
      </div>
    );
  }

  if (!monthData) {
    return (
      <div className="text-center py-12">
        <p className="text-slate-500">No data available for this year.</p>
      </div>
    );
  }

  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  const currentMonthData = monthData.monthlyBreakdown[parseInt(month!) - 1];
  const monthName = monthNames[parseInt(month!) - 1];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <Link href="/">
            <Button variant="outline" size="sm">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Timeline
            </Button>
          </Link>
          
          {/* Month Navigation */}
          <div className="flex items-center space-x-2">
            <Link href={`/month/${getPreviousMonth().year}/${getPreviousMonth().month}`}>
              <Button variant="outline" size="sm">
                <ChevronLeft className="w-4 h-4" />
              </Button>
            </Link>
            <Link href={`/month/${getNextMonth().year}/${getNextMonth().month}`}>
              <Button variant="outline" size="sm">
                <ChevronRight className="w-4 h-4" />
              </Button>
            </Link>
          </div>
          
          <div>
            <h1 className="text-2xl font-bold text-slate-900">
              {monthName} {year}
            </h1>

          </div>
        </div>
        
        <div className="flex items-center space-x-3">
          {/* Bulk Analysis Button */}
          {!activeAnalysis ? (
            <>
              <Button 
                variant="default" 
                size="sm"
                onClick={startBulkAnalysis}
                disabled={!monthData || (currentMonthData?.totalDays === currentMonthData?.analyzedDays)}
                data-testid="button-analyze-month"
              >
                <Play className="w-4 h-4 mr-2" />
                {selectedDates.size > 0 ? 'Analyze Selected' : 'Analyze Month'}
              </Button>
              
              {/* Time to Clean Button */}
              <Button 
                variant="outline" 
                size="sm"
                onClick={startCleanupAnalysis}
                disabled={!monthData || (currentMonthData?.analyzedDays === 0)}
                data-testid="button-time-to-clean"
              >
                <Sparkles className="w-4 h-4 mr-2" />
                Time to Clean
              </Button>
            </>
          ) : (
            <div className="flex items-center space-x-3">
              <div className="flex items-center space-x-2">
                <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
                <div className="text-sm">
                  <span className="font-medium text-slate-900">{activeAnalysis?.completed || 0}/{activeAnalysis?.total || 0}</span>
                  {currentAnalyzingDates.size > 0 && (
                    <span className="text-slate-600 ml-2">
                      Analyzing {currentAnalyzingDates.size} date{currentAnalyzingDates.size !== 1 ? 's' : ''}
                    </span>
                  )}
                </div>
              </div>
              <Button 
                variant="outline" 
                size="sm"
                onClick={stopBulkAnalysis}
              >
                <Square className="w-4 h-4 mr-2" />
                Stop
              </Button>
            </div>
          )}
          
          {/* Quality Check Button */}
          {monthData && monthData.analyses && monthData.analyses.length > 0 && (
            <Button 
              variant="outline" 
              size="sm"
              onClick={checkSummaryQuality}
              disabled={qualityCheckRunning}
            >
              {qualityCheckRunning ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Checking Quality...
                </>
              ) : (
                <>
                  <AlertTriangle className="w-4 h-4 mr-2" />
                  Check Quality
                </>
              )}
            </Button>
          )}

          {/* Google Check Button */}
          {monthData && monthData.analyses && monthData.analyses.length > 0 && (
            <Button 
              variant="outline" 
              size="sm"
              onClick={checkGoogleAccuracy}
              disabled={googleCheckRunning}
            >
              {googleCheckRunning ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Google Checking...
                </>
              ) : (
                <>
                  <SiGoogle className="w-4 h-4 mr-2" />
                  Google Check
                </>
              )}
            </Button>
          )}

          {selectedDates.size > 0 && (
            <>
              <Button 
                variant="destructive" 
                size="sm"
                onClick={() => deleteMutation.mutate(Array.from(selectedDates))}
                disabled={deleteMutation.isPending}
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Delete Selected ({selectedDates.size})
              </Button>
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => recreateMutation.mutate(Array.from(selectedDates))}
                disabled={recreateMutation.isPending}
              >
                <RefreshCw className="w-4 h-4 mr-2" />
                Recreate Selected ({selectedDates.size})
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Month Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-slate-600">Total Days</p>
                <p className="text-2xl font-bold text-slate-900">{currentMonthData?.totalDays || 0}</p>
              </div>
              <Calendar className="w-8 h-8 text-blue-600" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-slate-600">Analyzed</p>
                <p className="text-2xl font-bold text-slate-900">{currentMonthData?.analyzedDays || 0}</p>
              </div>
              <CheckCircle className="w-8 h-8 text-emerald-600" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-slate-600">Progress</p>
                <p className="text-2xl font-bold text-slate-900">{currentMonthData?.percentage || 0}%</p>
              </div>
              <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center">
                <span className="text-blue-600 text-sm font-bold">%</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Historical Period Banner */}
      {(() => {
        const period = getYearPeriod(parseInt(year!));
        const PeriodIcon = period.icon;
        return (
          <Card className="bg-gradient-to-r from-slate-50 to-slate-100 border-slate-200">
            <CardContent className="p-4">
              <div className="flex items-center space-x-3">
                <PeriodIcon className={`w-6 h-6 ${period.color}`} />
                <div>
                  <h3 className="font-semibold text-slate-900">{period.text}</h3>
                  <p className="text-sm text-slate-600">Bitcoin Historical Period for {year}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })()}

      {/* Monthly Analysis */}
      <Card>
        <CardHeader>
          <CardTitle>Monthly Analysis</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
                {/* Select All Header */}
                <div className="flex items-center p-3 border-b border-slate-200 bg-slate-50 rounded-t-lg">
                  <Checkbox
                    checked={selectedDates.size === generateDatesForMonth(parseInt(year!), parseInt(month!)).length}
                    onCheckedChange={handleSelectAll}
                    className="mr-3"
                  />
                  <span className="text-sm font-medium text-slate-700">
                    Select All ({selectedDates.size} selected)
                  </span>
                </div>
                
                {generateDatesForMonth(parseInt(year!), parseInt(month!)).map((date) => {
                  const analysis = getAnalysisForDate(date);
                  const isAnalyzed = !!analysis;
                  const isCurrentlyAnalyzing = currentAnalyzingDates.has(date);
                  
                  
                  const hasQualityIssues = affectedDates.has(date);
                  const googleVerification = getGoogleVerification(date);
                  
                  return (
                    <div key={date} className={`flex items-center p-3 border rounded-lg transition-colors ${
                      isCurrentlyAnalyzing 
                        ? 'border-amber-300 bg-amber-50' 
                        : hasQualityIssues
                        ? 'border-red-300 bg-red-50'
                        : 'border-slate-200 hover:bg-slate-50'
                    }`}>
                      <Checkbox
                        checked={selectedDates.has(date)}
                        onCheckedChange={(checked) => handleDateSelection(date, checked as boolean)}
                        className="mr-3"
                        onClick={(e) => e.stopPropagation()}
                        disabled={isCurrentlyAnalyzing}
                      />
                      <div className="flex items-center space-x-4 flex-1">
                        <div 
                          className={`flex items-center space-x-4 flex-1 cursor-pointer ${isCurrentlyAnalyzing ? 'pointer-events-none' : ''}`}
                          onClick={() => handleIndividualDayClick(date, isAnalyzed)}
                        >
                          <div className="w-16 text-sm font-medium text-slate-900">
                            {formatDate(date)}
                          </div>
                          <div className="flex-1">
                            {isCurrentlyAnalyzing ? (
                              <div className="flex items-center space-x-2">
                                <Loader2 className="w-4 h-4 animate-spin text-amber-600" />
                                <p className="text-sm text-amber-700 font-medium">Analyzing Bitcoin news...</p>
                                <div className="flex space-x-1">
                                  <div className="w-2 h-2 bg-amber-400 rounded-full animate-pulse"></div>
                                  <div className="w-2 h-2 bg-amber-400 rounded-full animate-pulse" style={{animationDelay: '0.2s'}}></div>
                                  <div className="w-2 h-2 bg-amber-400 rounded-full animate-pulse" style={{animationDelay: '0.4s'}}></div>
                                </div>
                              </div>
                            ) : isAnalyzed ? (
                              <div className="space-y-1">
                                <p className="text-sm text-slate-900 font-medium leading-relaxed break-words">
                                  {analysis?.summary || 'No summary available'}
                                </p>
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center space-x-2 flex-wrap">
                                    {/* Manual Import Badge - First badge */}
                                    {analysis?.isManualOverride && (
                                      <Badge variant="secondary" className="text-xs bg-blue-100 text-blue-800">
                                        <User className="w-3 h-3 mr-1" />
                                        Manual Import
                                      </Badge>
                                    )}

                                    <Badge variant="secondary" className="text-xs">
                                      {Math.round(parseFloat(analysis?.confidenceScore?.toString() || '0'))}% confidence
                                    </Badge>

                                    {/* Quality Badges */}
                                    {analysis?.summary && (
                                      <>
                                        {analysis.summary.length < 100 && (
                                          <Badge variant="destructive" className="text-xs">
                                            Too Short ({analysis.summary.length})
                                          </Badge>
                                        )}
                                        {analysis.summary.length > 110 && (
                                          <Badge variant="destructive" className="text-xs">
                                            Too Long ({analysis.summary.length})
                                          </Badge>
                                        )}
                                        {/\.{2,}/.test(analysis.summary) && (
                                          <Badge variant="secondary" className="text-xs bg-orange-100 text-orange-800">
                                            Dots
                                          </Badge>
                                        )}
                                      </>
                                    )}

                                    {analysis?.hasManualEntry && (
                                      <Badge variant="outline" className="text-xs">
                                        <User className="w-3 h-3 mr-1" />
                                        Manual
                                      </Badge>
                                    )}

                                    {/* Google Verification Badge */}
                                    {googleVerification === 'Valid' && (
                                      <Badge variant="default" className="text-xs bg-green-100 text-green-800">
                                        <SiGoogle className="w-3 h-3 mr-1" />
                                        Google ✓
                                      </Badge>
                                    )}
                                    {googleVerification === 'Incorrect' && (
                                      <Badge variant="destructive" className="text-xs">
                                        <SiGoogle className="w-3 h-3 mr-1" />
                                        Google ✗
                                      </Badge>
                                    )}
                                    {googleVerification === 'Cannot Verify' && (
                                      <Badge variant="secondary" className="text-xs bg-yellow-100 text-yellow-800">
                                        <SiGoogle className="w-3 h-3 mr-1" />
                                        Google ?
                                      </Badge>
                                    )}
                                  </div>
                                </div>
                              </div>
                            ) : (
                              <p className="text-sm text-slate-500 italic">No analysis available</p>
                            )}
                          </div>
                        </div>
                        
                        {/* Action buttons outside the main Link */}
                        {isAnalyzed && (
                          <div className="flex items-center space-x-2 flex-shrink-0">
                            <FlagButton
                              date={date}
                              isFlagged={analysis?.isFlagged || false}
                              flagReason={analysis?.flagReason}
                              type="analysis"
                            />
                            <Link href={`/day/${date}?from=month`}>
                              <Button 
                                variant="ghost" 
                                size="sm" 
                                className="p-1 h-6 w-6 hover:bg-orange-100 hover:text-orange-600"
                                title="View day details"
                              >
                                <ExternalLink className="w-3 h-3" />
                              </Button>
                            </Link>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
            </div>
        </CardContent>
      </Card>

      {/* Quality Issues Panel */}
      {qualityResults && qualityResults.totalIssues > 0 && (
        <Card className="border-red-200 bg-red-50">
          <CardHeader>
            <CardTitle className="text-red-800 flex items-center">
              <AlertTriangle className="w-5 h-5 mr-2" />
              Quality Issues Found ({qualityResults.totalIssues})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {/* Summary Stats */}
              <div className="grid grid-cols-3 md:grid-cols-7 gap-4">
                <div className="text-center">
                  <div className="text-2xl font-bold text-red-600">{qualityResults.summary.tooShort}</div>
                  <div className="text-sm text-red-600">Too Short</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-red-600">{qualityResults.summary.tooLong}</div>
                  <div className="text-sm text-red-600">Too Long</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-red-600">{qualityResults.summary.excessiveDots}</div>
                  <div className="text-sm text-red-600">Excessive Dots</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-red-600">{qualityResults.summary.genericFallback}</div>
                  <div className="text-sm text-red-600">Generic Fallback</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-orange-600">{qualityResults.summary.duplicateSummaries || 0}</div>
                  <div className="text-sm text-orange-600">Duplicates</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-yellow-600">{qualityResults.summary.similarSummaries || 0}</div>
                  <div className="text-sm text-yellow-600">Similar</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-red-600">{qualityResults.summary.invalidLinks || 0}</div>
                  <div className="text-sm text-red-600">Invalid Links</div>
                </div>
              </div>

              {/* Issues Grouped by Category */}
              <div className="space-y-4">
                {/* Too Short Issues */}
                {qualityResults.summary.tooShort > 0 && (
                  <div className="space-y-2">
                    <h4 className="font-semibold text-red-800">📏 Too Short ({qualityResults.summary.tooShort} dates):</h4>
                    <div className="space-y-2">
                      {Array.from(affectedDates).map(date => {
                        const issues = getQualityIssues(date);
                        const analysis = getAnalysisForDate(date);
                        const shortIssues = issues.filter(issue => issue.type === 'TOO_SHORT');
                        if (shortIssues.length === 0) return null;
                        return (
                          <div key={`short-${date}`} className="p-3 bg-red-50 border border-red-200 rounded-lg">
                            <div className="flex justify-between items-start">
                              <span className="font-medium text-slate-900">Feb {formatDate(date)}</span>
                              <span className="text-xs text-red-600">{shortIssues[0]?.message}</span>
                            </div>
                            <div className="text-sm text-slate-600 mt-1">
                              "{analysis?.summary || 'No summary'}"
                            </div>
                          </div>
                        );
                      }).filter(Boolean)}
                    </div>
                  </div>
                )}

                {/* Too Long Issues */}
                {qualityResults.summary.tooLong > 0 && (
                  <div className="space-y-2">
                    <h4 className="font-semibold text-red-800">📏 Too Long ({qualityResults.summary.tooLong} dates):</h4>
                    <div className="space-y-2">
                      {Array.from(affectedDates).map(date => {
                        const issues = getQualityIssues(date);
                        const analysis = getAnalysisForDate(date);
                        const longIssues = issues.filter(issue => issue.type === 'TOO_LONG');
                        if (longIssues.length === 0) return null;
                        return (
                          <div key={`long-${date}`} className="p-3 bg-red-50 border border-red-200 rounded-lg">
                            <div className="flex justify-between items-start">
                              <span className="font-medium text-slate-900">Feb {formatDate(date)}</span>
                              <span className="text-xs text-red-600">{longIssues[0]?.message}</span>
                            </div>
                            <div className="text-sm text-slate-600 mt-1">
                              "{analysis?.summary || 'No summary'}"
                            </div>
                          </div>
                        );
                      }).filter(Boolean)}
                    </div>
                  </div>
                )}

                {/* Excessive Dots Issues */}
                {qualityResults.summary.excessiveDots > 0 && (
                  <div className="space-y-2">
                    <h4 className="font-semibold text-orange-800">📝 Excessive Dots ({qualityResults.summary.excessiveDots} dates):</h4>
                    <div className="space-y-2">
                      {Array.from(affectedDates).map(date => {
                        const issues = getQualityIssues(date);
                        const analysis = getAnalysisForDate(date);
                        const dotIssues = issues.filter(issue => issue.type === 'EXCESSIVE_DOTS');
                        if (dotIssues.length === 0) return null;
                        return (
                          <div key={`dots-${date}`} className="p-3 bg-orange-50 border border-orange-200 rounded-lg">
                            <div className="flex justify-between items-start">
                              <span className="font-medium text-slate-900">Feb {formatDate(date)}</span>
                              <span className="text-xs text-orange-600">{dotIssues[0]?.message}</span>
                            </div>
                            <div className="text-sm text-slate-600 mt-1">
                              "{analysis?.summary || 'No summary'}"
                            </div>
                          </div>
                        );
                      }).filter(Boolean)}
                    </div>
                  </div>
                )}

                {/* Generic Fallback Issues */}
                {qualityResults.summary.genericFallback > 0 && (
                  <div className="space-y-2">
                    <h4 className="font-semibold text-orange-800">📝 Generic Fallback ({qualityResults.summary.genericFallback} dates):</h4>
                    <div className="space-y-2">
                      {Array.from(affectedDates).map(date => {
                        const issues = getQualityIssues(date);
                        const analysis = getAnalysisForDate(date);
                        const genericIssues = issues.filter(issue => issue.type === 'GENERIC_FALLBACK');
                        if (genericIssues.length === 0) return null;
                        return (
                          <div key={`generic-${date}`} className="p-3 bg-orange-50 border border-orange-200 rounded-lg">
                            <div className="flex justify-between items-start">
                              <span className="font-medium text-slate-900">Feb {formatDate(date)}</span>
                              <span className="text-xs text-orange-600">{genericIssues[0]?.message}</span>
                            </div>
                            <div className="text-sm text-slate-600 mt-1">
                              "{analysis?.summary || 'No summary'}"
                            </div>
                          </div>
                        );
                      }).filter(Boolean)}
                    </div>
                  </div>
                )}

                {/* Repeated Words Issues */}
                {qualityResults.summary.repeatedWords > 0 && (
                  <div className="space-y-2">
                    <h4 className="font-semibold text-yellow-800">📝 Repeated Words ({qualityResults.summary.repeatedWords} dates):</h4>
                    <div className="space-y-2">
                      {Array.from(affectedDates).map(date => {
                        const issues = getQualityIssues(date);
                        const analysis = getAnalysisForDate(date);
                        const repeatedIssues = issues.filter(issue => issue.type === 'REPEATED_WORDS');
                        if (repeatedIssues.length === 0) return null;
                        return (
                          <div key={`repeated-${date}`} className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                            <div className="flex justify-between items-start">
                              <span className="font-medium text-slate-900">Feb {formatDate(date)}</span>
                              <span className="text-xs text-yellow-600">{repeatedIssues[0]?.message}</span>
                            </div>
                            <div className="text-sm text-slate-600 mt-1">
                              "{analysis?.summary || 'No summary'}"
                            </div>
                          </div>
                        );
                      }).filter(Boolean)}
                    </div>
                  </div>
                )}

                {/* Placeholder Text Issues */}
                {qualityResults.summary.placeholderText > 0 && (
                  <div className="space-y-2">
                    <h4 className="font-semibold text-red-800">📝 Placeholder Text ({qualityResults.summary.placeholderText} dates):</h4>
                    <div className="space-y-2">
                      {Array.from(affectedDates).map(date => {
                        const issues = getQualityIssues(date);
                        const analysis = getAnalysisForDate(date);
                        const placeholderIssues = issues.filter(issue => issue.type === 'PLACEHOLDER_TEXT');
                        if (placeholderIssues.length === 0) return null;
                        return (
                          <div key={`placeholder-${date}`} className="p-3 bg-red-50 border border-red-200 rounded-lg">
                            <div className="flex justify-between items-start">
                              <span className="font-medium text-slate-900">Feb {formatDate(date)}</span>
                              <span className="text-xs text-red-600">{placeholderIssues[0]?.message}</span>
                            </div>
                            <div className="text-sm text-slate-600 mt-1">
                              "{analysis?.summary || 'No summary'}"
                            </div>
                          </div>
                        );
                      }).filter(Boolean)}
                    </div>
                  </div>
                )}

                {/* Duplicate Summary Issues */}
                {qualityResults.summary.duplicateSummaries > 0 && (
                  <div className="space-y-2">
                    <h4 className="font-semibold text-orange-800">🔗 Duplicate Summaries ({qualityResults.summary.duplicateSummaries} dates):</h4>
                    <div className="space-y-2">
                      {Array.from(affectedDates).map(date => {
                        const issues = getQualityIssues(date);
                        const analysis = getAnalysisForDate(date);
                        const duplicateIssues = issues.filter(issue => issue.type === 'DUPLICATE_SUMMARY');
                        if (duplicateIssues.length === 0) return null;
                        return (
                          <div key={`duplicate-${date}`} className="p-3 bg-orange-50 border border-orange-200 rounded-lg">
                            <div className="flex justify-between items-start">
                              <span className="font-medium text-slate-900">Feb {formatDate(date)}</span>
                              <span className="text-xs text-orange-600">{duplicateIssues[0]?.message}</span>
                            </div>
                            <div className="text-sm text-slate-600 mt-1">
                              "{analysis?.summary || 'No summary'}"
                            </div>
                          </div>
                        );
                      }).filter(Boolean)}
                    </div>
                  </div>
                )}

                {/* Similar Summary Issues */}
                {qualityResults.summary.similarSummaries > 0 && (
                  <div className="space-y-2">
                    <h4 className="font-semibold text-yellow-800">🔗 Similar Summaries ({qualityResults.summary.similarSummaries} dates):</h4>
                    <div className="space-y-2">
                      {Array.from(affectedDates).map(date => {
                        const issues = getQualityIssues(date);
                        const analysis = getAnalysisForDate(date);
                        const similarIssues = issues.filter(issue => issue.type === 'SIMILAR_SUMMARY');
                        if (similarIssues.length === 0) return null;
                        return (
                          <div key={`similar-${date}`} className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                            <div className="flex justify-between items-start">
                              <span className="font-medium text-slate-900">Feb {formatDate(date)}</span>
                              <span className="text-xs text-yellow-600">{similarIssues[0]?.message}</span>
                            </div>
                            <div className="text-sm text-slate-600 mt-1">
                              "{analysis?.summary || 'No summary'}"
                            </div>
                          </div>
                        );
                      }).filter(Boolean)}
                    </div>
                  </div>
                )}

                {/* Invalid Links Issues */}
                {qualityResults.summary.invalidLinks > 0 && (
                  <div className="space-y-2">
                    <h4 className="font-semibold text-red-800">🔗 Invalid Links ({qualityResults.summary.invalidLinks} dates):</h4>
                    <div className="space-y-2">
                      {Array.from(affectedDates).map(date => {
                        const issues = getQualityIssues(date);
                        const analysis = getAnalysisForDate(date);
                        const linkIssues = issues.filter(issue => issue.type === 'INVALID_LINKS');
                        if (linkIssues.length === 0) return null;
                        return (
                          <div key={`invalid-links-${date}`} className="p-3 bg-red-50 border border-red-200 rounded-lg">
                            <div className="flex justify-between items-start">
                              <span className="font-medium text-slate-900">Feb {formatDate(date)}</span>
                              <span className="text-xs text-red-600">{linkIssues[0]?.message}</span>
                            </div>
                            <div className="text-sm text-slate-600 mt-1">
                              "{analysis?.summary || 'No summary'}"
                            </div>
                            {linkIssues[0]?.details?.invalidUrls && (
                              <div className="mt-2 space-y-1">
                                <div className="text-xs font-medium text-red-700">Invalid URLs:</div>
                                {linkIssues[0].details.invalidUrls.map((url: string, index: number) => (
                                  <div key={index} className="text-xs text-red-600 break-all bg-red-100 p-2 rounded">
                                    {url}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      }).filter(Boolean)}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Quality Check Success Message */}
      {qualityResults && qualityResults.totalIssues === 0 && (
        <Card className="border-green-200 bg-green-50">
          <CardContent className="p-4">
            <div className="flex items-center text-green-800">
              <CheckCircle className="w-5 h-5 mr-2" />
              <span className="font-medium">All summaries passed quality checks!</span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Google Verification Results Panel */}
      {googleResults && (
        <Card className="border-blue-200 bg-blue-50">
          <CardHeader>
            <CardTitle className="text-blue-800 flex items-center">
              <SiGoogle className="w-5 h-5 mr-2" />
              Google Verification Results
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {/* Summary Stats */}
              <div className="grid grid-cols-4 gap-4">
                <div className="text-center">
                  <div className="text-2xl font-bold text-green-600">{googleResults.validDays}</div>
                  <div className="text-sm text-green-600">Valid</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-red-600">{googleResults.incorrectDays}</div>
                  <div className="text-sm text-red-600">Incorrect</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-yellow-600">{googleResults.cannotVerifyDays}</div>
                  <div className="text-sm text-yellow-600">Cannot Verify</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-blue-600">{googleResults.totalDays}</div>
                  <div className="text-sm text-blue-600">Total</div>
                </div>
              </div>

              {/* Accuracy Overview */}
              <div className="bg-white rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-blue-700">Accuracy Score</span>
                  <span className="text-lg font-bold text-blue-800">
                    {Math.round((googleResults.validDays / googleResults.totalDays) * 100)}%
                  </span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div 
                    className="bg-gradient-to-r from-green-400 to-blue-500 h-2 rounded-full" 
                    style={{ width: `${(googleResults.validDays / googleResults.totalDays) * 100}%` }}
                  ></div>
                </div>
              </div>

              {/* Affected Dates */}
              {googleResults.incorrectDays > 0 && (
                <div className="space-y-2">
                  <h4 className="font-semibold text-red-800">❌ Incorrect Summaries ({googleResults.incorrectDays} dates):</h4>
                  <div className="flex flex-wrap gap-2">
                    {Array.from(googleAffectedDates).filter(date => {
                      const verification = getGoogleVerification(date);
                      return verification === 'Incorrect';
                    }).map(date => (
                      <Link key={date} href={`/day/${date}`}>
                        <Badge variant="destructive" className="cursor-pointer hover:bg-red-600">
                          {date}
                        </Badge>
                      </Link>
                    ))}
                  </div>
                </div>
              )}

              {googleResults.cannotVerifyDays > 0 && (
                <div className="space-y-2">
                  <h4 className="font-semibold text-yellow-800">⚠️ Cannot Verify ({googleResults.cannotVerifyDays} dates):</h4>
                  <div className="flex flex-wrap gap-2">
                    {Array.from(googleAffectedDates).filter(date => {
                      const verification = getGoogleVerification(date);
                      return verification === 'Cannot Verify';
                    }).map(date => (
                      <Link key={date} href={`/day/${date}`}>
                        <Badge variant="secondary" className="cursor-pointer hover:bg-gray-300">
                          {date}
                        </Badge>
                      </Link>
                    ))}
                  </div>
                </div>
              )}

              {googleResults.validDays > 0 && (
                <div className="space-y-2">
                  <h4 className="font-semibold text-green-800">✅ Valid Summaries ({googleResults.validDays} dates):</h4>
                  <div className="flex flex-wrap gap-2">
                    {Object.keys(googleResults.results).filter(date => {
                      const verification = getGoogleVerification(date);
                      return verification === 'Valid';
                    }).map(date => (
                      <Link key={date} href={`/day/${date}`}>
                        <Badge variant="secondary" className="bg-green-100 text-green-800 cursor-pointer hover:bg-green-200">
                          {date}
                        </Badge>
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Early Year Warning Dialog */}
      <AlertDialog open={showEarlyYearWarning} onOpenChange={setShowEarlyYearWarning}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center">
              <SiGoogle className="w-5 h-5 mr-2 text-blue-600" />
              Google Check Warning
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-3">
              <div>
                You're about to verify Bitcoin news summaries from <strong>{year}</strong>, which is in Bitcoin's early era (2009-2012).
              </div>
              <div className="text-amber-600 font-medium">
                ⚠️ <strong>Please note:</strong> Google's search results for Bitcoin-related news from {year} may be limited or incomplete, as Bitcoin was relatively unknown during this period.
              </div>
              <div>
                The verification results for this early period may not be as reliable as for more recent years. Do you want to continue anyway?
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={() => {
                setShowEarlyYearWarning(false);
                performGoogleCheck();
              }}
              className="bg-blue-600 hover:bg-blue-700"
            >
              <SiGoogle className="w-4 h-4 mr-2" />
              Continue Google Check
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </div>
  );
}
