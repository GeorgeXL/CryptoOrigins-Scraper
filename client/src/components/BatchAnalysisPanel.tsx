import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { CheckSquare, Square, Play, X, Calendar } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';

interface BatchAnalysisProps {
  availableDates: string[];
  onClose: () => void;
}

interface BatchResult {
  date: string;
  status: 'pending' | 'success' | 'error';
  error?: string;
}

export default function BatchAnalysisPanel({ availableDates, onClose }: BatchAnalysisProps) {
  const [selectedDates, setSelectedDates] = useState<string[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<BatchResult[]>([]);
  const queryClient = useQueryClient();

  const handleDateToggle = (date: string, checked: boolean) => {
    if (checked) {
      setSelectedDates([...selectedDates, date]);
    } else {
      setSelectedDates(selectedDates.filter(d => d !== date));
    }
  };

  const selectAll = () => {
    setSelectedDates(availableDates);
  };

  const clearAll = () => {
    setSelectedDates([]);
  };

  const runBatchAnalysis = async () => {
    if (selectedDates.length === 0) return;

    setIsRunning(true);
    setProgress(0);
    setResults([]);

    try {
      const response = await apiRequest('POST', '/api/analysis/batch', {
        dates: selectedDates,
        aiProvider: 'openai'
      });

      const data = await response.json();
      setResults(data.results);
      setProgress(100);

      // Invalidate relevant queries to refresh the UI
      queryClient.invalidateQueries({ queryKey: ['/api/analysis'] });
      
    } catch (error) {
      console.error('Batch analysis failed:', error);
      setResults(selectedDates.map(date => ({
        date,
        status: 'error',
        error: 'Failed to start analysis'
      })));
    } finally {
      setIsRunning(false);
    }
  };

  const getDateStatus = (date: string) => {
    const result = results.find(r => r.date === date);
    if (!result) return 'pending';
    return result.status;
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'success': return 'bg-green-500';
      case 'error': return 'bg-red-500';
      case 'pending': return 'bg-yellow-500';
      default: return 'bg-gray-300';
    }
  };

  const successCount = results.filter(r => r.status === 'success').length;
  const errorCount = results.filter(r => r.status === 'error').length;

  return (
    <Card className="fixed inset-4 z-50 bg-white dark:bg-gray-900 shadow-xl">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-xl flex items-center gap-2">
            <Calendar className="w-5 h-5" />
            Batch Analysis
          </CardTitle>
          <Button onClick={onClose} variant="ghost" size="sm">
            <X className="w-4 h-4" />
          </Button>
        </div>
        <div className="text-sm text-gray-600 dark:text-gray-400">
          Select multiple dates to analyze in batch. This will fetch and analyze Bitcoin news for each selected date.
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Selection Controls */}
        <div className="flex items-center justify-between">
          <div className="flex gap-2">
            <Button onClick={selectAll} variant="outline" size="sm">
              <CheckSquare className="w-4 h-4 mr-2" />
              Select All ({availableDates.length})
            </Button>
            <Button onClick={clearAll} variant="outline" size="sm">
              <Square className="w-4 h-4 mr-2" />
              Clear All
            </Button>
          </div>
          <div className="text-sm text-gray-600 dark:text-gray-400">
            {selectedDates.length} selected
          </div>
        </div>

        {/* Progress */}
        {isRunning && (
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span>Processing batch...</span>
              <span>{Math.round(progress)}%</span>
            </div>
            <Progress value={progress} className="w-full" />
          </div>
        )}

        {/* Results Summary */}
        {results.length > 0 && (
          <div className="flex gap-4 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
            <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
              ✓ {successCount} Success
            </Badge>
            <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">
              ✗ {errorCount} Failed
            </Badge>
            <Badge variant="outline">
              📊 {results.length} Total
            </Badge>
          </div>
        )}

        {/* Date Selection Grid */}
        <ScrollArea className="h-96 border rounded-lg p-4">
          <div className="grid grid-cols-4 gap-2">
            {availableDates.map((date) => {
              const isSelected = selectedDates.includes(date);
              const status = getDateStatus(date);
              
              return (
                <div
                  key={date}
                  className={`
                    relative p-3 border rounded-lg cursor-pointer transition-all
                    ${isSelected 
                      ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-700' 
                      : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700'
                    }
                  `}
                  onClick={() => handleDateToggle(date, !isSelected)}
                >
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      checked={isSelected}
                      onChange={() => {}}
                      className="pointer-events-none"
                    />
                    <span className="text-sm font-medium">{date}</span>
                  </div>
                  
                  {status !== 'pending' && (
                    <div className={`absolute top-1 right-1 w-2 h-2 rounded-full ${getStatusColor(status)}`} />
                  )}
                </div>
              );
            })}
          </div>
        </ScrollArea>

        {/* Action Buttons */}
        <div className="flex justify-between pt-4">
          <Button onClick={onClose} variant="outline">
            Cancel
          </Button>
          <Button 
            onClick={runBatchAnalysis} 
            disabled={selectedDates.length === 0 || isRunning}
            className="min-w-32"
          >
            {isRunning ? (
              <>Processing...</>
            ) : (
              <>
                <Play className="w-4 h-4 mr-2" />
                Analyze {selectedDates.length} Dates
              </>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}