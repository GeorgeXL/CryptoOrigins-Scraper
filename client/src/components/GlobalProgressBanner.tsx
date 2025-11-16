import { useState, useEffect } from 'react';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { X, StopCircle, Calendar, BarChart3 } from 'lucide-react';
import { useGlobalAnalysis } from '@/contexts/GlobalAnalysisContext';
import { useToast } from '@/hooks/use-toast';

export function GlobalProgressBanner() {
  const { activeAnalyses, stopAnalysis, hasActiveAnalyses } = useGlobalAnalysis();
  const { toast } = useToast();
  const [isCollapsed, setIsCollapsed] = useState(false);

  // Auto-expand when new analyses start
  useEffect(() => {
    if (hasActiveAnalyses && isCollapsed) {
      setIsCollapsed(false);
    }
  }, [hasActiveAnalyses, isCollapsed]);

  if (!hasActiveAnalyses) {
    return null;
  }

  const handleStopAnalysis = (id: string, label: string) => {
    stopAnalysis(id);
    toast({
      title: "Analysis stopped",
      description: `${label} has been cancelled.`
    });
  };

  const formatElapsedTime = (startTime: number) => {
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    const minutes = Math.floor(elapsed / 60);
    const seconds = elapsed % 60;
    if (minutes > 0) {
      return `${minutes}m ${seconds}s`;
    }
    return `${seconds}s`;
  };

  const getAnalysisIcon = (type: string) => {
    switch (type) {
      case 'year': return BarChart3;
      case 'month': return Calendar;
      case 'batch': return Calendar;
      default: return Calendar;
    }
  };

  if (isCollapsed) {
    return (
      <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border-b border-blue-200 px-4 py-2 flex items-center justify-between shadow-sm">
        <div className="flex items-center space-x-3">
          <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
          <span className="text-sm font-medium text-blue-900">
            {activeAnalyses.size} analysis{activeAnalyses.size > 1 ? 'es' : ''} running
          </span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setIsCollapsed(false)}
          className="h-6 px-2 text-blue-700 hover:bg-blue-100"
        >
          Show
        </Button>
      </div>
    );
  }

  return (
    <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border-b border-blue-200 px-4 py-3 shadow-sm">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center space-x-2">
            <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
            <h3 className="text-sm font-semibold text-blue-900">
              Running Analyses ({activeAnalyses.size})
            </h3>
          </div>
          <div className="flex items-center space-x-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsCollapsed(true)}
              className="h-6 px-2 text-blue-700 hover:bg-blue-100"
            >
              Minimize
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                Array.from(activeAnalyses.keys()).forEach(id => {
                  const analysis = activeAnalyses.get(id);
                  if (analysis) {
                    handleStopAnalysis(id, analysis.label);
                  }
                });
              }}
              className="h-6 px-2 text-red-700 hover:bg-red-100"
            >
              <X className="w-3 h-3 mr-1" />
              Stop All
            </Button>
          </div>
        </div>

        <div className="space-y-3">
          {Array.from(activeAnalyses.values()).map((analysis) => {
            const Icon = getAnalysisIcon(analysis.type);
            const progressPercentage = analysis.total > 0 ? Math.round((analysis.completed / analysis.total) * 100) : 0;
            
            return (
              <div key={analysis.id} className="bg-white rounded-lg border border-blue-200 p-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center space-x-3">
                    <Icon className="w-4 h-4 text-blue-600" />
                    <div>
                      <div className="flex items-center space-x-2">
                        <span className="text-sm font-medium text-slate-900">{analysis.label}</span>
                        <Badge variant="secondary" className="text-xs">
                          {analysis.type}
                        </Badge>
                      </div>
                      <div className="text-xs text-slate-500 mt-1">
                        {analysis.completed} / {analysis.total} completed
                        {analysis.currentDate && (
                          <span className="ml-2">• Currently: {analysis.currentDate}</span>
                        )}
                        <span className="ml-2">• {formatElapsedTime(analysis.startTime)}</span>
                      </div>
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleStopAnalysis(analysis.id, analysis.label)}
                    className="flex items-center space-x-1 text-red-600 border-red-200 hover:bg-red-50"
                  >
                    <StopCircle className="w-3 h-3" />
                    <span>Stop</span>
                  </Button>
                </div>
                
                <div className="space-y-1">
                  <div className="flex justify-between text-xs text-slate-600">
                    <span>{progressPercentage}% complete</span>
                    <span>{analysis.completed} / {analysis.total}</span>
                  </div>
                  <Progress value={progressPercentage} className="h-2" />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}