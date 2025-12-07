import { useState, useCallback, useRef } from 'react';
import { useToast } from '@/hooks/use-toast';
import { queryClient } from '@/lib/queryClient';

interface AnalysisResult {
  success: boolean;
  date: string;
  requiresSelection?: boolean;
  selectionData?: any;
  error?: string;
}

interface SelectionRequest {
  date: string;
  selectionData: any;
}

export function useBulkReanalyze() {
  const [isReanalyzing, setIsReanalyzing] = useState(false);
  const [currentSelectionRequest, setCurrentSelectionRequest] = useState<SelectionRequest | null>(null);
  const [pendingDates, setPendingDates] = useState<string[]>([]);
  const [completedCount, setCompletedCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const { toast } = useToast();
  
  // Use refs for access in callbacks
  const pendingDatesRef = useRef<string[]>([]);
  const isCancelledRef = useRef(false);

  const analyzeSingleDate = useCallback(async (date: string): Promise<AnalysisResult> => {
    try {
      console.log(`🔄 [Bulk] Analyzing ${date}`);
      
      // Step 1: Initial analysis call
      const response = await fetch(`/api/analysis/date/${date}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ forceReanalysis: true })
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();

      // Step 2: Check if selection is required
      if (data.requiresSelection) {
        console.log(`📋 [Bulk] Selection required for ${date}`);
        return {
          success: false,
          date,
          requiresSelection: true,
          selectionData: data,
        };
      }

      // No selection required - completed
      console.log(`✅ [Bulk] Completed ${date}`);
      return { success: true, date };
    } catch (err) {
      console.error(`❌ [Bulk] Failed to analyze ${date}:`, err);
      return {
        success: false,
        date,
        error: err instanceof Error ? err.message : String(err)
      };
    }
  }, []);

  const processNextDate = useCallback(async (date: string) => {
    // Check if cancelled
    if (isCancelledRef.current) {
      console.log(`🛑 [Bulk] Analysis cancelled, stopping...`);
      finishBulkAnalysis(true);
      return;
    }

    const result = await analyzeSingleDate(date);

    // Check again after async operation
    if (isCancelledRef.current) {
      console.log(`🛑 [Bulk] Analysis cancelled after completing ${date}`);
      finishBulkAnalysis(true);
      return;
    }

    if (result.requiresSelection && result.selectionData) {
      // Pause and show selection dialog
      setCurrentSelectionRequest({
        date,
        selectionData: result.selectionData,
      });
    } else {
      // Completed or failed - move to next
      setCompletedCount(prev => prev + 1);

      // Get next date from ref
      const remaining = pendingDatesRef.current;
      if (remaining.length > 0 && !isCancelledRef.current) {
        const [nextDate, ...rest] = remaining;
        pendingDatesRef.current = rest;
        setPendingDates(rest);
        processNextDate(nextDate);
      } else {
        finishBulkAnalysis(isCancelledRef.current);
      }
    }
  }, [analyzeSingleDate]);

  const finishBulkAnalysis = useCallback((wasCancelled: boolean = false) => {
    setIsReanalyzing(false);
    setCurrentSelectionRequest(null);
    setPendingDates([]);
    pendingDatesRef.current = [];
    isCancelledRef.current = false;

    // Invalidate queries
    queryClient.invalidateQueries({ queryKey: ['analyses'] });
    queryClient.invalidateQueries({ queryKey: ['/api/analysis/stats'] });

    if (wasCancelled) {
      toast({
        title: "Analysis cancelled",
        description: `Stopped after analyzing ${completedCount} of ${totalCount} date(s)`,
        variant: "default",
      });
    } else {
      toast({
        title: "Re-analysis complete",
        description: `Successfully analyzed ${completedCount} of ${totalCount} date(s)`,
      });
    }

    setCompletedCount(0);
    setTotalCount(0);
  }, [completedCount, totalCount, toast]);

  const cancelAnalysis = useCallback(() => {
    console.log(`🛑 [Bulk] Cancel requested by user`);
    isCancelledRef.current = true;
    
    // If there's a dialog open, close it and finish
    if (currentSelectionRequest) {
      setCurrentSelectionRequest(null);
      finishBulkAnalysis(true);
    }
  }, [currentSelectionRequest, finishBulkAnalysis]);

  const confirmSelectionAndContinue = useCallback(async (articleId: string) => {
    if (!currentSelectionRequest) return;

    const { date, selectionData } = currentSelectionRequest;

    try {
      console.log(`✅ [Bulk] Confirming selection for ${date}`);
      
      const response = await fetch(`/api/analysis/date/${date}/confirm-selection`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          articleId,
          selectionMode: selectionData.selectionMode
        })
      });

      if (!response.ok) {
        throw new Error(`Confirmation failed: ${response.statusText}`);
      }

      await response.json();
      
      // Close dialog and increment completed
      setCurrentSelectionRequest(null);
      setCompletedCount(prev => prev + 1);

      // Check if cancelled while dialog was open
      if (isCancelledRef.current) {
        finishBulkAnalysis(true);
        return;
      }

      // Continue with next date if any
      const remaining = pendingDatesRef.current;
      if (remaining.length > 0) {
        const [nextDate, ...rest] = remaining;
        pendingDatesRef.current = rest;
        setPendingDates(rest);
        processNextDate(nextDate);
      } else {
        finishBulkAnalysis();
      }
    } catch (error) {
      console.error('Confirmation failed:', error);
      toast({
        title: "Confirmation Failed",
        description: error instanceof Error ? error.message : 'Failed to confirm selection',
        variant: "destructive",
      });
      
      // Skip this date and continue
      setCurrentSelectionRequest(null);
      setCompletedCount(prev => prev + 1);
      
      const remaining = pendingDatesRef.current;
      if (remaining.length > 0 && !isCancelledRef.current) {
        const [nextDate, ...rest] = remaining;
        pendingDatesRef.current = rest;
        setPendingDates(rest);
        processNextDate(nextDate);
      } else {
        finishBulkAnalysis(isCancelledRef.current);
      }
    }
  }, [currentSelectionRequest, toast, processNextDate, finishBulkAnalysis]);

  const reanalyzeDates = useCallback(async (dates: string[]) => {
    if (dates.length === 0) {
      toast({
        title: "No dates selected",
        description: "Please select dates to re-analyze",
        variant: "destructive",
      });
      return;
    }

    setIsReanalyzing(true);
    setCompletedCount(0);
    setTotalCount(dates.length);
    const remaining = dates.slice(1);
    pendingDatesRef.current = remaining;
    setPendingDates(remaining);
    setCurrentSelectionRequest(null);
    isCancelledRef.current = false;

    console.log(`🚀 [Bulk] Starting bulk re-analysis of ${dates.length} dates`);

    // Start with first date
    processNextDate(dates[0]);
  }, [toast, processNextDate]);

  const redoSummaries = async (dates: string[]) => {
    if (dates.length === 0) {
      toast({
        title: "No dates selected",
        description: "Please select dates to redo summaries",
        variant: "destructive",
      });
      return;
    }

    setIsReanalyzing(true);

    try {
      for (const date of dates) {
        try {
          await fetch(`/api/analysis/date/${date}/redo-summary`, { method: 'POST' });
        } catch (err) {
          console.error(`Failed to redo summary for ${date}:`, err);
        }
      }

      queryClient.invalidateQueries({ queryKey: ['analyses'] });
      
      toast({
        title: "Summaries updated",
        description: `Redid summaries for ${dates.length} date(s)`,
      });
    } finally {
      setIsReanalyzing(false);
    }
  };

  const handleDialogClose = useCallback((open: boolean) => {
    if (!open && currentSelectionRequest) {
      // User cancelled dialog - skip this date
      setCurrentSelectionRequest(null);
      setCompletedCount(prev => prev + 1);
      
      const remaining = pendingDatesRef.current;
      if (remaining.length > 0 && !isCancelledRef.current) {
        const [nextDate, ...rest] = remaining;
        pendingDatesRef.current = rest;
        setPendingDates(rest);
        processNextDate(nextDate);
      } else {
        finishBulkAnalysis(isCancelledRef.current);
      }
    }
  }, [currentSelectionRequest, processNextDate, finishBulkAnalysis]);

  return {
    isReanalyzing,
    reanalyzeDates,
    redoSummaries,
    cancelAnalysis,
    // Selection dialog state
    selectionRequest: currentSelectionRequest,
    isSelectionDialogOpen: !!currentSelectionRequest,
    setIsSelectionDialogOpen: handleDialogClose,
    confirmSelection: confirmSelectionAndContinue,
    progress: {
      completed: completedCount,
      total: totalCount,
    }
  };
}
