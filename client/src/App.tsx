import { Switch, Route } from "wouter";
import { lazy, Suspense } from "react";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/ThemeProvider";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { GlobalAnalysisProvider } from "@/contexts/GlobalAnalysisContext";

const HomePage = lazy(() => import("@/pages/HomePage"));
const MonthView = lazy(() => import("@/pages/MonthView"));
const DayAnalysis = lazy(() => import("@/pages/DayAnalysis"));
const EventCockpit = lazy(() => import("@/pages/EventCockpit"));
const Cleaner = lazy(() => import("@/pages/Cleaner"));
const TagsBrowser = lazy(() => import("@/pages/TagsBrowser"));
const ConflictCockpit = lazy(() => import("@/pages/ConflictCockpit"));
const Settings = lazy(() => import("@/pages/Settings"));
const NotFound = lazy(() => import("@/pages/not-found"));

import AppLayout from "@/components/AppLayout";

function LoadingFallback() {
  return (
    <div className="flex h-screen w-full items-center justify-center">
      <div className="text-xl">Loading...</div>
    </div>
  );
}

function Router() {
  return (
    <AppLayout>
      <Suspense fallback={<LoadingFallback />}>
        <Switch>
          <Route path="/" component={HomePage} />
          <Route path="/month/:year/:month" component={MonthView} />
          <Route path="/day/:date" component={DayAnalysis} />
          <Route path="/event-cockpit" component={EventCockpit} />
          <Route path="/cleaner" component={Cleaner} />
          <Route path="/tags-browser" component={TagsBrowser} />
          <Route path="/conflict/:sourceDate" component={ConflictCockpit} />
          <Route path="/violation/:date" component={ConflictCockpit} />
          <Route path="/fact-check/:date" component={ConflictCockpit} />
          <Route path="/settings" component={Settings} />
          <Route component={NotFound} />
        </Switch>
      </Suspense>
    </AppLayout>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light" storageKey="bitcoin-news-theme">
        <QueryClientProvider client={queryClient}>
          <GlobalAnalysisProvider>
            <TooltipProvider>
              <Toaster />
              <Router />
            </TooltipProvider>
          </GlobalAnalysisProvider>
        </QueryClientProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
