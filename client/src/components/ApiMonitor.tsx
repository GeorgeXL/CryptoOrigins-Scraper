import { useState, useEffect, useRef } from 'react';
import type React from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Trash2, Activity, Zap, Clock, AlertCircle, CheckCircle, Loader2 } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

interface ApiRequest {
  id: string;
  service: 'exa' | 'openai' | 'health' | 'perplexity' | 'perplexity-cleaner';
  endpoint: string;
  method: string;
  timestamp: number;
  status: 'pending' | 'success' | 'error' | 'cached';
  duration?: number;
  error?: string;
  requestData?: any;
  responseSize?: number;
  context?: string;
  purpose?: string;
  triggeredBy?: string;
  date?: string;
}

interface ApiStats {
  totalRequests: number;
  requestsLastHour: number;
  requestsLastMinute: number;
  errorRate: number;
  cacheHitRate: number;
  retryRate?: number;
  serviceBreakdown: {
    exa: number;
    openai: number;
    health: number;
  };
  errorBreakdown?: {
    validation: number;
    network: number;
    'rate-limit': number;
    parsing: number;
    other: number;
  };
}

const serviceColors = {
  exa: 'bg-blue-100 text-blue-800 border-blue-200',
  openai: 'bg-purple-100 text-purple-800 border-purple-200',
  health: 'bg-gray-100 text-gray-800 border-gray-200',
  perplexity: 'bg-orange-100 text-orange-800 border-orange-200',
  'perplexity-cleaner': 'bg-indigo-100 text-indigo-800 border-indigo-200'
};

const statusIcons = {
  pending: <Loader2 className="w-3 h-3 animate-spin text-yellow-500" />,
  success: <CheckCircle className="w-3 h-3 text-green-500" />,
  error: <AlertCircle className="w-3 h-3 text-red-500" />,
  cached: <Zap className="w-3 h-3 text-blue-500" />
};

const statusColors = {
  pending: 'bg-yellow-50 border-yellow-200',
  success: 'bg-green-50 border-green-200',
  error: 'bg-red-50 border-red-200',
  cached: 'bg-blue-50 border-blue-200'
};

// Helper function to format context names
const formatContext = (context: string): string => {
  return context
    .replace(/-/g, ' ')
    .replace(/\b\w/g, l => l.toUpperCase())
    .replace(/Api/g, 'API')
    .replace(/Ai/g, 'AI');
};

// Helper function to generate human-readable request summary
const getRequestSummary = (request: ApiRequest): string => {
  const data = request.requestData || {};
  
  // Perplexity Cleaner
  if (request.service === 'perplexity-cleaner') {
    if (data.date) {
      return `🧹 Resolving contradiction for ${data.date}`;
    }
    return '🧹 Resolving contradicted event';
  }
  
  // Perplexity fact-check
  if (request.service === 'perplexity') {
    if (data.date) {
      return `🔍 Fact-checking event for ${data.date}`;
    }
    if (data.query) {
      return `🔍 Perplexity search: "${data.query.substring(0, 50)}${data.query.length > 50 ? '...' : ''}"`;
    }
    return '🔍 Perplexity analysis';
  }
  
  // EXA search
  if (request.service === 'exa') {
    if (data.query) {
      const query = data.query.length > 60 ? data.query.substring(0, 60) + '...' : data.query;
      return `📰 Searching: "${query}"`;
    }
    if (data.dateRange) {
      return `📰 News search for ${data.dateRange}`;
    }
    return '📰 EXA news search';
  }
  
  // OpenAI
  if (request.service === 'openai') {
    if (data.openaiResponse?.summary) {
      return `✨ Generated summary: "${data.openaiResponse.summary.substring(0, 60)}${data.openaiResponse.summary.length > 60 ? '...' : ''}"`;
    }
    if (data.date) {
      return `🤖 Analyzing news for ${data.date}`;
    }
    if (data.purpose) {
      return `🤖 ${data.purpose}`;
    }
    return '🤖 OpenAI processing';
  }
  
  // Default
  return `${request.method} ${request.endpoint}`;
};

