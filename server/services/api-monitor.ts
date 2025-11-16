import { EventEmitter } from 'events';

export interface ApiRequest {
  id: string;
  service: 'exa' | 'openai' | 'perplexity' | 'perplexity-cleaner' | 'health';
  endpoint: string;
  method: string;
  timestamp: number;
  status: 'pending' | 'success' | 'error' | 'cached' | 'retry';
  duration?: number;
  error?: string;
  requestData?: any;
  responseSize?: number;
  retryAttempt?: number;
  errorCategory?: 'validation' | 'network' | 'rate-limit' | 'parsing' | 'other';
  context?: string;
  purpose?: string;
  triggeredBy?: string;
  date?: string;
}

class ApiMonitor extends EventEmitter {
  private requests: ApiRequest[] = [];
  private maxHistorySize = 100;

  logRequest(request: Omit<ApiRequest, 'id' | 'timestamp'>): string {
    const apiRequest: ApiRequest = {
      ...request,
      id: `${request.service}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: Date.now()
    };

    this.requests.unshift(apiRequest);
    
    // Limit history size
    if (this.requests.length > this.maxHistorySize) {
      this.requests = this.requests.slice(0, this.maxHistorySize);
    }

    const contextInfo = request.context ? ` [${request.context}]` : '';
    const purposeInfo = request.purpose ? ` - ${request.purpose}` : '';
    console.log(`📡 API Monitor: ${request.service.toUpperCase()} ${request.method} ${request.endpoint} - ${request.status}${contextInfo}${purposeInfo}`);
    
    // Emit event for real-time updates
    this.emit('request', apiRequest);
    return apiRequest.id;
  }

  updateRequest(id: string, updates: Partial<ApiRequest>) {
    const request = this.requests.find(r => r.id === id);
    if (request) {
      Object.assign(request, updates);
      this.emit('request-updated', request);
    }
  }

  getRecentRequests(limit = 50): ApiRequest[] {
    return this.requests.slice(0, limit);
  }

  getRequestStats() {
    const now = Date.now();
    const lastHour = this.requests.filter(r => now - r.timestamp < 3600000);
    const lastMinute = this.requests.filter(r => now - r.timestamp < 60000);
    const errors = this.requests.filter(r => r.status === 'error');

    return {
      totalRequests: this.requests.length,
      requestsLastHour: lastHour.length,
      requestsLastMinute: lastMinute.length,
      errorRate: errors.length / Math.max(this.requests.length, 1),
      cacheHitRate: this.requests.filter(r => r.status === 'cached').length / Math.max(this.requests.length, 1),
      retryRate: this.requests.filter(r => r.retryAttempt && r.retryAttempt > 1).length / Math.max(this.requests.length, 1),
      serviceBreakdown: {
        exa: this.requests.filter(r => r.service === 'exa').length,
        openai: this.requests.filter(r => r.service === 'openai').length,
        perplexity: this.requests.filter(r => r.service === 'perplexity').length,
        'perplexity-cleaner': this.requests.filter(r => r.service === 'perplexity-cleaner').length,
        health: this.requests.filter(r => r.service === 'health').length
      },
      errorBreakdown: {
        validation: errors.filter(r => r.errorCategory === 'validation').length,
        network: errors.filter(r => r.errorCategory === 'network').length,
        'rate-limit': errors.filter(r => r.errorCategory === 'rate-limit').length,
        parsing: errors.filter(r => r.errorCategory === 'parsing').length,
        other: errors.filter(r => r.errorCategory === 'other' || !r.errorCategory).length
      }
    };
  }

  clearHistory() {
    this.requests = [];
    this.emit('cleared');
  }
}

// Singleton instance
export const apiMonitor = new ApiMonitor();
