import { useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface UseToggleFlagOptions {
  /**
   * Query keys to invalidate after successful flag toggle.
   * Defaults to ['supabase-tags-analyses'] if not provided.
   */
  invalidateQueries?: string[][];
  /**
   * Custom success message. Defaults to 'Flag updated'.
   */
  successMessage?: string;
}

/**
 * Reusable hook for toggling flag status on analyses.
 * 
 * @param options - Configuration options for the hook
 * @returns A mutation object with mutate function
 * 
 * @example
 * ```tsx
 * const toggleFlagMutation = useToggleFlag({
 *   invalidateQueries: [['supabase-tags-analyses'], ['monthly-analyses']]
 * });
 * 
 * // Use it:
 * toggleFlagMutation.mutate({
 *   date: '2024-01-01',
 *   isFlagged: true
 * });
 * ```
 */
export function useToggleFlag(options: UseToggleFlagOptions = {}) {
  const { toast } = useToast();
  const { invalidateQueries = [['supabase-tags-analyses']], successMessage = 'Flag updated' } = options;

  return useMutation({
    mutationFn: async ({ date, isFlagged }: { date: string; isFlagged: boolean }) => {
      const response = await fetch(`/api/analysis/date/${date}/flag`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ isFlagged }),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Failed to toggle flag' }));
        throw new Error(error.error || 'Failed to toggle flag');
      }

      return await response.json();
    },
    onSuccess: () => {
      // Invalidate all specified query keys
      invalidateQueries.forEach(queryKey => {
        queryClient.invalidateQueries({ queryKey });
      });
      
      toast({
        title: successMessage,
        description: 'The flag status has been updated.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
}

