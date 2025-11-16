import { useState } from "react";
import { useQuery, useQueries, useMutation } from "@tanstack/react-query";
import { useParams, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { X, ChevronLeft, ChevronRight, Star, RefreshCw, Calendar, Check, Sparkles, Loader2, Pencil, Save, LayoutGrid, List, XCircle, AlertCircle, ExternalLink } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { NewsArticle } from "@/types/api-types";
import ApiMonitor from "@/components/ApiMonitor";
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

interface ConflictCluster {
  clusterId: string;
  dates: string[];
  summaries: Record<string, string>;
  conflictIds: number[];
}

interface DateAnalysis {
  analysis?: {
    summary: string;
    topArticleId: string;
  };
  tieredArticles?: {
    bitcoin: NewsArticle[];
    crypto: NewsArticle[];
    macro: NewsArticle[];
  };
  winningTier?: string | null;
}

interface AIRecommendation {
  date: string;
  action: 'keep' | 'switch';
  articleId?: string;
  newTopic?: string;
  reasoning: string;
  category?: 'bitcoin' | 'crypto' | 'macro';
}

interface AIGroup {
  theme: string;
  dates: string[];
  action: string;
  reasoning: string;
}

interface HolisticAnalysis {
  groups: AIGroup[];
  recommendations: AIRecommendation[];
  overallStrategy: string;
}

interface SmartDedupSuggestion {
  date: string;
  currentSummary: string;
  currentTopic: string;
  suggestedArticleId: string;
  newTopic: string;
  reasoning: string;
}

interface QualityViolation {
  date: string;
  summary: string;
  length: number;
  violations: string[];
}

interface FactCheckResult {
  date: string;
  summary: string;
  verdict: 'verified' | 'contradicted' | 'uncertain';
  confidence: number;
  reasoning: string;
  checkedAt: string;
}

interface PerplexityFactCheckResult {
  date: string;
  summary: string;
  verdict: 'verified' | 'contradicted' | 'uncertain';
  confidence: number;
  reasoning: string;
  correctDateText?: string | null;
  citations: string[];
  checkedAt: string;
  manualEntryProtected: boolean;
  reVerified?: boolean;
  reVerificationSummary?: string | null;
  reVerificationDate?: string | null;
  reVerificationStatus?: string | null;
  reVerificationWinner?: string | null;
  reVerificationReasoning?: string | null;
}

export default function ConflictCockpit() {
  const { sourceDate, date } = useParams();
  const [location, navigate] = useLocation();
  const { toast } = useToast();
  const [selectingArticleId, setSelectingArticleId] = useState<string | null>(null);
  const [currentConflictIndex, setCurrentConflictIndex] = useState(0);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [holisticAnalysis, setHolisticAnalysis] = useState<HolisticAnalysis | null>(null);
  const [smartDedupSuggestions, setSmartDedupSuggestions] = useState<SmartDedupSuggestion[]>([]);
  const [editingDate, setEditingDate] = useState<string | null>(null);
  const [editedSummaries, setEditedSummaries] = useState<Record<string, string>>({});
  const [reanalyzingDate, setReanalyzingDate] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"expanded" | "compact">("expanded");

  // Detect mode: violation mode uses /violation/:date, fact-check mode uses /fact-check/:date, conflict mode uses /conflict/:sourceDate
  const isViolationMode = location.startsWith('/violation');
  const isFactCheckMode = location.startsWith('/fact-check');
  const targetDate = (isViolationMode || isFactCheckMode) ? date : sourceDate;

  // Fetch quality violations for violation mode
  const { data: violationsData } = useQuery<{ data: QualityViolation[] }>({
    queryKey: ["/api/quality-check/violations"],
    enabled: isViolationMode,
  });

  const allViolations = violationsData?.data || [];
  const currentViolation = allViolations.find(v => v.date === targetDate);

  // Fetch fact-check results for fact-check mode
  const { data: factCheckData } = useQuery<{ data: FactCheckResult[] }>({
    queryKey: ["/api/fact-check/results"],
    enabled: isFactCheckMode,
  });

  // Fetch Perplexity fact-check results for fact-check mode (to get corrected dates)
  const { data: perplexityFactCheckData } = useQuery<{ data: PerplexityFactCheckResult[] }>({
    queryKey: ["/api/perplexity-fact-check/results"],
    enabled: isFactCheckMode,
    queryFn: async () => {
      const response = await fetch("/api/perplexity-fact-check/results");
      if (!response.ok) throw new Error('Failed to fetch Perplexity fact-check results');
      return response.json();
    },
  });

  const allFactCheckResults = factCheckData?.data || [];
  const currentFactCheck = allFactCheckResults.find(r => r.date === targetDate);
  
  const allPerplexityResults = perplexityFactCheckData?.data || [];
  const currentPerplexityCheck = allPerplexityResults.find(r => r.date === targetDate);
  
  // Check if this is a contradicted event
  const isContradicted = currentPerplexityCheck?.verdict === 'contradicted';
  const isContradictedWithCorrection = isContradicted && !!currentPerplexityCheck?.correctDateText;
  const correctedDate = currentPerplexityCheck?.correctDateText || null;

  // Fetch all clusters to enable navigation (conflicts mode only)
  const { data: allClusters = [] } = useQuery<ConflictCluster[]>({
    queryKey: ["/api/conflicts/all-grouped"],
    queryFn: async () => {
      const response = await fetch("/api/conflicts/all-grouped");
      return response.json();
    },
    enabled: !isViolationMode && !isFactCheckMode,
  });

  // Fetch current cluster by date (conflict mode) or create synthetic cluster (violation/fact-check mode)
  const { data: fetchedCluster } = useQuery<ConflictCluster>({
    queryKey: [`/api/conflicts/cluster/${targetDate}`],
    enabled: !isViolationMode && !isFactCheckMode && !!targetDate,
  });

  // Create synthetic cluster for violation mode or fact-check mode
  const currentCluster: ConflictCluster | undefined = 
    (isViolationMode || isFactCheckMode) && targetDate
      ? {
          clusterId: isFactCheckMode ? `factcheck-${targetDate}` : `violation-${targetDate}`,
          dates: [targetDate],
          summaries: {},
          conflictIds: [],
        }
      : fetchedCluster;

  // Find current cluster index for navigation
  const currentIndex = allClusters.findIndex(c => c.clusterId === currentCluster?.clusterId);

  // Get all dates in the cluster for analysis
  const clusterDates = currentCluster?.dates || [];

  // Fetch analyses for all dates in cluster using useQueries
  const dateQueries = useQueries<DateAnalysis[]>({
    queries: clusterDates.map((date) => ({
      queryKey: [`/api/analysis/date/${date}`],
      enabled: !!date,
    })),
  });
  
  // Map cluster data to UI structure (first date is "source", rest are "duplicates")
  const sourceAnalysis = dateQueries[0]?.data as DateAnalysis | undefined;
  const duplicateDates = clusterDates.slice(1).map((date, index) => ({
    date,
    id: currentCluster?.conflictIds[index] || 0
  }));
  const duplicateQueries = dateQueries.slice(1);

  // Article selection mutation
  const selectArticleMutation = useMutation({
    mutationFn: async ({ date, articleId }: { date: string; articleId: string }) => {
      setSelectingArticleId(articleId);
      const response = await apiRequest(
        "PUT",
        `/api/analysis/date/${date}/select-article`,
        { articleId }
      );
      return { date, result: await response.json() };
    },
    onSuccess: ({ date }) => {
      setSelectingArticleId(null);
      
      // Invalidate the specific date query to refresh the data
      queryClient.invalidateQueries({ queryKey: [`/api/analysis/date/${date}`] });
      
      // Also invalidate the target date if it's the selected date
      if (date === targetDate) {
        queryClient.invalidateQueries({ queryKey: [`/api/analysis/date/${targetDate}`] });
      }
      
      toast({
        title: "Article Selected",
        description: "Summary updated with selected article",
      });
    },
    onError: (error) => {
      setSelectingArticleId(null);
      toast({
        variant: "destructive",
        title: "Selection Failed",
        description: "Failed to update summary",
      });
    },
  });

  const handleArticleSelect = (date: string, articleId: string) => {
    if (selectingArticleId || selectArticleMutation.isPending) return;
    selectArticleMutation.mutate({ date, articleId });
  };

  // Fetch corrected date analysis if it exists
  const { data: correctedDateAnalysis } = useQuery<DateAnalysis>({
    queryKey: [`/api/analysis/date/${correctedDate}`],
    enabled: isFactCheckMode && !!correctedDate && !!isContradictedWithCorrection,
  });

  // AI Resolve mutation for contradicted events
  const aiResolveMutation = useMutation({
    mutationFn: async (date: string) => {
      const response = await fetch('/api/cleaner/resolve-contradiction', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date }),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to resolve contradiction');
      }
      return response.json();
    },
    onSuccess: async (result) => {
      toast({
        title: "Resolution Successful",
        description: result.message || `Event for ${targetDate} has been resolved.`,
        variant: "default",
      });
      // Invalidate all relevant queries to refresh data
      await queryClient.invalidateQueries({ queryKey: ['/api/analysis/date', targetDate] });
      if (correctedDate) {
        await queryClient.invalidateQueries({ queryKey: ['/api/analysis/date', correctedDate] });
      }
      await queryClient.invalidateQueries({ queryKey: ['/api/perplexity-fact-check/results'] });
      await queryClient.invalidateQueries({ queryKey: ['/api/fact-check/results'] });
    },
    onError: (error: Error) => {
      toast({
        title: "Resolution Failed",
        description: error.message || "An unexpected error occurred.",
        variant: "destructive",
      });
    },
  });

  // Delete/resolve conflict mutation
  const deleteConflictMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("DELETE", `/api/conflicts/resolve/${targetDate}`);
      return response.json();
    },
    onSuccess: () => {
      // Invalidate conflicts queries to update UI
      queryClient.invalidateQueries({ queryKey: ["/api/conflicts/all-grouped"] });
      queryClient.invalidateQueries({ queryKey: ["/api/conflicts/all"] });
      queryClient.invalidateQueries({ queryKey: ["/api/conflicts"] });
      
      toast({
        title: "Conflict Resolved",
        description: "All changes saved and conflict removed",
      });
      navigate("/cleaner");
    },
    onError: () => {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to resolve conflict",
      });
    },
  });

  // AI recommendations mutation - holistic cluster analysis
  const aiRecommendationsMutation = useMutation({
    mutationFn: async () => {
      if (!clusterDates.length) return { groups: [], recommendations: [], overallStrategy: '' };
      const response = await apiRequest("POST", "/api/conflicts/ai-recommendations", {
        sourceDate: clusterDates[0],
        duplicateDates: clusterDates.slice(1),
      });
      return response.json();
    },
    onSuccess: (data: HolisticAnalysis) => {
      // Enrich recommendations with category information
      const enrichedRecommendations = data.recommendations.map(rec => {
        // Find the date's analysis to determine category
        const dateIndex = clusterDates.findIndex(d => d === rec.date);
        const dateAnalysis = dateQueries[dateIndex]?.data as DateAnalysis | undefined;
        
        let category: 'bitcoin' | 'crypto' | 'macro' = 'bitcoin';
        if (rec.articleId && dateAnalysis && dateAnalysis.tieredArticles) {
          const { bitcoin = [], crypto = [], macro = [] } = dateAnalysis.tieredArticles;
          if (bitcoin.some((a: NewsArticle) => a.id === rec.articleId)) category = 'bitcoin';
          else if (crypto.some((a: NewsArticle) => a.id === rec.articleId)) category = 'crypto';
          else if (macro.some((a: NewsArticle) => a.id === rec.articleId)) category = 'macro';
        }
        
        return { ...rec, category };
      });
      
      setHolisticAnalysis({
        ...data,
        recommendations: enrichedRecommendations
      });
      
      toast({
        title: "Strategic Analysis Ready",
        description: `${data.groups.length} theme groups with ${enrichedRecommendations.length} recommendations`,
      });
    },
    onError: () => {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to get AI recommendations",
      });
    },
  });

  // Smart deduplication mutation
  const smartDedupMutation = useMutation({
    mutationFn: async () => {
      if (!clusterDates.length) return { suggestions: [], overlapGroups: [] };
      const response = await apiRequest("POST", "/api/conflicts/smart-dedup", {
        sourceDate: clusterDates[0],
        duplicateDates: clusterDates.slice(1),
      });
      return response.json();
    },
    onSuccess: (data: { suggestions: SmartDedupSuggestion[], overlapGroups: any[] }) => {
      setSmartDedupSuggestions(data.suggestions);
      
      // Invalidate queries to refresh cached news
      clusterDates.forEach(date => {
        queryClient.invalidateQueries({ queryKey: [`/api/analysis/date/${date}`] });
      });
      
      toast({
        title: "Smart Dedup Complete",
        description: `Found ${data.overlapGroups.length} overlapping topics. ${data.suggestions.length} alternative articles suggested.`,
      });
    },
    onError: () => {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to perform smart deduplication",
      });
    },
  });

  const handleClose = async () => {
    // In violation or fact-check mode, save changes if editing before closing
    if ((isViolationMode || isFactCheckMode) && editingDate === targetDate && editedSummaries[targetDate!]) {
      try {
        await saveSummaryMutation.mutateAsync({ 
          date: targetDate!, 
          summary: editedSummaries[targetDate!] 
        });
      } catch (error) {
        // Don't close if save fails
        return;
      }
    }
    
    if (isViolationMode) {
      navigate("/cleaner?tab=quality");
    } else if (isFactCheckMode) {
      navigate("/cleaner?tab=factcheck");
    } else {
      navigate("/cleaner");
    }
  };

  const handleDoneAndDelete = () => {
    setShowDeleteDialog(true);
  };

  const handleConfirmDelete = () => {
    deleteConflictMutation.mutate();
  };

  const handleAskAI = () => {
    aiRecommendationsMutation.mutate();
  };

  const handleSmartDedup = () => {
    smartDedupMutation.mutate();
  };

  const handleApplyRecommendation = (recommendation: AIRecommendation) => {
    if (recommendation.action === 'switch' && recommendation.articleId) {
      handleArticleSelect(recommendation.date, recommendation.articleId);
    }
  };

  const handleApplySmartDedupSuggestion = (suggestion: SmartDedupSuggestion) => {
    handleArticleSelect(suggestion.date, suggestion.suggestedArticleId);
  };

  const handleEditClick = (date: string, currentSummary: string) => {
    setEditingDate(date);
    setEditedSummaries(prev => ({ ...prev, [date]: currentSummary }));
  };

  const handleSummaryChange = (date: string, value: string) => {
    setEditedSummaries(prev => ({ ...prev, [date]: value }));
  };

  const handleCancelEdit = (date: string) => {
    setEditingDate(null);
    setEditedSummaries(prev => {
      const newSummaries = { ...prev };
      delete newSummaries[date];
      return newSummaries;
    });
  };

  // Save summary mutation
  const saveSummaryMutation = useMutation({
    mutationFn: async ({ date, summary }: { date: string; summary: string }) => {
      const response = await apiRequest("PATCH", `/api/analysis/date/${date}`, { summary });
      return response.json();
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: [`/api/analysis/date/${variables.date}`] });
      setEditingDate(null);
      setEditedSummaries(prev => {
        const newSummaries = { ...prev };
        delete newSummaries[variables.date];
        return newSummaries;
      });
      toast({
        title: "Summary Updated",
        description: "The summary has been saved successfully",
      });
    },
    onError: () => {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to save summary",
      });
    },
  });

  // Re-analyze all tiers mutation
  const reanalyzeMutation = useMutation({
    mutationFn: async (date: string) => {
      setReanalyzingDate(date);
      const response = await apiRequest("POST", `/api/analysis/date/${date}/reanalyze-all`, {});
      return response.json();
    },
    onSuccess: (data, date) => {
      setReanalyzingDate(null);
      queryClient.invalidateQueries({ queryKey: [`/api/analysis/date/${date}`] });
      toast({
        title: "Re-analysis Complete",
        description: `Fetched ${data.totalArticles} articles from all tiers. Select an article to generate summary.`,
      });
    },
    onError: (error, date) => {
      setReanalyzingDate(null);
      toast({
        variant: "destructive",
        title: "Re-analysis Failed",
        description: "Failed to fetch news from all tiers",
      });
    },
  });

  const handlePrevious = () => {
    if (currentIndex > 0) {
      const prevCluster = allClusters[currentIndex - 1];
      navigate(`/conflict/${prevCluster.dates[0]}`);
    }
  };

  const handleNext = () => {
    if (currentIndex < allClusters.length - 1) {
      const nextCluster = allClusters[currentIndex + 1];
      navigate(`/conflict/${nextCluster.dates[0]}`);
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    });
  };

  const renderCachedNews = (analysis: DateAnalysis | undefined, date: string, isSource: boolean = false) => {
    if (!analysis?.tieredArticles) {
      return <div className="text-sm text-slate-500">No cached news available</div>;
    }

    const topArticleId = analysis.analysis?.topArticleId;
    const winningTier = analysis.winningTier || 'bitcoin';
    const allArticles = [
      ...(analysis.tieredArticles.bitcoin || []),
      ...(analysis.tieredArticles.crypto || []),
      ...(analysis.tieredArticles.macro || [])
    ];

    return (
      <Tabs defaultValue={winningTier} className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="bitcoin">Bitcoin ({analysis.tieredArticles.bitcoin?.length || 0})</TabsTrigger>
          <TabsTrigger value="crypto">Crypto ({analysis.tieredArticles.crypto?.length || 0})</TabsTrigger>
          <TabsTrigger value="macro">Macro ({analysis.tieredArticles.macro?.length || 0})</TabsTrigger>
        </TabsList>

        {(['bitcoin', 'crypto', 'macro'] as const).map(tier => (
          <TabsContent key={tier} value={tier} className="space-y-2 max-h-96 overflow-y-auto">
            {(analysis.tieredArticles?.[tier] || []).map(article => {
              const isSelected = article.id === topArticleId;
              return (
                <Card key={article.id} className={`p-3 ${isSelected ? 'border-orange-500 bg-orange-50' : ''}`}>
                  <div className="flex items-start gap-2">
                    <div className="flex gap-1 flex-shrink-0">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0"
                        onClick={() => handleArticleSelect(date, article.id)}
                        disabled={selectingArticleId === article.id || selectArticleMutation.isPending}
                        data-testid={`select-article-${article.id}`}
                      >
                        {selectingArticleId === article.id ? (
                          <RefreshCw className="w-4 h-4 animate-spin text-orange-600" />
                        ) : isSelected ? (
                          <Star className="w-4 h-4 fill-orange-600 text-orange-600" />
                        ) : (
                          <Star className="w-4 h-4 text-slate-400 hover:text-orange-600 transition-colors" />
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0"
                        onClick={() => window.open(article.url, '_blank')}
                        title="Open article in new tab"
                        data-testid={`open-article-${article.id}`}
                      >
                        <ExternalLink className="w-4 h-4 text-slate-400 hover:text-blue-600 transition-colors" />
                      </Button>
                    </div>
                    <div className="flex-1 min-w-0">
                      <h4 className="text-sm font-semibold text-slate-900 truncate">{article.title}</h4>
                      <p className="text-xs text-slate-600 line-clamp-2 mt-1">{article.summary}</p>
                      <div className="flex items-center gap-2 mt-2">
                        <span className="text-xs text-slate-500">{article.author || 'Unknown'}</span>
                        <span className="text-xs text-slate-400">•</span>
                        <span className="text-xs text-slate-500">{new Date(article.publishedDate).toLocaleDateString()}</span>
                      </div>
                    </div>
                  </div>
                </Card>
              );
            })}
          </TabsContent>
        ))}
      </Tabs>
    );
  };

  if (!currentCluster || !clusterDates.length) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-xl font-semibold text-slate-900">Loading cluster...</h2>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-white z-50 flex flex-col">
      {/* Header */}
      <div className="border-b bg-slate-50 p-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="sm" onClick={handleClose} data-testid="button-close-cockpit">
              <X className="w-5 h-5" />
            </Button>
            <div>
              <h1 className="text-xl font-bold text-slate-900">
                {isViolationMode ? 'Quality Violation Editor' : isFactCheckMode ? 'Fact-Check Review' : 'Conflict Resolution Cockpit'}
              </h1>
              <p className="text-sm text-slate-600">
                {isViolationMode ? 'Fix quality violations and browse articles' : isFactCheckMode ? 'Review fact-check verdict and browse articles' : 'Review and resolve duplicate events'}
              </p>
            </div>
          </div>

          {/* Violation Badges (Violation Mode Only) */}
          {isViolationMode && currentViolation && (
            <div className="flex flex-wrap gap-2">
              {currentViolation.violations.map((v, i) => (
                <Badge 
                  key={i} 
                  variant="outline" 
                  className="bg-red-100 text-red-700 border-red-300"
                >
                  {v}
                </Badge>
              ))}
            </div>
          )}

          {/* Fact-Check Verdict Badge (Fact-Check Mode Only) */}
          {isFactCheckMode && (currentPerplexityCheck || currentFactCheck) && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                {/* Show Perplexity verdict if available, otherwise OpenAI fact-check verdict */}
                {(currentPerplexityCheck?.verdict || currentFactCheck?.verdict) === 'verified' && (
                  <Badge variant="outline" className="bg-green-100 text-green-700 border-green-300 flex items-center gap-1">
                    <Check className="w-3 h-3" />
                    Verified
                  </Badge>
                )}
                {(currentPerplexityCheck?.verdict || currentFactCheck?.verdict) === 'contradicted' && (
                  <Badge variant="outline" className="bg-red-100 text-red-700 border-red-300 flex items-center gap-1">
                    <XCircle className="w-3 h-3" />
                    Contradicted
                  </Badge>
                )}
                {(currentPerplexityCheck?.verdict || currentFactCheck?.verdict) === 'uncertain' && (
                  <Badge variant="outline" className="bg-amber-100 text-amber-700 border-amber-300 flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" />
                    Uncertain
                  </Badge>
                )}
                <Badge variant="outline" className="text-xs">
                  Confidence: {Math.round((currentPerplexityCheck?.confidence || currentFactCheck?.confidence || 0))}%
                </Badge>
              </div>
              {(currentPerplexityCheck?.reasoning || currentFactCheck?.reasoning) && (
                <p className="text-xs text-slate-600 max-w-md">{currentPerplexityCheck?.reasoning || currentFactCheck?.reasoning}</p>
              )}
            </div>
          )}

          {/* Navigation and Actions */}
          <div className="flex items-center gap-2">
            {/* View Toggle Button */}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setViewMode(viewMode === "expanded" ? "compact" : "expanded")}
              data-testid="button-toggle-view"
              title={viewMode === "expanded" ? "Switch to Compact View" : "Switch to Expanded View"}
            >
              {viewMode === "expanded" ? (
                <>
                  <List className="w-4 h-4 mr-2" />
                  Compact
                </>
              ) : (
                <>
                  <LayoutGrid className="w-4 h-4 mr-2" />
                  Expanded
                </>
              )}
            </Button>

            {/* Conflict Mode Only: Ask AI for Help Button */}
            {!isViolationMode && !isFactCheckMode && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleAskAI}
                disabled={aiRecommendationsMutation.isPending}
                data-testid="button-ask-ai"
              >
                {aiRecommendationsMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                ) : (
                  <Sparkles className="w-4 h-4 mr-2" />
                )}
                Ask AI for Help
              </Button>
            )}

            {/* Fact-Check Mode: AI Resolve Button for Contradicted Events */}
            {isFactCheckMode && isContradicted && (
              <Button
                variant="default"
                size="sm"
                onClick={() => aiResolveMutation.mutate(targetDate!)}
                disabled={aiResolveMutation.isPending}
                className="bg-blue-600 hover:bg-blue-700"
                data-testid="button-ai-resolve"
              >
                {aiResolveMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                ) : (
                  <Sparkles className="w-4 h-4 mr-2" />
                )}
                AI Resolve
              </Button>
            )}

            {/* Conflict Mode Only: Smart Dedup Button */}
            {!isViolationMode && !isFactCheckMode && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleSmartDedup}
                disabled={smartDedupMutation.isPending}
                data-testid="button-smart-dedup"
                className="bg-purple-50 hover:bg-purple-100 border-purple-200"
              >
                {smartDedupMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                ) : (
                  <Sparkles className="w-4 h-4 mr-2 text-purple-600" />
                )}
                Smart Dedup
              </Button>
            )}

            {/* Conflict Mode: Done & Delete Button | Violation/Fact-Check Mode: Save & Close */}
            {isViolationMode || isFactCheckMode ? (
              <Button
                variant="default"
                size="sm"
                onClick={handleClose}
                data-testid="button-save-close"
                className="bg-green-600 hover:bg-green-700"
              >
                <Check className="w-4 h-4 mr-2" />
                Save & Close
              </Button>
            ) : (
              <Button
                variant="default"
                size="sm"
                onClick={handleDoneAndDelete}
                disabled={deleteConflictMutation.isPending}
                data-testid="button-done-delete"
                className="bg-green-600 hover:bg-green-700"
              >
                {deleteConflictMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                ) : (
                  <Check className="w-4 h-4 mr-2" />
                )}
                Done & Delete
              </Button>
            )}

            {/* API Monitor */}
            <ApiMonitor />

            {/* Conflict Mode Only: Cluster Navigation */}
            {!isViolationMode && !isFactCheckMode && (
              <>
                {/* Divider */}
                <div className="h-6 w-px bg-slate-300 mx-2" />

                {/* Navigation */}
                <span className="text-sm text-slate-600">
                  {currentIndex + 1} / {allClusters.length}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handlePrevious}
                  disabled={currentIndex === 0}
                  data-testid="button-prev-conflict"
                >
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleNext}
                  disabled={currentIndex === allClusters.length - 1}
                  data-testid="button-next-conflict"
                >
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </>
            )}

            {/* Violation Mode Only: Violation Navigation */}
            {isViolationMode && allViolations.length > 0 && (
              <>
                {/* Divider */}
                <div className="h-6 w-px bg-slate-300 mx-2" />

                {/* Violation Navigation */}
                <span className="text-sm text-slate-600">
                  {allViolations.findIndex(v => v.date === targetDate) + 1} / {allViolations.length}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const currentIdx = allViolations.findIndex(v => v.date === targetDate);
                    if (currentIdx > 0) {
                      navigate(`/violation/${allViolations[currentIdx - 1].date}`);
                    }
                  }}
                  disabled={allViolations.findIndex(v => v.date === targetDate) === 0}
                  data-testid="button-prev-violation"
                >
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const currentIdx = allViolations.findIndex(v => v.date === targetDate);
                    if (currentIdx < allViolations.length - 1) {
                      navigate(`/violation/${allViolations[currentIdx + 1].date}`);
                    }
                  }}
                  disabled={allViolations.findIndex(v => v.date === targetDate) === allViolations.length - 1}
                  data-testid="button-next-violation"
                >
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-7xl mx-auto space-y-6">
          {/* Source Date Section */}
          <div className="bg-blue-50 border-2 border-blue-200 rounded-lg p-6">
            <div className="flex items-center gap-2 mb-4">
              <Calendar className="w-6 h-6 text-blue-600" />
              <h2 className="text-xl font-bold text-slate-900">Source Date</h2>
              <Badge variant="default" className="ml-2">Canonical</Badge>
            </div>
            
            <div className={viewMode === "expanded" ? "grid grid-cols-1 lg:grid-cols-3 gap-6" : "space-y-6"}>
              {/* Summary */}
              <div className={viewMode === "expanded" ? "lg:col-span-2" : ""}>
                <div className="bg-white rounded-lg p-4 border">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-semibold text-slate-900">{formatDate(targetDate!)}</h3>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-slate-500">
                        {editingDate === targetDate 
                          ? editedSummaries[targetDate!]?.length || 0 
                          : sourceAnalysis?.analysis?.summary?.length || 0} chars
                      </span>
                      {editingDate !== targetDate && (
                        <Button 
                          variant="ghost" 
                          size="sm"
                          onClick={() => handleEditClick(targetDate!, sourceAnalysis?.analysis?.summary || '')}
                          data-testid={`edit-summary-${targetDate}`}
                        >
                          <Pencil className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                  
                  {editingDate === targetDate ? (
                    <>
                      <Textarea
                        value={editedSummaries[targetDate!] || ''}
                        onChange={(e) => handleSummaryChange(targetDate!, e.target.value)}
                        className="text-slate-800 text-lg leading-relaxed mb-3 min-h-[100px] bg-white"
                        placeholder="Edit the summary..."
                        data-testid={`textarea-summary-${targetDate}`}
                      />
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleCancelEdit(targetDate!)}
                          data-testid={`cancel-edit-${targetDate}`}
                        >
                          Cancel
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => saveSummaryMutation.mutate({ date: targetDate!, summary: editedSummaries[targetDate!] || '' })}
                          disabled={saveSummaryMutation.isPending}
                          className="bg-green-600 hover:bg-green-700"
                          data-testid={`save-edit-${targetDate}`}
                        >
                          {saveSummaryMutation.isPending ? (
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          ) : (
                            <Save className="w-4 h-4 mr-2" />
                          )}
                          Save
                        </Button>
                      </div>
                    </>
                  ) : (
                    <p className="text-slate-700">{sourceAnalysis?.analysis?.summary}</p>
                  )}
                </div>
              </div>

              {/* Cached News */}
              {viewMode === "expanded" && (
                <div className="lg:col-span-1">
                  <div className="bg-white rounded-lg p-4 border">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="font-semibold text-slate-900">Cached News</h3>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => targetDate && reanalyzeMutation.mutate(targetDate)}
                        disabled={reanalyzingDate === targetDate || reanalyzeMutation.isPending}
                        data-testid={`reanalyze-${targetDate}`}
                        title="Fetch news from all tiers (Bitcoin, Crypto, Macro)"
                      >
                        {reanalyzingDate === targetDate ? (
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        ) : (
                          <RefreshCw className="w-4 h-4 mr-2" />
                        )}
                        Re-analyze
                      </Button>
                    </div>
                    {renderCachedNews(sourceAnalysis, targetDate!)}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Corrected Date Section (Fact-Check Mode with Contradiction) */}
          {isFactCheckMode && isContradictedWithCorrection && correctedDate && (
            <div className="bg-amber-50 border-2 border-amber-200 rounded-lg p-6">
              <div className="flex items-center gap-2 mb-4">
                <Calendar className="w-6 h-6 text-amber-600" />
                <h2 className="text-xl font-bold text-slate-900">Suggested Correct Date</h2>
                <Badge variant="outline" className="ml-2 bg-amber-100 text-amber-700 border-amber-300">
                  Perplexity Suggested
                </Badge>
              </div>
              
              <div className={viewMode === "expanded" ? "grid grid-cols-1 lg:grid-cols-3 gap-6" : "space-y-6"}>
                {/* Summary */}
                <div className={viewMode === "expanded" ? "lg:col-span-2" : ""}>
                  <div className="bg-white rounded-lg p-4 border">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="font-semibold text-slate-900">
                        {/^\d{4}-\d{2}-\d{2}$/.test(correctedDate) 
                          ? formatDate(correctedDate)
                          : correctedDate}
                      </h3>
                    </div>
                    
                    {correctedDateAnalysis?.analysis?.summary ? (
                      <p className="text-slate-700">{correctedDateAnalysis.analysis.summary}</p>
                    ) : (
                      <p className="text-slate-500 italic">
                        No analysis exists for this date yet. The AI resolution may move the summary here.
                      </p>
                    )}
                  </div>
                </div>
                
                {/* Cached News */}
                <div className={viewMode === "expanded" ? "" : ""}>
                  {correctedDateAnalysis && renderCachedNews(correctedDateAnalysis, correctedDate)}
                </div>
              </div>
            </div>
          )}

          {/* Holistic Analysis Section */}
          {holisticAnalysis && (
            <div className="bg-gradient-to-br from-blue-50 to-purple-50 border-2 border-blue-300 rounded-lg p-6 shadow-lg">
              <div className="flex items-center gap-3 mb-4">
                <Sparkles className="w-6 h-6 text-blue-600" />
                <h2 className="text-xl font-bold text-slate-900">Strategic Cluster Analysis</h2>
                <Badge variant="default" className="bg-blue-600">AI-Powered</Badge>
              </div>

              {/* Overall Strategy */}
              <div className="bg-white rounded-lg p-4 mb-4 border border-blue-200">
                <h3 className="text-sm font-semibold text-blue-900 mb-2">Overall Resolution Strategy</h3>
                <p className="text-sm text-slate-700">{holisticAnalysis.overallStrategy}</p>
              </div>

              {/* Theme Groups */}
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-slate-900">Theme Groups ({holisticAnalysis.groups.length})</h3>
                {holisticAnalysis.groups.map((group, index) => (
                  <div key={index} className="bg-white rounded-lg p-4 border border-slate-200">
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <Badge variant="outline" className="bg-slate-100 text-slate-800">
                            {group.theme}
                          </Badge>
                          <span className="text-xs text-slate-500">
                            {group.dates.length} date{group.dates.length > 1 ? 's' : ''}
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-1 mb-2">
                          {group.dates.map((date, i) => (
                            <Badge key={i} variant="secondary" className="text-xs">
                              {date}
                            </Badge>
                          ))}
                        </div>
                      </div>
                      <Badge 
                        variant="outline" 
                        className={group.action.toLowerCase().includes('keep') 
                          ? 'bg-green-100 text-green-700 border-green-300'
                          : 'bg-yellow-100 text-yellow-700 border-yellow-300'
                        }
                      >
                        {group.action}
                      </Badge>
                    </div>
                    <p className="text-xs text-slate-600">{group.reasoning}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Duplicate Dates Section */}
          <div>
            <h2 className="text-xl font-bold text-slate-900 mb-4">Duplicate Dates ({duplicateDates.length})</h2>
            <div className="space-y-4">
              {duplicateDates.map(({ date, id }, index) => {
                const duplicateData = duplicateQueries[index]?.data as DateAnalysis | undefined;
                
                const aiRecommendation = holisticAnalysis?.recommendations.find(r => r.date === date);
                
                return (
                  <div key={id} className="bg-amber-50 border-2 border-amber-200 rounded-lg p-6">
                    <div className={viewMode === "expanded" ? "grid grid-cols-1 lg:grid-cols-3 gap-6" : "space-y-6"}>
                      {/* Summary */}
                      <div className={viewMode === "expanded" ? "lg:col-span-2" : ""}>
                        <div className="bg-white rounded-lg p-4 border">
                          <div className="flex items-center justify-between mb-3">
                            <h3 className="font-semibold text-slate-900">{formatDate(date)}</h3>
                            <div className="flex items-center gap-2">
                              <span className="text-sm text-slate-500">
                                {editingDate === date 
                                  ? editedSummaries[date]?.length || 0 
                                  : duplicateData?.analysis?.summary?.length || 0} chars
                              </span>
                              {editingDate !== date && (
                                <Button 
                                  variant="ghost" 
                                  size="sm"
                                  onClick={() => handleEditClick(date, duplicateData?.analysis?.summary || '')}
                                  data-testid={`edit-summary-${date}`}
                                >
                                  <Pencil className="w-4 h-4" />
                                </Button>
                              )}
                            </div>
                          </div>
                          
                          {editingDate === date ? (
                            <>
                              <Textarea
                                value={editedSummaries[date] || ''}
                                onChange={(e) => handleSummaryChange(date, e.target.value)}
                                className="text-slate-800 text-lg leading-relaxed mb-3 min-h-[100px] bg-white"
                                placeholder="Edit the summary..."
                                data-testid={`textarea-summary-${date}`}
                              />
                              <div className="flex gap-2">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => handleCancelEdit(date)}
                                  data-testid={`cancel-edit-${date}`}
                                >
                                  Cancel
                                </Button>
                                <Button
                                  size="sm"
                                  onClick={() => saveSummaryMutation.mutate({ date, summary: editedSummaries[date] || '' })}
                                  disabled={saveSummaryMutation.isPending}
                                  className="bg-green-600 hover:bg-green-700"
                                  data-testid={`save-edit-${date}`}
                                >
                                  {saveSummaryMutation.isPending ? (
                                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                  ) : (
                                    <Save className="w-4 h-4 mr-2" />
                                  )}
                                  Save
                                </Button>
                              </div>
                            </>
                          ) : (
                            <p className="text-slate-700">{duplicateData?.analysis?.summary || 'No summary available'}</p>
                          )}
                          
                          {/* Smart Dedup Suggestion (if available) */}
                          {(() => {
                            const suggestion = smartDedupSuggestions.find(s => s.date === date);
                            if (!suggestion) return null;
                            
                            return (
                              <div className="mt-4 p-4 bg-purple-50 border-2 border-purple-300 rounded-lg">
                                <div className="flex items-start justify-between gap-3">
                                  <div className="flex-1">
                                    <div className="flex items-center gap-2 mb-3">
                                      <Sparkles className="w-5 h-5 text-purple-600" />
                                      <span className="text-sm font-bold text-purple-900">Smart Dedup Suggestion</span>
                                    </div>
                                    
                                    <div className="space-y-2 mb-3">
                                      <div className="flex items-start gap-2">
                                        <Badge variant="outline" className="bg-red-100 text-red-700 border-red-300 shrink-0">
                                          Current Topic
                                        </Badge>
                                        <p className="text-sm text-slate-700 flex-1">{suggestion.currentTopic}</p>
                                      </div>
                                      
                                      <div className="flex items-start gap-2">
                                        <Badge variant="outline" className="bg-green-100 text-green-700 border-green-300 shrink-0">
                                          Suggested Topic
                                        </Badge>
                                        <p className="text-sm text-slate-700 flex-1">{suggestion.newTopic}</p>
                                      </div>
                                    </div>
                                    
                                    <div className="bg-white p-2 rounded border border-purple-200 mb-2">
                                      <p className="text-xs text-slate-600 font-semibold mb-1">AI Reasoning:</p>
                                      <p className="text-xs text-slate-700">{suggestion.reasoning}</p>
                                    </div>
                                    
                                    <p className="text-xs text-purple-600 font-mono">Article ID: {suggestion.suggestedArticleId}</p>
                                  </div>
                                  <div className="flex flex-col gap-2">
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      onClick={() => setSmartDedupSuggestions(prev => prev.filter(s => s.date !== date))}
                                      data-testid={`reject-smart-dedup-${date}`}
                                    >
                                      Reject
                                    </Button>
                                    <Button
                                      size="sm"
                                      onClick={() => {
                                        handleApplySmartDedupSuggestion(suggestion);
                                        setSmartDedupSuggestions(prev => prev.filter(s => s.date !== date));
                                      }}
                                      data-testid={`accept-smart-dedup-${date}`}
                                      className="bg-purple-600 hover:bg-purple-700"
                                    >
                                      Accept
                                    </Button>
                                  </div>
                                </div>
                              </div>
                            );
                          })()}

                          {/* AI Recommendation (if available) */}
                          {aiRecommendation && (
                            <div className={`mt-4 p-3 ${
                              aiRecommendation.action === 'keep' 
                                ? 'bg-green-50 border border-green-200' 
                                : 'bg-blue-50 border border-blue-200'
                            } rounded-lg`}>
                              <div className="flex items-start justify-between gap-3">
                                <div className="flex-1">
                                  <div className="flex items-center gap-2 mb-2">
                                    <Sparkles className="w-4 h-4 text-blue-600" />
                                    <span className="text-sm font-semibold text-blue-900">AI Recommendation</span>
                                    <Badge 
                                      variant="outline"
                                      className={
                                        aiRecommendation.action === 'keep'
                                          ? 'bg-green-100 text-green-700 border-green-300'
                                          : 'bg-yellow-100 text-yellow-700 border-yellow-300'
                                      }
                                    >
                                      {aiRecommendation.action.toUpperCase()}
                                    </Badge>
                                    {aiRecommendation.category && (
                                      <Badge 
                                        variant="outline" 
                                        className={`text-xs ${
                                          aiRecommendation.category === 'bitcoin' 
                                            ? 'bg-orange-100 text-orange-700 border-orange-300' 
                                            : aiRecommendation.category === 'crypto'
                                            ? 'bg-purple-100 text-purple-700 border-purple-300'
                                            : 'bg-blue-100 text-blue-700 border-blue-300'
                                        }`}
                                      >
                                        {aiRecommendation.category}
                                      </Badge>
                                    )}
                                  </div>
                                  
                                  {aiRecommendation.action === 'switch' && aiRecommendation.newTopic && (
                                    <div className="mb-2 p-2 bg-white rounded border border-blue-200">
                                      <p className="text-xs text-slate-600 font-semibold mb-1">Suggested Topic:</p>
                                      <p className="text-sm text-slate-800">{aiRecommendation.newTopic}</p>
                                    </div>
                                  )}
                                  
                                  <p className="text-sm text-slate-700 mb-2">{aiRecommendation.reasoning}</p>
                                  
                                  {aiRecommendation.articleId && (
                                    <p className="text-xs text-slate-500">Article ID: {aiRecommendation.articleId}</p>
                                  )}
                                </div>
                                <div className="flex gap-2">
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => setHolisticAnalysis(prev => 
                                      prev ? {
                                        ...prev,
                                        recommendations: prev.recommendations.filter(r => r.date !== date)
                                      } : null
                                    )}
                                    data-testid={`reject-recommendation-${date}`}
                                  >
                                    Dismiss
                                  </Button>
                                  {aiRecommendation.action === 'switch' && aiRecommendation.articleId && (
                                    <Button
                                      size="sm"
                                      onClick={() => {
                                        handleApplyRecommendation(aiRecommendation);
                                        setHolisticAnalysis(prev => 
                                          prev ? {
                                            ...prev,
                                            recommendations: prev.recommendations.filter(r => r.date !== date)
                                          } : null
                                        );
                                      }}
                                      data-testid={`accept-recommendation-${date}`}
                                      className="bg-green-600 hover:bg-green-700"
                                    >
                                      Apply Switch
                                    </Button>
                                  )}
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Cached News */}
                      {viewMode === "expanded" && (
                        <div className="lg:col-span-1">
                          <div className="bg-white rounded-lg p-4 border">
                            <div className="flex items-center justify-between mb-3">
                              <h3 className="font-semibold text-slate-900">Cached News</h3>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => reanalyzeMutation.mutate(date)}
                                disabled={reanalyzingDate === date || reanalyzeMutation.isPending}
                                data-testid={`reanalyze-${date}`}
                                title="Fetch news from all tiers (Bitcoin, Crypto, Macro)"
                              >
                                {reanalyzingDate === date ? (
                                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                ) : (
                                  <RefreshCw className="w-4 h-4 mr-2" />
                                )}
                                Re-analyze
                              </Button>
                            </div>
                            {renderCachedNews(duplicateData, date)}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Resolution</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to mark this conflict as resolved? This will save all current article selections and remove the conflict from the database.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmDelete} className="bg-green-600 hover:bg-green-700">
              Confirm & Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
