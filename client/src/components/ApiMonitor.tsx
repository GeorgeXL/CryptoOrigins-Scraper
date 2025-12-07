import { useState, useEffect, useRef } from 'react';
import type React from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Trash2, Activity, Zap, Clock, AlertCircle, CheckCircle, Loader2 } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDistanceToNow } from 'date-fns';

// Helper function to format time more concisely
const formatTimeAgo = (timestamp: number): string => {
  const formatted = formatDistanceToNow(new Date(timestamp), { addSuffix: true });
  return formatted
    .replace(/minutes?/g, 'mins')
    .replace(/seconds?/g, 'secs')
    .replace(/hours?/g, 'hrs')
    .replace(/days?/g, 'days')
    .replace(/months?/g, 'mos')
    .replace(/years?/g, 'yrs');
};

interface ApiRequest {
  id: string;
  service: 'exa' | 'openai' | 'health' | 'perplexity' | 'perplexity-cleaner' | 'gemini';
  endpoint: string;
  method: string;
  timestamp: number;
  status: 'pending' | 'success' | 'error' | 'cached';
  duration?: number;
  error?: string;
  requestData?: any;
  responseData?: any; // AI model responses, summaries, selected articles, etc.
  responseSize?: number;
  context?: string;
  purpose?: string;
  triggeredBy?: string;
  date?: string;
  // Tag categorization fields
  tagName?: string;
  tagCategory?: string;
  tagSubcategoryPath?: string[];
  tagConfidence?: number;
  tagReasoning?: string;
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
  exa: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  openai: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  health: 'bg-muted text-muted-foreground border-border',
  perplexity: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  'perplexity-cleaner': 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30',
  gemini: 'bg-green-500/20 text-green-400 border-green-500/30'
};

const serviceTextColors = {
  exa: 'text-blue-400',
  openai: 'text-purple-400',
  health: 'text-muted-foreground',
  perplexity: 'text-orange-400',
  'perplexity-cleaner': 'text-indigo-400',
  gemini: 'text-green-400'
};

const statusIcons = {
  pending: <Loader2 className="w-3 h-3 animate-spin text-yellow-400" />,
  success: <CheckCircle className="w-3 h-3 text-green-400" />,
  error: <AlertCircle className="w-3 h-3 text-red-400" />,
  cached: <Zap className="w-3 h-3 text-blue-400" />
};

const statusColors = {
  pending: 'bg-yellow-500/10 border-yellow-500/30',
  success: 'bg-green-500/10 border-green-500/30',
  error: 'bg-red-500/10 border-red-500/30',
  cached: 'bg-blue-500/10 border-blue-500/30'
};

// Helper function to format context names
const formatContext = (context: string): string => {
  return context
    .replace(/-/g, ' ')
    .replace(/\b\w/g, l => l.toUpperCase())
    .replace(/Api/g, 'API')
    .replace(/Ai/g, 'AI');
};

