import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Wifi, Database, Clock, TrendingDown, FileX, LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Badge } from '@/components/ui/badge';

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

interface Warning {
  id: string;
  type: 'critical' | 'warning' | 'info';
  title: string;
  description: string;
  icon: LucideIcon;
  action?: {
    label: string;
    onClick: () => void;
  };
}

interface DbStats {
  slowQueries: number;
  connections: number;
  cacheHitRate: number;
}

interface QualityWarning {
  date: string;
  reason: string;
  flaggedAt: string;
}

export function StatusBarWarnings() {
  const { data: healthStatus } = useQuery<HealthStatus>({
    queryKey: ['/api/health/status'],
    refetchInterval: false, // Disable automatic refresh
  });
  
  // Check for recent analysis quality issues
  const { data: qualityWarnings } = useQuery<QualityWarning[]>({
    queryKey: ['/api/analysis/quality-warnings'],
    refetchInterval: false, // Disable automatic refresh
  });

  // Check database performance
  const { data: dbStats } = useQuery<DbStats>({
    queryKey: ['/api/system/db-stats'],
    refetchInterval: false, // Disable automatic refresh
  });

  const warnings: Warning[] = [];

  // API Health warnings
  if (healthStatus) {
    if (healthStatus.overall === 'outage') {
      const failedApis = healthStatus.apis.filter(api => api.status !== 'operational');
      warnings.push({
        id: 'api-outage',
        type: 'critical',
        title: 'API Services Down',
        description: `${failedApis.map(api => api.name).join(', ')} not responding. Analysis may be limited.`,
        icon: Wifi,
        action: {
          label: 'Retry',
          onClick: () => window.location.reload()
        }
      });
    } else if (healthStatus.overall === 'degraded') {
      warnings.push({
        id: 'api-degraded',
        type: 'warning',
        title: 'API Performance Issues',
        description: 'Some services are experiencing delays',
        icon: Clock,
      });
    }

    // Rate limit warnings
    const lowRateApis = healthStatus.apis.filter(api => 
      api.rateLimitRemaining !== undefined && api.rateLimitRemaining < 100
    );
    if (lowRateApis.length > 0) {
      warnings.push({
        id: 'rate-limits',
        type: 'warning',
        title: 'Low API Quota',
        description: `${lowRateApis.map(api => api.name).join(', ')} running low on requests`,
        icon: TrendingDown,
      });
    }
  }

  // Database performance warnings
  if (dbStats && dbStats.slowQueries > 10) {
    warnings.push({
      id: 'db-performance',
      type: 'warning',
      title: 'Database Slow',
      description: `${dbStats.slowQueries} slow queries affecting performance`,
      icon: Database,
    });
  }

  // Data quality warnings
  if (qualityWarnings && Array.isArray(qualityWarnings) && qualityWarnings.length > 0) {
    warnings.push({
      id: 'data-quality',
      type: 'info',
      title: 'Flagged Analysis',
      description: `${qualityWarnings.length} recent analyses flagged for review`,
      icon: FileX,
    });
  }

  // Missing analysis warnings for recent days
  const recentDays = 7;
  const today = new Date();
  let missingDays = 0;
  
  for (let i = 1; i <= recentDays; i++) {
    const checkDate = new Date(today);
    checkDate.setDate(today.getDate() - i);
    // This is a simplified check - in real implementation, we'd query the database
    // For now, we'll skip this warning to avoid complexity
  }

  if (warnings.length === 0) {
    return null;
  }

  const criticalCount = warnings.filter(w => w.type === 'critical').length;
  const warningCount = warnings.filter(w => w.type === 'warning').length;
  const infoCount = warnings.filter(w => w.type === 'info').length;

  const badgeVariant = criticalCount > 0 ? 'destructive' : 
                      warningCount > 0 ? 'secondary' : 'outline';

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button 
          variant="ghost" 
          size="sm" 
          className="relative h-8 px-2 text-xs hover:bg-slate-100"
        >
          <AlertTriangle className={`h-4 w-4 mr-1 ${
            criticalCount > 0 ? 'text-red-500' : 
            warningCount > 0 ? 'text-yellow-500' : 
            'text-blue-500'
          }`} />
          <Badge variant={badgeVariant} className="h-5 px-1 text-xs min-w-5">
            {warnings.length}
          </Badge>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-3" align="end">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="font-medium text-sm">System Warnings</h4>
            <div className="flex gap-1">
              {criticalCount > 0 && (
                <Badge variant="destructive" className="h-5 px-2 text-xs">
                  {criticalCount} critical
                </Badge>
              )}
              {warningCount > 0 && (
                <Badge variant="secondary" className="h-5 px-2 text-xs">
                  {warningCount} warnings
                </Badge>
              )}
              {infoCount > 0 && (
                <Badge variant="outline" className="h-5 px-2 text-xs">
                  {infoCount} info
                </Badge>
              )}
            </div>
          </div>
          
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {warnings.map((warning) => {
              const Icon = warning.icon;
              return (
                <div 
                  key={warning.id}
                  className={`p-2 rounded-md border text-xs ${
                    warning.type === 'critical' ? 'border-red-200 bg-red-50' : 
                    warning.type === 'warning' ? 'border-yellow-200 bg-yellow-50' : 
                    'border-blue-200 bg-blue-50'
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <Icon className={`h-3 w-3 mt-0.5 flex-shrink-0 ${
                      warning.type === 'critical' ? 'text-red-500' : 
                      warning.type === 'warning' ? 'text-yellow-600' : 
                      'text-blue-500'
                    }`} />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium mb-1">{warning.title}</div>
                      <div className={`text-xs ${
                        warning.type === 'critical' ? 'text-red-700' : 
                        warning.type === 'warning' ? 'text-yellow-700' : 
                        'text-blue-700'
                      }`}>
                        {warning.description}
                      </div>
                      {warning.action && (
                        <button
                          onClick={warning.action.onClick}
                          className={`mt-2 px-2 py-1 text-xs font-medium rounded transition-colors ${
                            warning.type === 'critical' ? 'bg-red-600 text-white hover:bg-red-700' :
                            warning.type === 'warning' ? 'bg-yellow-600 text-white hover:bg-yellow-700' :
                            'bg-blue-600 text-white hover:bg-blue-700'
                          }`}
                        >
                          {warning.action.label}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          
          <div className="text-xs text-slate-500 text-center">
            Last updated: {healthStatus?.lastUpdate ? 
              new Date(healthStatus.lastUpdate).toLocaleTimeString() : 'Unknown'
            }
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}