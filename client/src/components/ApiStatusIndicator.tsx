import { useApiHealth } from "@/hooks/useApiHealth";
import { useApiHealthCheck } from "@/hooks/useApiHealthCheck";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { RefreshCw } from "lucide-react";
import { useState } from "react";

export function ApiStatusIndicator() {
  const { health, isLoading, getStatusDot, getStatusColor, formatStatus } = useApiHealth();
  const { triggerHealthCheck } = useApiHealthCheck();
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await triggerHealthCheck();
    } catch (error) {
      console.warn('Failed to refresh health status:', error);
    } finally {
      setIsRefreshing(false);
    }
  };

  if (isLoading) {
    return <Skeleton className="w-4 h-4 rounded-full" />;
  }

  if (!health) {
    return (
      <div className="flex items-center space-x-2">
        <div className="w-2 h-2 rounded-full bg-gray-500"></div>
        <span className="text-sm text-gray-600">Status Unknown</span>
      </div>
    );
  }

  const overallStatusColor = getStatusDot(health.overall);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="flex items-center space-x-2 h-8 px-2">
          <div className={`w-2 h-2 rounded-full ${overallStatusColor}`}></div>
          <span className="text-sm">
            {health.overall === 'operational' ? 'All Systems' : 'Issues Detected'}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80" align="end">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="font-semibold">API Status</h4>
            <div className="flex items-center space-x-2">
              <Badge 
                variant={health.overall === 'operational' ? 'default' : 'destructive'}
                className={health.overall === 'operational' ? 'bg-green-100 text-green-800' : ''}
              >
                {health.overall}
              </Badge>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleRefresh}
                disabled={isRefreshing}
                className="h-6 w-6 p-0"
              >
                <RefreshCw className={`w-3 h-3 ${isRefreshing ? 'animate-spin' : ''}`} />
              </Button>
            </div>
          </div>
          
          <div className="space-y-2">
            {health.apis.map((api) => (
              <div key={api.name} className="flex items-center justify-between p-2 bg-slate-50 rounded">
                <div className="flex items-center space-x-2">
                  <div className={`w-2 h-2 rounded-full ${getStatusDot(api.status)}`}></div>
                  <span className="font-medium">{api.name}</span>
                </div>
                <div className="text-right">
                  <div className={`text-sm ${getStatusColor(api.status)}`}>
                    {api.status}
                  </div>
                  {api.responseTime && api.status === 'operational' && (
                    <div className="text-xs text-slate-500">
                      {api.responseTime}ms
                    </div>
                  )}
                  {api.error && (
                    <div className="text-xs text-red-600 max-w-32 truncate">
                      {api.error}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
          
          <div className="text-xs text-slate-500 pt-2 border-t">
            Last checked: {new Date(health.lastUpdate).toLocaleTimeString()}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}