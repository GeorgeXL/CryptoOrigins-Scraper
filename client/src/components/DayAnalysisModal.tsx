import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { 
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { queryClient, clearCacheForDate } from "@/lib/queryClient";
import { apiRequest } from "@/lib/queryClient";
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
import { formatDate, extractDomainFromUrl, truncateText } from "@/lib/utils";
import { 
  Bot, 
  Edit, 
  RefreshCw, 
  Save, 
  Eye, 
  Star,
  ExternalLink,
  TrendingUp,
  X,
  Calendar,
  Clock,
  Target,
  Newspaper
} from "lucide-react";

interface DayAnalysisModalProps {
  isOpen: boolean;
  onClose: () => void;
  date: string;
}

interface DayAnalysisData {
  analysis: {
    id: string;
    date: string;
    summary: string;
    topArticleId: string;
    reasoning: string;
    confidenceScore: string;
    aiProvider: string;
    lastAnalyzed: string;
  };
  manualEntries: Array<{
    id: string;
    title: string;
    summary: string;
    description: string;
  }>;
}

interface NewsArticle {
  id: string;
  title: string;
  url: string;
  publishedDate: string;
  author?: string;
  text: string;
  score?: number;
}

export default function DayAnalysisModal({ isOpen, onClose, date }: DayAnalysisModalProps) {
  const { toast } = useToast();
  const [isEditing, setIsEditing] = useState(false);
  const [showReanalyzeConfirm, setShowReanalyzeConfirm] = useState(false);

  const { data: dayData, isLoading } = useQuery<DayAnalysisData>({
    queryKey: [`/api/analysis/date/${date}`],
    enabled: isOpen && !!date,
  });

  const { data: newsArticles, isLoading: newsLoading } = useQuery<{results: NewsArticle[]}>({
    queryKey: [`/api/news/fetch/${date}`],
    enabled: isOpen && !!date,
  });

  const reanalyzeMutation = useMutation({
    mutationFn: async () => {
      // Clear all cached data for this date first
      clearCacheForDate(date);
      
      const response = await fetch(`/api/analysis/date/${date}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ 
          forceReanalysis: true,
          aiProvider: 'openai',
          newsProvider: 'exa'
        }),
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/analysis/date/${date}`] });
      queryClient.invalidateQueries({ queryKey: ['/api/analysis/stats'] });
      const year = new Date(date).getFullYear();
      queryClient.invalidateQueries({ queryKey: [`/api/analysis/year/${year}`] });
      setShowReanalyzeConfirm(false); // Close the confirmation dialog
      const formattedDate = new Date(date).toLocaleDateString('en-US', { 
        month: 'long', 
        day: 'numeric', 
        year: 'numeric' 
      });
      toast({
        title: "Analysis Complete",
        description: `Bitcoin news analysis for ${formattedDate} has been updated successfully.`,
      });
    },
    onError: (error: any) => {
      setShowReanalyzeConfirm(false); // Close the confirmation dialog on error
      toast({
        title: "Analysis Failed",
        description: error.message || "Failed to reanalyze the news for this date.",
        variant: "destructive",
      });
    },
  });

  const handleReanalyzeClick = () => {
    setShowReanalyzeConfirm(true);
  };

  const handleConfirmReanalyze = () => {
    if (!reanalyzeMutation.isPending) {
      reanalyzeMutation.mutate();
    }
  };


  const topArticle = newsArticles?.results?.find(article => 
    article.id === dayData?.analysis?.topArticleId
  );

  const otherArticles = newsArticles?.results?.filter(article => 
    article.id !== dayData?.analysis?.topArticleId
  ) || [];

  const handleClose = () => {
    setIsEditing(false);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-5xl max-h-screen overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <div>
              <DialogTitle className="text-xl font-bold text-slate-900">
                {formatDate(date)}
              </DialogTitle>
              <p className="text-slate-600">Bitcoin News Analysis</p>
            </div>
            <Button variant="ghost" size="sm" onClick={handleClose}>
              <X className="w-4 h-4" />
            </Button>
          </div>
        </DialogHeader>

        <div className="space-y-6">
          {isLoading ? (
            <div className="space-y-4">
              <Skeleton className="h-32 w-full" />
              <Skeleton className="h-48 w-full" />
            </div>
          ) : !dayData ? (
            <Card>
              <CardContent className="p-12 text-center">
                <Calendar className="w-12 h-12 text-slate-400 mx-auto mb-4" />
                <p className="text-slate-500 mb-4">No analysis found for this date.</p>
                <Button 
                  onClick={handleReanalyzeClick}
                  disabled={reanalyzeMutation.isPending}
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
          ) : (
            <>
              {/* AI Summary Card */}
              <Card className="gradient-ai">
                <CardContent className="p-6">
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center space-x-2">
                      <Bot className="w-5 h-5 text-violet-600" />
                      <h3 className="text-lg font-semibold text-slate-900">AI Summary</h3>
                      <Badge variant="secondary" className="bg-violet-100 text-violet-800">
                        {dayData.analysis.aiProvider?.toUpperCase() || 'GPT-4'}
                      </Badge>
                    </div>
                    <div className="flex items-center space-x-2">
                      <Button variant="ghost" size="sm" onClick={() => setIsEditing(!isEditing)}>
                        <Edit className="w-4 h-4" />
                      </Button>
                      <Button 
                        variant="ghost" 
                        size="sm"
                        onClick={handleReanalyzeClick}
                        disabled={reanalyzeMutation.isPending}
                      >
                        {reanalyzeMutation.isPending ? (
                          <RefreshCw className="w-4 h-4 animate-spin" />
                        ) : (
                          <RefreshCw className="w-4 h-4" />
                        )}
                      </Button>
                    </div>
                  </div>
                  
                  <blockquote className="text-slate-800 text-lg leading-relaxed mb-4 border-l-4 border-violet-300 pl-4">
                    "{dayData.analysis.summary}"
                  </blockquote>
                  
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                    <div className="flex items-center space-x-2">
                      <Target className="w-4 h-4 text-slate-600" />
                      <span className="text-slate-600">
                        Confidence: <span className="font-medium text-slate-900">
                          {Math.round(parseFloat(dayData.analysis.confidenceScore || '0'))}%
                        </span>
                      </span>
                    </div>
                    <div className="flex items-center space-x-2">
                      <Newspaper className="w-4 h-4 text-slate-600" />
                      <span className="text-slate-600">
                        Sources: <span className="font-medium text-slate-900">
                          {newsArticles?.results?.length || 0} articles
                        </span>
                      </span>
                    </div>
                    <div className="flex items-center space-x-2">
                      <Clock className="w-4 h-4 text-slate-600" />
                      <span className="text-slate-500">
                        {dayData.analysis.summary.length} characters
                      </span>
                    </div>
                  </div>
                  
                  {dayData.analysis.lastAnalyzed && (
                    <div className="mt-4 pt-4 border-t border-violet-200">
                      <span className="text-xs text-slate-500">
                        Last analyzed: {new Date(dayData.analysis.lastAnalyzed).toLocaleString()}
                      </span>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Top Article */}
              {topArticle && (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center space-x-2">
                      <TrendingUp className="w-5 h-5 text-blue-600" />
                      <span>Featured Article</span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-start space-x-4">
                      <div className="w-24 h-16 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center flex-shrink-0">
                        <TrendingUp className="w-8 h-8 text-white" />
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center space-x-2 mb-2">
                          <Badge className="bg-blue-100 text-blue-800">Top Article</Badge>
                          <span className="text-slate-500 text-sm">
                            {extractDomainFromUrl(topArticle.url)}
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
                          {truncateText(topArticle.text, 200)}
                        </p>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-4 text-sm text-slate-500">
                            {topArticle.author && (
                              <span className="flex items-center">
                                <Eye className="w-3 h-3 mr-1" />
                                By {topArticle.author}
                              </span>
                            )}
                            {topArticle.score && (
                              <span className="flex items-center">
                                <Star className="w-3 h-3 mr-1" />
                                {(topArticle.score * 10).toFixed(1)} rating
                              </span>
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

              {/* Additional Articles */}
              {otherArticles.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle>Related Articles ({otherArticles.length} more)</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {otherArticles.slice(0, 5).map((article) => (
                      <div key={article.id} className="border border-slate-200 rounded-lg p-4 hover:bg-slate-50 transition-colors">
                        <div className="flex justify-between items-start">
                          <div className="flex-1">
                            <div className="flex items-center space-x-2 mb-1">
                              <span className="text-slate-500 text-sm">
                                {extractDomainFromUrl(article.url)}
                              </span>
                              <span className="text-slate-400">•</span>
                              <span className="text-slate-500 text-sm">
                                {new Date(article.publishedDate).toLocaleTimeString('en-US', {
                                  hour: 'numeric',
                                  minute: '2-digit',
                                  hour12: true
                                })}
                              </span>
                            </div>
                            <h5 className="font-medium text-slate-900 mb-1 hover:text-blue-600">
                              <a href={article.url} target="_blank" rel="noopener noreferrer">
                                {article.title}
                              </a>
                            </h5>
                            <p className="text-slate-600 text-sm truncate-2">
                              {truncateText(article.text, 150)}
                            </p>
                            {article.author && (
                              <p className="text-xs text-slate-500 mt-1">
                                By {article.author}
                              </p>
                            )}
                          </div>
                          <div className="text-right ml-4">
                            {article.score && (
                              <Badge variant="outline" className="ml-2">
                                {(article.score * 10).toFixed(1)}/10
                              </Badge>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                    
                    {otherArticles.length > 5 && (
                      <div className="text-center pt-4">
                        <Button variant="outline" size="sm">
                          Show {otherArticles.length - 5} more articles
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* AI Reasoning */}
              {dayData.analysis.reasoning && (
                <Card className="bg-slate-50">
                  <CardHeader>
                    <CardTitle className="flex items-center space-x-2">
                      <Bot className="w-5 h-5 text-slate-600" />
                      <span>AI Reasoning</span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-slate-700 leading-relaxed">
                      {dayData.analysis.reasoning}
                    </p>
                  </CardContent>
                </Card>
              )}

              {/* Manual Entries */}
              {dayData.manualEntries.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center space-x-2">
                      <Edit className="w-5 h-5 text-purple-600" />
                      <span>Manual Entries</span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {dayData.manualEntries.map((entry) => (
                      <div key={entry.id} className="border border-purple-200 rounded-lg p-4 bg-purple-50">
                        <h5 className="font-medium text-slate-900 mb-2">{entry.title}</h5>
                        <p className="text-slate-700 text-sm mb-2">{entry.summary}</p>
                        {entry.description && (
                          <p className="text-slate-600 text-xs">{entry.description}</p>
                        )}
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}

              {/* Action Buttons */}
              <div className="flex justify-between pt-4 border-t border-slate-200">
                <div className="flex space-x-3">
                  <Button 
                    onClick={handleReanalyzeClick}
                    disabled={reanalyzeMutation.isPending}
                    variant="outline"
                  >
                    {reanalyzeMutation.isPending ? (
                      <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <RefreshCw className="w-4 h-4 mr-2" />
                    )}
                    Reanalyze
                  </Button>
                  <Button variant="outline">
                    <Edit className="w-4 h-4 mr-2" />
                    Edit Summary
                  </Button>
                </div>
                <Button className="bg-emerald-600 hover:bg-emerald-700">
                  <Save className="w-4 h-4 mr-2" />
                  Save Changes
                </Button>
              </div>
            </>
          )}
        </div>
      </DialogContent>

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
    </Dialog>
  );
}
