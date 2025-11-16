import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FlagButton } from "@/components/FlagButton";
import { useToast } from "@/hooks/use-toast";
import { queryClient, clearCacheForDate } from "@/lib/queryClient";
import { apiRequest } from "@/lib/queryClient";
import { debounce } from "@/lib/debounce";
import { useApiHealthCheck } from "@/hooks/useApiHealthCheck";
import { useAiProvider } from "@/hooks/useAiProvider";
import { NewsArticle } from "@/types/api-types";
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



import { 
  ArrowLeft,
  ArrowRight, 
  Bot, 
  Edit, 
  RefreshCw, 
  Save, 
  Eye, 
  Star,
  ExternalLink,
  TrendingUp,
  Search,
  ChevronDown,
  ChevronUp,
  FileText,
  Layers,
  BarChart3,
  Bitcoin,
  Coins,
  DollarSign,
  Shield,
  CheckCircle,
  XCircle,
  Loader2
} from "lucide-react";
import { SiGoogle } from "react-icons/si";

interface DayAnalysisData {
  analysis: {
    id: string;
    date: string;
    summary: string;

    topArticleId: string;
    reasoning: string;
    confidenceScore: string;
    aiProvider: string;
    isManualOverride?: boolean;
    isFlagged?: boolean;
    flagReason?: string;
    articleTags?: {
      totalArticles: number;
      topSources: string[];
      duplicatesFound: number;
      sourcesUsed: string[];
      totalFetched: number;
      analysisMetadata?: {
        processingDate: string;
        version: string;
        sentimentAnalysis: boolean;
        topicCategorization: boolean;
        duplicateDetection: boolean;
        multiSourceIntegration: boolean;
        hierarchicalSearch?: {
          tierUsed: string;
          searchPath: string[];
          totalSearched: number;
          diagnostics: {
            tier1Results: number;
            tier2Results: number;
            tier3Results: number;
            fallbackTriggered: boolean;
          };
        };
      };
    };
  };
  manualEntries: Array<{
    id: string;
    title: string;
    summary: string;
    description: string;
  }>;
  // NEW: Multi-tier article support
  tieredArticles?: {
    bitcoin: NewsArticle[];
    crypto: NewsArticle[];
    macro: NewsArticle[];
  };
  winningTier?: string | null;
  meta?: {
    hasLegacyData: boolean;
    hasTieredData: boolean;
    dataVersion: 'v1-legacy' | 'v2-tiered';
  };
}


