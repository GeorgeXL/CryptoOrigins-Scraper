import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/ThemeProvider";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { GlobalAnalysisProvider } from "@/contexts/GlobalAnalysisContext";

import HomePage from "@/pages/HomePage";
import MonthView from "@/pages/MonthView";
import DayAnalysis from "@/pages/DayAnalysis";
import EventCockpit from "@/pages/EventCockpit";
import Cleaner from "@/pages/Cleaner";
import TagsBrowser from "@/pages/TagsBrowser";
import ConflictCockpit from "@/pages/ConflictCockpit";
import Settings from "@/pages/Settings";
import NotFound from "@/pages/not-found";
import AppLayout from "@/components/AppLayout";

function Router() {
  return (
    <AppLayout>
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
