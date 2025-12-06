import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { VeriBadge } from '@/components/VeriBadge';
import { 
  CheckCircle, 
  Sparkles, 
  ExternalLink, 
  Loader2, 
  Star,
  Bot,
  Zap,
  FileText,
  ArrowRight,
  AlertCircle
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { queryClient } from '@/lib/queryClient';

interface Article {
  id: string;
  title: string;
  summary?: string;
  url?: string;
  text?: string;
}

interface ArticleSelectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  date: string;
  selectionMode: 'orphan' | 'multiple';
  tieredArticles: {
    bitcoin: Article[];
    crypto: Article[];
    macro: Article[];
  };
  geminiSelectedIds?: string[];
  perplexitySelectedIds?: string[];
  intersectionIds?: string[];
  openaiSuggestedId?: string;
  onConfirm: (articleId: string) => Promise<void>;
}

export function ArticleSelectionDialog({
  open,
  onOpenChange,
  date,
  selectionMode,
  tieredArticles,
  geminiSelectedIds = [],
  perplexitySelectedIds = [],
  intersectionIds = [],
  openaiSuggestedId,
  onConfirm,
}: ArticleSelectionDialogProps) {
  const [selectedArticleId, setSelectedArticleId] = useState<string | null>(
    selectionMode === 'multiple' ? openaiSuggestedId || null : null
  );
  const [isConfirming, setIsConfirming] = useState(false);
  const { toast } = useToast();

  // Determine which tier the suggested/selected article belongs to
  const getArticleTier = (articleId: string | null | undefined): 'bitcoin' | 'crypto' | 'macro' => {
    if (!articleId) return 'bitcoin';
    if (tieredArticles.bitcoin.some(a => a.id === articleId)) return 'bitcoin';
    if (tieredArticles.crypto.some(a => a.id === articleId)) return 'crypto';
    if (tieredArticles.macro.some(a => a.id === articleId)) return 'macro';
    return 'bitcoin';
  };

  const defaultTier = getArticleTier(openaiSuggestedId || selectedArticleId);

  // Debug logging
  useEffect(() => {
    if (open) {
      console.log('🔍 [ArticleSelectionDialog] Dialog opened with:', {
        selectionMode,
        tieredArticles: {
          bitcoin: tieredArticles.bitcoin?.length || 0,
          crypto: tieredArticles.crypto?.length || 0,
          macro: tieredArticles.macro?.length || 0,
        },
        geminiSelectedIds: geminiSelectedIds.length,
        perplexitySelectedIds: perplexitySelectedIds.length,
        intersectionIds: intersectionIds.length,
        intersectionIdsSample: intersectionIds.slice(0, 3),
        openaiSuggestedId,
        selectedArticleId,
      });
    }
  }, [open, selectionMode, tieredArticles, geminiSelectedIds, perplexitySelectedIds, intersectionIds, openaiSuggestedId, selectedArticleId]);

  const handleConfirm = async () => {
    if (!selectedArticleId) {
      toast({
        variant: 'destructive',
        description: 'Please select an article first',
      });
      return;
    }

    setIsConfirming(true);
    try {
      await onConfirm(selectedArticleId);
      onOpenChange(false);
      toast({
        description: 'Article selected successfully. Generating summary...',
      });
    } catch (error) {
      toast({
        variant: 'destructive',
        description: `Failed to confirm selection: ${(error as Error).message}`,
      });
    } finally {
      setIsConfirming(false);
    }
  };

  const getArticleStatus = (articleId: string) => {
    const isGemini = geminiSelectedIds.includes(articleId);
    const isPerplexity = perplexitySelectedIds.includes(articleId);
    const isIntersection = intersectionIds.includes(articleId);
    const isOpenAISuggested = articleId === openaiSuggestedId;
    const isSelected = articleId === selectedArticleId;

    return {
      isGemini,
      isPerplexity,
      isIntersection,
      isOpenAISuggested,
      isSelected,
    };
  };

  const renderArticle = (article: Article, tier: 'bitcoin' | 'crypto' | 'macro') => {
    const status = getArticleStatus(article.id);
    const tierColors = {
      bitcoin: 'border-orange-500/30 bg-orange-950/20',
      crypto: 'border-blue-500/30 bg-blue-950/20',
      macro: 'border-purple-500/30 bg-purple-950/20',
    };

    const borderClass = status.isOpenAISuggested
      ? 'border-2 border-yellow-500 ring-2 ring-yellow-500/50'
      : status.isSelected
      ? 'border-2 border-green-500 ring-2 ring-green-500/50'
      : status.isIntersection
      ? 'border-2 border-green-400/50'
      : 'border border-border';

    return (
      <Card
        key={article.id}
        className={`group cursor-pointer transition-all duration-200 hover:scale-[1.02] hover:shadow-lg ${
          status.isSelected 
            ? 'ring-2 ring-green-500/50 shadow-lg shadow-green-500/20' 
            : 'hover:ring-1 hover:ring-border'
        } ${borderClass} ${tierColors[tier]} bg-muted/50 backdrop-blur-sm`}
        onClick={() => {
          if (selectionMode === 'orphan' || status.isIntersection) {
            setSelectedArticleId(article.id);
          }
        }}
      >
        <CardContent className="p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 space-y-3">
              <div className="flex items-start gap-3">
                {status.isSelected && (
                  <div className="flex-shrink-0 mt-1">
                    <div className="p-1.5 rounded-full bg-green-500/20 border border-green-500/50">
                      <CheckCircle className="w-4 h-4 text-green-400" />
                    </div>
                  </div>
                )}
                <div className="flex-1">
                  <h4 className={`font-semibold leading-tight mb-2 ${
                    status.isSelected ? 'text-green-300' : 'text-foreground'
                  }`}>
                    {article.title}
                  </h4>
                  {article.summary && (
                    <p className="text-sm text-muted-foreground leading-relaxed line-clamp-3 mb-3">
                      {article.summary}
                    </p>
                  )}
                </div>
              </div>
              
              <div className="flex flex-wrap items-center gap-2">
                {status.isGemini && (
                  <Badge variant="outline" className="bg-blue-500/10 text-blue-300 border-blue-500/30 text-xs font-medium px-2 py-1">
                    <Bot className="w-3 h-3 mr-1" />
                    Gemini
                  </Badge>
                )}
                {status.isPerplexity && (
                  <Badge variant="outline" className="bg-purple-500/10 text-purple-300 border-purple-500/30 text-xs font-medium px-2 py-1">
                    <Zap className="w-3 h-3 mr-1" />
                    Perplexity
                  </Badge>
                )}
                {status.isIntersection && (
                  <Badge variant="outline" className="bg-green-500/10 text-green-300 border-green-500/30 text-xs font-medium px-2 py-1">
                    <CheckCircle className="w-3 h-3 mr-1" />
                    Both Agreed
                  </Badge>
                )}
                {status.isOpenAISuggested && (
                  <Badge variant="outline" className="bg-yellow-500/10 text-yellow-300 border-yellow-500/30 text-xs font-medium px-2 py-1">
                    <Star className="w-3 h-3 mr-1 fill-yellow-300/20" />
                    OpenAI Suggested
                  </Badge>
                )}
              </div>
              
              {article.url && (
                <a
                  href={article.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center text-xs text-blue-400 hover:text-blue-300 transition-colors font-medium mt-2"
                  onClick={(e) => e.stopPropagation()}
                >
                  <ExternalLink className="w-3 h-3 mr-1.5" />
                  View Full Article
                  <ArrowRight className="w-3 h-3 ml-1" />
                </a>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    );
  };

  const renderTier = (tier: 'bitcoin' | 'crypto' | 'macro', articles: Article[]) => {
    if (!articles || articles.length === 0) {
      return (
        <div className="text-center py-8 text-muted-foreground">
          <p>No articles found in this tier</p>
        </div>
      );
    }

    // Filter articles based on selection mode
    let displayArticles = articles;
    if (selectionMode === 'multiple') {
      // Only show intersection articles
      // Handle both URL and ID matching
      displayArticles = articles.filter((a) => {
        const matches = intersectionIds.includes(a.id) || 
                       intersectionIds.some(id => a.url && (id === a.url || a.url.includes(id) || id.includes(a.url)));
        return matches;
      });
      console.log(`   [${tier}] Filtered ${displayArticles.length} articles from ${articles.length} total (intersection: ${intersectionIds.length})`);
    }
    // For orphan mode, show all articles

    if (displayArticles.length === 0) {
      return (
        <div className="text-center py-8 text-muted-foreground">
          <p>No matching articles in this tier</p>
        </div>
      );
    }

    return (
      <div className="space-y-4">
        {displayArticles.map((article) => renderArticle(article, tier))}
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] flex flex-col bg-background border-border text-foreground shadow-2xl">
        <DialogHeader className="space-y-4 pb-4 border-b border-border">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 space-y-2">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-gradient-to-br from-violet-500/20 to-purple-500/20 border border-violet-500/30">
                  <FileText className="w-5 h-5 text-violet-300" />
                </div>
                <DialogTitle className="text-2xl font-bold text-foreground">
                  Select Article for {new Date(date).toLocaleDateString('en-US', { 
                    weekday: 'long',
                    year: 'numeric', 
                    month: 'long', 
                    day: 'numeric' 
                  })}
                </DialogTitle>
              </div>
              <DialogDescription className="text-muted-foreground text-base leading-relaxed">
                {selectionMode === 'multiple' ? (
                  <div className="flex items-start gap-2">
                    <Sparkles className="w-4 h-4 mt-1 text-yellow-400 flex-shrink-0" />
                    <span>
                      Multiple articles were approved by both <span className="font-semibold text-blue-300">Gemini</span> and <span className="font-semibold text-purple-300">Perplexity</span>. 
                      <span className="font-semibold text-yellow-300"> OpenAI</span> has suggested one, but you can choose a different one.
                    </span>
                  </div>
                ) : (
                  <div className="flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 mt-1 text-orange-400 flex-shrink-0" />
                    <span>
                      No articles were approved by both AIs. Please manually select an article to summarize.
                    </span>
                  </div>
                )}
              </DialogDescription>
            </div>
            <div className="flex-shrink-0">
              <VeriBadge badge={selectionMode === 'orphan' ? 'Orphan' : 'Verified'} />
            </div>
          </div>
        </DialogHeader>

        <Tabs defaultValue={defaultTier} className="w-full mt-6">
          <TabsList className="grid w-full grid-cols-3 bg-muted/50 border border-border rounded-lg p-1">
            <TabsTrigger
              value="bitcoin"
              className="data-[state=active]:bg-gradient-to-r data-[state=active]:from-orange-500/20 data-[state=active]:to-orange-600/20 data-[state=active]:text-orange-300 data-[state=active]:border-orange-500/30 data-[state=active]:shadow-lg transition-all rounded-md border border-transparent"
            >
              <div className="flex items-center gap-2">
                <Zap className="w-4 h-4" />
                <span className="font-semibold">Bitcoin</span>
                <Badge variant="secondary" className="ml-1 bg-orange-500/20 text-orange-300 border-orange-500/30 text-xs">
                  {tieredArticles.bitcoin.length}
                </Badge>
                {defaultTier === 'bitcoin' && (
                  <Star className="w-4 h-4 text-orange-400 fill-orange-400/30" />
                )}
              </div>
            </TabsTrigger>
            <TabsTrigger
              value="crypto"
              className="data-[state=active]:bg-gradient-to-r data-[state=active]:from-blue-500/20 data-[state=active]:to-blue-600/20 data-[state=active]:text-blue-300 data-[state=active]:border-blue-500/30 data-[state=active]:shadow-lg transition-all rounded-md border border-transparent"
            >
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4" />
                <span className="font-semibold">Crypto</span>
                <Badge variant="secondary" className="ml-1 bg-blue-500/20 text-blue-300 border-blue-500/30 text-xs">
                  {tieredArticles.crypto.length}
                </Badge>
                {defaultTier === 'crypto' && (
                  <Star className="w-4 h-4 text-blue-400 fill-blue-400/30" />
                )}
              </div>
            </TabsTrigger>
            <TabsTrigger
              value="macro"
              className="data-[state=active]:bg-gradient-to-r data-[state=active]:from-purple-500/20 data-[state=active]:to-purple-600/20 data-[state=active]:text-purple-300 data-[state=active]:border-purple-500/30 data-[state=active]:shadow-lg transition-all rounded-md border border-transparent"
            >
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4" />
                <span className="font-semibold">Macro</span>
                <Badge variant="secondary" className="ml-1 bg-purple-500/20 text-purple-300 border-purple-500/30 text-xs">
                  {tieredArticles.macro.length}
                </Badge>
                {defaultTier === 'macro' && (
                  <Star className="w-4 h-4 text-purple-400 fill-purple-400/30" />
                )}
              </div>
            </TabsTrigger>
          </TabsList>

          <div className="mt-4 flex-1 overflow-y-auto pr-2 min-h-0">
            <TabsContent value="bitcoin" className="mt-0">
              {renderTier('bitcoin', tieredArticles.bitcoin)}
            </TabsContent>
            <TabsContent value="crypto" className="mt-0">
              {renderTier('crypto', tieredArticles.crypto)}
            </TabsContent>
            <TabsContent value="macro" className="mt-0">
              {renderTier('macro', tieredArticles.macro)}
            </TabsContent>
          </div>
        </Tabs>

        <DialogFooter className="border-t border-border pt-6 mt-6">
          <div className="flex items-center justify-between w-full gap-4">
            <div className="flex items-center gap-3 text-sm">
              {selectedArticleId ? (
                <>
                  <div className="p-1.5 rounded-full bg-green-500/20 border border-green-500/30">
                    <CheckCircle className="w-4 h-4 text-green-400" />
                  </div>
                  <div className="flex flex-col">
                    <span className="text-muted-foreground text-xs">Selected Article:</span>
                    <span className="text-foreground font-medium">
                      {tieredArticles.bitcoin.concat(tieredArticles.crypto, tieredArticles.macro).find(a => a.id === selectedArticleId)?.title.substring(0, 60)}
                      {tieredArticles.bitcoin.concat(tieredArticles.crypto, tieredArticles.macro).find(a => a.id === selectedArticleId)?.title.length && tieredArticles.bitcoin.concat(tieredArticles.crypto, tieredArticles.macro).find(a => a.id === selectedArticleId)!.title.length > 60 ? '...' : ''}
                    </span>
                  </div>
                </>
              ) : (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <AlertCircle className="w-4 h-4" />
                  <span>Please select an article to continue</span>
                </div>
              )}
            </div>
            <div className="flex gap-3">
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={isConfirming}
                className="border-border text-muted-foreground hover:bg-muted/50 hover:border-muted-foreground/50 transition-all"
              >
                Cancel
              </Button>
              <Button
                onClick={handleConfirm}
                disabled={!selectedArticleId || isConfirming}
                className="bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 text-white shadow-lg shadow-green-500/20 hover:shadow-green-500/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed font-semibold"
              >
                {isConfirming ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Generating Summary...
                  </>
                ) : (
                  <>
                    <CheckCircle className="w-4 h-4 mr-2" />
                    Confirm Selection
                  </>
                )}
              </Button>
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

