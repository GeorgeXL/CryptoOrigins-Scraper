import { useState, useRef, useEffect } from 'react';
import { useToast } from '@/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';

export function useAutoTagging() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isCategorizing, setIsCategorizing] = useState(false);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, []);

  const startAutoTagging = async () => {
    setIsCategorizing(true);
    try {
      const response = await fetch('/api/tags/ai-categorize/start', { method: 'POST' });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to start auto sorting');
      }
      
      const data = await response.json();
      toast({
        title: "Auto Sorting started",
        description: `AI is categorizing ${data.total || 0} tags in the background`,
      });

      // Poll for status until complete
      const pollStatus = async () => {
        try {
          const statusResponse = await fetch('/api/tags/ai-categorize/status');
          if (!statusResponse.ok) return;
          
          const status = await statusResponse.json();
          
          if (!status.isRunning) {
            // Categorization complete - stop polling and refresh data
            if (pollIntervalRef.current) {
              clearInterval(pollIntervalRef.current);
              pollIntervalRef.current = null;
            }
            
            setIsCategorizing(false);
            
            // Invalidate queries to refresh the UI
            queryClient.invalidateQueries({ queryKey: ['/api/tags/quality-check'] });
            queryClient.invalidateQueries({ queryKey: ['/api/tags/filter-tree'] });
            
            toast({
              title: "Auto Sorting completed",
              description: `Processed ${status.processed || 0} of ${status.total || 0} tags`,
            });
          }
        } catch (error) {
          console.error('Error polling status:', error);
        }
      };

      // Clear any existing interval
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }

      // Start polling every 2 seconds
      pollIntervalRef.current = setInterval(pollStatus, 2000);
      
      // Also poll immediately
      pollStatus();
      
    } catch (err) {
      setIsCategorizing(false);
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Failed to start auto sorting",
        variant: "destructive",
      });
    }
  };

  return {
    startAutoTagging,
    isCategorizing,
  };
}

