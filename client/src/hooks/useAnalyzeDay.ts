import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { queryClient } from '@/lib/queryClient';

interface AnalysisSelectionData {
  requiresSelection: boolean;
  selectionMode: 'orphan' | 'multiple';
  tieredArticles: {
    bitcoin: any[];
    crypto: any[];
    macro: any[];
  };
  geminiSelectedIds?: string[];
  perplexitySelectedIds?: string[];
  intersectionIds?: string[];
  openaiSuggestedId?: string;
  aisDidntAgree?: boolean;
}

interface UseAnalyzeDayOptions {
  date: string;
  onSelectionRequired?: (data: AnalysisSelectionData) => void;
  onSuccess?: () => void;
  onError?: (error: Error) => void;
  aiProvider?: string;
  newsProvider?: string;
}

export function useAnalyzeDay({
  date,
  onSelectionRequired,
  onSuccess,
  onError,
  aiProvider = 'openai',
  newsProvider = 'exa'
}: UseAnalyzeDayOptions) {
  const { toast } = useToast();
  const [selectionData, setSelectionData] = useState<AnalysisSelectionData | null>(null);
  const [isSelectionDialogOpen, setIsSelectionDialogOpen] = useState(false);

  const analyzeMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/analysis/date/${date}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          forceReanalysis: true,
          aiProvider,
          newsProvider
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Analysis failed:', errorText);
        throw new Error(`Failed to analyze: ${response.statusText}`);
      }

      const data = await response.json();
      console.log('🔍 [useAnalyzeDay] Analysis response:', {
        date,
        hasRequiresSelection: !!data?.requiresSelection,
        selectionMode: data?.selectionMode,
        hasTieredArticles: !!data?.tieredArticles,
      });

      return data;
    },
    onSuccess: (data: any) => {
      // Check if user selection is required
      if (data?.requiresSelection) {
        console.log('✅ [useAnalyzeDay] Selection required for', date);
        const selectionInfo: AnalysisSelectionData = {
          requiresSelection: data.requiresSelection,
          selectionMode: data.selectionMode,
          tieredArticles: data.tieredArticles || { bitcoin: [], crypto: [], macro: [] },
          geminiSelectedIds: data.geminiSelectedIds,
          perplexitySelectedIds: data.perplexitySelectedIds,
          intersectionIds: data.intersectionIds,
          openaiSuggestedId: data.openaiSuggestedId,
          aisDidntAgree: data.aisDidntAgree,
        };
        
        setSelectionData(selectionInfo);
        setIsSelectionDialogOpen(true);
        
        // Call the callback if provided
        if (onSelectionRequired) {
          onSelectionRequired(selectionInfo);
        }
        return;
      }

      // No selection required - complete successfully
      console.log('ℹ️ [useAnalyzeDay] No selection required for', date);
      
      // Invalidate queries
      queryClient.refetchQueries({ queryKey: [`supabase-date-${date}`] });
      const dateYear = date?.substring(0, 4);
      if (dateYear) {
        queryClient.invalidateQueries({ queryKey: [`supabase-year-${dateYear}`] });
      }
      queryClient.invalidateQueries({ queryKey: ['/api/analysis/stats'] });
      queryClient.invalidateQueries({ queryKey: ['analyses'] });

      // Check if AIs didn't agree
      if (data?.aisDidntAgree) {
        toast({
          title: "⚠️ AIs Didn't Agree",
          description: `Gemini and Perplexity couldn't agree on any articles for ${date}. Articles saved for manual review.`,
          variant: "default",
          duration: 8000,
        });
      } else {
        toast({
          title: "Analysis Complete",
          description: `Analysis for ${new Date(date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })} completed successfully.`,
        });
      }

      if (onSuccess) {
        onSuccess();
      }
    },
    onError: (error: Error) => {
      toast({
        title: "Analysis Failed",
        description: error.message || `Failed to analyze ${date}`,
        variant: "destructive",
      });

      if (onError) {
        onError(error);
      }
    },
  });

  const confirmSelection = async (articleId: string) => {
    try {
      const response = await fetch(`/api/analysis/date/${date}/confirm-selection`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          articleId,
          selectionMode: selectionData?.selectionMode,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to confirm selection');
      }

      const result = await response.json();

      // Invalidate queries
      queryClient.refetchQueries({ queryKey: [`supabase-date-${date}`] });
      const dateYear = date?.substring(0, 4);
      if (dateYear) {
        queryClient.invalidateQueries({ queryKey: [`supabase-year-${dateYear}`] });
      }
      queryClient.invalidateQueries({ queryKey: ['/api/analysis/stats'] });
      queryClient.invalidateQueries({ queryKey: ['analyses'] });

      setIsSelectionDialogOpen(false);
      setSelectionData(null);

      toast({
        title: "Analysis Complete",
        description: `Summary generated successfully. VeriBadge: ${result.veriBadge}`,
      });

      if (onSuccess) {
        onSuccess();
      }

      return result;
    } catch (error) {
      toast({
        title: "Confirmation Failed",
        description: error instanceof Error ? error.message : 'Failed to confirm selection',
        variant: "destructive",
      });
      throw error;
    }
  };

  return {
    analyze: analyzeMutation.mutate,
    isAnalyzing: analyzeMutation.isPending,
    selectionData,
    isSelectionDialogOpen,
    setIsSelectionDialogOpen,
    confirmSelection,
  };
}

