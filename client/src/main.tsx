import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// Global error handlers for better debugging
if (typeof window !== 'undefined') {
  // Handle unhandled promise rejections
  window.addEventListener('unhandledrejection', (event) => {
    // Filter out common non-critical promise rejections
    const reason = event.reason?.toString() || '';
    if (reason.includes('NetworkError') || 
        reason.includes('fetch') ||
        reason.includes('AbortError') ||
        reason.includes('The user aborted a request')) {
      // Silently prevent default for these common network errors
      event.preventDefault();
      return;
    }
    
    // Log other rejections for debugging
    console.group('🚨 Unhandled Promise Rejection');
    console.error('Promise rejection:', event.reason);
    console.error('Promise:', event.promise);
    console.trace('Stack trace');
    console.groupEnd();
    
    // Prevent the default browser error handling
    event.preventDefault();
  });

  // Handle uncaught errors
  window.addEventListener('error', (event) => {
    console.group('🚨 Uncaught JavaScript Error');
    console.error('Error:', event.error);
    console.error('Message:', event.message);
    console.error('Filename:', event.filename);
    console.error('Line:', event.lineno);
    console.error('Column:', event.colno);
    console.trace('Stack trace');
    console.groupEnd();
  });

  // Add console styling for development
  if (import.meta.env.DEV) {
    console.log(
      '%c🚀 Bitcoin News Analyzer - Development Mode',
      'background: linear-gradient(90deg, #f7931a, #ff6b35); color: white; padding: 8px 16px; border-radius: 4px; font-weight: bold;'
    );
    console.log('Error tracking enabled. Check console for detailed error information.');
  }
}

createRoot(document.getElementById("root")!).render(<App />);
