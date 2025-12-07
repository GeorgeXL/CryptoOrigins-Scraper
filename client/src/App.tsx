import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { GlobalAnalysisProvider } from "@/contexts/GlobalAnalysisContext";

import HomePage from "@/pages/HomePage";
import MonthView from "@/pages/MonthView";
import MonthlyView from "@/pages/MonthlyView";
import DayAnalysis from "@/pages/DayAnalysis";
import TagCleanupTool from "@/pages/TagCleanupTool";
import TagManagerPage from "@/pages/TagManagerPage";
import ConflictCockpit from "@/pages/ConflictCockpit";
import IsolatedLab from "@/pages/IsolatedLab";
import Admin from "@/pages/Admin";
import EventsManager from "@/pages/EventsManager";
import NotFound from "@/pages/not-found";
import AppLayout from "@/components/AppLayout";

function Router() {
  return (
    <AppLayout>
      <Switch>
        <Route path="/" component={HomePage} />
        <Route path="/monthly" component={MonthlyView} />
        <Route path="/month/:year/:month" component={MonthView} />
        <Route path="/day/:date" component={DayAnalysis} />
        <Route path="/events-manager" component={EventsManager} />
        <Route path="/tags-browser" component={HomePage} />
        <Route path="/tags-cleanup" component={TagCleanupTool} />
        <Route path="/tags-manager" component={TagManagerPage} />
        <Route path="/conflict/:sourceDate" component={ConflictCockpit} />
        <Route path="/violation/:date" component={ConflictCockpit} />
        <Route path="/fact-check/:date" component={ConflictCockpit} />
        <Route path="/admin" component={Admin} />
        <Route path="/lab/isolated" component={IsolatedLab} />
        <Route component={NotFound} />
      </Switch>
    </AppLayout>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <GlobalAnalysisProvider>
          <TooltipProvider>
            <Toaster />
            <Router />
          </TooltipProvider>
        </GlobalAnalysisProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