// Helper function to format API service names
const formatApiName = (name: string): string => {
  const nameMap: Record<string, string> = {
    'openai': 'OpenAI',
    'gemini': 'Gemini',
    'perplexity': 'Perplexity',
    'perplexity-cleaner': 'Perplexity Cleaner',
    'exa': 'Exa',
    'health': 'Health',
  };
  return nameMap[name.toLowerCase()] || name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
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
    // Tag categorization
    if (request.tagName && request.context === 'tag-categorization') {
      return `🏷️ Categorizing tag: "${request.tagName}"`;
    }
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
              data.verdict === 'verified' ? 'bg-green-500/20 text-green-400' :
              data.verdict === 'contradicted' ? 'bg-red-500/20 text-red-400' :
              'bg-yellow-500/20 text-yellow-400'
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
          <span className="inline-block bg-blue-500/20 text-blue-400 px-2 py-1 rounded text-xs font-medium mr-2">
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
    // Tag categorization details
    if (request.tagName && request.context === 'tag-categorization') {
      return (
        <div className="space-y-1">
          <div>
            <span className="font-medium">Tag:</span> <span className="font-mono">{request.tagName}</span>
          </div>
          {request.tagCategory && (
            <div>
              <span className="font-medium">Current Category:</span> {request.tagCategory}
            </div>
          )}
        </div>
      );
    }
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
  const responseData = request.responseData || {};
  
  // Perplexity Cleaner success
  if (request.service === 'perplexity-cleaner') {
    return (
      <>
        <div className="font-medium text-green-400 text-sm mb-1">✅ Resolution Complete</div>
        {data.message && (
          <div className="text-xs text-green-300">{data.message}</div>
        )}
        {data.updatedDate && (
          <div className="text-xs text-green-400 mt-1">
            Updated date: {data.updatedDate}
          </div>
        )}
        {data.newTier && (
          <div className="text-xs text-green-400">
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
        {responseData.verdict && (
          <div className="font-medium text-green-400 text-sm mb-1">
            Verdict: <span className={`${
              responseData.verdict === 'verified' ? 'text-green-300' :
              responseData.verdict === 'contradicted' ? 'text-red-300' :
              'text-yellow-300'
            }`}>
              {responseData.verdict.toUpperCase()}
            </span>
          </div>
        )}
        {responseData.confidence !== undefined && (
          <div className="text-xs text-green-400">
            Confidence: {responseData.confidence}%
          </div>
        )}
        {responseData.reasoning && (
          <div className="text-xs text-green-300 mt-1 italic">
            {responseData.reasoning}
          </div>
        )}
        {responseData.correctDateText && (
          <div className="text-xs text-green-400 mt-1">
            Suggested correct date: {responseData.correctDateText}
          </div>
        )}
        {responseData.status && (
          <div className="text-xs text-blue-400 mt-1">
            Status: {responseData.status} {responseData.matchedCount !== undefined && `(${responseData.matchedCount} articles matched)`}
          </div>
        )}
        {responseData.validArticleIds && responseData.validArticleIds.length > 0 && (
          <div className="text-xs text-green-400 mt-1">
            Selected: {responseData.validArticleIds.slice(0, 3).join(', ')}{responseData.validArticleIds.length > 3 ? ` (+${responseData.validArticleIds.length - 3} more)` : ''}
          </div>
        )}
        {responseData.text && (
          <div className="text-xs text-muted-foreground mt-2 pt-2 border-t border-border">
            <div className="font-medium mb-1">Response:</div>
            <div className="font-mono text-xs bg-muted p-2 rounded max-h-32 overflow-y-auto">
              {responseData.text}
            </div>
          </div>
        )}
      </>
    );
  }
  
  // Gemini success
  if (request.service === 'gemini') {
    return (
      <>
        {responseData.approved !== undefined && (
          <div className="font-medium text-green-400 text-sm mb-1">
            {responseData.approved ? '✅ Approved' : '❌ Not Approved'}
          </div>
        )}
        {responseData.reasoning && (
          <div className="text-xs text-green-300 mt-1 italic">
            {responseData.reasoning}
          </div>
        )}
        {responseData.status && (
          <div className="text-xs text-blue-400 mt-1">
            Status: {responseData.status} {responseData.matchedCount !== undefined && `(${responseData.matchedCount} articles matched)`}
          </div>
        )}
        {responseData.validArticleIds && responseData.validArticleIds.length > 0 && (
          <div className="text-xs text-green-400 mt-1">
            Selected: {responseData.validArticleIds.slice(0, 3).join(', ')}{responseData.validArticleIds.length > 3 ? ` (+${responseData.validArticleIds.length - 3} more)` : ''}
          </div>
        )}
        {responseData.text && (
          <div className="text-xs text-muted-foreground mt-2 pt-2 border-t border-border">
            <div className="font-medium mb-1">Response:</div>
            <div className="font-mono text-xs bg-muted p-2 rounded max-h-32 overflow-y-auto">
              {responseData.text}
            </div>
          </div>
        )}
      </>
    );
  }
  
  // OpenAI tag categorization success
  if (request.service === 'openai' && request.tagName && request.context === 'tag-categorization') {
    return (
      <>
        <div className="font-medium text-green-400 text-sm mb-2">✅ Tag Categorized</div>
        <div className="space-y-1 text-xs">
          <div>
            <span className="font-medium text-green-300">Tag:</span>{' '}
            <span className="font-mono bg-green-500/20 text-green-400 px-1.5 py-0.5 rounded">{request.tagName}</span>
          </div>
          {request.tagCategory && (
            <div>
              <span className="font-medium text-green-300">Category:</span>{' '}
              <span className="bg-blue-500/20 text-blue-400 px-1.5 py-0.5 rounded text-xs font-medium">
                {request.tagCategory}
              </span>
            </div>
          )}
          {request.tagSubcategoryPath && request.tagSubcategoryPath.length > 0 && (
            <div>
              <span className="font-medium text-green-300">Subcategory Path:</span>{' '}
              <span className="text-green-400 font-mono">
                {request.tagSubcategoryPath.join(' → ')}
              </span>
            </div>
          )}
          {request.tagConfidence !== undefined && (
            <div>
              <span className="font-medium text-green-300">Confidence:</span>{' '}
              <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${
                request.tagConfidence >= 0.8 ? 'bg-green-500/20 text-green-400' :
                request.tagConfidence >= 0.6 ? 'bg-yellow-500/20 text-yellow-400' :
                'bg-orange-500/20 text-orange-400'
              }`}>
                {(request.tagConfidence * 100).toFixed(1)}%
              </span>
            </div>
          )}
          {request.tagReasoning && (
            <div className="mt-2 pt-2 border-t border-border">
              <div className="font-medium text-green-300 mb-1">Reasoning:</div>
              <div className="text-green-400 italic">{request.tagReasoning}</div>
            </div>
          )}
        </div>
      </>
    );
  }
  
  // EXA success
  if (request.service === 'exa') {
    return (
      <>
        <div className="font-medium text-green-400 text-sm mb-1">
          📰 Found {request.responseSize || 0} articles
        </div>
        {data.result?.articlesFound && (
          <div className="text-xs text-green-300">
            Articles found: {data.result.articlesFound}
          </div>
        )}
        {data.result?.hasContent && (
          <div className="text-xs text-green-300">
            {data.result.hasContent ? '✅ Has article content' : '⚠️ No article content'}
          </div>
        )}
      </>
    );
  }
  
  // OpenAI success
  if (request.service === 'openai') {
    // Show response data if available
    if (responseData.text) {
      return (
        <>
          <div className="font-medium text-green-400 text-sm mb-1">
            ✨ Response
          </div>
          <div className="text-xs text-muted-foreground mb-2">
            <div className="font-mono bg-muted p-2 rounded max-h-32 overflow-y-auto">
              {responseData.text}
            </div>
          </div>
          {responseData.tokens && (
            <div className="flex justify-between text-xs text-green-400">
              <span>Tokens: {responseData.tokens.total || responseData.tokens}</span>
              {responseData.model && <span>Model: {responseData.model}</span>}
            </div>
          )}
        </>
      );
    }
    if (responseData.content || responseData.parsed) {
      return (
        <>
          <div className="font-medium text-green-400 text-sm mb-1">
            ✨ JSON Response
          </div>
          <div className="text-xs text-muted-foreground mb-2">
            <div className="font-mono bg-muted p-2 rounded max-h-32 overflow-y-auto">
              {JSON.stringify(responseData.parsed || responseData.content, null, 2).substring(0, 500)}
              {JSON.stringify(responseData.parsed || responseData.content, null, 2).length > 500 ? '...' : ''}
            </div>
          </div>
          {responseData.tokens && (
            <div className="flex justify-between text-xs text-green-400">
              <span>Tokens: {responseData.tokens.total || responseData.tokens}</span>
            </div>
          )}
        </>
      );
    }
    if (data.openaiResponse?.summary) {
      return (
        <>
          <div className="font-medium text-green-400 text-sm mb-1">
            ✨ Generated Summary
          </div>
          <div className="text-xs text-green-300 mb-2">
            "{data.openaiResponse.summary}"
          </div>
          <div className="flex justify-between text-xs text-green-400">
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
          <div className="font-medium text-green-400 text-sm mb-1">
            {data.result.isSignificant ? '✅ SIGNIFICANT EVENT' : '❌ NOT SIGNIFICANT'}
          </div>
          {data.result.reasoning && (
            <div className="text-xs text-green-300 mt-1">
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
      <div className="text-xs text-green-400">
        Returned {request.responseSize} result{request.responseSize !== 1 ? 's' : ''}
      </div>
    );
  }
  
  return null;
};

export default function ApiMonitor() {
  const [isOpen, setIsOpen] = useState(false);
  const [requests, setRequests] = useState<ApiRequest[]>([]);
  const [hasPendingRequests, setHasPendingRequests] = useState(false); // Track pending requests for button status
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
  const pendingCheckIntervalRef = useRef<NodeJS.Timeout | null>(null);

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
        } else         if (data.type === 'request') {
          setRequests(prev => {
            // Check if request already exists to prevent duplicates
            const existsIndex = prev.findIndex(r => r.id === data.data.id);
            if (existsIndex >= 0) {
              // Update existing instead of adding duplicate
              const updated = [...prev];
              updated[existsIndex] = { ...updated[existsIndex], ...data.data };
              // Update pending status
              setHasPendingRequests(updated.some(r => r.status === 'pending'));
              return updated;
            }
            // Add new request
            const updated = [data.data, ...prev.slice(0, 49)]; // Keep last 50
            // Update pending status
            setHasPendingRequests(updated.some(r => r.status === 'pending'));
            return updated;
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
              // Update pending status
              setHasPendingRequests(updated.some(r => r.status === 'pending'));
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

  // Fallback: Fetch requests via HTTP if WebSocket fails
  const fetchRequests = async () => {
    try {
      const response = await fetch('/api/monitor/requests?limit=50');
      if (response.ok) {
        const data = await response.json();
        setRequests(data);
        // Update pending status
        setHasPendingRequests(data.some((r: ApiRequest) => r.status === 'pending'));
      }
    } catch (error) {
      console.error('Failed to fetch API requests:', error);
    }
  };
  
  // Lightweight check for pending requests (even when dialog is closed)
  const checkPendingRequests = async () => {
    try {
      const response = await fetch('/api/monitor/requests?limit=50');
      if (response.ok) {
        const data = await response.json();
        // Check if any requests are pending
        const hasPending = Array.isArray(data) && data.some((r: ApiRequest) => r.status === 'pending');
        setHasPendingRequests(hasPending);
      }
    } catch (error) {
      // Silently fail - don't spam console
    }
  };

  useEffect(() => {
    // Always check for pending requests (even when dialog is closed)
    checkPendingRequests();
    pendingCheckIntervalRef.current = setInterval(checkPendingRequests, 3000); // Check every 3 seconds
    
    if (isOpen) {
      // Try WebSocket first
      connectWebSocket();
      
      // Also set up HTTP polling as fallback
      const pollInterval = setInterval(() => {
        fetchRequests();
        fetchStats();
      }, 2000); // Poll every 2 seconds
      
      // Initial fetch
      fetchRequests();
      fetchStats();
      
      return () => {
        clearInterval(pollInterval);
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
    }
    
    return () => {
      if (pendingCheckIntervalRef.current) {
        clearInterval(pendingCheckIntervalRef.current);
      }
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

  // Determine button color: green when idle, red when active
  const getButtonColor = () => {
    if (hasPendingRequests) {
      return 'text-red-500'; // Red when active
    }
    return 'text-green-500'; // Green when idle
  };
  
  // Determine if button should pulse: only when active
  const shouldPulse = hasPendingRequests;

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="relative">
          <Activity className={`w-4 h-4 ${getButtonColor()} ${shouldPulse ? 'animate-pulse' : ''}`} />
        </Button>
      </DialogTrigger>
      
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-hidden">
        <DialogHeader className="pb-3">
          <DialogTitle className="flex items-center gap-2">
            <Activity className={`w-5 h-5 ${getConnectionColor()}`} />
            API Request Monitor
            <Badge 
              variant="outline" 
              className={`ml-2 ${
                connectionStatus === 'connected' 
                  ? 'bg-green-500/20 text-green-400 border-green-500/30' 
                  : connectionStatus === 'connecting'
                  ? 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30'
                  : 'bg-red-500/20 text-red-400 border-red-500/30'
              }`}
            >
              {connectionStatus}
            </Badge>
          </DialogTitle>
        </DialogHeader>
        
        {/* Stats Overview */}
        <div className="grid grid-cols-4 gap-3 mb-2">
          <div className="bg-gradient-to-br from-blue-500/10 to-blue-600/5 border border-blue-500/20 rounded-lg p-4 backdrop-blur-sm">
            <div className="text-xs text-muted-foreground mb-2 font-medium">Requests</div>
            <div className="text-2xl font-bold text-foreground mb-1">{stats.totalRequests}</div>
            <div className="text-xs text-muted-foreground">
              {stats.requestsLastMinute}/min • {stats.requestsLastHour}/hr
            </div>
          </div>
          
          <div className={`bg-gradient-to-br rounded-lg p-4 backdrop-blur-sm border ${
            stats.errorRate > 0.15 
              ? 'from-red-500/10 to-red-600/5 border-red-500/20' 
              : stats.errorRate > 0.05 
              ? 'from-yellow-500/10 to-yellow-600/5 border-yellow-500/20'
              : 'from-green-500/10 to-green-600/5 border-green-500/20'
          }`}>
            <div className="text-xs text-muted-foreground mb-2 font-medium">Error Rate</div>
            <div className={`text-2xl font-bold ${
              stats.errorRate > 0.15 ? 'text-red-400' : 
              stats.errorRate > 0.05 ? 'text-yellow-400' : 
              'text-green-400'
            }`}>
              {(stats.errorRate * 100).toFixed(1)}%
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              Cache: {(stats.cacheHitRate * 100).toFixed(1)}%
            </div>
          </div>
          
          <div className="bg-gradient-to-br from-purple-500/10 to-purple-600/5 border border-purple-500/20 rounded-lg p-4 backdrop-blur-sm">
            <div className="text-xs text-muted-foreground mb-2 font-medium">Services</div>
            <div className="text-xs space-y-1 text-foreground">
              <div>Exa: {(stats.serviceBreakdown as any).exa || stats.serviceBreakdown.exa || 0}</div>
              <div>OpenAI: {(stats.serviceBreakdown as any).openai || stats.serviceBreakdown.openai || 0}</div>
              <div>Gemini: {(stats.serviceBreakdown as any).gemini || 0}</div>
              <div>Perplexity: {(stats.serviceBreakdown as any).perplexity || 0}</div>
              {(stats.serviceBreakdown as any)['perplexity-cleaner'] ? (
                <div>Perplexity Cleaner: {(stats.serviceBreakdown as any)['perplexity-cleaner']}</div>
              ) : null}
            </div>
          </div>
          
          <div className="bg-gradient-to-br from-indigo-500/10 to-indigo-600/5 border border-indigo-500/20 rounded-lg p-4 backdrop-blur-sm">
            <div className="text-xs text-muted-foreground mb-2 font-medium">Quality</div>
            <div className="text-2xl font-bold text-foreground mb-1">
              {stats.retryRate ? (stats.retryRate * 100).toFixed(1) : '0.0'}%
            </div>
            <div className="text-xs text-muted-foreground">Retry Rate</div>
          </div>
        </div>
        
        {/* Error Breakdown - Only show if there are errors */}
        {stats.errorBreakdown && Object.values(stats.errorBreakdown).some(count => count > 0) && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 mb-3">
            <div className="text-sm font-medium text-red-400 mb-2">Error Breakdown</div>
            <div className="grid grid-cols-2 gap-2 text-xs text-red-300">
              {stats.errorBreakdown.validation > 0 && (
                <div>Validation: {stats.errorBreakdown.validation}</div>
              )}
              {stats.errorBreakdown.network > 0 && (
                <div>Network: {stats.errorBreakdown.network}</div>
              )}
              {stats.errorBreakdown['rate-limit'] > 0 && (
                <div>Rate Limit: {stats.errorBreakdown['rate-limit']}</div>
              )}
              {stats.errorBreakdown.parsing > 0 && (
                <div>Parsing: {stats.errorBreakdown.parsing}</div>
              )}
              {stats.errorBreakdown.other > 0 && (
                <div>Other: {stats.errorBreakdown.other}</div>
              )}
            </div>
          </div>
        )}
        
        {/* Controls */}
        <div className="flex justify-between items-center mb-1">
          <h3 className="text-sm font-semibold text-foreground">Live Request Feed</h3>
          <Button 
            onClick={clearHistory} 
            variant="ghost" 
            size="sm"
            className="flex items-center gap-1.5 h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
          >
            <Trash2 className="w-3 h-3" />
            Clear
          </Button>
        </div>
        
        {/* Request Feed */}
        <ScrollArea className="h-96">
          {requests.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No API requests yet. Start using the app to see requests here.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[40px]"></TableHead>
                  <TableHead className="w-[90px]">Service</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="w-[80px]">Duration</TableHead>
                  <TableHead className="w-[100px]">Time</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {requests.map((request, index) => (
                  <TableRow 
                    key={`${request.id}-${index}-${request.timestamp}`}
                    className={`${statusColors[request.status]} hover:bg-muted/30`}
                  >
                    <TableCell className="py-2">
                      {statusIcons[request.status]}
                    </TableCell>
                    <TableCell className="py-2">
                      <span className="text-xs font-medium text-foreground">
                        {formatApiName(request.service)}
                      </span>
                    </TableCell>
                    <TableCell className="py-2">
                      <div className="space-y-0.5">
                        <div className="text-xs text-foreground">
                          {getRequestSummary(request)}
                        </div>
                        <div className="text-xs text-muted-foreground font-mono">
                          {request.method} {request.endpoint}
                        </div>
                        {request.error && (
                          <div className="text-xs text-red-400 mt-1">
                            {request.error}
                          </div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="py-2">
                      {request.duration ? (
                        <span className="text-xs text-muted-foreground">
                          {request.duration}ms
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="py-2">
                      <span className="text-xs text-muted-foreground">
                        {formatTimeAgo(request.timestamp)}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