// Helper function to render request details based on service type
const renderRequestDetails = (request: ApiRequest): JSX.Element | null => {
  const data = request.requestData || {};
  
  // Perplexity Cleaner details
  if (request.service === 'perplexity-cleaner') {
    return (
      <div className="space-y-1">
        {data.date && (
          <div>
            <span className="font-medium">Date:</span> {data.date}
          </div>
        )}
        {data.correctedDate && (
          <div>
            <span className="font-medium">Corrected Date:</span> {data.correctedDate}
          </div>
        )}
      </div>
    );
  }
  
  // Perplexity details
  if (request.service === 'perplexity') {
    return (
      <div className="space-y-1">
        {data.date && (
          <div>
            <span className="font-medium">Date:</span> {data.date}
          </div>
        )}
        {data.query && (
          <div>
            <span className="font-medium">Query:</span> {data.query}
          </div>
        )}
        {data.verdict && (
          <div>
            <span className="font-medium">Verdict:</span> 
            <span className={`ml-2 px-2 py-0.5 rounded text-xs ${
              data.verdict === 'verified' ? 'bg-green-100 text-green-800' :
              data.verdict === 'contradicted' ? 'bg-red-100 text-red-800' :
              'bg-amber-100 text-amber-800'
            }`}>
              {data.verdict.toUpperCase()}
            </span>
          </div>
        )}
      </div>
    );
  }
  
  // EXA search details
  if (request.service === 'exa') {
    return (
      <div className="space-y-1">
        {data.tier && (
          <span className="inline-block bg-blue-100 text-blue-800 px-2 py-1 rounded text-xs font-medium mr-2">
            {data.tier.toUpperCase()} TIER
          </span>
        )}
        {data.query && (
          <div>
            <span className="font-medium">Search Query:</span> {data.query}
          </div>
        )}
        {data.dateRange && (
          <div>
            <span className="font-medium">Date Range:</span> {data.dateRange}
          </div>
        )}
        {data.numResults && (
          <div>
            <span className="font-medium">Requested:</span> {data.numResults} results
          </div>
        )}
      </div>
    );
  }
  
  // OpenAI details
  if (request.service === 'openai') {
    return (
      <div className="space-y-1">
        {data.date && (
          <div>
            <span className="font-medium">Date:</span> {data.date}
          </div>
        )}
        {data.tier && (
          <div>
            <span className="font-medium">Tier:</span> {data.tier}
          </div>
        )}
        {data.articlesCount && (
          <div>
            <span className="font-medium">Articles Analyzed:</span> {data.articlesCount}
          </div>
        )}
      </div>
    );
  }
  
  // Generic fallback
  return (
    <div className="space-y-1">
      {data.query && (
        <div>
          <span className="font-medium">Query:</span> {data.query}
        </div>
      )}
      {data.dateRange && (
        <div>
          <span className="font-medium">Date:</span> {data.dateRange}
        </div>
      )}
    </div>
  );
};

