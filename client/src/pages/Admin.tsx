import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import CSVImportDialog from "@/components/CSVImportDialog";
import { Upload, Loader2, Download, FileText } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabase";

interface Analysis {
  date: string;
  summary: string;
  isManualOverride?: boolean;
}

export default function Admin() {
  const { toast } = useToast();
  const [isExporting, setIsExporting] = useState(false);
  const [showExportDialog, setShowExportDialog] = useState(false);


  // Export Functions - using Supabase directly for reliability
  const exportToCSV = async () => {
    setIsExporting(true);
    try {
      if (!supabase) {
        throw new Error('Supabase client not configured');
      }
      
      // Fetch all analyses from Supabase directly
      const { data, error } = await supabase
        .from('historical_news_analyses')
        .select('date, summary, is_manual_override')
        .gte('date', '2008-01-01')
        .lte('date', new Date().toISOString().split('T')[0])
        .order('date', { ascending: true });
      
      if (error) {
        throw new Error(`Database error: ${error.message}`);
      }
      
      // Map to expected format
      const analyses: Analysis[] = (data || []).map(row => ({
        date: row.date,
        summary: row.summary || '',
        isManualOverride: row.is_manual_override || false,
      }));
      
      if (!analyses || analyses.length === 0) {
        toast({
          title: "No Data Found",
          description: "No analysis data available for export.",
          variant: "destructive"
        });
        return;
      }

      // Sort analyses by date (oldest first) and ensure yyyy-mm-dd format
      analyses.sort((a, b) => {
        const dateA = new Date(a.date);
        const dateB = new Date(b.date);
        return dateA.getTime() - dateB.getTime();
      });

      // Create a set of dates that have manual entries (identified by isManualOverride flag)
      const keyDatesSet = new Set(analyses.filter((analysis) => analysis.isManualOverride).map((analysis) => analysis.date));

      // Prepare CSV data - duplicate each entry twice as requested
      const csvData: string[][] = [];
      csvData.push(['Date', 'Summary', 'Type']); // Header row with third column
      
      analyses.forEach((analysis) => {
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
        description: error instanceof Error ? error.message : "Failed to export data. Please try again.",
        variant: "destructive"
      });
    } finally {
      setIsExporting(false);
    }
  }

  // TXT Export Function - using Supabase directly for reliability
  const exportToTXT = async () => {
    setIsExporting(true);
    try {
      if (!supabase) {
        throw new Error('Supabase client not configured');
      }
      
      // Fetch all analyses from Supabase directly
      const { data, error } = await supabase
        .from('historical_news_analyses')
        .select('date, summary, is_manual_override')
        .gte('date', '2008-01-01')
        .lte('date', new Date().toISOString().split('T')[0])
        .order('date', { ascending: true });
      
      if (error) {
        throw new Error(`Database error: ${error.message}`);
      }
      
      // Map to expected format
      const analyses: Analysis[] = (data || []).map(row => ({
        date: row.date,
        summary: row.summary || '',
        isManualOverride: row.is_manual_override || false,
      }));
      
      if (!analyses || analyses.length === 0) {
        toast({
          title: "No Data Found",
          description: "No analysis data available for export.",
          variant: "destructive"
        });
        return;
      }

      // Sort analyses by date (oldest first)
      analyses.sort((a, b) => {
        const dateA = new Date(a.date);
        const dateB = new Date(b.date);
        return dateA.getTime() - dateB.getTime();
      });

      // Create TXT content
      let txtContent = "Bitcoin News Analysis - Historical Timeline\n";
      txtContent += "=".repeat(50) + "\n\n";
      
      analyses.forEach((analysis, index: number) => {
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
        description: error instanceof Error ? error.message : "Failed to export data. Please try again.",
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-foreground">Admin</h1>
        <p className="text-muted-foreground mt-1">
          Manage data imports and system administration
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Data Import Section */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Upload className="w-5 h-5" />
              <CardTitle>Import Bitcoin Events</CardTitle>
            </div>
            <CardDescription>
              Upload CSV files to import Bitcoin news events into the database
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <CSVImportDialog buttonVariant="default" buttonSize="default" showLabel={true} />
            </div>
            <p className="text-sm text-muted-foreground">
              Upload a CSV file with Bitcoin events. The file should have two columns: Date (YYYY-MM-DD format) and Summary.
            </p>
          </CardContent>
        </Card>

        {/* Data Export Section */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Download className="w-5 h-5" />
              <CardTitle>Export Data</CardTitle>
            </div>
            <CardDescription>
              Download all Bitcoin news analysis data to CSV or TXT file
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button 
              variant="outline" 
              size="sm" 
              onClick={handleExportClick}
              disabled={isExporting}
              data-testid="button-export"
            >
              {isExporting ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Download className="w-4 h-4 mr-2" />
              )}
              {isExporting ? 'Exporting...' : 'Export Data'}
            </Button>
            <p className="text-sm text-muted-foreground">
              Export all historical Bitcoin news analyses. Choose between CSV (for spreadsheets) or TXT (for reading) format.
            </p>
          </CardContent>
        </Card>

      </div>

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
                <div className="text-sm text-muted-foreground">Comma-separated values, good for spreadsheets</div>
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
                <div className="text-sm text-muted-foreground">Plain text, easy to read and share</div>
              </div>
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

