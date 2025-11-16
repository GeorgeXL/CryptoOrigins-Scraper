import { QueryClient, QueryFunction } from "@tanstack/react-query";
import { trackAPICall, reportError } from "./debug";

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    const error = new Error(`${res.status}: ${text}`);
    
    // Track failed API calls
    trackAPICall(res.url, 'unknown', res.status, error);
    throw error;
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const startTime = performance.now();
  
  try {
    const res = await fetch(url, {
      method,
      headers: data ? { "Content-Type": "application/json" } : {},
      body: data ? JSON.stringify(data) : undefined,
      credentials: "include",
    });

    // Track successful API calls
    const duration = performance.now() - startTime;
    trackAPICall(url, method, res.status);
    
    if (import.meta.env.DEV && duration > 1000) {
      console.warn(`⚠️ Slow API call: ${method} ${url} took ${duration.toFixed(2)}ms`);
    }

    await throwIfResNotOk(res);
    return res;
  } catch (error) {
    // Track failed API calls with more context
    trackAPICall(url, method, undefined, error);
    reportError(error as Error, { url, method, data }, 'API Request');
    throw error;
  }
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const res = await fetch(queryKey[0] as string, {
      credentials: "include",
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    // Handle 404s for analysis endpoints as "no data available" rather than errors
    const url = queryKey[0] as string;
    if (res.status === 404 && url.includes('/api/analysis/date/')) {
      return null; // Return null instead of throwing error for missing analysis
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: 5 * 60 * 1000, // 5 minutes - data becomes stale after 5 minutes
      gcTime: 30 * 60 * 1000, // 30 minutes - cache is garbage collected after 30 minutes
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});

// Helper function to clear cache for a specific date
export function clearCacheForDate(date: string) {
  queryClient.removeQueries({ queryKey: [`/api/analysis/date/${date}`] });
  queryClient.removeQueries({ queryKey: [`/api/news/fetch/${date}`] });
  
  // Also clear year-level cache to ensure monthly view updates
  const year = date.substring(0, 4);
  queryClient.removeQueries({ queryKey: [`/api/analysis/year/${year}`] });
}
