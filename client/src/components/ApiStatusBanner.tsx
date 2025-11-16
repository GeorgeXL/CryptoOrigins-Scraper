import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { X, AlertTriangle, Clock } from "lucide-react";
import { useApiHealth } from "@/hooks/useApiHealth";

export function ApiStatusBanner() {
  const { health, showBanner, dismissBanner, getStatusColor } = useApiHealth();

  if (!showBanner || !health || health.overall === 'operational') {
    return null;
  }

  const failedApis = health.apis.filter(api => api.status !== 'operational');
  const isOutage = failedApis.some(api => api.status === 'outage');

  return (
    <div className={`w-full border-l-4 shadow-sm ${
      isOutage ? 'border-l-red-500 bg-red-50' : 'border-l-orange-500 bg-orange-50'
    }`}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            {isOutage ? (
              <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0" />
            ) : (
              <Clock className="w-5 h-5 text-orange-600 flex-shrink-0" />
            )}
            <div className="font-medium">
              <div className={`text-sm font-semibold ${isOutage ? 'text-red-800' : 'text-orange-800'}`}>
                {isOutage ? 'Service Outage Detected' : 'Service Degradation Detected'}
              </div>
              <div className="mt-1 flex flex-wrap gap-2">
                {failedApis.map((api) => (
                  <Badge 
                    key={api.name} 
                    variant="outline"
                    className={`text-xs ${
                      api.status === 'outage' 
                        ? 'border-red-300 text-red-700 bg-red-50' 
                        : 'border-orange-300 text-orange-700 bg-orange-50'
                    }`}
                  >
                    {api.name}: {api.status}
                    {api.error && (
                      <span className="ml-1 opacity-75">
                        ({api.error})
                      </span>
                    )}
                  </Badge>
                ))}
              </div>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={dismissBanner}
            className="text-slate-500 hover:text-slate-700 flex-shrink-0"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}