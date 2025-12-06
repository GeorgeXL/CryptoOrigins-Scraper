import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

export interface ApiStatus {
  name: string;
  status: 'operational' | 'degraded' | 'outage';
  lastChecked: string;
  error?: string;
  responseTime?: number;
}

export interface SystemHealth {
  overall: 'operational' | 'degraded' | 'outage';
  apis: ApiStatus[];
  lastUpdate: string;
}

export function useApiHealth() {
  const [dismissedIssues, setDismissedIssues] = useState<string[]>([]);

  const { data: health, isLoading, error } = useQuery<SystemHealth>({
    queryKey: ['/api/health/status'],
    refetchInterval: 300000, // Check every 5 minutes
    staleTime: 280000, // Consider stale after 4 minutes 40 seconds  
    retry: 3,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
  });

  // Determine if we should show the banner based on current health state
  const shouldShowBanner = health && health.overall !== 'operational' && !dismissedIssues.length;

  const dismissBanner = () => {
    if (health) {
      const currentIssues = health.apis
        .filter(api => api.status !== 'operational')
        .map(api => `${api.name}:${api.status}`);
      
      setDismissedIssues(prev => [...prev, ...currentIssues]);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'operational': return 'text-green-600';
      case 'degraded': return 'text-yellow-600';
      case 'outage': return 'text-red-600';
      default: return 'text-gray-600';
    }
  };

  const getStatusDot = (status: string) => {
    switch (status) {
      case 'operational': return 'bg-green-500';
      case 'degraded': return 'bg-yellow-500';
      case 'outage': return 'bg-red-500';
      default: return 'bg-gray-500';
    }
  };

  const formatStatus = (api: ApiStatus) => {
    if (api.status === 'operational') {
      return `${api.name} (${api.responseTime}ms)`;
    } else {
      return `${api.name} experiencing issues`;
    }
  };

  return {
    health,
    isLoading,
    error,
    showBanner: shouldShowBanner,
    dismissBanner,
    getStatusColor,
    getStatusDot,
    formatStatus,
  };
}