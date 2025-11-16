import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Label } from "@/components/ui/label";
import YearCard from "@/components/YearCard";
import YearListView from "@/components/YearListView";
import CSVImportDialog from "@/components/CSVImportDialog";
import { WarningBanner } from "@/components/WarningBanner";
import { useToast } from "@/hooks/use-toast";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { 
  Calendar, 
  CheckCircle, 
  Bot, 
  Download, 
  Plus,
  Sprout,
  TrendingUp,
  AlertTriangle,
  Coins,
  Snowflake,
  Building,
  Rocket,
  Star,
  Moon,
  Loader2,
  FileText,
  Upload,
  Grid3X3,
  List,
  ChevronDown,
  CalendarDays,
  Sparkles,
  StopCircle,
  Shield,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Tag
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface AnalysisStats {
  totalDays: number;
  analyzedDays: number;
  completionPercentage: number;
  manualEntries: number;
}

interface QuickLookupData {
  summary?: string;
  date: string;
}

export default function HomePage() {
  const { data: stats, isLoading: statsLoading } = useQuery<AnalysisStats>({
    queryKey: ['/api/analysis/stats'],
  });
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [viewMode, setViewMode] = useState<'cards' | 'list'>('cards');
  const [loadedYears, setLoadedYears] = useState<number[]>([2009]);
  const [loadingMoreYears, setLoadingMoreYears] = useState(false);
  const [isCleaningDatabase, setIsCleaningDatabase] = useState(false);
  const [currentCleaningYear, setCurrentCleaningYear] = useState<number | null>(null);
  const [cleanupAbortController, setCleanupAbortController] = useState<AbortController | null>(null);
  const [isFactChecking, setIsFactChecking] = useState(false);
  const [showFactCheckDialog, setShowFactCheckDialog] = useState(false);
  const [factCheckProgress, setFactCheckProgress] = useState({ checked: 0, total: 0, verified: 0, contradicted: 0, uncertain: 0 });
  const [activeFactCheckProvider, setActiveFactCheckProvider] = useState<'openai' | 'perplexity' | null>(null);
  const [isBatchTagging, setIsBatchTagging] = useState(false);
  const [batchTaggingProgress, setBatchTaggingProgress] = useState({ processed: 0, total: 0 });
  const [quickLookupDate1, setQuickLookupDate1] = useState('');
  const [quickLookupDate2, setQuickLookupDate2] = useState('');
  const [quickLookupInput1, setQuickLookupInput1] = useState('');
  const [quickLookupInput2, setQuickLookupInput2] = useState('');

  // Helper function to parse dd/mm/yyyy to yyyy-mm-dd with proper calendar validation
  const parseDateInput = (input: string): string | null => {
    // Remove any extra whitespace
    const cleaned = input.trim();
    
    // Empty input is valid (clears the date)
    if (!cleaned) return null;
    
    // Match dd/mm/yyyy format
    const match = cleaned.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!match) return null;
    
    const [, day, month, year] = match;
    const d = parseInt(day, 10);
    const m = parseInt(month, 10);
    const y = parseInt(year, 10);
    
    // Validate year range
    if (y < 2008 || y > 2030) {
      return null;
    }
    
    // Validate month range
    if (m < 1 || m > 12) {
      return null;
    }
    
    // Validate day range
    if (d < 1 || d > 31) {
      return null;
    }
    
    // Use JavaScript Date to validate the actual calendar date
    // Note: JS Date months are 0-indexed, so subtract 1
    const testDate = new Date(y, m - 1, d);
    
    // Check if the date is valid by verifying it matches what we input
    // Invalid dates like 31/02/2020 will roll over to 02/03/2020
    if (testDate.getFullYear() !== y || 
        testDate.getMonth() !== m - 1 || 
        testDate.getDate() !== d) {
      return null;
    }
    
    // Format as yyyy-mm-dd
    const formattedMonth = m.toString().padStart(2, '0');
    const formattedDay = d.toString().padStart(2, '0');
    return `${y}-${formattedMonth}-${formattedDay}`;
  };

  // Handle date input changes - clear date state when input is invalid or empty
  const handleQuickLookupInput1Change = (value: string) => {
    setQuickLookupInput1(value);
    const parsed = parseDateInput(value);
    setQuickLookupDate1(parsed || '');
  };

  const handleQuickLookupInput2Change = (value: string) => {
    setQuickLookupInput2(value);
    const parsed = parseDateInput(value);
    setQuickLookupDate2(parsed || '');
  };

  // Quick lookup queries
  const { data: quickLookup1Data, isLoading: quickLookup1Loading } = useQuery<QuickLookupData>({
    queryKey: [`/api/analysis/date/${quickLookupDate1}`],
    enabled: !!quickLookupDate1,
    select: (data: any) => ({
      summary: data?.analysis?.summary,
      date: data?.analysis?.date || quickLookupDate1
    })
  });

  const { data: quickLookup2Data, isLoading: quickLookup2Loading } = useQuery<QuickLookupData>({
    queryKey: [`/api/analysis/date/${quickLookupDate2}`],
    enabled: !!quickLookupDate2,
    select: (data: any) => ({
      summary: data?.analysis?.summary,
      date: data?.analysis?.date || quickLookupDate2
    })
  });

  const handleImportComplete = () => {
    // Invalidate stats query to refresh manual entries count
    queryClient.invalidateQueries({ queryKey: ['/api/analysis/stats'] });
    setShowImportDialog(false);
  };

  const currentYear = new Date().getFullYear();
  // Exclude 2025 from the years list
  const maxYear = Math.min(currentYear, 2024);
  const years = Array.from({ length: maxYear - 2009 + 1 }, (_, i) => 2009 + i);

  const historicalPeriods = [
    { icon: Sprout, text: "Early Bitcoin Era (2009-2010)", color: "text-green-500" },
    { icon: TrendingUp, text: "First Bubble (2011-2013)", color: "text-blue-500" },
    { icon: AlertTriangle, text: "Mt. Gox Crisis (2014-2015)", color: "text-red-500" },
    { icon: Coins, text: "ICO Boom (2017-2018)", color: "text-yellow-500" },
    { icon: Snowflake, text: "Crypto Winter (2018-2020)", color: "text-cyan-500" },
    { icon: Building, text: "Institutional (2020-2022)", color: "text-indigo-500" },
    { icon: Rocket, text: "DeFi/NFT Era (2021-2023)", color: "text-purple-500" },
    { icon: Star, text: "ETF Era (2024+)", color: "text-amber-500" },
  ];

  // Export Functions
  const exportToCSV = async () => {
    setIsExporting(true);
    try {
      // Fetch all analyses from 2008 to current date
      const response = await fetch(`/api/analysis/filter?startDate=2008-01-01&endDate=${new Date().toISOString().split('T')[0]}`);
      
      if (!response.ok) {
        throw new Error('Failed to fetch analysis data');
      }
      
      const analyses = await response.json();
      
      if (!analyses || analyses.length === 0) {
        toast({
          title: "No Data Found",
          description: "No analysis data available for export.",
          variant: "destructive"
        });
        return;
      }

      // Sort analyses by date (oldest first) and ensure yyyy-mm-dd format
      analyses.sort((a: any, b: any) => {
        const dateA = new Date(a.date);
        const dateB = new Date(b.date);
        return dateA.getTime() - dateB.getTime();
      });

      // Create a set of dates that have manual entries (identified by isManualOverride flag)
      const keyDatesSet = new Set(analyses.filter((analysis: any) => analysis.isManualOverride).map((analysis: any) => analysis.date));

      // Prepare CSV data - duplicate each entry twice as requested
      const csvData = [];
      csvData.push(['Date', 'Summary', 'Type']); // Header row with third column
      
      analyses.forEach((analysis: any) => {
        // Date is already in yyyy-mm-dd format from the database
        // Add single quote prefix to ensure it's treated as text in spreadsheet applications
        const date = `'${analysis.date}`; // Force text format: "'2024-07-02"
        const summary = analysis.summary || 'No summary available';
        const isKeyDate = keyDatesSet.has(analysis.date);
        const type = isKeyDate ? 'Key Date' : '';
        
        // Add the same row twice as requested
        csvData.push([date, summary, type]);
        csvData.push([date, summary, type]);
      });

      // Convert to CSV string
      const csvContent = csvData.map(row => 
        row.map(field => `"${field.toString().replace(/"/g, '""')}"`)
          .join(',')
      ).join('\n');

      // Create and download file
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      const url = URL.createObjectURL(blob);
      link.setAttribute('href', url);
      link.setAttribute('download', `bitcoin-news-analysis-${new Date().toISOString().split('T')[0]}.csv`);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      toast({
        title: "Export Successful",
        description: `Exported ${analyses.length * 2} rows (${analyses.length} unique days, duplicated) to CSV file with Key Date indicators.`,
      });
      
    } catch (error) {
      console.error('Export failed:', error);
      toast({
        title: "Export Failed",
        description: "Failed to export data. Please try again.",
        variant: "destructive"
      });
    } finally {
      setIsExporting(false);
    }
  }

  // TXT Export Function
  const exportToTXT = async () => {
    setIsExporting(true);
    try {
      // Fetch all analyses from 2008 to current date
      const response = await fetch(`/api/analysis/filter?startDate=2008-01-01&endDate=${new Date().toISOString().split('T')[0]}`);
      
      if (!response.ok) {
        throw new Error('Failed to fetch analysis data');
      }
      
      const analyses = await response.json();
      
      if (!analyses || analyses.length === 0) {
        toast({
          title: "No Data Found",
          description: "No analysis data available for export.",
          variant: "destructive"
        });
        return;
      }

      // Sort analyses by date (oldest first)
      analyses.sort((a: any, b: any) => {
        const dateA = new Date(a.date);
        const dateB = new Date(b.date);
        return dateA.getTime() - dateB.getTime();
      });

      // Create TXT content
      let txtContent = "Bitcoin News Analysis - Historical Timeline\n";
      txtContent += "=".repeat(50) + "\n\n";
      
      analyses.forEach((analysis: any, index: number) => {
        const date = analysis.date; // Already in yyyy-mm-dd format
        const summary = analysis.summary || 'No summary available';
        const isKeyDate = analysis.isManualOverride;
        
        txtContent += `${index + 1}. ${date}${isKeyDate ? ' [KEY DATE]' : ''}\n`;
        txtContent += `${summary}\n\n`;
      });

      // Create and download file
      const blob = new Blob([txtContent], { type: 'text/plain;charset=utf-8;' });
      const link = document.createElement('a');
      const url = URL.createObjectURL(blob);
      link.setAttribute('href', url);
      link.setAttribute('download', `bitcoin-news-analysis-${new Date().toISOString().split('T')[0]}.txt`);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      toast({
        title: "Export Successful",
        description: `Exported ${analyses.length} analyses to TXT file.`,
      });
      
    } catch (error) {
      console.error('Export failed:', error);
      toast({
        title: "Export Failed",
        description: "Failed to export data. Please try again.",
        variant: "destructive"
      });
    } finally {
      setIsExporting(false);
    }
  }

  const handleExportClick = () => {
    setShowExportDialog(true);
  }

  const handleExportFormat = (format: 'csv' | 'txt') => {
    setShowExportDialog(false);
    if (format === 'csv') {
      exportToCSV();
    } else {
      exportToTXT();
    }
  };

  // Clean Database - Sequential year cleanup
  const startDatabaseCleanup = async () => {
    const abortController = new AbortController();
    setCleanupAbortController(abortController);
    setIsCleaningDatabase(true);

    try {
      for (let year = 2009; year <= maxYear; year++) {
        if (abortController.signal.aborted) {
          toast({
            title: "Cleanup Stopped",
            description: `Database cleanup stopped at ${year}.`,
          });
          break;
        }

        setCurrentCleaningYear(year);

        const response = await fetch(`/api/conflicts/analyze-year/${year}`, {
          method: 'POST',
          signal: abortController.signal,
        });

        if (!response.ok) {
          throw new Error(`Failed to analyze year ${year}`);
        }

        const result = await response.json();
        console.log(`✅ Completed cleanup for ${year}:`, result);
      }

      if (!abortController.signal.aborted) {
        toast({
          title: "Cleanup Complete",
          description: "Successfully analyzed all years for duplicates.",
        });
      }
    } catch (error: any) {
      if (error.name !== 'AbortError') {
        console.error('Cleanup error:', error);
        toast({
          variant: "destructive",
          title: "Cleanup Error",
          description: error.message || "Failed to complete database cleanup",
        });
      }
    } finally {
      setIsCleaningDatabase(false);
      setCurrentCleaningYear(null);
      setCleanupAbortController(null);
    }
  };

  const stopDatabaseCleanup = () => {
    if (cleanupAbortController) {
      cleanupAbortController.abort();
    }
  };

  // Fact Check Database
  const startFactCheck = async () => {
    setShowFactCheckDialog(true);
    setIsFactChecking(true);
    setActiveFactCheckProvider('openai');
    setFactCheckProgress({ checked: 0, total: 0, verified: 0, contradicted: 0, uncertain: 0 });

    try {
      const response = await fetch('/api/fact-check/run', {
        method: 'POST',
      });

      if (!response.ok) {
        throw new Error('Failed to start fact-check');
      }

      const result = await response.json();
      setFactCheckProgress(prev => ({ ...prev, total: result.eligible || result.total }));

      // Show breakdown of eligible vs skipped analyses
      const message = result.skipped 
        ? `Processing ${result.eligible} analyses (${result.skipped} skipped - after Sept 2023). This may take a while.`
        : `Processing ${result.total} analyses. This may take a while.`;

      toast({
        title: "OpenAI Fact-Check Started",
        description: message,
      });

    } catch (error: any) {
      console.error('Fact-check error:', error);
      toast({
        variant: "destructive",
        title: "Fact-Check Error",
        description: error.message || "Failed to start fact-check",
      });
      setIsFactChecking(false);
      setActiveFactCheckProvider(null);
      setFactCheckProgress({ checked: 0, total: 0, verified: 0, contradicted: 0, uncertain: 0 });
      setShowFactCheckDialog(false);
    }
  };

  const stopFactCheck = async () => {
    try {
      const endpoint = activeFactCheckProvider === 'perplexity' 
        ? '/api/perplexity-fact-check/stop'
        : '/api/fact-check/stop';

      const response = await fetch(endpoint, {
        method: 'POST',
      });

      if (!response.ok) {
        throw new Error('Failed to stop fact-check');
      }

      const result = await response.json();
      const providerName = activeFactCheckProvider === 'perplexity' ? 'Perplexity' : 'OpenAI';
      setIsFactChecking(false);
      setActiveFactCheckProvider(null);
      setFactCheckProgress({ checked: 0, total: 0, verified: 0, contradicted: 0, uncertain: 0 });
      
      toast({
        title: `${providerName} Fact-Check Stopped`,
        description: `Fact-checking cancelled. ${result.processed || 0} analyses were checked before stopping.`,
      });
    } catch (error: any) {
      console.error('Error stopping fact-check:', error);
      setIsFactChecking(false);
      setActiveFactCheckProvider(null);
      setFactCheckProgress({ checked: 0, total: 0, verified: 0, contradicted: 0, uncertain: 0 });
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to stop fact-check",
      });
    }
  };

  // Perplexity Fact Check
  const startPerplexityFactCheck = async () => {
    setShowFactCheckDialog(true);
    setIsFactChecking(true);
    setActiveFactCheckProvider('perplexity');
    setFactCheckProgress({ checked: 0, total: 0, verified: 0, contradicted: 0, uncertain: 0 });

    try {
      const response = await fetch('/api/perplexity-fact-check/run', {
        method: 'POST',
      });

      if (!response.ok) {
        throw new Error('Failed to start Perplexity fact-check');
      }

      const result = await response.json();
      setFactCheckProgress(prev => ({ ...prev, total: result.contradicted || result.total || 0 }));

      toast({
        title: "Perplexity Fact-Check Started",
        description: `Processing ${result.contradicted || 0} contradicted analyses with grounded search. This may take a while.`,
      });

    } catch (error: any) {
      console.error('Perplexity fact-check error:', error);
      toast({
        variant: "destructive",
        title: "Perplexity Fact-Check Error",
        description: error.message || "Failed to start Perplexity fact-check",
      });
      setIsFactChecking(false);
      setActiveFactCheckProvider(null);
      setFactCheckProgress({ checked: 0, total: 0, verified: 0, contradicted: 0, uncertain: 0 });
      setShowFactCheckDialog(false);
    }
  };

  // Batch tagging functions
  const startBatchTagging = async () => {
    setIsBatchTagging(true);
    setBatchTaggingProgress({ processed: 0, total: 0 });

    try {
      const response = await fetch('/api/batch-tagging/start', {
        method: 'POST',
      });

      if (!response.ok) {
        throw new Error('Failed to start batch tagging');
      }

      const result = await response.json();
      setBatchTaggingProgress({ processed: 0, total: result.total });

      toast({
        title: "Batch Tagging Started",
        description: `Extracting entities from ${result.total} analyses. This may take a while.`,
      });

      // Poll for progress every 2 seconds
      const pollInterval = setInterval(async () => {
        try {
          const statusResponse = await fetch('/api/batch-tagging/status');
          if (statusResponse.ok) {
            const status = await statusResponse.json();
            setBatchTaggingProgress({ 
              processed: status.processed, 
              total: status.total 
            });
            
            // Stop polling if process is complete
            if (!status.isRunning) {
              clearInterval(pollInterval);
              setIsBatchTagging(false);
              
              toast({
                title: "Batch Tagging Complete",
                description: `Successfully tagged ${status.processed} analyses with entities.`,
              });

              // Refresh data
              queryClient.invalidateQueries({ queryKey: ['/api/analysis/stats'] });
            }
          }
        } catch (error) {
          console.error('Error polling batch tagging status:', error);
        }
      }, 2000);

      // Stop polling after 30 minutes maximum
      setTimeout(() => {
        clearInterval(pollInterval);
        if (isBatchTagging) {
          setIsBatchTagging(false);
        }
      }, 1800000);

    } catch (error: any) {
      console.error('Batch tagging error:', error);
      toast({
        variant: "destructive",
        title: "Batch Tagging Error",
        description: error.message || "Failed to start batch tagging",
      });
      setIsBatchTagging(false);
      setBatchTaggingProgress({ processed: 0, total: 0 });
    }
  };

  const stopBatchTagging = async () => {
    try {
      const response = await fetch('/api/batch-tagging/stop', {
        method: 'POST',
      });

      if (!response.ok) {
        throw new Error('Failed to stop batch tagging');
      }

      const result = await response.json();
      setIsBatchTagging(false);
      setBatchTaggingProgress({ processed: 0, total: 0 });
      
      toast({
        title: "Batch Tagging Stopped",
        description: `Batch tagging cancelled. ${result.processed || 0} analyses were tagged before stopping.`,
      });
    } catch (error: any) {
      console.error('Error stopping batch tagging:', error);
      setIsBatchTagging(false);
      setBatchTaggingProgress({ processed: 0, total: 0 });
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to stop batch tagging",
      });
    }
  };

  // Load more years for list view
  const loadMoreYears = () => {
    setLoadingMoreYears(true);
    const currentMaxYear = Math.max(...loadedYears);
    const nextYear = currentMaxYear + 1;
    if (nextYear <= currentYear) {
      setLoadedYears(prev => [...prev, nextYear]);
    }
    setLoadingMoreYears(false);
  };

  // Generate all dates for a given year
  const generateDatesForYear = (year: number) => {
    const dates = [];
    const startDate = new Date(year, 0, 1);
    const endDate = new Date(year, 11, 31);
    
    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
      dates.push(new Date(d).toISOString().split('T')[0]);
    }
    
    return dates;
  };

  if (statsLoading) {
    return (
      <div className="space-y-8">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="bg-white rounded-xl p-6 shadow-sm border border-slate-200 animate-pulse">
              <div className="h-16 bg-slate-200 rounded"></div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Advanced Features Header */}
      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 dark:text-white">Bitcoin News Analysis</h1>
          <p className="text-slate-600 dark:text-slate-400 mt-1">
            Comprehensive Bitcoin news tracking and AI-powered analysis since 2008
          </p>
        </div>
      </div>

      {/* Quick Look Up */}
      <Card>
        <div className="p-6">
          <h2 className="text-xl font-semibold text-slate-900 mb-4">Quick Look Up</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Date 1 */}
            <div className="space-y-3">
              <Label className="text-slate-500">
                Date 1
              </Label>
              <input
                type="text"
                value={quickLookupInput1}
                onChange={(e) => handleQuickLookupInput1Change(e.target.value)}
                placeholder="dd/mm/yyyy (e.g., 20/09/2009)"
                className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-700 placeholder:text-slate-400 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:bg-white"
                data-testid="input-quick-lookup-date-1"
              />
              {quickLookupDate1 && (
                <div className="mt-3 p-4 bg-slate-50 rounded-lg border border-slate-200">
                  {quickLookup1Loading ? (
                    <div className="flex items-center justify-center py-4">
                      <Loader2 className="w-5 h-5 animate-spin text-blue-600" />
                    </div>
                  ) : quickLookup1Data?.summary ? (
                    <p className="text-sm text-slate-700">{quickLookup1Data.summary}</p>
                  ) : (
                    <p className="text-sm text-slate-500 italic">No summary available for this date</p>
                  )}
                </div>
              )}
            </div>

            {/* Date 2 */}
            <div className="space-y-3">
              <Label className="text-slate-500">
                Date 2
              </Label>
              <input
                type="text"
                value={quickLookupInput2}
                onChange={(e) => handleQuickLookupInput2Change(e.target.value)}
                placeholder="dd/mm/yyyy (e.g., 20/09/2009)"
                className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-700 placeholder:text-slate-400 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:bg-white"
                data-testid="input-quick-lookup-date-2"
              />
              {quickLookupDate2 && (
                <div className="mt-3 p-4 bg-slate-50 rounded-lg border border-slate-200">
                  {quickLookup2Loading ? (
                    <div className="flex items-center justify-center py-4">
                      <Loader2 className="w-5 h-5 animate-spin text-blue-600" />
                    </div>
                  ) : quickLookup2Data?.summary ? (
                    <p className="text-sm text-slate-700">{quickLookup2Data.summary}</p>
                  ) : (
                    <p className="text-sm text-slate-500 italic">No summary available for this date</p>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </Card>

      {/* Timeline Content */}
      <Card>
        <div className="p-6">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-xl font-semibold text-slate-900">Historical Timeline</h2>
            <TooltipProvider>
              <div className="flex items-center space-x-3">
                <ToggleGroup 
                  type="single" 
                  value={viewMode} 
                  onValueChange={(value) => value && setViewMode(value as 'cards' | 'list')}
                  className="bg-slate-100 p-1 rounded-lg"
                >
                  <ToggleGroupItem 
                    value="cards" 
                    aria-label="Cards view" 
                    className={`px-3 py-2 transition-colors ${
                      viewMode === 'cards' 
                        ? 'bg-blue-600 text-white hover:bg-blue-700 data-[state=on]:bg-blue-600 data-[state=on]:text-white' 
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <Grid3X3 className={`w-4 h-4 mr-2 ${viewMode === 'cards' ? 'text-white' : ''}`} />
                    Cards
                  </ToggleGroupItem>
                  <ToggleGroupItem 
                    value="list" 
                    aria-label="List view" 
                    className={`px-3 py-2 transition-colors ${
                      viewMode === 'list' 
                        ? 'bg-blue-600 text-white hover:bg-blue-700 data-[state=on]:bg-blue-600 data-[state=on]:text-white' 
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <List className={`w-4 h-4 mr-2 ${viewMode === 'list' ? 'text-white' : ''}`} />
                    List
                  </ToggleGroupItem>
                </ToggleGroup>
                
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button 
                      variant="outline" 
                      size="sm" 
                      onClick={isCleaningDatabase ? stopDatabaseCleanup : startDatabaseCleanup}
                      disabled={isExporting || isFactChecking}
                      className={isCleaningDatabase ? "border-red-500 text-red-600 hover:bg-red-50" : ""}
                      data-testid="button-clean-database"
                    >
                      {isCleaningDatabase ? (
                        <>
                          <StopCircle className="w-4 h-4 mr-2" />
                          Stop Cleanup {currentCleaningYear && `(${currentCleaningYear})`}
                        </>
                      ) : (
                        <>
                          <Sparkles className="w-4 h-4 mr-2" />
                          Clean Database
                        </>
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Find and remove duplicate events across all years</p>
                  </TooltipContent>
                </Tooltip>

                <DropdownMenu>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <DropdownMenuTrigger asChild>
                        <Button 
                          variant="outline" 
                          size="sm" 
                          disabled={isExporting || isCleaningDatabase || isFactChecking || isBatchTagging}
                          data-testid="button-fact-check-dropdown"
                        >
                          <Shield className="w-4 h-4 mr-2" />
                          Fact Check Database
                          <ChevronDown className="w-4 h-4 ml-2" />
                        </Button>
                      </DropdownMenuTrigger>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Choose fact-checking method: OpenAI or Perplexity</p>
                    </TooltipContent>
                  </Tooltip>
                  <DropdownMenuContent align="start">
                    <DropdownMenuItem 
                      onClick={startFactCheck}
                      disabled={isFactChecking}
                      data-testid="fact-check-openai"
                    >
                      <Shield className="w-4 h-4 mr-2" />
                      <div>
                        <div className="font-medium">OpenAI Fact Check</div>
                        <div className="text-xs text-slate-500">Verify all events (through Sept 2023)</div>
                      </div>
                    </DropdownMenuItem>
                    <DropdownMenuItem 
                      onClick={startPerplexityFactCheck}
                      disabled={isFactChecking}
                      data-testid="fact-check-perplexity"
                    >
                      <Sparkles className="w-4 h-4 mr-2" />
                      <div>
                        <div className="font-medium">Perplexity Fact Check</div>
                        <div className="text-xs text-slate-500">Re-verify contradicted events with grounded search</div>
                      </div>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button 
                      variant="outline" 
                      size="sm" 
                      onClick={isBatchTagging ? stopBatchTagging : startBatchTagging}
                      disabled={isExporting || isCleaningDatabase || isFactChecking}
                      className={isBatchTagging ? "border-orange-500 text-orange-600 hover:bg-orange-50" : ""}
                      data-testid="button-batch-tag"
                    >
                      {isBatchTagging ? (
                        <>
                          <StopCircle className="w-4 h-4 mr-2" />
                          Stop Tagging ({batchTaggingProgress.processed}/{batchTaggingProgress.total})
                        </>
                      ) : (
                        <>
                          <Tag className="w-4 h-4 mr-2" />
                          Tag All Database
                        </>
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Extract entities (countries, companies, people, cryptocurrencies) from all analyses</p>
                  </TooltipContent>
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button 
                      variant="outline" 
                      size="sm" 
                      onClick={handleExportClick}
                      disabled={isExporting || isCleaningDatabase || isFactChecking || isBatchTagging}
                      data-testid="button-export"
                    >
                      {isExporting ? (
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      ) : (
                        <Download className="w-4 h-4 mr-2" />
                      )}
                      {isExporting ? 'Exporting...' : 'Export Data'}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Download all Bitcoin news data to CSV or TXT file</p>
                  </TooltipContent>
                </Tooltip>
              </div>
            </TooltipProvider>
          </div>

          {/* Timeline Content Based on View Mode */}
          {viewMode === 'cards' ? (
            /* Years Grid - Full Width Layout */
            <div className="space-y-8 mb-8">
              {years.map((year) => (
                <YearCard key={year} year={year} />
              ))}
            </div>
          ) : (
            /* List View - Days in Calendar Format */
            <div className="space-y-8 mb-8">
              {loadedYears.map((year) => (
                <YearListView key={year} year={year} />
              ))}
              
              {/* Load More Years Button */}
              {Math.max(...loadedYears) < currentYear && (
                <div className="flex justify-center py-8">
                  <Button 
                    onClick={loadMoreYears}
                    disabled={loadingMoreYears}
                    variant="outline"
                    size="lg"
                  >
                    {loadingMoreYears ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <ChevronDown className="w-4 h-4 mr-2" />
                    )}
                    Load Another Year
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* Historical Periods Legend */}
          <div className="bg-slate-50 rounded-xl p-6">
            <h3 className="text-lg font-semibold text-slate-900 mb-4">Historical Periods</h3>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {historicalPeriods.map((period, index) => {
                const Icon = period.icon;
                return (
                  <div key={index} className="flex items-center space-x-2">
                    <Icon className={`w-4 h-4 ${period.color}`} />
                    <span className="text-sm text-slate-700">{period.text}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </Card>

      {/* CSV Import Dialog */}
      <CSVImportDialog 
        open={showImportDialog}
        onClose={() => setShowImportDialog(false)}
        onImportComplete={handleImportComplete}
      />

      {/* Export Format Dialog */}
      <Dialog open={showExportDialog} onOpenChange={setShowExportDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Choose Export Format</DialogTitle>
            <DialogDescription>
              Select the format for exporting your Bitcoin news analysis data.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col space-y-3 mt-4">
            <Button 
              variant="outline" 
              onClick={() => handleExportFormat('csv')}
              className="flex items-center justify-start space-x-3 p-4 h-auto"
            >
              <FileText className="w-5 h-5" />
              <div className="text-left">
                <div className="font-medium">CSV Format</div>
                <div className="text-sm text-slate-500">Comma-separated values, good for spreadsheets</div>
              </div>
            </Button>
            <Button 
              variant="outline" 
              onClick={() => handleExportFormat('txt')}
              className="flex items-center justify-start space-x-3 p-4 h-auto"
            >
              <FileText className="w-5 h-5" />
              <div className="text-left">
                <div className="font-medium">TXT Format</div>
                <div className="text-sm text-slate-500">Plain text, easy to read and share</div>
              </div>
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Fact-Check Progress Dialog */}
      <Dialog open={showFactCheckDialog} onOpenChange={setShowFactCheckDialog}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {activeFactCheckProvider === 'perplexity' ? 'Perplexity' : 'OpenAI'} Fact-Checking
            </DialogTitle>
            <DialogDescription>
              {activeFactCheckProvider === 'perplexity' 
                ? 'Re-verifying contradicted events with grounded search'
                : 'Verifying Bitcoin historical events with AI'
              }
            </DialogDescription>
          </DialogHeader>
          
          {isFactChecking ? (
            <div className="space-y-6 py-4">
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-16 h-16 animate-spin text-blue-600" />
              </div>
              
              <div className="space-y-4">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-600">Progress</span>
                  <span className="font-medium">{factCheckProgress.total} analyses queued</span>
                </div>
                
                <div className="bg-slate-100 dark:bg-slate-800 rounded-lg p-4">
                  <p className="text-sm text-slate-600 dark:text-slate-400 text-center">
                    Processing in background. This may take several hours.
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-500 text-center mt-2">
                    You can close this dialog and check progress in the Fact Check tab later.
                  </p>
                </div>

                <Button 
                  onClick={() => {
                    setShowFactCheckDialog(false);
                    setIsFactChecking(false);
                  }}
                  className="w-full"
                  variant="outline"
                  data-testid="button-close-fact-check"
                >
                  Run in Background
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-6 py-4">
              <div className="grid grid-cols-3 gap-4">
                <div className="text-center p-4 bg-green-50 dark:bg-green-900/20 rounded-lg">
                  <CheckCircle2 className="w-8 h-8 mx-auto text-green-600 mb-2" />
                  <div className="text-2xl font-bold text-green-900 dark:text-green-100">{factCheckProgress.verified}</div>
                  <div className="text-xs text-green-700 dark:text-green-300">Verified</div>
                </div>
                <div className="text-center p-4 bg-red-50 dark:bg-red-900/20 rounded-lg">
                  <XCircle className="w-8 h-8 mx-auto text-red-600 mb-2" />
                  <div className="text-2xl font-bold text-red-900 dark:text-red-100">{factCheckProgress.contradicted}</div>
                  <div className="text-xs text-red-700 dark:text-red-300">Contradicted</div>
                </div>
                <div className="text-center p-4 bg-amber-50 dark:bg-amber-900/20 rounded-lg">
                  <AlertCircle className="w-8 h-8 mx-auto text-amber-600 mb-2" />
                  <div className="text-2xl font-bold text-amber-900 dark:text-amber-100">{factCheckProgress.uncertain}</div>
                  <div className="text-xs text-amber-700 dark:text-amber-300">Uncertain</div>
                </div>
              </div>

              <Button 
                onClick={() => setShowFactCheckDialog(false)}
                className="w-full"
                data-testid="button-close-results"
              >
                Close
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

    </div>
  );
}