// Helper function to render success results
const renderSuccessResult = (request: ApiRequest): JSX.Element | null => {
  const data = request.requestData || {};
  
  // Perplexity Cleaner success
  if (request.service === 'perplexity-cleaner') {
    return (
      <>
        <div className="font-medium text-green-800 text-sm mb-1">✅ Resolution Complete</div>
        {data.message && (
          <div className="text-xs text-green-700">{data.message}</div>
        )}
        {data.updatedDate && (
          <div className="text-xs text-green-600 mt-1">
            Updated date: {data.updatedDate}
          </div>
        )}
        {data.newTier && (
          <div className="text-xs text-green-600">
            New tier: {data.newTier}
          </div>
        )}
      </>
    );
  }
  
  // Perplexity success
  if (request.service === 'perplexity') {
    return (
      <>
        {data.verdict && (
          <div className="font-medium text-green-800 text-sm mb-1">
            Verdict: <span className={`${
              data.verdict === 'verified' ? 'text-green-700' :
              data.verdict === 'contradicted' ? 'text-red-700' :
              'text-amber-700'
            }`}>
              {data.verdict.toUpperCase()}
            </span>
          </div>
        )}
        {data.confidence && (
          <div className="text-xs text-green-600">
            Confidence: {data.confidence}%
          </div>
        )}
        {data.correctDate && (
          <div className="text-xs text-green-600 mt-1">
            Suggested correct date: {data.correctDate}
          </div>
        )}
      </>
    );
  }
  
  // EXA success
  if (request.service === 'exa') {
    return (
      <>
        <div className="font-medium text-green-800 text-sm mb-1">
          📰 Found {request.responseSize || 0} articles
        </div>
        {data.result?.articlesFound && (
          <div className="text-xs text-green-600">
            Articles found: {data.result.articlesFound}
          </div>
        )}
        {data.result?.hasContent && (
          <div className="text-xs text-green-600">
            {data.result.hasContent ? '✅ Has article content' : '⚠️ No article content'}
          </div>
        )}
      </>
    );
  }
  
  // OpenAI success
  if (request.service === 'openai') {
    if (data.openaiResponse?.summary) {
      return (
        <>
          <div className="font-medium text-green-800 text-sm mb-1">
            ✨ Generated Summary
          </div>
          <div className="text-xs text-green-700 mb-2">
            "{data.openaiResponse.summary}"
          </div>
          <div className="flex justify-between text-xs text-green-600">
            <span>Length: {data.openaiResponse.length || data.openaiResponse.summary.length} chars</span>
            {data.attempt && <span>Attempt: {data.attempt}</span>}
            {data.openaiResponse.confidence && (
              <span>Confidence: {data.openaiResponse.confidence}%</span>
            )}
          </div>
        </>
      );
    }
    if (data.result?.isSignificant !== undefined) {
      return (
        <>
          <div className="font-medium text-green-800 text-sm mb-1">
            {data.result.isSignificant ? '✅ SIGNIFICANT EVENT' : '❌ NOT SIGNIFICANT'}
          </div>
          {data.result.reasoning && (
            <div className="text-xs text-green-600 mt-1">
              {data.result.reasoning}
            </div>
          )}
        </>
      );
    }
  }
  
  // Generic success
  if (request.responseSize !== undefined) {
    return (
      <div className="text-xs text-green-700">
        Returned {request.responseSize} result{request.responseSize !== 1 ? 's' : ''}
      </div>
    );
  }
  
  return null;
};

