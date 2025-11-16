/**
 * Debug utilities for better error tracking and development experience
 */

interface DebugConfig {
  enableComponentTracking: boolean;
  enableAPILogging: boolean;
  enableStateTracking: boolean;
  logLevel: 'error' | 'warn' | 'info' | 'debug';
}

class DebugManager {
  private config: DebugConfig = {
    enableComponentTracking: import.meta.env.DEV,
    enableAPILogging: import.meta.env.DEV,
    enableStateTracking: import.meta.env.DEV,
    logLevel: 'info'
  };

  // Component tracking for debugging React issues
  trackComponent(componentName: string, action: string, data?: any) {
    if (!this.config.enableComponentTracking) return;
    
    console.group(`⚛️ Component: ${componentName}`);
    console.log(`Action: ${action}`);
    if (data) console.log('Data:', data);
    console.trace('Component stack');
    console.groupEnd();
  }

  // API call tracking
  trackAPICall(endpoint: string, method: string, status?: number, error?: any) {
    if (!this.config.enableAPILogging) return;
    
    // Don't show 404s for analysis endpoints as errors - they're expected when no analysis exists yet
    const is404ForAnalysis = status === 404 && endpoint.includes('/api/analysis/date/');
    if (is404ForAnalysis) return; // Skip logging expected 404s
    
    const emoji = error ? '❌' : status && status >= 400 ? '⚠️' : '✅';
    console.group(`${emoji} API Call: ${method} ${endpoint}`);
    if (status) console.log(`Status: ${status}`);
    if (error) {
      console.error('Error:', error);
      console.trace('Error stack');
    }
    console.groupEnd();
  }

  // Hook state tracking
  trackHookState(hookName: string, state: any, action?: string) {
    if (!this.config.enableStateTracking) return;
    
    console.group(`🪝 Hook: ${hookName}`);
    if (action) console.log(`Action: ${action}`);
    console.log('State:', state);
    console.groupEnd();
  }

  // Error boundary reporting
  reportError(error: Error, errorInfo?: any, context?: string) {
    console.group('🚨 Error Report');
    console.error('Error:', error);
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    if (errorInfo) console.error('Error info:', errorInfo);
    if (context) console.error('Context:', context);
    console.trace('Current stack');
    console.groupEnd();

    // Send to external error tracking service if available
    if (typeof window !== 'undefined' && (window as any).Sentry) {
      (window as any).Sentry.captureException(error, {
        extra: { errorInfo, context }
      });
    }
  }

  // Debug specific runtime issues
  debugRuntimeIssue(issue: string, details: any) {
    console.group(`🔧 Runtime Debug: ${issue}`);
    console.error('Issue details:', details);
    console.log('Window object keys:', Object.keys(window).slice(0, 20));
    console.log('Document readyState:', document.readyState);
    console.log('Location:', window.location.href);
    console.trace('Debug stack');
    console.groupEnd();
  }
}

// Export singleton instance
export const debugManager = new DebugManager();

// Convenience functions for common debugging tasks
export const trackComponent = debugManager.trackComponent.bind(debugManager);
export const trackAPICall = debugManager.trackAPICall.bind(debugManager);
export const trackHookState = debugManager.trackHookState.bind(debugManager);
export const reportError = debugManager.reportError.bind(debugManager);
export const debugRuntimeIssue = debugManager.debugRuntimeIssue.bind(debugManager);