export default function DayAnalysis() {
  const { date } = useParams();
  const { toast } = useToast();
  const [isEditing, setIsEditing] = React.useState(false);
  const [editedSummary, setEditedSummary] = React.useState('');
  const [hasUnsavedChanges, setHasUnsavedChanges] = React.useState(false);
  const [hasNewAnalysis, setHasNewAnalysis] = React.useState(false);
  const [currentPage, setCurrentPage] = React.useState(1);
  const [showReanalyzeConfirm, setShowReanalyzeConfirm] = React.useState(false);
  const [activeTab, setActiveTab] = React.useState<string>('');
  const articlesPerPage = 10;
  const { triggerHealthCheck } = useApiHealthCheck();
  const { aiProvider } = useAiProvider();

  // Get the source parameter from URL to determine back button behavior
  const urlParams = new URLSearchParams(window.location.search);
  const source = urlParams.get('from') || 'month'; // default to month view

  // Helper function to get AI provider badge
  const getAIProviderBadge = (provider: string) => {
    switch (provider) {
      case 'openai':
        return <Badge variant="outline" className="bg-violet-50 text-violet-700 border-violet-200">
          <Bot className="w-3 h-3 mr-1" />
          OpenAI
        </Badge>;
      case 'claude':
        return <Badge variant="outline" className="bg-purple-50 text-purple-700 border-purple-200">
          <Star className="w-3 h-3 mr-1" />
          Claude
        </Badge>;
      case 'dual':
        return <Badge variant="outline" className="bg-gradient-to-r from-violet-50 to-purple-50 text-violet-700 border-violet-200">
          <TrendingUp className="w-3 h-3 mr-1" />
          Dual AI
        </Badge>;
      default:
        return <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">
          <Bot className="w-3 h-3 mr-1" />
          Manual
        </Badge>;
    }
  };

  const { data: dayData, isLoading } = useQuery<DayAnalysisData & {
    analyzedArticles?: NewsArticle[];
  }>({
    queryKey: [`/api/analysis/date/${date}`],
  });

  const reanalyzeMutation = useMutation({
    mutationFn: async () => {
      // Clear all cached data for this date first
      if (date) {
        clearCacheForDate(date);
      }
      
      // Trigger health check before critical operation
      try {
        await triggerHealthCheck();
      } catch (error) {
        console.warn('Health check failed before analysis:', error);
      }

      const response = await fetch(`/api/analysis/date/${date}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ 
          forceReanalysis: true,
          aiProvider: aiProvider,
          newsProvider: localStorage.getItem('newsProvider') || 'exa'
        }),
      });
      if (!response.ok) {
        throw new Error(`Failed to analyze: ${response.statusText}`);
      }
      return response.json();
    },
    onSuccess: () => {
      // DON'T invalidate current date query to prevent re-triggering useEffect
      // Instead, refetch it explicitly to get fresh data without making dayData undefined
      queryClient.refetchQueries({ queryKey: [`/api/analysis/date/${date}`] });
      
      // Also invalidate year data for calendar updates
      const dateYear = date?.substring(0, 4);
      if (dateYear) {
        queryClient.invalidateQueries({ queryKey: [`/api/analysis/year/${dateYear}`] });
      }
      
      // Invalidate stats for homepage
      queryClient.invalidateQueries({ queryKey: ['/api/analysis/stats'] });
      
      setHasNewAnalysis(true);
      setHasUnsavedChanges(false); // Reset manual changes flag since we have new analysis
      setShowReanalyzeConfirm(false); // Close the confirmation dialog
      setIsAnalyzing(false); // Reset analyzing state
      // Reset the ref so future navigations to this date can trigger analysis if needed
      analysisTriggeredRef.current = null;
      toast({
        title: "Analysis Complete",
        description: `Bitcoin news analysis for ${new Date(date!).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })} has been updated successfully.`,
      });
    },
    onError: (error: any) => {
      setShowReanalyzeConfirm(false); // Close the confirmation dialog on error
      setIsAnalyzing(false); // Reset analyzing state
      // Reset the ref on error so user can retry
      analysisTriggeredRef.current = null;
      toast({
        title: "Analysis Failed",
        description: error.message || "Failed to reanalyze the news for this date.",
        variant: "destructive",
      });
    },
  });

  // Google verification mutation
  const googleVerifyMutation = useMutation({
    mutationFn: async (): Promise<{ assessment: 'Valid' | 'Incorrect' | 'Cannot Verify' }> => {
      if (!dayData?.analysis?.summary) {
        throw new Error("No summary available to verify");
      }
      
      setGoogleVerification({ status: null, isLoading: true });
      
      const response = await fetch('/api/analysis/google-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: date,
          summary: dayData.analysis.summary
        })
      });
      
      if (!response.ok) {
        throw new Error(`Verification failed: ${response.statusText}`);
      }
      
      return response.json();
    },
    onSuccess: (result: { assessment: 'Valid' | 'Incorrect' | 'Cannot Verify' }) => {
      setGoogleVerification({ 
        status: result.assessment, 
        isLoading: false 
      });
      
      toast({
        title: "Google Verification Complete",
        description: `Summary was assessed as: ${result.assessment}`,
        variant: result.assessment === 'Valid' ? "default" : "destructive",
      });
    },
    onError: (error: any) => {
      setGoogleVerification({ status: null, isLoading: false });
      toast({
        title: "Verification Failed",
        description: error.message || "Failed to verify summary with Google.",
        variant: "destructive",
      });
    },
  });

  const [isAnalyzing, setIsAnalyzing] = React.useState(false);
  const analysisTriggeredRef = React.useRef<string | null>(null); // Track which date triggered analysis
  const [selectingArticleId, setSelectingArticleId] = React.useState<string | null>(null); // Track which article is being selected
  
  // Google verification state
  const [googleVerification, setGoogleVerification] = React.useState<{
    status: 'Valid' | 'Incorrect' | 'Cannot Verify' | null;
    isLoading: boolean;
  }>({ status: null, isLoading: false });

  // Debounced reanalyze click handler
  const debouncedReanalyzeClick = React.useMemo(
    () => debounce(() => {
      if (!isAnalyzing && !reanalyzeMutation.isPending) {
        setShowReanalyzeConfirm(true);
      }
    }, 300),
    [isAnalyzing, reanalyzeMutation.isPending]
  );

  const handleReanalyzeClick = () => {
    // Prevent multiple clicks
    if (isAnalyzing || reanalyzeMutation.isPending) {
      console.log('Analysis already in progress, ignoring click');
      return;
    }
    debouncedReanalyzeClick();
  };

  const handleConfirmReanalyze = () => {
    // Double check to prevent race conditions
    if (isAnalyzing || reanalyzeMutation.isPending) {
      console.log('Analysis already in progress, ignoring confirmation');
      return;
    }
    const triggerSource = `MANUAL_BUTTON_${Date.now()}`;
    console.log(`🔄 [${triggerSource}] Manual reanalysis triggered for date: ${date}`);
    console.log(`📍 [${triggerSource}] Trigger context: manual button click`);
    console.log(`🌐 [${triggerSource}] Current URL: ${window.location.href}`);
    console.log(`⏰ [${triggerSource}] Timestamp: ${new Date().toISOString()}`);
    setIsAnalyzing(true);
    reanalyzeMutation.mutate();
  };

  const saveChangesMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/analysis/date/${date}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          summary: editedSummary || dayData?.analysis.summary,
          reasoning: dayData?.analysis.reasoning,
        }),
      });
      if (!response.ok) {
        throw new Error(`Failed to save: ${response.statusText}`);
      }
      return response.json();
    },
    onSuccess: () => {
      // Invalidate multiple related queries to ensure UI updates
      queryClient.invalidateQueries({ queryKey: [`/api/analysis/date/${date}`] });
      
      // Get year from date to invalidate year data (for calendar updates)
      const dateYear = date?.substring(0, 4);
      if (dateYear) {
        queryClient.invalidateQueries({ queryKey: [`/api/analysis/year/${dateYear}`] });
      }
      
      // Invalidate stats for homepage
      queryClient.invalidateQueries({ queryKey: ['/api/analysis/stats'] });
      
      // Reset edit state
      setIsEditing(false);
      setHasUnsavedChanges(false);
      setHasNewAnalysis(false);
      setEditedSummary('');
      
      toast({
        title: "Changes Saved",
        description: "Your modifications have been saved successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Save Failed",
        description: error.message || "Failed to save changes.",
        variant: "destructive",
      });
    },
  });

  // Article selection mutation
  const selectArticleMutation = useMutation({
    mutationFn: async (articleId: string) => {
      setSelectingArticleId(articleId);
      const response = await apiRequest(
        "PUT",
        `/api/analysis/date/${date}/select-article`,
        { articleId }
      );
      return response.json();
    },
    onSuccess: (result) => {
      // Invalidate multiple queries to ensure complete UI update
      queryClient.invalidateQueries({ queryKey: [`/api/analysis/date/${date}`] });
      
      // Get year from date to invalidate year data (for calendar updates)  
      const dateYear = date?.substring(0, 4);
      if (dateYear) {
        queryClient.invalidateQueries({ queryKey: [`/api/analysis/year/${dateYear}`] });
      }
      
      // Invalidate stats for overall dashboard updates
      queryClient.invalidateQueries({ queryKey: ['/api/analysis/stats'] });
      
      // Force immediate refetch of the current analysis
      queryClient.refetchQueries({ queryKey: [`/api/analysis/date/${date}`] });
      
      // CRITICAL FIX: Clear sticky edited state to show fresh AI-generated summary
      setEditedSummary('');
      setHasUnsavedChanges(false);
      setIsEditing(false); // Exit edit mode if active
      
      setSelectingArticleId(null);
      toast({
        title: "Article Selected",
        description: "New summary generated successfully from the selected article.",
      });
    },
    onError: (error: any) => {
      setSelectingArticleId(null);
      toast({
        title: "Selection Failed", 
        description: error.message || "Failed to select article and generate new summary.",
        variant: "destructive",
      });
    },
  });

  // Handle article selection
  const handleArticleSelect = (articleId: string) => {
    if (selectingArticleId || selectArticleMutation.isPending) {
      return; // Prevent multiple selections
    }
    selectArticleMutation.mutate(articleId);
  };

  // Initialize editedSummary when data loads (only for display purposes, not sticky state)
  React.useEffect(() => {
    if (dayData?.analysis?.summary && !editedSummary && !isEditing) {
      setEditedSummary(dayData.analysis.summary);
    }
  }, [dayData?.analysis?.summary, editedSummary, isEditing]);

  // Edit functions
  const handleEditClick = () => {
    setIsEditing(true);
    setEditedSummary(dayData?.analysis.summary || '');
  };

  const handleSummaryChange = (value: string) => {
    setEditedSummary(value);
    setHasUnsavedChanges(value !== dayData?.analysis.summary);
  };

  // Navigation functions with prefetching for faster loading
  const navigatePreviousDay = async () => {
    if (!date) return;
    const currentDate = new Date(date);
    currentDate.setDate(currentDate.getDate() - 1);
    const prevDate = currentDate.toISOString().split('T')[0];
    
    // Prefetch the previous day's data for instant loading
    await queryClient.prefetchQuery({
      queryKey: [`/api/analysis/date/${prevDate}`],
      queryFn: () => fetch(`/api/analysis/date/${prevDate}`).then(res => res.json()),
      staleTime: 5 * 60 * 1000, // Cache for 5 minutes
    });
    
    // Preserve the source parameter when navigating
    window.location.href = `/day/${prevDate}?from=${source}`;
  };

  const navigateNextDay = async () => {
    if (!date) return;
    const currentDate = new Date(date);
    currentDate.setDate(currentDate.getDate() + 1);
    const nextDate = currentDate.toISOString().split('T')[0];
    
    // Prefetch the next day's data for instant loading
    await queryClient.prefetchQuery({
      queryKey: [`/api/analysis/date/${nextDate}`],
      queryFn: () => fetch(`/api/analysis/date/${nextDate}`).then(res => res.json()),
      staleTime: 5 * 60 * 1000, // Cache for 5 minutes
    });
    
    // Preserve the source parameter when navigating
    window.location.href = `/day/${nextDate}?from=${source}`;
  };

  // Auto-analyze when no data exists for the current date (only after loading completes)
  React.useEffect(() => {
    // Only trigger auto-analysis after the query finishes loading AND there's no data
    // This prevents reanalysis of existing days during their initial loading phase
    if (date && !isLoading && !dayData && !reanalyzeMutation.isPending && !isAnalyzing) {
      const triggerSource = `AUTO_USEEFFECT_${Date.now()}`;
      console.log(`🔄 [${triggerSource}] Auto-analyzing date: ${date} - query complete, no data found`);
      console.log(`📍 [${triggerSource}] Trigger context: useEffect auto-analysis`);
      console.log(`🌐 [${triggerSource}] Current URL: ${window.location.href}`);
      console.log(`⏰ [${triggerSource}] Timestamp: ${new Date().toISOString()}`);
      
      setIsAnalyzing(true);
      reanalyzeMutation.mutate();
    }
  }, [date, isLoading, dayData]); // Depend on loading state and data

  // Disabled aggressive prefetching to prevent unnecessary API calls
  // Prefetching is now only done on user navigation (previous/next day buttons)

  // Keyboard shortcuts
  React.useEffect(() => {
    const handleKeyPress = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey) return;
      
      // Don't trigger shortcuts when user is typing in input fields, textareas, or dialogs
      const activeElement = document.activeElement;
      const isTyping = activeElement && (
        activeElement.tagName === 'INPUT' ||
        activeElement.tagName === 'TEXTAREA' ||
        activeElement.getAttribute('contenteditable') === 'true' ||
        activeElement.closest('[role="dialog"]') !== null
      );
      
      if (isTyping) return;
      
      switch (event.key.toLowerCase()) {
        case 's':
          event.preventDefault();
          saveChangesMutation.mutate();
          break;
        case 'r':
          event.preventDefault();
          if (!reanalyzeMutation.isPending && !isAnalyzing) {
            const triggerSource = `KEYBOARD_R_${Date.now()}`;
            console.log(`🔄 [${triggerSource}] Keyboard 'R' reanalysis triggered for date: ${date}`);
            console.log(`📍 [${triggerSource}] Trigger context: keyboard shortcut`);
            console.log(`🌐 [${triggerSource}] Current URL: ${window.location.href}`);
            console.log(`⏰ [${triggerSource}] Timestamp: ${new Date().toISOString()}`);
            reanalyzeMutation.mutate();
          }
          break;
        case 'arrowleft':
          event.preventDefault();
          navigatePreviousDay();
          break;
        case 'arrowright':
          event.preventDefault();
          navigateNextDay();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, []);

  // Helper functions for navigation variables and tiered articles
  const analyzedArticles = dayData?.analyzedArticles || [];
  const tieredArticles = dayData?.tieredArticles;
  const winningTier = dayData?.winningTier;
  const hasTieredData = dayData?.meta?.hasTieredData || false;
  
  // Set default active tab based on winning tier (runs when data loads)
  React.useEffect(() => {
    if (hasTieredData && winningTier) {
      // Always set to winning tier when tiered data is available
      if (activeTab !== winningTier) {
        setActiveTab(winningTier);
      }
    } else if (!hasTieredData && activeTab !== 'legacy') {
      // Set to legacy for non-tiered data
      setActiveTab('legacy');
    }
  }, [hasTieredData, winningTier, dayData?.analysis?.id]); // Add analysis ID to trigger when new data loads
  
  // Find the top article from tiered articles first, then fall back to analyzedArticles
  const findTopArticleInTieredArticles = () => {
    if (!dayData?.analysis.topArticleId || !tieredArticles) return null;
    
    // Search across all tiers
    const allTieredArticles = [
      ...(tieredArticles.bitcoin || []),
      ...(tieredArticles.crypto || []),
      ...(tieredArticles.macro || [])
    ];
    
    return allTieredArticles.find(article => article.id === dayData?.analysis.topArticleId);
  };

  const topArticle = findTopArticleInTieredArticles() || 
                     analyzedArticles.find(article => article.id === dayData?.analysis.topArticleId) || 
                     analyzedArticles[0]; // Final fallback

  const otherArticles = analyzedArticles.filter(article => 
    article.id !== (topArticle?.id || dayData?.analysis.topArticleId)
  ) || [];

  // Helper function to get tier icon and colors
  const getTierConfig = (tier: string) => {
    switch (tier) {
      case 'bitcoin':
        return {
          icon: Bitcoin,
          label: 'Bitcoin',
          color: 'bg-orange-50 text-orange-700 border-orange-200',
          accentColor: 'text-orange-600'
        };
      case 'crypto':
        return {
          icon: Coins,
          label: 'Crypto/Web3',
          color: 'bg-blue-50 text-blue-700 border-blue-200',
          accentColor: 'text-blue-600'
        };
      case 'macro':
        return {
          icon: DollarSign,
          label: 'Macro/Financial',
          color: 'bg-green-50 text-green-700 border-green-200',
          accentColor: 'text-green-600'
        };
      default:
        return {
          icon: FileText,
          label: 'Articles',
          color: 'bg-slate-50 text-slate-700 border-slate-200',
          accentColor: 'text-slate-600'
        };
    }
  };

  // Handle edge case of missing date param
  if (!date) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }



  return (
    <div className="space-y-6">
      {/* Header with Action Buttons */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <Link href={
            source === 'annual' 
              ? '/' 
              : `/month/${new Date(date!).getFullYear()}/${new Date(date!).getMonth() + 1}`
          }>
            <Button variant="outline" size="sm">
              <ArrowLeft className="w-4 h-4 mr-2" />
              {source === 'annual' ? 'Back to Annual' : 'Back to Month'}
            </Button>
          </Link>
          <div>
            <h1 className="text-xl font-bold text-slate-900">
              {new Date(date!).toLocaleDateString('en-US', { 
                weekday: 'long',
                year: 'numeric', 
                month: 'long', 
                day: 'numeric' 
              })}
            </h1>
            <p className="text-slate-600">Bitcoin News Analysis</p>
          </div>
        </div>
        
        {/* Action Buttons */}
        <div className="flex items-center space-x-3">
          {dayData?.analysis && (
            <FlagButton
              date={date!}
              isFlagged={dayData.analysis.isFlagged || false}
              flagReason={dayData.analysis.flagReason}
              type="analysis"
            />
          )}
          <div className="w-px h-6 bg-slate-300"></div>
          <Button
            variant="outline"
            size="sm"
            onClick={navigatePreviousDay}
            title="Previous Day (←)"
          >
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={navigateNextDay}
            title="Next Day (→)"
          >
            <ArrowRight className="w-4 h-4" />
          </Button>
          <div className="w-px h-6 bg-slate-300"></div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleReanalyzeClick}
            disabled={reanalyzeMutation.isPending || isAnalyzing}
            title="Re-analyze (R)"
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${reanalyzeMutation.isPending ? 'animate-spin' : ''}`} />
            Re-analyze
          </Button>
          
          {/* Google Check Button */}
          {dayData?.analysis?.summary && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => googleVerifyMutation.mutate()}
              disabled={googleVerification.isLoading || googleVerifyMutation.isPending}
              title="Verify with Google"
              className="border-blue-300 text-blue-700 hover:bg-blue-50"
            >
              {googleVerification.isLoading || googleVerifyMutation.isPending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <SiGoogle className="w-4 h-4 mr-2" />
              )}
              Google Check
            </Button>
          )}
          
          <Button
            size="sm"
            onClick={() => saveChangesMutation.mutate()}
            disabled={saveChangesMutation.isPending || (!hasUnsavedChanges && !hasNewAnalysis && !!dayData)}
            variant={
              !dayData ? "destructive" : 
              hasUnsavedChanges || hasNewAnalysis ? "default" : 
              "outline"
            }
            className={
              !dayData ? "bg-red-600 hover:bg-red-700 text-white" :
              hasNewAnalysis ? "bg-yellow-600 hover:bg-yellow-700 text-white" :
              hasUnsavedChanges ? "bg-green-600 hover:bg-green-700 text-white" :
              ""
            }
            title="Save Changes (S)"
          >
            <Save className="w-4 h-4 mr-2" />
            {saveChangesMutation.isPending ? 'Saving...' : 
             !dayData ? 'Not yet saved' :
             hasNewAnalysis ? 'Save new changes?' :
             hasUnsavedChanges ? 'Save' : 
             'All Saved'}
          </Button>
        </div>
      </div>

      {/* AI Summary Card */}
      {isLoading || !dayData ? (
        <Card className="bg-gradient-to-r from-violet-50 to-purple-50 border-violet-200">
          <CardContent className="p-6">
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center space-x-2">
                <Skeleton className="h-5 w-5 rounded" />
                <Skeleton className="h-6 w-24" />
                <Skeleton className="h-5 w-16" />
              </div>
              <Skeleton className="h-8 w-8" />
            </div>
            <Skeleton className="h-16 w-full mb-4" />
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-4">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-20" />
              </div>
              <Skeleton className="h-4 w-16" />
            </div>
          </CardContent>
        </Card>
      ) : !dayData ? (
        <Card>
          <CardContent className="p-12 text-center">
            <p className="text-slate-500 mb-4">No analysis found for this date.</p>
            <Button 
              onClick={handleReanalyzeClick}
              disabled={reanalyzeMutation.isPending || isAnalyzing}
            >
              {reanalyzeMutation.isPending ? (
                <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Bot className="w-4 h-4 mr-2" />
              )}
              Analyze This Date
            </Button>
          </CardContent>
        </Card>
      ) : dayData?.analysis ? (
        <Card className={`relative ${dayData.analysis.isManualOverride 
          ? "bg-gradient-to-r from-amber-50 to-orange-50 border-amber-200" 
          : "bg-gradient-to-r from-violet-50 to-purple-50 border-violet-200"}`}>
          <CardContent className="p-6">
            {/* Loading overlay when re-analyzing */}
            {reanalyzeMutation.isPending && (
              <div className="absolute inset-0 bg-white/80 backdrop-blur-sm rounded-lg flex items-center justify-center z-10">
                <div className="text-center">
                  <RefreshCw className="w-8 h-8 animate-spin text-violet-600 mx-auto mb-3" />
                  <p className="text-slate-700 font-medium">Regenerating AI Analysis...</p>
                  <p className="text-slate-500 text-sm">This may take a few moments</p>
                </div>
              </div>
            )}
            
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center space-x-2">
                <Bot className={`w-5 h-5 ${dayData.analysis.isManualOverride ? 'text-amber-600' : 'text-violet-600'}`} />
                <h3 className="text-lg font-semibold text-slate-900">
                  {dayData.analysis.isManualOverride ? 'Manual Entry' : 'AI Summary'}
                </h3>
                <Badge variant="secondary" className={
                  dayData.analysis.isManualOverride 
                    ? "bg-amber-100 text-amber-800" 
                    : "bg-violet-100 text-violet-800"
                }>
                  {dayData.analysis.isManualOverride ? 'CSV Import' : 'OpenAI GPT-4o'}
                </Badge>
              </div>
              {!dayData.analysis.isManualOverride && (
                <Button variant="ghost" size="sm" onClick={handleEditClick}>
                  <Edit className="w-4 h-4" />
                </Button>
              )}
            </div>
            
            {isEditing && !dayData.analysis.isManualOverride ? (
              <Textarea
                value={editedSummary}
                onChange={(e) => handleSummaryChange(e.target.value)}
                className="text-slate-800 text-lg leading-relaxed mb-4 min-h-[100px] bg-white"
                placeholder="Edit the AI summary..."
              />
            ) : (
              <div className="space-y-4 mb-4">
                {/* Short Summary Section */}
                <div className="bg-white p-4 rounded-lg border">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="font-semibold text-slate-900">Short Summary</h4>
                    <span className="text-sm text-slate-500">
                      {dayData.analysis.summary?.length || 0} characters
                    </span>
                  </div>
                  
                  {/* Show loading state during article selection */}
                  {selectArticleMutation.isPending ? (
                    <div className="flex items-center space-x-3 py-4">
                      <div className="animate-spin rounded-full h-5 w-5 border-2 border-violet-600 border-t-transparent"></div>
                      <div className="space-y-1">
                        <p className="text-slate-700 font-medium">Generating new summary...</p>
                        <p className="text-slate-500 text-sm">AI is analyzing the selected article</p>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <p className="text-slate-800 text-lg leading-relaxed mb-3">
                        "{isEditing && editedSummary ? editedSummary : dayData.analysis.summary}"
                      </p>
                      
                      {/* Google Verification Status */}
                      {googleVerification.status && (
                        <div className="flex items-center space-x-2">
                          {googleVerification.status === 'Valid' && (
                            <Badge className="bg-green-600 text-white border-green-600">
                              <CheckCircle className="w-3 h-3 mr-1" />
                              Google Approved
                            </Badge>
                          )}
                          {googleVerification.status === 'Incorrect' && (
                            <Badge className="bg-red-600 text-white border-red-600">
                              <XCircle className="w-3 h-3 mr-1" />
                              Google Rejected
                            </Badge>
                          )}
                          {googleVerification.status === 'Cannot Verify' && (
                            <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-300">
                              <Shield className="w-3 h-3 mr-1" />
                              Cannot Verify
                            </Badge>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
                

              </div>
            )}
          </CardContent>
        </Card>
      ) : null}

      {/* Search Strategy Information */}
      {isLoading || !dayData ? (
        <Card className="bg-gradient-to-r from-emerald-50 to-teal-50 border-emerald-200">
          <CardContent className="p-6">
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center space-x-2">
                <Skeleton className="h-5 w-5 rounded" />
                <Skeleton className="h-6 w-32" />
                <Skeleton className="h-5 w-20" />
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
              <div className="text-center p-3 bg-white rounded-lg border">
                <Skeleton className="h-8 w-8 mx-auto mb-2" />
                <Skeleton className="h-4 w-16 mx-auto" />
              </div>
              <div className="text-center p-3 bg-white rounded-lg border">
                <Skeleton className="h-8 w-8 mx-auto mb-2" />
                <Skeleton className="h-4 w-20 mx-auto" />
              </div>
              <div className="text-center p-3 bg-white rounded-lg border">
                <Skeleton className="h-8 w-8 mx-auto mb-2" />
                <Skeleton className="h-4 w-24 mx-auto" />
              </div>
            </div>
            <div className="flex items-center justify-between">
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-4 w-24" />
            </div>
          </CardContent>
        </Card>
      ) : dayData?.analysis?.articleTags?.analysisMetadata?.hierarchicalSearch && (
        <Card className="bg-gradient-to-r from-emerald-50 to-teal-50 border-emerald-200">
          <CardContent className="p-6">
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center space-x-2">
                <Search className="w-5 h-5 text-emerald-600" />
                <h3 className="text-lg font-semibold text-slate-900">Search Strategy</h3>
                <Badge variant="secondary" className="bg-emerald-100 text-emerald-800">
                  {dayData.analysis?.articleTags?.analysisMetadata?.hierarchicalSearch?.tierUsed}
                </Badge>
              </div>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
              <div className="text-center p-3 bg-white rounded-lg border">
                <div className="text-2xl font-bold text-emerald-600">
                  {dayData.analysis?.articleTags?.analysisMetadata?.hierarchicalSearch?.diagnostics?.tier1Results}
                </div>
                <div className="text-sm text-slate-600">Bitcoin Events</div>
              </div>
              <div className="text-center p-3 bg-white rounded-lg border">
                <div className="text-2xl font-bold text-emerald-600">
                  {dayData.analysis?.articleTags?.analysisMetadata?.hierarchicalSearch?.diagnostics?.tier2Results}
                </div>
                <div className="text-sm text-slate-600">Crypto & Web3</div>
              </div>
              <div className="text-center p-3 bg-white rounded-lg border">
                <div className="text-2xl font-bold text-emerald-600">
                  {dayData.analysis?.articleTags?.analysisMetadata?.hierarchicalSearch?.diagnostics?.tier3Results}
                </div>
                <div className="text-sm text-slate-600">Macroeconomics</div>
              </div>
            </div>

            <div className="flex items-center justify-between text-sm">
              <div className="flex items-center space-x-4">
                <span className="text-slate-600">
                  Search Path: <span className="font-medium text-slate-900">
                    {dayData.analysis?.articleTags?.analysisMetadata?.hierarchicalSearch?.searchPath?.join(' → ')}
                  </span>
                </span>
                {dayData.analysis?.articleTags?.analysisMetadata?.hierarchicalSearch?.diagnostics?.fallbackTriggered && (
                  <Badge variant="outline" className="text-orange-700 border-orange-300">
                    Fallback Used
                  </Badge>
                )}
              </div>
              <span className="text-slate-500">
                {dayData.analysis?.articleTags?.analysisMetadata?.hierarchicalSearch?.totalSearched} total searched
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Data Mismatch Warning */}
      {dayData?.analysis?.topArticleId && 
       !dayData.analysis.topArticleId.includes('no-news-') && 
       dayData.analysis.topArticleId !== 'none' &&
       analyzedArticles.length > 0 && 
       !analyzedArticles.find(article => article.id === dayData.analysis.topArticleId) && (
        <Card className="border-amber-200 bg-amber-50">
          <CardContent className="p-4">
            <div className="flex items-start space-x-3">
              <div className="flex-shrink-0">
                <div className="w-8 h-8 bg-amber-100 rounded-full flex items-center justify-center">
                  <TrendingUp className="w-4 h-4 text-amber-600" />
                </div>
              </div>
              <div className="flex-1">
                <h4 className="text-sm font-medium text-amber-800 mb-1">
                  Analysis Based on Older Articles
                </h4>
                <p className="text-sm text-amber-700 mb-3">
                  This analysis was created using different articles than what's currently available. 
                  News sources change over time, so the summary and featured article may not match the current articles below.
                </p>
                <div className="flex items-center space-x-3">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleReanalyzeClick}
                    disabled={reanalyzeMutation.isPending || isAnalyzing}
                    className="text-amber-700 border-amber-300 hover:bg-amber-100"
                  >
                    {reanalyzeMutation.isPending ? (
                      <>
                        <span className="animate-spin w-3 h-3 border border-amber-600 border-t-transparent rounded-full mr-2"></span>
                        Re-analyzing...
                      </>
                    ) : (
                      <>
                        <TrendingUp className="w-3 h-3 mr-1" />
                        Update Analysis
                      </>
                    )}
                  </Button>
                  <span className="text-xs text-amber-600">
                    This will analyze the current articles and update the summary.
                  </span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Top Article */}
      {isLoading || !dayData ? (
        <Card>
          <CardContent className="p-6">
            <div className="flex items-start space-x-4">
              <Skeleton className="w-24 h-16 rounded-lg flex-shrink-0" />
              <div className="flex-1">
                <div className="flex items-center space-x-2 mb-2">
                  <Skeleton className="h-5 w-20" />
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-4 w-16" />
                </div>
                <Skeleton className="h-6 w-full mb-2" />
                <Skeleton className="h-4 w-3/4 mb-3" />
                <div className="flex items-center justify-between">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-6 w-20" />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : topArticle && (
        <Card>
          <CardContent className="p-6">
            <div className="flex items-start space-x-4">
              <div className="w-24 h-16 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center flex-shrink-0">
                <TrendingUp className="w-8 h-8 text-white" />
              </div>
              <div className="flex-1">
                <div className="flex items-center space-x-2 mb-2">
                  <Badge className="bg-blue-100 text-blue-800">Top Article</Badge>
                  <span className="text-slate-500 text-sm">
                    {new URL(topArticle.url).hostname}
                  </span>
                  <span className="text-slate-400">•</span>
                  <span className="text-slate-500 text-sm">
                    {new Date(topArticle.publishedDate).toLocaleTimeString('en-US', {
                      hour: 'numeric',
                      minute: '2-digit',
                      hour12: true
                    })}
                  </span>
                </div>
                <h4 className="text-lg font-semibold text-slate-900 leading-tight mb-2">
                  {topArticle.title}
                </h4>
                <p className="text-slate-600 text-sm leading-relaxed mb-3">
                  {topArticle.summary ? 
                    topArticle.summary : 
                    topArticle.text ? 
                      `${topArticle.text.slice(0, 200)}...` : 
                      'Content not available from source.'
                  }
                </p>
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-4 text-sm text-slate-500">
                    {topArticle.author && (
                      <span><Eye className="w-3 h-3 mr-1 inline" />By {topArticle.author}</span>
                    )}
                    {topArticle.score && (
                      <span><Star className="w-3 h-3 mr-1 inline" />{(topArticle.score * 10).toFixed(1)} rating</span>
                    )}
                  </div>
                  <Button variant="link" size="sm" asChild>
                    <a href={topArticle.url} target="_blank" rel="noopener noreferrer">
                      Read Article <ExternalLink className="w-3 h-3 ml-1" />
                    </a>
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* AI Reasoning */}
      {dayData?.analysis.reasoning && (
        <Card className="bg-slate-50">
          <CardHeader>
            <CardTitle>AI Reasoning</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-slate-700 leading-relaxed">
              {dayData.analysis.reasoning}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Multi-Tier Articles Interface */}
      {(hasTieredData || analyzedArticles.length > 0) && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Layers className="w-5 h-5 text-slate-600" />
                <CardTitle>
                  {hasTieredData ? 'All Source Articles by Tier' : 'All Source Articles'}
                </CardTitle>
                {winningTier && (
                  <Badge variant="outline" className={getTierConfig(winningTier).color}>
                    {getTierConfig(winningTier).label} Won
                  </Badge>
                )}
                {dayData?.meta?.dataVersion && (
                  <Badge variant="outline" className="bg-slate-50 text-slate-600">
                    {dayData.meta.dataVersion}
                  </Badge>
                )}
              </div>
            </div>
          </CardHeader>
          
          <CardContent className="space-y-4">
            {/* Tabbed Interface for Tiered Articles */}
            {hasTieredData && tieredArticles ? (
              <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                <TabsList className="grid w-full grid-cols-3">
                  <TabsTrigger value="bitcoin" className="flex items-center space-x-2">
                    <Bitcoin className="w-4 h-4" />
                    <span>Bitcoin</span>
                    <Badge variant="secondary" className="ml-1 bg-orange-100 text-orange-700">
                      {tieredArticles.bitcoin?.length || 0}
                    </Badge>
                    {winningTier === 'bitcoin' && <Star className="w-3 h-3 text-orange-500" />}
                  </TabsTrigger>
                  <TabsTrigger value="crypto" className="flex items-center space-x-2">
                    <Coins className="w-4 h-4" />
                    <span>Crypto</span>
                    <Badge variant="secondary" className="ml-1 bg-blue-100 text-blue-700">
                      {tieredArticles.crypto?.length || 0}
                    </Badge>
                    {winningTier === 'crypto' && <Star className="w-3 h-3 text-blue-500" />}
                  </TabsTrigger>
                  <TabsTrigger value="macro" className="flex items-center space-x-2">
                    <DollarSign className="w-4 h-4" />
                    <span>Macro</span>
                    <Badge variant="secondary" className="ml-1 bg-green-100 text-green-700">
                      {tieredArticles.macro?.length || 0}
                    </Badge>
                    {winningTier === 'macro' && <Star className="w-3 h-3 text-green-500" />}
                  </TabsTrigger>
                </TabsList>

                {/* Tier Analysis Summary */}
                {winningTier && (
                  <div className="mt-4 p-4 bg-gradient-to-r from-slate-50 to-slate-100 rounded-lg border">
                    <h4 className="font-medium text-slate-900 mb-2 flex items-center">
                      <BarChart3 className="w-4 h-4 mr-2" />
                      Tier Analysis Summary
                    </h4>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                      <div>
                        <span className="text-slate-500">Winning Tier:</span>
                        <div className={`font-medium capitalize ${getTierConfig(winningTier).accentColor}`}>
                          {getTierConfig(winningTier).label}
                        </div>
                      </div>
                      <div>
                        <span className="text-slate-500">Total Articles:</span>
                        <div className="font-medium text-slate-900">
                          {(tieredArticles.bitcoin?.length || 0) + (tieredArticles.crypto?.length || 0) + (tieredArticles.macro?.length || 0)}
                        </div>
                      </div>
                      <div>
                        <span className="text-slate-500">Source:</span>
                        <div className="font-medium text-slate-900">EXA API</div>
                      </div>
                      <div>
                        <span className="text-slate-500">Search Mode:</span>
                        <div className="font-medium text-slate-900">Sequential Waterfall</div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Tab Content for Bitcoin */}
                <TabsContent value="bitcoin" className="space-y-4">
                  {tieredArticles.bitcoin && tieredArticles.bitcoin.length > 0 ? (
                    <div className="space-y-4">
                      {tieredArticles.bitcoin.map((article) => {
                        const isSelectedArticle = dayData?.analysis.topArticleId === article.id;
                        return (
                          <div 
                            key={article.id} 
                            className={`border rounded-lg p-4 ${
                              isSelectedArticle ? 'border-orange-300 bg-orange-50' : 'border-slate-200'
                            }`}
                          >
                            {isSelectedArticle && (
                              <div className="mb-3">
                                <Badge className="bg-orange-600 text-white">
                                  <Star className="w-3 h-3 mr-1" />
                                  Selected for Analysis
                                </Badge>
                              </div>
                            )}
                            
                            <div className="flex justify-between items-start">
                              <div className="flex-1">
                                <div className="flex items-center justify-between mb-2">
                                  <div className="flex items-center space-x-2">
                                    <span className="text-slate-500 text-sm font-medium">
                                      {new URL(article.url).hostname}
                                    </span>
                                    <span className="text-slate-400">•</span>
                                    <span className="text-slate-500 text-sm">
                                      {new Date(article.publishedDate).toLocaleTimeString('en-US', {
                                        hour: 'numeric',
                                        minute: '2-digit',
                                        hour12: true
                                      })}
                                    </span>
                                    <Badge variant="outline" className="text-xs bg-orange-100 text-orange-800 border-orange-200">
                                      Bitcoin Tier
                                    </Badge>
                                  </div>
                                  
                                  {/* Article Selection Star */}
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-8 w-8 p-0 hover:bg-orange-100"
                                    onClick={() => handleArticleSelect(article.id)}
                                    disabled={selectingArticleId === article.id || selectArticleMutation.isPending}
                                    title={isSelectedArticle ? "Currently selected article" : "Select this article for analysis"}
                                  >
                                    {selectingArticleId === article.id ? (
                                      <RefreshCw className="w-4 h-4 animate-spin text-orange-600" />
                                    ) : isSelectedArticle ? (
                                      <Star className="w-4 h-4 fill-orange-600 text-orange-600" />
                                    ) : (
                                      <Star className="w-4 h-4 text-slate-400 hover:text-orange-600 transition-colors" />
                                    )}
                                  </Button>
                                </div>
                                
                                <h5 className="font-semibold text-slate-900 mb-2 leading-tight">
                                  <a 
                                    href={article.url} 
                                    target="_blank" 
                                    rel="noopener noreferrer"
                                    className="hover:text-orange-600 transition-colors"
                                  >
                                    {article.title}
                                  </a>
                                </h5>
                                
                                {article.summary && (
                                  <div className="mb-3">
                                    <div className="text-xs text-slate-500 mb-1 uppercase tracking-wide">EXA AI Summary</div>
                                    <p className="text-slate-700 text-sm leading-relaxed bg-white p-3 rounded border">
                                      {article.summary}
                                    </p>
                                  </div>
                                )}
                                
                                <div className="flex items-center space-x-4 text-xs text-slate-500">
                                  {article.author && (
                                    <span><Eye className="w-3 h-3 mr-1 inline" />By {article.author}</span>
                                  )}
                                  {article.score && (
                                    <span><BarChart3 className="w-3 h-3 mr-1 inline" />Relevance: {(article.score * 100).toFixed(1)}%</span>
                                  )}
                                </div>
                              </div>
                              
                              <div className="text-right ml-4 space-y-2">
                                {article.score && (
                                  <div className="text-orange-600 text-sm font-medium">
                                    {(article.score * 10).toFixed(1)}/10
                                  </div>
                                )}
                                <Button variant="outline" size="sm" asChild>
                                  <a href={article.url} target="_blank" rel="noopener noreferrer">
                                    <ExternalLink className="w-3 h-3" />
                                  </a>
                                </Button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="text-center py-8 text-slate-500">
                      <Bitcoin className="w-12 h-12 mx-auto mb-3 text-slate-300" />
                      <p>No Bitcoin articles found for this date</p>
                    </div>
                  )}
                </TabsContent>

                {/* Tab Content for Crypto */}
                <TabsContent value="crypto" className="space-y-4">
                  {tieredArticles.crypto && tieredArticles.crypto.length > 0 ? (
                    <div className="space-y-4">
                      {tieredArticles.crypto.map((article) => {
                        const isSelectedArticle = dayData?.analysis.topArticleId === article.id;
                        return (
                          <div 
                            key={article.id} 
                            className={`border rounded-lg p-4 ${
                              isSelectedArticle ? 'border-blue-300 bg-blue-50' : 'border-slate-200'
                            }`}
                          >
                            {isSelectedArticle && (
                              <div className="mb-3">
                                <Badge className="bg-blue-600 text-white">
                                  <Star className="w-3 h-3 mr-1" />
                                  Selected for Analysis
                                </Badge>
                              </div>
                            )}
                            
                            <div className="flex justify-between items-start">
                              <div className="flex-1">
                                <div className="flex items-center justify-between mb-2">
                                  <div className="flex items-center space-x-2">
                                    <span className="text-slate-500 text-sm font-medium">
                                      {new URL(article.url).hostname}
                                    </span>
                                    <span className="text-slate-400">•</span>
                                    <span className="text-slate-500 text-sm">
                                      {new Date(article.publishedDate).toLocaleTimeString('en-US', {
                                        hour: 'numeric',
                                        minute: '2-digit',
                                        hour12: true
                                      })}
                                    </span>
                                    <Badge variant="outline" className="text-xs bg-blue-100 text-blue-800 border-blue-200">
                                      Crypto Tier
                                    </Badge>
                                  </div>
                                  
                                  {/* Article Selection Star */}
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-8 w-8 p-0 hover:bg-blue-100"
                                    onClick={() => handleArticleSelect(article.id)}
                                    disabled={selectingArticleId === article.id || selectArticleMutation.isPending}
                                    title={isSelectedArticle ? "Currently selected article" : "Select this article for analysis"}
                                  >
                                    {selectingArticleId === article.id ? (
                                      <RefreshCw className="w-4 h-4 animate-spin text-blue-600" />
                                    ) : isSelectedArticle ? (
                                      <Star className="w-4 h-4 fill-blue-600 text-blue-600" />
                                    ) : (
                                      <Star className="w-4 h-4 text-slate-400 hover:text-blue-600 transition-colors" />
                                    )}
                                  </Button>
                                </div>
                                
                                <h5 className="font-semibold text-slate-900 mb-2 leading-tight">
                                  <a 
                                    href={article.url} 
                                    target="_blank" 
                                    rel="noopener noreferrer"
                                    className="hover:text-blue-600 transition-colors"
                                  >
                                    {article.title}
                                  </a>
                                </h5>
                                
                                {article.summary && (
                                  <div className="mb-3">
                                    <div className="text-xs text-slate-500 mb-1 uppercase tracking-wide">EXA AI Summary</div>
                                    <p className="text-slate-700 text-sm leading-relaxed bg-white p-3 rounded border">
                                      {article.summary}
                                    </p>
                                  </div>
                                )}
                                
                                <div className="flex items-center space-x-4 text-xs text-slate-500">
                                  {article.author && (
                                    <span><Eye className="w-3 h-3 mr-1 inline" />By {article.author}</span>
                                  )}
                                  {article.score && (
                                    <span><BarChart3 className="w-3 h-3 mr-1 inline" />Relevance: {(article.score * 100).toFixed(1)}%</span>
                                  )}
                                </div>
                              </div>
                              
                              <div className="text-right ml-4 space-y-2">
                                {article.score && (
                                  <div className="text-blue-600 text-sm font-medium">
                                    {(article.score * 10).toFixed(1)}/10
                                  </div>
                                )}
                                <Button variant="outline" size="sm" asChild>
                                  <a href={article.url} target="_blank" rel="noopener noreferrer">
                                    <ExternalLink className="w-3 h-3" />
                                  </a>
                                </Button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="text-center py-8 text-slate-500">
                      <Coins className="w-12 h-12 mx-auto mb-3 text-slate-300" />
                      <p>No crypto/web3 articles found for this date</p>
                    </div>
                  )}
                </TabsContent>

                {/* Tab Content for Macro */}
                <TabsContent value="macro" className="space-y-4">
                  {tieredArticles.macro && tieredArticles.macro.length > 0 ? (
                    <div className="space-y-4">
                      {tieredArticles.macro.map((article) => {
                        const isSelectedArticle = dayData?.analysis.topArticleId === article.id;
                        return (
                          <div 
                            key={article.id} 
                            className={`border rounded-lg p-4 ${
                              isSelectedArticle ? 'border-green-300 bg-green-50' : 'border-slate-200'
                            }`}
                          >
                            {isSelectedArticle && (
                              <div className="mb-3">
                                <Badge className="bg-green-600 text-white">
                                  <Star className="w-3 h-3 mr-1" />
                                  Selected for Analysis
                                </Badge>
                              </div>
                            )}
                            
                            <div className="flex justify-between items-start">
                              <div className="flex-1">
                                <div className="flex items-center justify-between mb-2">
                                  <div className="flex items-center space-x-2">
                                    <span className="text-slate-500 text-sm font-medium">
                                      {new URL(article.url).hostname}
                                    </span>
                                    <span className="text-slate-400">•</span>
                                    <span className="text-slate-500 text-sm">
                                      {new Date(article.publishedDate).toLocaleTimeString('en-US', {
                                        hour: 'numeric',
                                        minute: '2-digit',
                                        hour12: true
                                      })}
                                    </span>
                                    <Badge variant="outline" className="text-xs bg-green-100 text-green-800 border-green-200">
                                      Macro Tier
                                    </Badge>
                                  </div>
                                  
                                  {/* Article Selection Star */}
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-8 w-8 p-0 hover:bg-green-100"
                                    onClick={() => handleArticleSelect(article.id)}
                                    disabled={selectingArticleId === article.id || selectArticleMutation.isPending}
                                    title={isSelectedArticle ? "Currently selected article" : "Select this article for analysis"}
                                  >
                                    {selectingArticleId === article.id ? (
                                      <RefreshCw className="w-4 h-4 animate-spin text-green-600" />
                                    ) : isSelectedArticle ? (
                                      <Star className="w-4 h-4 fill-green-600 text-green-600" />
                                    ) : (
                                      <Star className="w-4 h-4 text-slate-400 hover:text-green-600 transition-colors" />
                                    )}
                                  </Button>
                                </div>
                                
                                <h5 className="font-semibold text-slate-900 mb-2 leading-tight">
                                  <a 
                                    href={article.url} 
                                    target="_blank" 
                                    rel="noopener noreferrer"
                                    className="hover:text-green-600 transition-colors"
                                  >
                                    {article.title}
                                  </a>
                                </h5>
                                
                                {article.summary && (
                                  <div className="mb-3">
                                    <div className="text-xs text-slate-500 mb-1 uppercase tracking-wide">EXA AI Summary</div>
                                    <p className="text-slate-700 text-sm leading-relaxed bg-white p-3 rounded border">
                                      {article.summary}
                                    </p>
                                  </div>
                                )}
                                
                                <div className="flex items-center space-x-4 text-xs text-slate-500">
                                  {article.author && (
                                    <span><Eye className="w-3 h-3 mr-1 inline" />By {article.author}</span>
                                  )}
                                  {article.score && (
                                    <span><BarChart3 className="w-3 h-3 mr-1 inline" />Relevance: {(article.score * 100).toFixed(1)}%</span>
                                  )}
                                </div>
                              </div>
                              
                              <div className="text-right ml-4 space-y-2">
                                {article.score && (
                                  <div className="text-green-600 text-sm font-medium">
                                    {(article.score * 10).toFixed(1)}/10
                                  </div>
                                )}
                                <Button variant="outline" size="sm" asChild>
                                  <a href={article.url} target="_blank" rel="noopener noreferrer">
                                    <ExternalLink className="w-3 h-3" />
                                  </a>
                                </Button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="text-center py-8 text-slate-500">
                      <DollarSign className="w-12 h-12 mx-auto mb-3 text-slate-300" />
                      <p>No macro/financial articles found for this date</p>
                    </div>
                  )}
                </TabsContent>
              </Tabs>
            ) : (
              /* Legacy Article Display for Backward Compatibility */
              <div className="space-y-4">
                <div className="bg-slate-50 p-4 rounded-lg border">
                  <h4 className="font-medium text-slate-900 mb-2 flex items-center">
                    <BarChart3 className="w-4 h-4 mr-2" />
                    Search Analysis (Legacy)
                  </h4>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                    <div>
                      <span className="text-slate-500">Tier Used:</span>
                      <div className="font-medium text-slate-900 capitalize">{(dayData?.analysis as any)?.tierUsed || 'Unknown'}</div>
                    </div>
                    <div>
                      <span className="text-slate-500">Total Searched:</span>
                      <div className="font-medium text-slate-900">{analyzedArticles.length}</div>
                    </div>
                    <div>
                      <span className="text-slate-500">Sources:</span>
                      <div className="font-medium text-slate-900">EXA</div>
                    </div>
                    <div>
                      <span className="text-slate-500">Data Version:</span>
                      <div className="font-medium text-slate-900">v1-legacy</div>
                    </div>
                  </div>
                </div>

                {/* Legacy Articles Display */}
                {(() => {
                  const startIndex = (currentPage - 1) * articlesPerPage;
                const endIndex = startIndex + articlesPerPage;
                const currentArticles = analyzedArticles.slice(startIndex, endIndex);
                const totalPages = Math.ceil(analyzedArticles.length / articlesPerPage);

                return (
                  <>
                    {currentArticles.map((article) => {
                      const isSelectedArticle = dayData?.analysis.topArticleId === article.id;
                      
                      return (
                        <div 
                          key={article.id} 
                          className={`border rounded-lg p-4 ${
                            isSelectedArticle ? 'border-blue-300 bg-blue-50' : 'border-slate-200'
                          }`}
                        >
                          {isSelectedArticle && (
                            <div className="mb-3">
                              <Badge className="bg-blue-600 text-white">
                                <Star className="w-3 h-3 mr-1" />
                                Selected for Analysis
                              </Badge>
                            </div>
                          )}
                          
                          <div className="flex justify-between items-start">
                            <div className="flex-1">
                              <div className="flex items-center justify-between mb-2">
                                <div className="flex items-center space-x-2">
                                  <span className="text-slate-500 text-sm font-medium">
                                    {new URL(article.url).hostname}
                                  </span>
                                  <span className="text-slate-400">•</span>
                                  <span className="text-slate-500 text-sm">
                                    {new Date(article.publishedDate).toLocaleTimeString('en-US', {
                                      hour: 'numeric',
                                      minute: '2-digit',
                                      hour12: true
                                    })}
                                  </span>
                                  {article.source && (
                                    <>
                                      <span className="text-slate-400">•</span>
                                      <Badge 
                                        variant="outline"
                                        className={`text-xs ${
                                          article.source === 'EXA' 
                                            ? 'bg-green-100 text-green-800 border-green-200' 
                                            : 'bg-amber-100 text-amber-800 border-amber-200'
                                        }`}
                                      >
                                        {article.source}
                                      </Badge>
                                    </>
                                  )}
                                </div>
                                
                                {/* Article Selection Star */}
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-8 w-8 p-0 hover:bg-slate-100"
                                  onClick={() => handleArticleSelect(article.id)}
                                  disabled={selectingArticleId === article.id || selectArticleMutation.isPending}
                                  title={isSelectedArticle ? "Currently selected article" : "Select this article for analysis"}
                                >
                                  {selectingArticleId === article.id ? (
                                    <RefreshCw className="w-4 h-4 animate-spin text-slate-600" />
                                  ) : isSelectedArticle ? (
                                    <Star className="w-4 h-4 fill-slate-600 text-slate-600" />
                                  ) : (
                                    <Star className="w-4 h-4 text-slate-400 hover:text-slate-600 transition-colors" />
                                  )}
                                </Button>
                              </div>
                              
                              <h5 className="font-semibold text-slate-900 mb-2 leading-tight">
                                <a 
                                  href={article.url} 
                                  target="_blank" 
                                  rel="noopener noreferrer"
                                  className="hover:text-blue-600 transition-colors"
                                >
                                  {article.title}
                                </a>
                              </h5>
                              
                              {/* EXA Rich Summary */}
                              {article.summary && (
                                <div className="mb-3">
                                  <div className="text-xs text-slate-500 mb-1 uppercase tracking-wide">EXA AI Summary</div>
                                  <p className="text-slate-700 text-sm leading-relaxed bg-white p-3 rounded border">
                                    {article.summary}
                                  </p>
                                </div>
                              )}
                              
                              {/* Final Analysis Summary Comparison */}
                              {isSelectedArticle && dayData?.analysis.summary && (
                                <div className="mb-3">
                                  <div className="text-xs text-blue-600 mb-1 uppercase tracking-wide">Final Analysis (100-110 chars)</div>
                                  <p className="text-blue-800 text-sm font-medium bg-blue-100 p-2 rounded border border-blue-200">
                                    {dayData.analysis.summary}
                                  </p>
                                </div>
                              )}
                              
                              <div className="flex items-center space-x-4 text-xs text-slate-500">
                                {article.author && (
                                  <span><Eye className="w-3 h-3 mr-1 inline" />By {article.author}</span>
                                )}
                                {article.score && (
                                  <span><BarChart3 className="w-3 h-3 mr-1 inline" />Relevance: {(article.score * 100).toFixed(1)}%</span>
                                )}
                              </div>
                            </div>
                            
                            <div className="text-right ml-4 space-y-2">
                              {article.score && (
                                <div className="text-emerald-600 text-sm font-medium">
                                  {(article.score * 10).toFixed(1)}/10
                                </div>
                              )}
                              <Button variant="outline" size="sm" asChild>
                                <a href={article.url} target="_blank" rel="noopener noreferrer">
                                  <ExternalLink className="w-3 h-3" />
                                </a>
                              </Button>
                            </div>
                          </div>
                      </div>
                    );
                  })}
                    
                    {/* Pagination Controls */}
                    {totalPages > 1 && (
                      <div className="flex items-center justify-between border-t pt-4">
                        <div className="text-sm text-slate-600">
                          Showing {startIndex + 1}-{Math.min(endIndex, analyzedArticles.length)} of {analyzedArticles.length} articles
                        </div>
                      <div className="flex items-center space-x-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                          disabled={currentPage === 1}
                        >
                          Previous
                        </Button>
                        <div className="flex items-center space-x-1">
                          {Array.from({ length: totalPages }, (_, i) => i + 1).map(pageNum => (
                            <Button
                              key={pageNum}
                              variant={currentPage === pageNum ? "default" : "outline"}
                              size="sm"
                              onClick={() => setCurrentPage(pageNum)}
                              className="w-8 h-8 p-0"
                            >
                              {pageNum}
                            </Button>
                          ))}
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                          disabled={currentPage === totalPages}
                        >
                          Next
                        </Button>
                      </div>
                    </div>
                  )}
                </>
              );
            })()}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Re-analyze Confirmation Dialog */}
      <AlertDialog open={showReanalyzeConfirm} onOpenChange={setShowReanalyzeConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Re-analysis</AlertDialogTitle>
            <AlertDialogDescription>
              This will delete all saved data for {date}, including:
              <br />
              • Current analysis and summary
              <br />
              • All cached news articles
              <br />
              • Any manual edits or flags
              <br />
              <br />
              A fresh analysis will be performed using the latest news data and AI models.
              <br />
              <br />
              <strong>This action cannot be undone.</strong>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmReanalyze}
              className="bg-red-600 hover:bg-red-700"
            >
              Delete & Re-analyze
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
