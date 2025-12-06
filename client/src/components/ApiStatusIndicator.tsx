import { useApiHealth } from "@/hooks/useApiHealth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";

export function ApiStatusIndicator() {
  const { health, isLoading, getStatusDot, getStatusColor, formatStatus } = useApiHealth();

  if (isLoading) {
    return <Skeleton className="w-4 h-4 rounded-full" />;
  }

  if (!health) {
    return (
      <div className="flex items-center space-x-2" title={error?.message || "Health check failed"}>
        <div className="w-2 h-2 rounded-full bg-gray-500"></div>
        <span className="text-sm text-gray-600">Status Unknown</span>
      </div>
    );
  }

  const overallStatusColor = getStatusDot(health.overall);

  // Format API names to proper brand names
  const formatApiName = (name: string): string => {
    const nameMap: Record<string, string> = {
      'openai': 'OpenAI',
      'gemini': 'Gemini',
      'perplexity': 'Perplexity',
      'exa': 'Exa',
      'EXA': 'Exa',
    };
    return nameMap[name.toLowerCase()] || name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="flex items-center space-x-2 h-8 px-2">
          <div className={`w-2 h-2 rounded-full ${overallStatusColor}`}></div>
          <span className="text-sm">
            API Status
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72" align="end">
        <div className="space-y-2.5">
          <div className="flex items-center justify-between">
            <h4 className="font-semibold text-sm">API Status</h4>
            <Badge 
              variant={health.overall === 'operational' ? 'default' : 'destructive'}
              className={
                health.overall === 'operational' 
                  ? 'bg-green-500/20 text-green-400 border-green-500/30 text-xs px-1.5 py-0' 
                  : 'text-xs px-1.5 py-0'
              }
            >
              {health.overall}
            </Badge>
          </div>
          
          <div className="space-y-1.5">
            {health.apis.map((api) => (
              <div 
                key={api.name} 
                className="flex items-center justify-between py-1"
              >
                <div className="flex items-center gap-2">
                  <div className={`w-1.5 h-1.5 rounded-full ${getStatusDot(api.status)}`}></div>
                  <span className="font-medium text-xs">{formatApiName(api.name)}</span>
                </div>
                <div className="flex items-center gap-2">
                  {api.responseTime && api.status === 'operational' && (
                    <span className="text-xs text-muted-foreground">
                      {api.responseTime}ms
                    </span>
                  )}
                  {api.error && (
                    <div className="text-xs text-destructive max-w-28 truncate">
                      {api.error}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
          
          <div className="text-xs text-muted-foreground pt-1.5">
            Last checked: {new Date(health.lastUpdate).toLocaleTimeString()}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}