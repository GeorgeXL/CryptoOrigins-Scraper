import { exaService } from "./exa";
import { aiService } from "./ai";

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

class HealthMonitor {
  private cache: SystemHealth | null = null;
  private lastCheck: number = 0;
  private readonly CACHE_DURATION = 30000; // 30 seconds for faster error detection

  async getSystemHealth(): Promise<SystemHealth> {
    const now = Date.now();
    
    // Return cached result if still fresh
    if (this.cache && (now - this.lastCheck) < this.CACHE_DURATION) {
      return this.cache;
    }

    const apis: ApiStatus[] = [];
    
    // Test AI Providers in parallel to avoid timeouts
    const providers = ['openai', 'gemini', 'perplexity'];
    const aiPromises = providers.map(provider => this.testAiProvider(provider as any));
    
    // Test EXA in parallel
    const exaPromise = this.testExa();

    // Wait for all checks
    const [openaiResult, geminiResult, perplexityResult, exaResult] = await Promise.all([
      ...aiPromises,
      exaPromise
    ]);

    apis.push(openaiResult, geminiResult, perplexityResult, exaResult);
    
    // Determine overall status
    const hasOutage = apis.some(api => api.status === 'outage');
    const hasDegraded = apis.some(api => api.status === 'degraded');
    
    let overall: 'operational' | 'degraded' | 'outage' = 'operational';
    if (hasOutage) {
      overall = 'outage';
    } else if (hasDegraded) {
      overall = 'degraded';
    }

    this.cache = {
      overall,
      apis,
      lastUpdate: new Date().toISOString()
    };
    
    this.lastCheck = now;
    return this.cache;
  }

  private async testAiProvider(providerName: 'openai' | 'gemini' | 'perplexity'): Promise<ApiStatus> {
    const startTime = Date.now();
    try {
      const provider = aiService.getProvider(providerName);
      const isHealthy = await provider.healthCheck();
      const responseTime = Date.now() - startTime;

      if (isHealthy) {
        return {
          name: provider.getName(),
          status: responseTime > 10000 ? 'degraded' : 'operational',
          lastChecked: new Date().toISOString(),
          responseTime
        };
      } else {
        return {
          name: provider.getName(),
          status: 'outage',
          lastChecked: new Date().toISOString(),
          error: 'Health check failed',
          responseTime
        };
      }
    } catch (error: any) {
      return {
        name: providerName,
        status: 'outage',
        lastChecked: new Date().toISOString(),
        error: error.message || 'Unknown error',
        responseTime: Date.now() - startTime
      };
    }
  }



  private async testExa(): Promise<ApiStatus> {
    const startTime = Date.now();
    
    try {
      // Import API monitor here to avoid circular dependency
      const { apiMonitor } = await import('./api-monitor');
      
      // Check recent API errors from the monitor
      const recentRequests = apiMonitor.getRecentRequests(10);
      const recentExaErrors = recentRequests.filter(r => 
        r.service === 'exa' && 
        r.status === 'error' && 
        Date.now() - r.timestamp < 300000 // Last 5 minutes
      );
      
      // Check for credit limit errors specifically
      const hasCreditError = recentExaErrors.some(error => 
        error.errorCategory === 'rate-limit' || 
        (error.requestData && JSON.stringify(error.requestData).includes('credits limit'))
      );
      
      // Check if API key is configured
      if (!process.env.EXA_API_KEY) {
        return {
          name: 'EXA',
          status: 'outage',
          lastChecked: new Date().toISOString(),
          error: 'API key not configured',
          responseTime: Date.now() - startTime
        };
      }
      
      // If we have recent credit errors, mark as degraded
      if (hasCreditError) {
        return {
          name: 'EXA',
          status: 'outage',
          lastChecked: new Date().toISOString(),
          error: 'Credits limit exceeded - service unavailable',
          responseTime: Date.now() - startTime
        };
      }
      
      // If we have other recent errors, mark as degraded
      if (recentExaErrors.length > 0) {
        const latestError = recentExaErrors[0];
        return {
          name: 'EXA',
          status: 'degraded',
          lastChecked: new Date().toISOString(),
          error: `Recent API errors detected: ${latestError.errorCategory || 'unknown'}`,
          responseTime: Date.now() - startTime
        };
      }
      
      // No recent errors and API key configured = operational
      return {
        name: 'EXA',
        status: 'operational',
        lastChecked: new Date().toISOString(),
        responseTime: Date.now() - startTime
      };
    } catch (error: any) {
      return {
        name: 'EXA',
        status: 'outage',
        lastChecked: new Date().toISOString(),
        error: error.message || 'Unknown error',
        responseTime: Date.now() - startTime
      };
    }
  }




  // Clear cache to force fresh check
  invalidateCache(): void {
    this.cache = null;
    this.lastCheck = 0;
  }

  // Force immediate fresh check bypassing all caches
  async forceRefresh(): Promise<SystemHealth> {
    this.invalidateCache();
    return await this.getSystemHealth();
  }
}

export const healthMonitor = new HealthMonitor();