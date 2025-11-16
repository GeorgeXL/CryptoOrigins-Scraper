import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';

interface HealthCheckResult {
  overall: 'operational' | 'degraded' | 'outage';
  apis: Array<{
    name: string;
    status: 'operational' | 'degraded' | 'outage';
    lastChecked: string;
    error?: string;
    responseTime?: number;
  }>;
  lastUpdate: string;
}

export function useApiHealthCheck() {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (): Promise<HealthCheckResult> => {
      const response = await fetch('/api/health/refresh', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      return await response.json();
    },
    onSuccess: (data) => {
      // Update the health status cache
      queryClient.setQueryData(['health-status'], data);
    },
  });

  return {
    triggerHealthCheck: mutation.mutateAsync,
    isLoading: mutation.isPending,
    error: mutation.error,
  };
}