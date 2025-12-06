import React, { Component, ErrorInfo, ReactNode } from 'react';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertTriangle, RefreshCw, Bug, Home } from "lucide-react";
import { Link } from "wouter";

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
        <div className="min-h-screen w-full flex items-center justify-center bg-background p-4">
          <Card className="w-full max-w-2xl border-border bg-card">
            <CardHeader className="text-center">
              <div className="flex justify-center mb-4">
                <div className="rounded-full bg-destructive/10 dark:bg-destructive/20 p-3">
                  <AlertTriangle className="h-12 w-12 text-destructive" />
                </div>
              </div>
              <CardTitle className="text-3xl font-bold text-foreground">Something went wrong</CardTitle>
              <CardDescription className="text-base mt-2 text-muted-foreground">
                The application encountered an unexpected error
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {this.state.error && (
                <Alert variant="destructive" className="border-destructive/50 bg-destructive/10">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertTitle className="text-destructive-foreground">Error Message</AlertTitle>
                  <AlertDescription className="font-mono text-sm mt-2 text-destructive-foreground/90">
                    {this.state.error.message}
                  </AlertDescription>
                </Alert>
              )}

              {this.state.errorInfo && (
                <details className="group">
                  <summary className="cursor-pointer list-none">
                    <div className="flex items-center justify-between p-4 bg-muted/50 dark:bg-muted/30 rounded-lg hover:bg-muted/70 dark:hover:bg-muted/50 transition-colors border border-border">
                      <div className="flex items-center space-x-2">
                        <Bug className="h-4 w-4 text-muted-foreground" />
                        <span className="font-medium text-sm text-foreground">Technical Details</span>
                      </div>
                      <span className="text-xs text-muted-foreground group-open:hidden">Click to expand</span>
                    </div>
                  </summary>
                  <div className="mt-2 p-4 bg-muted/30 dark:bg-muted/20 rounded-lg border border-border">
                    <div className="text-xs font-mono text-muted-foreground whitespace-pre-wrap break-words">
                      {this.state.errorInfo.componentStack}
                    </div>
                  </div>
                </details>
              )}
            </CardContent>
            <CardFooter className="flex flex-col sm:flex-row gap-3 justify-center">
              <Button onClick={this.handleReset} variant="outline" className="w-full sm:w-auto">
                Try Again
              </Button>
              <Button onClick={this.handleReload} className="w-full sm:w-auto">
                <RefreshCw className="w-4 h-4 mr-2" />
                Reload Page
              </Button>
              <Link href="/">
                <Button variant="ghost" className="w-full sm:w-auto">
                  <Home className="w-4 h-4 mr-2" />
                  Go Home
                </Button>
              </Link>
            </CardFooter>
            <div className="px-6 pb-6">
              <p className="text-xs text-center text-muted-foreground">
                If this problem persists, check the browser console for more details.
              </p>
            </div>
          </Card>
        </div>
      );
    }

    return this.props.children;
  }
}