import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { VeriBadge } from "@/components/VeriBadge";
import { ArticleSelectionDialog } from "@/components/ArticleSelectionDialog";
import { useToast } from "@/hooks/use-toast";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { queryClient, clearCacheForDate } from "@/lib/queryClient";
import { apiRequest } from "@/lib/queryClient";
import { debounce } from "@/lib/debounce";
import { useApiHealthCheck } from "@/hooks/useApiHealthCheck";
import { useAiProvider } from "@/hooks/useAiProvider";
import { NewsArticle } from "@/types/api-types";
import { supabase } from "@/lib/supabase";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";



import { 
  ArrowLeft,
  ArrowRight, 
  Bot, 
  Pencil,
  X,
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
  Loader2,
  Globe,
  Building,
  User,
  Building2,
  Hash,
  Sparkles,
  Tag,
  Minus,
  Plus
} from "lucide-react";
import { getCategoryColor, getCategoryIcon, getTagCategory } from "@/utils/tagHelpers";
import { getCategoryKeyFromPath, getCategoryDisplayMeta } from "@shared/taxonomy";

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
    veriBadge?: 'Manual' | 'Orphan' | 'Verified' | 'Not Available' | null;
    tagsVersion2?: string[];
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
  const [hoveredTag, setHoveredTag] = React.useState<string | null>(null);
  const [isTaggingMode, setIsTaggingMode] = React.useState(false);
  const [isAddTagDialogOpen, setIsAddTagDialogOpen] = React.useState(false);
  const [tagSearchQuery, setTagSearchQuery] = React.useState('');
  const [tagPage, setTagPage] = React.useState(0);
  const tagsPerPage = 10;
  const [currentPage, setCurrentPage] = React.useState(1);
  const [selectionDialogOpen, setSelectionDialogOpen] = React.useState(false);
  const [selectionData, setSelectionData] = React.useState<any>(null);
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
    queryKey: [`supabase-date-${date}`],
    queryFn: async () => {
      if (!supabase || !date) throw new Error("Supabase not configured or date missing");

      // Fetch analysis for the specific date
      const { data: analysis, error } = await supabase
        .from("historical_news_analyses")
        .select("*")
        .eq("date", date)
        .single();

      if (error && error.code !== 'PGRST116') throw error; // PGRST116 = no rows returned
      if (!analysis) {
        // Return empty structure if no analysis exists
        return {
          analysis: {
            id: '',
            date: date,
            summary: '',
            topArticleId: '',
            reasoning: '',
            confidenceScore: '0',
            aiProvider: 'unknown',
            isManualOverride: false,
            isFlagged: false,
            tagsVersion2: [],
            articleTags: {
              totalArticles: 0,
              topSources: [],
              duplicatesFound: 0,
              sourcesUsed: [],
              totalFetched: 0,
            }
          },
          manualEntries: [],
          tieredArticles: {
            bitcoin: [],
            crypto: [],
            macro: []
          },
          winningTier: null,
          meta: {
            hasLegacyData: false,
            hasTieredData: false,
            dataVersion: 'v2-tiered' as const
          }
        };
      }

      // Fetch manual entries for this date (if any)
      const { data: manualEntries } = await supabase
        .from("manual_news_entries")
        .select("*")
        .eq("date", date);

      // Check if tiered_articles has actual data
      const tieredArticles = analysis.tiered_articles || { bitcoin: [], crypto: [], macro: [] };
      const hasTieredData = !!(
        (tieredArticles.bitcoin && tieredArticles.bitcoin.length > 0) ||
        (tieredArticles.crypto && tieredArticles.crypto.length > 0) ||
        (tieredArticles.macro && tieredArticles.macro.length > 0)
      );

      return {
        analysis: {
          id: analysis.id,
          date: analysis.date,
          summary: analysis.summary,
          topArticleId: analysis.top_article_id || '',
          reasoning: analysis.reasoning || '',
          confidenceScore: analysis.confidence_score || '0',
          aiProvider: analysis.ai_provider || 'unknown',
          isManualOverride: analysis.is_manual_override || false,
          isFlagged: false,
          veriBadge: analysis.veri_badge as 'Manual' | 'Orphan' | 'Verified' | 'Not Available' | null | undefined,
          tagsVersion2: analysis.tags_version2 || [],
          articleTags: {
            totalArticles: analysis.total_articles_fetched || 0,
            topSources: [],
            duplicatesFound: 0,
            sourcesUsed: [],
            totalFetched: analysis.total_articles_fetched || 0,
          }
        },
        manualEntries: manualEntries?.map(entry => ({
          id: entry.id,
          title: entry.title || '',
          summary: entry.summary || '',
          description: entry.description || ''
        })) || [],
        tieredArticles,
        analyzedArticles: analysis.analyzed_articles || [],
        winningTier: analysis.tier_used || analysis.winning_tier || null,
        meta: {
          hasLegacyData: !hasTieredData && (analysis.analyzed_articles && analysis.analyzed_articles.length > 0),
          hasTieredData,
          dataVersion: hasTieredData ? 'v2-tiered' : 'v1-legacy'
        }
      };
    },
  });

  // Query for all available tags (for the add tag dialog)
  const { data: allTags } = useQuery<Array<{ name: string; category: string; subcategory_path: string[] | null }>>({
    queryKey: ['all-tags'],
    queryFn: async () => {
      if (!supabase) return [];
      const { data, error } = await supabase
        .from('tags')
        .select('name, category, subcategory_path')
        .order('name');
      if (error) throw error;
      return data || [];
    },
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
  });

  // Filter tags based on search query
  const filteredTags = React.useMemo(() => {
    if (!allTags || !tagSearchQuery.trim()) return allTags || [];
    const query = tagSearchQuery.toLowerCase();
    return allTags.filter(tag => 
      tag.name.toLowerCase().includes(query)
    );
  }, [allTags, tagSearchQuery]);

  const analyzeDayMutation = useMutation({
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
        const errorText = await response.text();
        console.error('Analysis failed:', errorText);
        throw new Error(`Failed to analyze: ${response.statusText}`);
      }
      const data = await response.json();
      console.log('Analysis response:', { 
        hasRequiresSelection: !!data.requiresSelection, 
        requiresSelection: data.requiresSelection,
        selectionMode: data.selectionMode,
        hasTieredArticles: !!data.tieredArticles 
      });
      return data;
    },
    onSuccess: (data: any) => {
      console.log('🔍 [DayAnalysis] Analysis response received:', {
        hasRequiresSelection: !!data?.requiresSelection,
        requiresSelection: data?.requiresSelection,
        selectionMode: data?.selectionMode,
        hasTieredArticles: !!data?.tieredArticles,
        tieredArticlesKeys: data?.tieredArticles ? Object.keys(data.tieredArticles) : [],
        fullData: data
      });
      
      // Check if user selection is required
      if (data?.requiresSelection) {
        console.log('✅ [DayAnalysis] User selection required - opening dialog');
        console.log('   Selection data:', {
          mode: data.selectionMode,
          geminiCount: data.geminiSelectedIds?.length || 0,
          perplexityCount: data.perplexitySelectedIds?.length || 0,
          intersectionCount: data.intersectionIds?.length || 0,
          openaiSuggested: data.openaiSuggestedId,
          tieredArticles: data.tieredArticles ? {
            bitcoin: data.tieredArticles.bitcoin?.length || 0,
            crypto: data.tieredArticles.crypto?.length || 0,
            macro: data.tieredArticles.macro?.length || 0
          } : null
        });
        console.log('   Full selection data:', JSON.stringify(data, null, 2));
        setSelectionData(data);
        setSelectionDialogOpen(true);
        console.log('   State updated: selectionDialogOpen = true, selectionData set');
        setIsAnalyzing(false);
        return;
      }
      
      console.log('ℹ️ [DayAnalysis] No selection required - continuing with normal flow');

      // DON'T invalidate current date query to prevent re-triggering useEffect
      // Instead, refetch it explicitly to get fresh data without making dayData undefined
      queryClient.refetchQueries({ queryKey: [`supabase-date-${date}`] });
      
      // Also invalidate year data for calendar updates
      const dateYear = date?.substring(0, 4);
      if (dateYear) {
        queryClient.invalidateQueries({ queryKey: [`supabase-year-${dateYear}`] });
      }
      
      // Invalidate stats for homepage
      queryClient.invalidateQueries({ queryKey: ['/api/analysis/stats'] });
      
      setHasNewAnalysis(true);
      setHasUnsavedChanges(false); // Reset manual changes flag since we have new analysis
      setIsAnalyzing(false); // Reset analyzing state
      // Reset the ref so future navigations to this date can trigger analysis if needed
      analysisTriggeredRef.current = null;
      
      // Check if AIs didn't agree
      if (data?.aisDidntAgree) {
        toast({
          title: "⚠️ AIs Didn't Agree",
          description: `Gemini and Perplexity couldn't agree on any articles for this date. News articles were still saved and are available for manual review.`,
          variant: "default",
          duration: 8000,
        });
      } else {
        toast({
          title: "Analysis Complete",
          description: `Bitcoin news analysis for ${new Date(date!).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })} has been updated successfully.`,
        });
      }
    },
    onError: (error: any) => {
      setIsAnalyzing(false); // Reset analyzing state
      // Reset the ref on error so user can retry
      analysisTriggeredRef.current = null;
      toast({
        title: "Analysis Failed",
        description: error.message || "Failed to analyze the news for this date.",
        variant: "destructive",
      });
    },
  });

  const redoSummaryMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/analysis/date/${date}/redo-summary`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      });
      if (!response.ok) {
        throw new Error(`Failed to regenerate summary: ${response.statusText}`);
      }
      return response.json();
    },
    onSuccess: () => {
      // Refetch the current date query to get updated summary
      queryClient.refetchQueries({ queryKey: [`supabase-date-${date}`] });
      
      // Also invalidate year data for calendar updates
      const dateYear = date?.substring(0, 4);
      if (dateYear) {
        queryClient.invalidateQueries({ queryKey: [`supabase-year-${dateYear}`] });
      }
      
      // Invalidate stats for homepage
      queryClient.invalidateQueries({ queryKey: ['/api/analysis/stats'] });
      
      setHasUnsavedChanges(false);
      
      toast({
        title: "Summary Regenerated",
        description: "Summary has been regenerated successfully from the existing article.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Regeneration Failed",
        description: error.message || "Failed to regenerate summary.",
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

  const handleAnalyzeDay = () => {
    // Prevent multiple clicks
    if (isAnalyzing || analyzeDayMutation.isPending) {
      console.log('Analysis already in progress, ignoring click');
      return;
    }
    
    const triggerSource = `ANALYSE_DAY_${Date.now()}`;
    console.log(`🔄 [${triggerSource}] Analyse Day triggered for date: ${date}`);
    console.log(`📍 [${triggerSource}] Trigger context: analyse day button click`);
    console.log(`🌐 [${triggerSource}] Current URL: ${window.location.href}`);
    console.log(`⏰ [${triggerSource}] Timestamp: ${new Date().toISOString()}`);
    
    setIsAnalyzing(true);
    analyzeDayMutation.mutate();
  };

  const handleRedoSummary = () => {
    // Prevent multiple clicks
    if (redoSummaryMutation.isPending) {
      console.log('Summary regeneration already in progress, ignoring click');
      return;
    }
    
    redoSummaryMutation.mutate();
  };

  // Handler for initial analysis
  const handleInitialAnalyze = () => {
    // Prevent multiple clicks
    if (isAnalyzing || analyzeDayMutation.isPending) {
      console.log('Analysis already in progress, ignoring click');
      return;
    }
    
    const triggerSource = `INITIAL_ANALYSIS_${Date.now()}`;
    console.log(`🔄 [${triggerSource}] Initial analysis triggered for date: ${date}`);
    console.log(`📍 [${triggerSource}] Trigger context: initial analyse button click`);
    console.log(`🌐 [${triggerSource}] Current URL: ${window.location.href}`);
    console.log(`⏰ [${triggerSource}] Timestamp: ${new Date().toISOString()}`);
    
    setIsAnalyzing(true);
    analyzeDayMutation.mutate();
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
          is_manual_override: true
        }),
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `Failed to save: ${response.statusText}`);
      }
      
      return response.json();
    },
    onSuccess: () => {
      // Invalidate multiple related queries to ensure UI updates
      queryClient.invalidateQueries({ queryKey: [`supabase-date-${date}`] });
      
      // Get year from date to invalidate year data (for calendar updates)
      const dateYear = date?.substring(0, 4);
      if (dateYear) {
        queryClient.invalidateQueries({ queryKey: [`supabase-year-${dateYear}`] });
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

  // Remove tag mutation
  const removeTagMutation = useMutation({
    mutationFn: async (tagNameToRemove: string) => {
      if (!dayData?.analysis?.tagsVersion2) {
        throw new Error("No tags to remove");
      }
      
      // Filter out the tag to remove
      const updatedTags = dayData.analysis.tagsVersion2.filter(tag => tag !== tagNameToRemove);
      
      const response = await fetch(`/api/analysis/date/${date}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          summary: dayData.analysis.summary,
          tags_version2: updatedTags,
        }),
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `Failed to remove tag: ${response.statusText}`);
      }
      
      return { success: true, tags_version2: updatedTags };
    },
    onSuccess: () => {
      // Invalidate queries to refresh the UI
      queryClient.invalidateQueries({ queryKey: [`supabase-date-${date}`] });
      
      const dateYear = date?.substring(0, 4);
      if (dateYear) {
        queryClient.invalidateQueries({ queryKey: [`supabase-year-${dateYear}`] });
      }
      
      queryClient.invalidateQueries({ queryKey: ['/api/analysis/stats'] });
      
      toast({
        title: "Tag Removed",
        description: "Tag has been removed from this analysis.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Remove Failed",
        description: error.message || "Failed to remove tag.",
        variant: "destructive",
      });
    },
  });

  // Add tag mutation (for highlight-to-tag feature)
  const addTagMutation = useMutation({
    mutationFn: async (newTagName: string) => {
      const currentTags = dayData?.analysis?.tagsVersion2 || [];
      
      // Don't add duplicate tags
      if (currentTags.includes(newTagName)) {
        throw new Error("Tag already exists");
      }
      
      const updatedTags = [...currentTags, newTagName];
      
      const response = await fetch(`/api/analysis/date/${date}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          summary: dayData?.analysis.summary,
          tags_version2: updatedTags,
        }),
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `Failed to add tag: ${response.statusText}`);
      }
      
      return { success: true, tags_version2: updatedTags };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`supabase-date-${date}`] });
      toast({
        title: "Tag Added",
        description: "New tag has been added.",
      });
    },
    onError: (error: any) => {
      if (error.message !== "Tag already exists") {
        toast({
          title: "Add Failed",
          description: error.message || "Failed to add tag.",
          variant: "destructive",
        });
      }
    },
  });

  // Handle text selection for tagging
  const handleTextSelection = () => {
    if (!isTaggingMode) return;
    
    const selection = window.getSelection();
    const selectedText = selection?.toString().trim();
    
    if (selectedText && selectedText.length > 0 && selectedText.length < 100) {
      addTagMutation.mutate(selectedText);
      selection?.removeAllRanges(); // Clear selection after adding
    }
  };

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
      queryClient.refetchQueries({ queryKey: [`supabase-date-${date}`] });
      
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
    if (isEditing) {
      // Cancel editing
      setIsEditing(false);
      setEditedSummary(dayData?.analysis.summary || '');
      setHasUnsavedChanges(false);
    } else {
      // Start editing
      setIsEditing(true);
      setEditedSummary(dayData?.analysis.summary || '');
    }
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
      queryKey: [`supabase-date-${prevDate}`],
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
      queryKey: [`supabase-date-${nextDate}`],
      staleTime: 5 * 60 * 1000, // Cache for 5 minutes
    });
    
    // Preserve the source parameter when navigating
    window.location.href = `/day/${nextDate}?from=${source}`;
  };

  // Auto-analysis is disabled - user must manually click the Analyse button

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
          if (!analyzeDayMutation.isPending && !isAnalyzing) {
            const triggerSource = `KEYBOARD_R_${Date.now()}`;
            console.log(`🔄 [${triggerSource}] Keyboard 'R' analysis triggered for date: ${date}`);
            console.log(`📍 [${triggerSource}] Trigger context: keyboard shortcut`);
            console.log(`🌐 [${triggerSource}] Current URL: ${window.location.href}`);
            console.log(`⏰ [${triggerSource}] Timestamp: ${new Date().toISOString()}`);
            setIsAnalyzing(true);
            analyzeDayMutation.mutate();
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
  const hasTieredData = dayData?.meta?.hasTieredData || false;
  
  // Compute the winning tier based on where the selected article actually is
  const computedWinningTier = React.useMemo(() => {
    const topArticleId = dayData?.analysis?.topArticleId;
    if (!topArticleId || !tieredArticles) return dayData?.winningTier || null;
    
    if (tieredArticles.bitcoin?.some(a => a.id === topArticleId)) return 'bitcoin';
    if (tieredArticles.crypto?.some(a => a.id === topArticleId)) return 'crypto';
    if (tieredArticles.macro?.some(a => a.id === topArticleId)) return 'macro';
    
    // Fallback to stored value
    return dayData?.winningTier || null;
  }, [dayData?.analysis?.topArticleId, tieredArticles, dayData?.winningTier]);
  
  const winningTier = computedWinningTier;
  
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
          color: 'bg-orange-500/20 text-orange-300 border-orange-500/30',
          accentColor: 'text-orange-400',
          rowColor: 'hover:bg-orange-50/50',
          selectedColor: 'bg-orange-100 border-orange-300'
        };
      case 'crypto':
        return {
          icon: Coins,
          label: 'Crypto/Web3',
          color: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
          accentColor: 'text-blue-400',
          rowColor: 'hover:bg-blue-50/50',
          selectedColor: 'bg-blue-100 border-blue-300'
        };
      case 'macro':
        return {
          icon: DollarSign,
          label: 'Macro/Financial',
          color: 'bg-green-500/20 text-green-300 border-green-500/30',
          accentColor: 'text-green-400',
          rowColor: 'hover:bg-green-50/50',
          selectedColor: 'bg-green-100 border-green-300'
        };
      default:
        return {
          icon: FileText,
          label: 'Articles',
          color: 'bg-muted/50 text-muted-foreground border-border',
          accentColor: 'text-muted-foreground',
          rowColor: 'hover:bg-accent/50',
          selectedColor: 'bg-accent border-border'
        };
    }
  };

  // Helper function to render articles in table format
  const renderArticlesTable = (articles: NewsArticle[], tier: 'bitcoin' | 'crypto' | 'macro') => {
    if (!articles || articles.length === 0) {
      const EmptyIcon = getTierConfig(tier).icon;
      return (
        <div className="text-center py-12 text-muted-foreground">
          <EmptyIcon className="w-12 h-12 mx-auto mb-3 text-muted-foreground" />
          <p>No {getTierConfig(tier).label.toLowerCase()} articles found for this date</p>
        </div>
      );
    }

    const tierConfig = getTierConfig(tier);

    return (
      <div className="rounded-lg border border-border overflow-hidden">
        <Table>
          <TableHeader className="bg-muted/50">
            <TableRow className="border-b border-border hover:bg-accent/50">
              <TableHead className="w-12 text-muted-foreground"></TableHead>
              <TableHead className="font-semibold text-foreground">Title</TableHead>
              <TableHead className="font-semibold text-foreground">Source</TableHead>
              <TableHead className="font-semibold text-foreground">Relevance</TableHead>
              <TableHead className="font-semibold w-24 text-right text-foreground">Link</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {articles.map((article) => {
              const isSelectedArticle = dayData?.analysis.topArticleId === article.id;
              return (
                <TableRow
                  key={article.id}
                  className={`group border-b border-border/50 hover:bg-accent/50 ${
                    isSelectedArticle 
                      ? tier === 'bitcoin' ? 'bg-orange-950/30 hover:bg-orange-950/40' :
                        tier === 'crypto' ? 'bg-blue-950/30 hover:bg-blue-950/40' :
                        'bg-green-950/30 hover:bg-green-950/40'
                      : ''
                  } transition-colors`}
                >
                  <TableCell className="w-12 text-foreground">
                    {selectingArticleId === article.id ? (
                      <div className="flex items-center">
                        <RefreshCw className={`w-4 h-4 animate-spin ${tierConfig.accentColor}`} />
                      </div>
                    ) : isSelectedArticle ? (
                      <Badge className={`${tierConfig.color} border`} variant="outline">
                        <Star className="w-3 h-3 mr-1 fill-current" />
                        Selected
                      </Badge>
                    ) : (
                      <Badge
                        className={`${tierConfig.color} border cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity hover:scale-105 ${
                          selectArticleMutation.isPending ? 'pointer-events-none opacity-50' : ''
                        }`}
                        variant="outline"
                        onClick={() => !selectArticleMutation.isPending && handleArticleSelect(article.id)}
                        title="Select this article"
                      >
                        <Star className="w-3 h-3 mr-1" />
                        Select
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-foreground p-4">
                    <HoverCard>
                      <HoverCardTrigger asChild>
                        <div className="space-y-1 w-full h-full cursor-pointer -m-4 p-4">
                          <a
                            href={article.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={`font-semibold text-foreground hover:text-foreground transition-colors line-clamp-2 block`}
                            onClick={(e) => e.stopPropagation()}
                          >
                            {article.title}
                          </a>
                          {article.summary && (
                            <p className="text-xs text-muted-foreground line-clamp-2 mt-1">
                              {article.summary}
                            </p>
                          )}
                        </div>
                      </HoverCardTrigger>
                      <HoverCardContent className="w-80 bg-accent border-border">
                        <div className="space-y-2">
                          <p className="font-semibold text-accent-foreground leading-relaxed">
                            {article.title}
                          </p>
                          {article.summary && (
                            <p className="text-sm text-muted-foreground leading-relaxed">
                              {article.summary}
                            </p>
                          )}
                        </div>
                      </HoverCardContent>
                    </HoverCard>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    <span className="text-xs">
                      {new URL(article.url).hostname}
                    </span>
                  </TableCell>
                  <TableCell className="text-foreground">
                    {article.score ? (
                      <div className="flex items-center gap-2">
                        <div className="flex-1 bg-muted rounded-full h-2 max-w-[60px]">
                          <div
                            className={`h-2 rounded-full ${
                              tier === 'bitcoin' ? 'bg-orange-500' :
                            tier === 'crypto' ? 'bg-blue-500' :
                            'bg-green-500'
                            }`}
                            style={{ width: `${(article.score * 100)}%` }}
                          />
                        </div>
                        <span className={`text-xs font-medium ${tierConfig.accentColor}`}>
                          {(article.score * 100).toFixed(0)}%
                        </span>
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">N/A</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right text-foreground">
                    <Button variant="ghost" size="sm" className="h-8 w-8 p-0 hover:bg-accent" asChild>
                      <a href={article.url} target="_blank" rel="noopener noreferrer" title="Open article">
                        <ExternalLink className="w-4 h-4 text-muted-foreground hover:text-foreground" />
                      </a>
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    );
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

  // Check if date has no real data (empty id means no analysis exists)
  const hasNoData = !isLoading && dayData && (!dayData.analysis.id || dayData.analysis.id === '');

  // If loading, show loading state
  if (isLoading) {
    return (
      <div className="space-y-6">
        {/* Header with Action Buttons */}
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <Button variant="outline" size="sm" onClick={() => window.history.back()}>
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back
            </Button>
            <div>
              <h1 className="text-xl font-bold text-foreground">
                {new Date(date!).toLocaleDateString('en-US', { 
                  weekday: 'long',
                  year: 'numeric', 
                  month: 'long', 
                  day: 'numeric' 
                })}
              </h1>
            </div>
          </div>
        </div>
        <Card className="relative bg-black/90 border-border">
          <CardContent className="p-6">
            <div className="flex items-center justify-center min-h-[200px]">
              <div className="text-center">
                <Loader2 className="w-8 h-8 animate-spin text-white mx-auto mb-3" />
                <p className="text-white/80 font-medium">Loading analysis...</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // If no data exists, show centered Analyse button
  if (hasNoData) {
    return (
      <div className="space-y-6">
        {/* Header with Action Buttons */}
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <Button variant="outline" size="sm" onClick={() => window.history.back()}>
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back
            </Button>
            <div>
              <h1 className="text-xl font-bold text-foreground">
                {new Date(date!).toLocaleDateString('en-US', { 
                  weekday: 'long',
                  year: 'numeric', 
                  month: 'long', 
                  day: 'numeric' 
                })}
              </h1>
            </div>
          </div>
        </div>

        {/* Centered Analyse Button */}
        <div className="flex items-center justify-center min-h-[60vh]">
          <Button 
            size="lg"
            onClick={handleInitialAnalyze}
            disabled={analyzeDayMutation.isPending || isAnalyzing}
            className="px-8 py-6 text-lg"
          >
            {analyzeDayMutation.isPending || isAnalyzing ? (
              <>
                <RefreshCw className="w-5 h-5 mr-2 animate-spin" />
                Analysing...
              </>
            ) : (
              <>
                <Bot className="w-5 h-5 mr-2" />
                Analyse Day
              </>
            )}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header with Action Buttons */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <Button variant="outline" size="sm" onClick={() => window.history.back()}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back
          </Button>
          <div className="flex items-center space-x-3">
            <h1 className="text-xl font-bold text-foreground">
              {new Date(date!).toLocaleDateString('en-US', { 
                weekday: 'long',
                year: 'numeric', 
                month: 'long', 
                day: 'numeric' 
              })}
            </h1>
            {hasUnsavedChanges || hasNewAnalysis ? (
              <Badge variant="outline" className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30">
                Unsaved changes
              </Badge>
            ) : (
              <Badge variant="outline" className="bg-green-500/20 text-green-400 border-green-500/30">
                All Saved
              </Badge>
            )}
          </div>
        </div>
        
        {/* Action Buttons */}
        <div className="flex items-center space-x-3">
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
          <div className="w-px h-6 bg-border"></div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                disabled={analyzeDayMutation.isPending || redoSummaryMutation.isPending || isAnalyzing}
                title="Re-analyze (R)"
              >
                <RefreshCw className={`w-4 h-4 mr-2 ${(analyzeDayMutation.isPending || redoSummaryMutation.isPending) ? 'animate-spin' : ''}`} />
                Re-analyze
                <ChevronDown className="w-4 h-4 ml-2" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={handleAnalyzeDay}
                disabled={analyzeDayMutation.isPending || isAnalyzing}
              >
                <RefreshCw className="w-4 h-4 mr-2" />
                Analyse Day
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={handleRedoSummary}
                disabled={redoSummaryMutation.isPending || !dayData?.analysis?.topArticleId || dayData?.analysis?.topArticleId === 'none'}
              >
                <FileText className="w-4 h-4 mr-2" />
                Redo Summary
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* AI Summary Card */}
      {isLoading || !dayData?.analysis ? (
        // Loading state with dark background and centered spinner
        <Card className="relative bg-black/90 border-border">
          <CardContent className="p-6">
            <div className="flex items-center justify-center min-h-[200px]">
              <div className="text-center">
                <Loader2 className="w-8 h-8 animate-spin text-white mx-auto mb-3" />
                <p className="text-white/80 font-medium">Loading analysis...</p>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card className="relative bg-background border-border">
          <CardContent className="p-6">
            {/* Loading overlay when analyzing */}
            {(analyzeDayMutation.isPending || redoSummaryMutation.isPending) && (
              <div className="absolute inset-0 bg-black/80 backdrop-blur-sm rounded-lg flex items-center justify-center z-10">
                <div className="text-center">
                  <RefreshCw className="w-8 h-8 animate-spin text-white mx-auto mb-3" />
                  <p className="text-foreground font-medium">
                    {analyzeDayMutation.isPending ? 'Regenerating AI Analysis...' : 'Regenerating Summary...'}
                  </p>
                  <p className="text-muted-foreground text-sm">This may take a few moments</p>
                </div>
              </div>
            )}
            
            <div className="grid grid-cols-2 gap-6 items-start">
              {/* Left Half: Summary Text */}
              <div className="relative pr-6 border-r border-border">
                <div className="flex items-center space-x-2 mb-4">
                  <h3 className="text-lg font-semibold text-foreground">
                    {dayData.analysis.isManualOverride ? 'Manual Entry' : 'Summary'}
                  </h3>
                  {dayData.analysis.summary && (
                    <Badge 
                      variant="secondary" 
                      className={`font-normal ${
                        (isEditing ? editedSummary?.length : dayData.analysis.summary?.length) < 100 || 
                        (isEditing ? editedSummary?.length : dayData.analysis.summary?.length) > 110
                          ? '!bg-red-500/20 !text-red-400 border-red-500/30' 
                          : ''
                      }`}
                    >
                      {((isEditing ? editedSummary?.length : dayData.analysis.summary?.length) || 0).toLocaleString()} characters
                    </Badge>
                  )}
                  {!dayData.analysis.isManualOverride && (
                    <div className="flex items-center space-x-1">
                      {hasUnsavedChanges && (
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          onClick={() => saveChangesMutation.mutate()}
                          disabled={saveChangesMutation.isPending}
                          className="h-8 w-8 p-0 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                          title="Save Changes (S)"
                        >
                          {saveChangesMutation.isPending ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Save className="w-4 h-4" />
                          )}
                        </Button>
                      )}
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        onClick={handleEditClick}
                        className="h-8 w-8 p-0 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                        title={isEditing ? "Cancel editing" : "Edit summary"}
                      >
                        {isEditing ? (
                          <X className="w-4 h-4" />
                        ) : (
                          <Pencil className="w-4 h-4" />
                        )}
                      </Button>
                    </div>
                  )}
                </div>
                {/* Show loading state during article selection */}
                {selectArticleMutation.isPending ? (
                  <div className="flex items-center space-x-3 py-4">
                    <div className="animate-spin rounded-full h-5 w-5 border-2 border-white border-t-transparent"></div>
                    <div className="space-y-1">
                      <p className="text-foreground font-medium">Generating new summary...</p>
                      <p className="text-muted-foreground text-sm">AI is analyzing the selected article</p>
                    </div>
                  </div>
                ) : isEditing && !dayData.analysis.isManualOverride ? (
                  <Textarea
                    value={editedSummary}
                    onChange={(e) => handleSummaryChange(e.target.value)}
                    className="text-base leading-relaxed min-h-[100px] text-foreground bg-background border-input focus-visible:ring-ring"
                    placeholder="Edit the AI summary..."
                  />
                ) : (
                  <div
                    onMouseUp={handleTextSelection}
                    className={isTaggingMode ? 'select-text' : ''}
                    style={isTaggingMode ? { cursor: 'text' } : undefined}
                  >
                    <p 
                      className={`text-foreground text-base leading-relaxed ${isTaggingMode ? 'selection:bg-orange-500/40 selection:text-orange-100' : ''}`}
                    >
                      {dayData.analysis.summary}
                    </p>
                    {isTaggingMode && (
                      <p className="text-xs text-orange-400/70 mt-2 italic">
                        Highlight any text above to create a tag
                      </p>
                    )}
                  </div>
                )}
              </div>
                
                {/* Right Half: Tags and Approval */}
                <div className="flex flex-col pl-6">
                  {/* Applied Tags */}
                  <div>
                    <div className="flex items-center space-x-2 mb-2">
                      <h5 className="text-sm font-semibold text-foreground">Tags</h5>
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        onClick={() => setIsTaggingMode(!isTaggingMode)}
                        className={`h-6 w-6 p-0 ${isTaggingMode ? 'text-orange-400 bg-orange-500/20' : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'}`}
                        title={isTaggingMode ? "Exit tagging mode" : "Highlight text to create tags"}
                      >
                        {isTaggingMode ? (
                          <X className="w-3.5 h-3.5" />
                        ) : (
                          <Pencil className="w-3.5 h-3.5" />
                        )}
                      </Button>
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        onClick={() => setIsAddTagDialogOpen(true)}
                        className="h-6 w-6 p-0 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                        title="Add tag from list"
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </Button>
                      {isTaggingMode && (
                        <span className="text-xs text-orange-400">Select text in summary to add tags</span>
                      )}
                    </div>
                    {dayData.analysis.tagsVersion2 && dayData.analysis.tagsVersion2.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {dayData.analysis.tagsVersion2.map((tagName, idx) => {
                          // Try to infer category from tag name (simple heuristic)
                          // For "Bitcoin" specifically, use crypto category, otherwise default to gray
                          const tagLower = tagName.toLowerCase();
                          let category = 'miscellaneous';
                          if (tagLower.includes('bitcoin') || tagName === 'BTC') {
                            category = 'crypto';
                          }
                          const Icon = getCategoryIcon(category);
                          const isHovered = hoveredTag === tagName;
                          const isRemoving = removeTagMutation.isPending;
                          
                          return (
                            <Badge
                              key={`${tagName}-${idx}`}
                              variant="outline"
                              className={`text-xs px-1.5 py-0.5 flex items-center space-x-1 cursor-pointer transition-all ${
                                isHovered 
                                  ? 'bg-red-500/20 text-red-400 border-red-500/30' 
                                  : getCategoryColor(category)
                              }`}
                              onMouseEnter={() => setHoveredTag(tagName)}
                              onMouseLeave={() => setHoveredTag(null)}
                              onClick={() => !isRemoving && removeTagMutation.mutate(tagName)}
                              title={isHovered ? "Click to remove tag" : undefined}
                            >
                              {isHovered ? (
                                <>
                                  <X className="w-2.5 h-2.5" />
                                  <span>Delete?</span>
                                </>
                              ) : (
                                <>
                                  <Icon className="w-2.5 h-2.5" />
                                  <span>{tagName}</span>
                                </>
                              )}
                            </Badge>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">No tags applied</p>
                    )}
                  </div>
                  
                  {/* More */}
                  <div className="mt-6">
                    <h5 className="text-sm font-semibold text-foreground mb-2">More</h5>
                    <VeriBadge badge={dayData.analysis.veriBadge} />
                  </div>
                </div>
              </div>
          </CardContent>
        </Card>
      )}

      {/* Search Strategy Information */}
      {dayData?.analysis?.articleTags?.analysisMetadata?.hierarchicalSearch && (
        <Card className="bg-gradient-to-r from-emerald-50 to-teal-50 border-emerald-200">
          <CardContent className="p-6">
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center space-x-2">
                <Search className="w-5 h-5 text-emerald-600" />
                <h3 className="text-lg font-semibold text-foreground">Search Strategy</h3>
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
                <div className="text-sm text-muted-foreground">Bitcoin Events</div>
              </div>
              <div className="text-center p-3 bg-white rounded-lg border">
                <div className="text-2xl font-bold text-emerald-600">
                  {dayData.analysis?.articleTags?.analysisMetadata?.hierarchicalSearch?.diagnostics?.tier2Results}
                </div>
                <div className="text-sm text-muted-foreground">Crypto & Web3</div>
              </div>
              <div className="text-center p-3 bg-white rounded-lg border">
                <div className="text-2xl font-bold text-emerald-600">
                  {dayData.analysis?.articleTags?.analysisMetadata?.hierarchicalSearch?.diagnostics?.tier3Results}
                </div>
                <div className="text-sm text-muted-foreground">Macroeconomics</div>
              </div>
            </div>

            <div className="flex items-center justify-between text-sm">
              <div className="flex items-center space-x-4">
                <span className="text-muted-foreground">
                  Search Path: <span className="font-medium text-foreground">
                    {dayData.analysis?.articleTags?.analysisMetadata?.hierarchicalSearch?.searchPath?.join(' → ')}
                  </span>
                </span>
                {dayData.analysis?.articleTags?.analysisMetadata?.hierarchicalSearch?.diagnostics?.fallbackTriggered && (
                  <Badge variant="outline" className="text-orange-700 border-orange-300">
                    Fallback Used
                  </Badge>
                )}
              </div>
              <span className="text-muted-foreground">
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
                    onClick={handleAnalyzeDay}
                    disabled={analyzeDayMutation.isPending || isAnalyzing}
                    className="text-amber-700 border-amber-300 hover:bg-amber-100"
                  >
                    {analyzeDayMutation.isPending ? (
                      <>
                        <span className="animate-spin w-3 h-3 border border-amber-600 border-t-transparent rounded-full mr-2"></span>
                        Analysing...
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

      {/* Multi-Tier Articles Interface */}
      {(hasTieredData || analyzedArticles.length > 0) && (
        <Card className="bg-background border-border">
          <CardHeader className="bg-background rounded-t-xl pb-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <CardTitle className="text-foreground">
                  All Sourced Articles
                </CardTitle>
              </div>
            </div>
          </CardHeader>
          
          <CardContent className="space-y-6 bg-background pt-2">
            {/* Tabbed Interface for Tiered Articles */}
            {hasTieredData && tieredArticles ? (
              <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                <TabsList className="inline-flex h-11 items-center justify-start gap-1 rounded-lg bg-muted/50 p-1 border border-border">
                  <TabsTrigger 
                    value="bitcoin" 
                    className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all
                      data-[state=inactive]:text-muted-foreground data-[state=inactive]:hover:text-orange-300 data-[state=inactive]:hover:bg-orange-500/10
                      data-[state=active]:bg-orange-500/20 data-[state=active]:text-orange-300 data-[state=active]:shadow-sm"
                  >
                    <Bitcoin className="w-4 h-4" />
                    <span>Bitcoin</span>
                    <span className="ml-1 px-1.5 py-0.5 rounded-full bg-orange-500/30 text-orange-200 text-xs font-semibold">
                      {tieredArticles.bitcoin?.length || 0}
                    </span>
                    {winningTier === 'bitcoin' && <Star className="w-3 h-3 text-orange-400 fill-orange-400" />}
                  </TabsTrigger>
                  <TabsTrigger 
                    value="crypto" 
                    className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all
                      data-[state=inactive]:text-muted-foreground data-[state=inactive]:hover:text-blue-300 data-[state=inactive]:hover:bg-blue-500/10
                      data-[state=active]:bg-blue-500/20 data-[state=active]:text-blue-300 data-[state=active]:shadow-sm"
                  >
                    <Coins className="w-4 h-4" />
                    <span>Crypto</span>
                    <span className="ml-1 px-1.5 py-0.5 rounded-full bg-blue-500/30 text-blue-200 text-xs font-semibold">
                      {tieredArticles.crypto?.length || 0}
                    </span>
                    {winningTier === 'crypto' && <Star className="w-3 h-3 text-blue-400 fill-blue-400" />}
                  </TabsTrigger>
                  <TabsTrigger 
                    value="macro" 
                    className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all
                      data-[state=inactive]:text-muted-foreground data-[state=inactive]:hover:text-green-300 data-[state=inactive]:hover:bg-green-500/10
                      data-[state=active]:bg-green-500/20 data-[state=active]:text-green-300 data-[state=active]:shadow-sm"
                  >
                    <DollarSign className="w-4 h-4" />
                    <span>Macro</span>
                    <span className="ml-1 px-1.5 py-0.5 rounded-full bg-green-500/30 text-green-200 text-xs font-semibold">
                      {tieredArticles.macro?.length || 0}
                    </span>
                    {winningTier === 'macro' && <Star className="w-3 h-3 text-green-400 fill-green-400" />}
                  </TabsTrigger>
                </TabsList>

                {/* Tab Content for Bitcoin */}
                <TabsContent value="bitcoin" className="mt-6">
                  {renderArticlesTable(tieredArticles.bitcoin || [], 'bitcoin')}
                </TabsContent>

                {/* Tab Content for Crypto */}
                <TabsContent value="crypto" className="mt-6">
                  {renderArticlesTable(tieredArticles.crypto || [], 'crypto')}
                </TabsContent>

                {/* Tab Content for Macro */}
                <TabsContent value="macro" className="mt-6">
                  {renderArticlesTable(tieredArticles.macro || [], 'macro')}
                </TabsContent>
              </Tabs>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <BarChart3 className="w-12 h-12 mx-auto mb-3 text-muted-foreground" />
                <p>No tiered article data available for this date.</p>
                <p className="text-sm mt-2">Please re-analyze this date to generate tiered article data.</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Article Selection Dialog */}
      {selectionData && (
        <ArticleSelectionDialog
          key={`dialog-${selectionDialogOpen}-${selectionData.selectionMode}`}
          open={selectionDialogOpen}
          onOpenChange={(open) => {
            setSelectionDialogOpen(open);
            if (!open) {
              setSelectionData(null);
            }
          }}
          date={date!}
          selectionMode={selectionData.selectionMode}
          tieredArticles={selectionData.tieredArticles || { bitcoin: [], crypto: [], macro: [] }}
          geminiSelectedIds={selectionData.geminiSelectedIds}
          perplexitySelectedIds={selectionData.perplexitySelectedIds}
          intersectionIds={selectionData.intersectionIds}
          openaiSuggestedId={selectionData.openaiSuggestedId}
          onConfirm={async (articleId: string) => {
            try {
              const response = await fetch(`/api/analysis/date/${date}/confirm-selection`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  articleId,
                  selectionMode: selectionData.selectionMode,
                }),
              });

              if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Failed to confirm selection');
              }

              const result = await response.json();

              // Invalidate queries to refresh the page
              queryClient.refetchQueries({ queryKey: [`supabase-date-${date}`] });
              const dateYear = date?.substring(0, 4);
              if (dateYear) {
                queryClient.invalidateQueries({ queryKey: [`supabase-year-${dateYear}`] });
              }
              queryClient.invalidateQueries({ queryKey: ['/api/analysis/stats'] });

              setHasNewAnalysis(true);
              setHasUnsavedChanges(false);
              setIsAnalyzing(false);
              analysisTriggeredRef.current = null;

              toast({
                title: "Analysis Complete",
                description: `Summary generated successfully. VeriBadge: ${result.veriBadge}`,
              });
            } catch (error) {
              throw error;
            }
          }}
        />
      )}

      {/* Add Tag Dialog */}
      <Dialog open={isAddTagDialogOpen} onOpenChange={(open) => {
        setIsAddTagDialogOpen(open);
        if (!open) {
          setTagSearchQuery('');
          setTagPage(0);
        }
      }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add Tag</DialogTitle>
            <DialogDescription>
              Search for an existing tag or create a new one
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex items-center space-x-2">
              <Search className="w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search or enter new tag..."
                value={tagSearchQuery}
                onChange={(e) => {
                  setTagSearchQuery(e.target.value);
                  setTagPage(0); // Reset to first page on search
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && tagSearchQuery.trim()) {
                    addTagMutation.mutate(tagSearchQuery.trim());
                    setTagSearchQuery('');
                    setIsAddTagDialogOpen(false);
                  }
                }}
                autoFocus
              />
            </div>
            
            {/* Create new tag option */}
            {tagSearchQuery.trim() && !filteredTags?.some(t => t.name.toLowerCase() === tagSearchQuery.toLowerCase()) && (
              <Button
                variant="outline"
                className="w-full justify-start text-orange-400 border-orange-500/30 hover:bg-orange-500/10"
                onClick={() => {
                  addTagMutation.mutate(tagSearchQuery.trim());
                  setTagSearchQuery('');
                  setIsAddTagDialogOpen(false);
                }}
              >
                <Plus className="w-4 h-4 mr-2" />
                Create "{tagSearchQuery.trim()}"
              </Button>
            )}
            
            {/* Existing tags list */}
            <div className="space-y-1">
              {filteredTags?.slice(tagPage * tagsPerPage, (tagPage + 1) * tagsPerPage).map((tag) => {
                const isAlreadyAdded = dayData?.analysis?.tagsVersion2?.includes(tag.name);
                // Derive main category from subcategory_path (like in tag manager)
                // Handle both snake_case (from Supabase) and camelCase formats
                const subcategoryPath = (tag as any).subcategory_path || (tag as any).subcategoryPath || null;
                const mainCategoryKey = getCategoryKeyFromPath(Array.isArray(subcategoryPath) ? subcategoryPath : null, tag.category);
                const categoryDisplay = mainCategoryKey ? getCategoryDisplayMeta(mainCategoryKey) : { name: tag.category };
                return (
                  <Button
                    key={`${tag.name}-${tag.category}`}
                    variant="ghost"
                    className={`w-full justify-start ${isAlreadyAdded ? 'opacity-50' : ''}`}
                    disabled={isAlreadyAdded}
                    onClick={() => {
                      if (!isAlreadyAdded) {
                        addTagMutation.mutate(tag.name);
                        setTagSearchQuery('');
                        setIsAddTagDialogOpen(false);
                      }
                    }}
                  >
                    <Tag className="w-4 h-4 mr-2 text-muted-foreground" />
                    <span>{tag.name}</span>
                    <span className="ml-auto text-xs text-muted-foreground">{categoryDisplay.name}</span>
                    {isAlreadyAdded && <CheckCircle className="w-3 h-3 ml-2 text-green-500" />}
                  </Button>
                );
              })}
              {filteredTags?.length === 0 && tagSearchQuery && (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No existing tags found. Press Enter to create a new tag.
                </p>
              )}
            </div>
            
            {/* Pagination */}
            {filteredTags && filteredTags.length > tagsPerPage && (
              <div className="flex items-center justify-between pt-2 border-t">
                <span className="text-xs text-muted-foreground">
                  {tagPage * tagsPerPage + 1}-{Math.min((tagPage + 1) * tagsPerPage, filteredTags.length)} of {filteredTags.length}
                </span>
                <div className="flex items-center space-x-1">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 px-2"
                    disabled={tagPage === 0}
                    onClick={() => setTagPage(p => p - 1)}
                  >
                    <ArrowLeft className="w-3 h-3" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 px-2"
                    disabled={(tagPage + 1) * tagsPerPage >= filteredTags.length}
                    onClick={() => setTagPage(p => p + 1)}
                  >
                    <ArrowRight className="w-3 h-3" />
                  </Button>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