export default function ApiMonitor() {
  const [isOpen, setIsOpen] = useState(false);
  const [requests, setRequests] = useState<ApiRequest[]>([]);
  const [stats, setStats] = useState<ApiStats>({
    totalRequests: 0,
    requestsLastHour: 0,
    requestsLastMinute: 0,
    errorRate: 0,
    cacheHitRate: 0,
    serviceBreakdown: { exa: 0, openai: 0, health: 0 }
  });
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'disconnected'>('disconnected');
  
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const fetchStatsTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const connectWebSocket = () => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;
    
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/api/monitor/ws`;
    
    setConnectionStatus('connecting');
    wsRef.current = new WebSocket(wsUrl);
    
    wsRef.current.onopen = () => {
      console.log('📡 Connected to API monitor');
      setConnectionStatus('connected');
    };
    
    wsRef.current.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        
        if (data.type === 'init') {
          setStats(data.stats);
          setRequests(data.recentRequests || []);
        } else if (data.type === 'request') {
          setRequests(prev => {
            // Check if request already exists to prevent duplicates
            const existsIndex = prev.findIndex(r => r.id === data.data.id);
            if (existsIndex >= 0) {
              // Update existing instead of adding duplicate
              const updated = [...prev];
              updated[existsIndex] = { ...updated[existsIndex], ...data.data };
              return updated;
            }
            // Add new request
            return [data.data, ...prev.slice(0, 49)]; // Keep last 50
          });
          // Throttle stats fetching to prevent excessive requests
          if (fetchStatsTimeoutRef.current) {
            clearTimeout(fetchStatsTimeoutRef.current);
          }
          fetchStatsTimeoutRef.current = setTimeout(fetchStats, 1000); // Debounce for 1 second
        } else if (data.type === 'request-updated') {
          // Handle request updates (like OpenAI response updates)
          setRequests(prev => {
            const existingIndex = prev.findIndex(r => r.id === data.data.id);
            if (existingIndex >= 0) {
              const updated = [...prev];
              const existingRequest = updated[existingIndex];
              
              // Deep merge requestData to preserve OpenAI response information
              const mergedRequestData = existingRequest.requestData || data.data.requestData 
                ? {
                    ...existingRequest.requestData,
                    ...data.data.requestData,
                    // Preserve OpenAI response if it exists in either version
                    openaiResponse: data.data.requestData?.openaiResponse || existingRequest.requestData?.openaiResponse
                  }
                : undefined;

              updated[existingIndex] = { 
                ...existingRequest, 
                ...data.data,
                requestData: mergedRequestData
              };
              return updated;
            }
            return prev; // If not found, don't add it
          });
        }
      } catch (error) {
        console.error('Failed to parse WebSocket message:', error);
      }
    };
    
    wsRef.current.onclose = () => {
      console.log('📡 Disconnected from API monitor');
      setConnectionStatus('disconnected');
      
      // Auto-reconnect after 3 seconds
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = setTimeout(connectWebSocket, 3000);
    };
    
    wsRef.current.onerror = (error) => {
      console.error('📡 WebSocket error:', error);
      setConnectionStatus('disconnected');
    };
  };

  const fetchStats = async () => {
    try {
      const response = await fetch('/api/monitor/stats');
      if (response.ok) {
        const data = await response.json();
        setStats(data);
      }
    } catch (error) {
      console.error('Failed to fetch API stats:', error);
    }
  };

  const clearHistory = async () => {
    try {
      const response = await fetch('/api/monitor/clear', { method: 'DELETE' });
      if (response.ok) {
        setRequests([]);
        fetchStats();
      }
    } catch (error) {
      console.error('Failed to clear history:', error);
    }
  };

  useEffect(() => {
    if (isOpen) {
      connectWebSocket();
    }
    
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (fetchStatsTimeoutRef.current) {
        clearTimeout(fetchStatsTimeoutRef.current);
      }
    };
  }, [isOpen]);

  const getConnectionColor = () => {
    switch (connectionStatus) {
      case 'connected': return 'text-green-500';
      case 'connecting': return 'text-yellow-500';
      default: return 'text-red-500';
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="relative">
          <Activity className={`w-4 h-4 ${getConnectionColor()}`} />
          {stats.requestsLastMinute > 0 && (
            <div className="absolute -top-1 -right-1 w-2 h-2 bg-orange-500 rounded-full animate-pulse" />
          )}
        </Button>
      </DialogTrigger>
      
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Activity className={`w-5 h-5 ${getConnectionColor()}`} />
            API Request Monitor
            <Badge variant="outline" className="ml-2">
              {connectionStatus}
            </Badge>
          </DialogTitle>
          <DialogDescription>
            Real-time monitoring of API requests including EXA, OpenAI, and health checks with detailed response information.
          </DialogDescription>
        </DialogHeader>
        
        {/* Stats Overview */}
        <div className="grid grid-cols-4 gap-3 mb-4">
          <div className="bg-gray-50 p-3 rounded-lg">
            <div className="text-sm text-gray-600">Requests</div>
            <div className="text-lg font-semibold">{stats.totalRequests}</div>
            <div className="text-xs text-gray-500">
              {stats.requestsLastMinute}/min • {stats.requestsLastHour}/hr
            </div>
          </div>
          
          <div className="bg-gray-50 p-3 rounded-lg">
            <div className="text-sm text-gray-600">Error Rate</div>
            <div className={`text-lg font-semibold ${stats.errorRate > 0.15 ? 'text-red-600' : stats.errorRate > 0.05 ? 'text-yellow-600' : 'text-green-600'}`}>
              {(stats.errorRate * 100).toFixed(1)}%
            </div>
            <div className="text-xs text-gray-500">
              Cache: {(stats.cacheHitRate * 100).toFixed(1)}%
            </div>
          </div>
          
          <div className="bg-gray-50 p-3 rounded-lg">
            <div className="text-sm text-gray-600">Services</div>
            <div className="text-xs space-y-1">
              <div>EXA: {stats.serviceBreakdown.exa || 0}</div>
              <div>OpenAI: {stats.serviceBreakdown.openai || 0}</div>
              {(stats.serviceBreakdown as any).perplexity && (
                <div>Perplexity: {(stats.serviceBreakdown as any).perplexity}</div>
              )}
              {(stats.serviceBreakdown as any)['perplexity-cleaner'] && (
                <div>Cleaner: {(stats.serviceBreakdown as any)['perplexity-cleaner']}</div>
              )}
            </div>
          </div>
          
          <div className="bg-gray-50 p-3 rounded-lg">
            <div className="text-sm text-gray-600">Quality</div>
            <div className="text-lg font-semibold">
              {stats.retryRate ? (stats.retryRate * 100).toFixed(1) : '0.0'}%
            </div>
            <div className="text-xs text-gray-500">Retry Rate</div>
          </div>
        </div>
        
        {/* Error Breakdown - Only show if there are errors */}
        {stats.errorBreakdown && Object.values(stats.errorBreakdown).some(count => count > 0) && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4">
            <div className="text-sm font-medium text-red-800 mb-2">Error Breakdown</div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              {stats.errorBreakdown.validation > 0 && (
                <div className="text-red-700">Validation: {stats.errorBreakdown.validation}</div>
              )}
              {stats.errorBreakdown.network > 0 && (
                <div className="text-red-700">Network: {stats.errorBreakdown.network}</div>
              )}
              {stats.errorBreakdown['rate-limit'] > 0 && (
                <div className="text-red-700">Rate Limit: {stats.errorBreakdown['rate-limit']}</div>
              )}
              {stats.errorBreakdown.parsing > 0 && (
                <div className="text-red-700">Parsing: {stats.errorBreakdown.parsing}</div>
              )}
              {stats.errorBreakdown.other > 0 && (
                <div className="text-red-700">Other: {stats.errorBreakdown.other}</div>
              )}
            </div>
          </div>
        )}
        
        {/* Controls */}
        <div className="flex justify-between items-center mb-3">
          <h3 className="text-sm font-medium text-gray-700">Live Request Feed</h3>
          <Button 
            onClick={clearHistory} 
            variant="outline" 
            size="sm"
            className="flex items-center gap-1"
          >
            <Trash2 className="w-3 h-3" />
            Clear
          </Button>
        </div>
        
        {/* Request Feed */}
        <ScrollArea className="h-96">
          <div className="space-y-2">
            {requests.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                No API requests yet. Start using the app to see requests here.
              </div>
            ) : (
              requests.map((request, index) => (
                <div 
                  key={`${request.id}-${index}-${request.timestamp}`}
                  className={`border rounded-lg p-3 ${statusColors[request.status]}`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      {statusIcons[request.status]}
                      <Badge className={serviceColors[request.service]}>
                        {request.service.toUpperCase()}
                      </Badge>
                      <span className="text-sm font-mono text-gray-700 truncate">
                        {request.method} {request.endpoint}
                      </span>
                    </div>
                    
                    <div className="flex items-center gap-2 text-xs text-gray-500 shrink-0 ml-2">
                      {request.duration && (
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {request.duration}ms
                        </span>
                      )}
                      <span>
                        {formatDistanceToNow(new Date(request.timestamp), { addSuffix: true })}
                      </span>
                    </div>
                  </div>
                  
                  {request.error && (
                    <div className="mt-2 text-xs text-red-600 bg-red-50 p-2 rounded border">
                      {request.error}
                    </div>
                  )}
                  
                  {/* Human-readable request summary */}
                  <div className="mt-2 text-sm font-medium text-gray-800">
                    {getRequestSummary(request)}
                  </div>
                  
                  {/* Enhanced context display */}
                  {(request.context || request.purpose || request.triggeredBy) && (
                    <div className="mt-2 text-xs text-gray-700 bg-gray-50 p-2 rounded border">
                      {request.context && (
                        <div className="font-medium text-blue-700 mb-1">
                          {formatContext(request.context)}
                        </div>
                      )}
                      {request.purpose && (
                        <div className="text-gray-600 mb-1">
                          {request.purpose}
                        </div>
                      )}
                      {request.triggeredBy && (
                        <div className="text-gray-500 text-xs">
                          Triggered by: {request.triggeredBy}
                        </div>
                      )}
                    </div>
                  )}
                  
                  {/* Request data display - formatted by service type */}
                  {request.requestData && (
                    <div className="mt-2 text-xs text-gray-600">
                      {renderRequestDetails(request)}
                    </div>
                  )}
                  
                  {/* Success/Error result summary */}
                  {request.status === 'success' && request.requestData && (
                    <div className="mt-2 p-2 bg-green-50 border border-green-200 rounded">
                      {renderSuccessResult(request)}
                    </div>
                  )}
                  
                  {request.status === 'error' && request.error && (
                    <div className="mt-2 p-2 bg-red-50 border border-red-200 rounded">
                      <div className="font-medium text-red-800 text-sm mb-1">Error Details</div>
                      <div className="text-xs text-red-700">{request.error}</div>
                      {request.errorCategory && (
                        <div className="mt-1 text-xs text-red-600">
                          Category: <span className="font-medium">{request.errorCategory}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
