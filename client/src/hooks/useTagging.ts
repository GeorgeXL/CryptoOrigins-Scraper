import { useState } from 'react';
import { useToast } from '@/hooks/use-toast';
import { queryClient } from '@/lib/queryClient';

export function useTagging() {
  const { toast } = useToast();
  const [isBatchTagging, setIsBatchTagging] = useState(false);
  const [isContextTagging, setIsContextTagging] = useState(false);

  const startBatchTagging = async (dates?: string[]) => {
    setIsBatchTagging(true);
    try {
      const response = await fetch('/api/batch-tagging/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dates: dates || null }),
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to start batch tagging');
      }
      
      const data = await response.json();
      const count = dates?.length || data.total || 'all';
      toast({
        title: "Batch Tagging started",
        description: `AI is extracting tags from ${count} ${dates ? 'selected' : 'untagged'} summaries`,
      });
      
      // Invalidate queries to refresh data after tagging completes
      setTimeout(() => {
        if (dates && dates.length === 1) {
          queryClient.invalidateQueries({ queryKey: [`supabase-date-${dates[0]}`] });
        } else {
          queryClient.invalidateQueries({ queryKey: ['analyses'] });
          // Invalidate all date-specific queries
          queryClient.invalidateQueries({ predicate: (query) => {
            return Array.isArray(query.queryKey) && 
                   query.queryKey[0]?.toString().startsWith('supabase-date-');
          } });
        }
      }, 2000);
    } catch (err: any) {
      toast({
        title: "Error",
        description: err.message || "Failed to start batch tagging",
        variant: "destructive",
      });
    } finally {
      setIsBatchTagging(false);
    }
  };

  const startContextTagging = async (dates?: string[]) => {
    setIsContextTagging(true);
    try {
      const response = await fetch('/api/tagging/with-context', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dates: dates || null }),
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to start context tagging');
      }
      
      const data = await response.json();
      const count = dates?.length || data.total || 'all';
      toast({
        title: "Tagging with Context started",
        description: `AI is extracting tags from ${count} ${dates ? 'selected' : 'untagged'} summaries with full article context`,
      });
      
      // Invalidate queries to refresh data after tagging completes
      setTimeout(() => {
        if (dates && dates.length === 1) {
          queryClient.invalidateQueries({ queryKey: [`supabase-date-${dates[0]}`] });
        } else {
          queryClient.invalidateQueries({ queryKey: ['analyses'] });
          // Invalidate all date-specific queries
          queryClient.invalidateQueries({ predicate: (query) => {
            return Array.isArray(query.queryKey) && 
                   query.queryKey[0]?.toString().startsWith('supabase-date-');
          } });
        }
      }, 2000);
    } catch (err: any) {
      toast({
        title: "Error",
        description: err.message || "Failed to start context tagging",
        variant: "destructive",
      });
    } finally {
      setIsContextTagging(false);
    }
  };

  const stopBatchTagging = async () => {
    try {
      const response = await fetch('/api/batch-tagging/stop', { method: 'POST' });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to stop batch tagging');
      }
      toast({
        title: "Batch Tagging stopped",
        description: "Batch tagging has been halted",
      });
    } catch (err: any) {
      toast({
        title: "Error",
        description: err.message || "Failed to stop batch tagging",
        variant: "destructive",
      });
    }
  };

  const stopContextTagging = async () => {
    try {
      const response = await fetch('/api/tagging/with-context/stop', { method: 'POST' });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to stop context tagging');
      }
      toast({
        title: "Context Tagging stopped",
        description: "Context tagging has been halted",
      });
    } catch (err: any) {
      toast({
        title: "Error",
        description: err.message || "Failed to stop context tagging",
        variant: "destructive",
      });
    }
  };

  return {
    startBatchTagging,
    startContextTagging,
    stopBatchTagging,
    stopContextTagging,
    isBatchTagging,
    isContextTagging,
    isTagging: isBatchTagging || isContextTagging,
  };
}

