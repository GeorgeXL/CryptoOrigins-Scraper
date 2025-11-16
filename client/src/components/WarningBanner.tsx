import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertTriangle, Wifi, Database, Clock, TrendingDown, FileX } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';

interface ApiStatus {
  name: string;
  status: string;
  rateLimitRemaining?: number;
}

interface HealthStatus {
  overall: 'operational' | 'degraded' | 'outage';
  apis: ApiStatus[];
  lastUpdate: string;
}

interface WarningItem {
  id: string;
  type: 'critical' | 'warning' | 'info';
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  action?: {
    label: string;
    onClick: () => void;
  };
}

export function WarningBanner() {
  const { data: healthStatus } = useQuery<HealthStatus>({
    queryKey: ['/api/health/status'],
    refetchInterval: false, // Disable automatic refresh
  });
  
  // Check for recent analysis quality issues
  const { data: qualityWarnings } = useQuery({
    queryKey: ['/api/analysis/quality-warnings'],
    queryFn: async () => {
      const response = await fetch('/api/analysis/quality-warnings');
      if (!response.ok) return [];
      return response.json();
    },
    refetchInterval: false, // Disable automatic refresh
  });

  const warnings: WarningItem[] = [];

  // API Health Warnings
  if (healthStatus?.overall !== 'operational') {
    const failedApis = healthStatus?.apis?.filter((api: ApiStatus) => api.status !== 'operational') || [];
    
    if (failedApis.length > 0) {
      warnings.push({
        id: 'api-health',
        type: 'critical',
        icon: Wifi,
        title: 'API Service Issues Detected',
        description: `${failedApis.map((api: ApiStatus) => api.name).join(', ')} ${failedApis.length === 1 ? 'is' : 'are'} experiencing issues. This may affect news analysis quality.`,
        action: {
          label: 'Check Status',
          onClick: () => window.location.href = '/settings'
        }
      });
    }
  }

  // Data Quality Warnings
  if (qualityWarnings && qualityWarnings.length > 0) {
    warnings.push({
      id: 'data-quality',
      type: 'warning',
      icon: TrendingDown,
      title: 'Analysis Quality Issues',
      description: `${qualityWarnings.length} recent analyses may have quality issues or missing information.`,
      action: {
        label: 'Review',
        onClick: () => {
          // Navigate to first flagged date
          if (qualityWarnings[0]?.date) {
            window.location.href = `/day/${qualityWarnings[0].date}`;
          }
        }
      }
    });
  }

  // Database Performance Warning
  const { data: dbStats } = useQuery({
    queryKey: ['/api/system/db-stats'],
    queryFn: async () => {
      const response = await fetch('/api/system/db-stats');
      if (!response.ok) return null;
      return response.json();
    },
    refetchInterval: false, // Disable automatic refresh
  });

  if (dbStats?.slowQueries > 10) {
    warnings.push({
      id: 'db-performance',
      type: 'warning',
      icon: Database,
      title: 'Database Performance Issues',
      description: `${dbStats.slowQueries} slow database queries detected. This may affect loading speeds.`,
    });
  }

  // Rate Limit Warnings
  if (healthStatus?.apis?.some((api: ApiStatus) => api.rateLimitRemaining && api.rateLimitRemaining < 100)) {
    const lowLimitApis = healthStatus.apis.filter((api: ApiStatus) => api.rateLimitRemaining && api.rateLimitRemaining < 100);
    warnings.push({
      id: 'rate-limits',
      type: 'warning',
      icon: Clock,
      title: 'API Rate Limits Running Low',
      description: `${lowLimitApis.map((api: ApiStatus) => api.name).join(', ')} ${lowLimitApis.length === 1 ? 'has' : 'have'} limited requests remaining today.`,
    });
  }

  // Missing Analysis Warnings
  const { data: missingAnalysis } = useQuery({
    queryKey: ['/api/analysis/missing-days'],
    queryFn: async () => {
      const response = await fetch('/api/analysis/missing-days?recent=7');
      if (!response.ok) return [];
      return response.json();
    },
    refetchInterval: false, // Disable automatic refresh
  });

  if (missingAnalysis && missingAnalysis.length > 0) {
    warnings.push({
      id: 'missing-analysis',
      type: 'info',
      icon: FileX,
      title: 'Recent Days Without Analysis',
      description: `${missingAnalysis.length} recent days are missing Bitcoin news analysis.`,
      action: {
        label: 'Analyze Now',
        onClick: () => {
          // Trigger batch analysis for missing days
          fetch('/api/analysis/batch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ dates: missingAnalysis.slice(0, 5) })
          });
        }
      }
    });
  }

  if (warnings.length === 0) {
    return null;
  }

  return (
    <div className="space-y-2 mb-6">
      {warnings.map((warning) => {
        const Icon = warning.icon;
        return (
          <Alert 
            key={warning.id} 
            variant={warning.type === 'critical' ? 'destructive' : 'default'}
            className={`${
              warning.type === 'critical' ? 'border-red-500 bg-red-50' : 
              warning.type === 'warning' ? 'border-yellow-500 bg-yellow-50' : 
              'border-blue-500 bg-blue-50'
            }`}
          >
            <Icon className="h-4 w-4" />
            <AlertDescription>
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium text-sm mb-1">{warning.title}</div>
                  <div className="text-sm">{warning.description}</div>
                </div>
                {warning.action && (
                  <button
                    onClick={warning.action.onClick}
                    className={`ml-4 px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                      warning.type === 'critical' ? 'bg-red-600 text-white hover:bg-red-700' :
                      warning.type === 'warning' ? 'bg-yellow-600 text-white hover:bg-yellow-700' :
                      'bg-blue-600 text-white hover:bg-blue-700'
                    }`}
                  >
                    {warning.action.label}
                  </button>
                )}
              </div>
            </AlertDescription>
          </Alert>
        );
      })}
    </div>
  );
}