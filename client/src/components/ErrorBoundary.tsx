import React, { Component, ErrorInfo, ReactNode } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertTriangle, RefreshCw, Bug } from "lucide-react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error): State {
    // Update state so the next render will show the fallback UI
    return { hasError: true, error, errorInfo: null };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // Log detailed error information
    console.group('🚨 React Error Boundary Caught Error');
    console.error('Error:', error);
    console.error('Error Info:', errorInfo);
    console.error('Component Stack:', errorInfo.componentStack);
    console.error('Error Stack:', error.stack);
    console.groupEnd();

    // Update state with error details
    this.setState({
      error,
      errorInfo
    });

    // Report to external error tracking service if available
    if (typeof window !== 'undefined' && (window as any).reportError) {
      (window as any).reportError(error);
    }
  }

  handleReload = () => {
    window.location.reload();
  };

  handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-50 p-4 flex items-center justify-center">
          <Card className="w-full max-w-2xl">
            <CardHeader>
              <CardTitle className="flex items-center space-x-2 text-red-600">
                <AlertTriangle className="w-5 h-5" />
                <span>Something went wrong</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-slate-600">
                The application encountered an unexpected error. Here are the details:
              </p>
              
              {this.state.error && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                  <h4 className="font-semibold text-red-800 mb-2">Error Message:</h4>
                  <p className="text-red-700 font-mono text-sm">
                    {this.state.error.message}
                  </p>
                </div>
              )}

              {this.state.errorInfo && (
                <details className="bg-slate-100 border border-slate-200 rounded-lg p-4">
                  <summary className="cursor-pointer font-semibold text-slate-700 flex items-center space-x-2">
                    <Bug className="w-4 h-4" />
                    <span>Technical Details (Click to expand)</span>
                  </summary>
                  <div className="mt-3 text-xs font-mono text-slate-600 whitespace-pre-wrap">
                    {this.state.errorInfo.componentStack}
                  </div>
                </details>
              )}

              <div className="flex space-x-3 pt-4">
                <Button onClick={this.handleReset} variant="outline">
                  Try Again
                </Button>
                <Button onClick={this.handleReload} className="flex items-center space-x-2">
                  <RefreshCw className="w-4 h-4" />
                  <span>Reload Page</span>
                </Button>
              </div>

              <div className="text-sm text-slate-500 mt-4">
                <p>If this problem persists, check the browser console for more details.</p>
              </div>
            </CardContent>
          </Card>
        </div>
      );
    }

    return this.props.children;
  }
}