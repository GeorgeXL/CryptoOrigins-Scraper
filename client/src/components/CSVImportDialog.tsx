import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Progress } from '@/components/ui/progress';
import { Upload, FileText, AlertCircle, CheckCircle, Download } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface CSVImportDialogProps {
  open?: boolean;
  onClose?: () => void;
  onImportComplete?: () => void;
  buttonVariant?: "default" | "destructive" | "outline" | "secondary" | "ghost" | "link";
  buttonSize?: "default" | "sm" | "lg" | "icon";
  showLabel?: boolean;
}

interface ImportResult {
  total: number;
  imported: number;
  skipped: number;
  errors: string[];
}

export default function CSVImportDialog({ 
  open: controlledOpen, 
  onClose: controlledOnClose, 
  onImportComplete,
  buttonVariant = "ghost",
  buttonSize = "sm",
  showLabel = false
}: CSVImportDialogProps = {}) {
  const [internalOpen, setInternalOpen] = useState(false);
  
  // Use controlled state if provided, otherwise use internal state
  const open = controlledOpen !== undefined ? controlledOpen : internalOpen;
  const setOpen = controlledOnClose !== undefined ? 
    (value: boolean) => { if (!value) controlledOnClose(); } : 
    setInternalOpen;
  
  // CSV related state
  const [file, setFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  const { toast } = useToast();

  const validateCSVFile = (file: File): string | null => {
    if (!file.name.toLowerCase().endsWith('.csv')) {
      return 'Please select a CSV file (must have .csv extension)';
    }
    
    if (file.size > 5 * 1024 * 1024) { // 5MB limit
      return 'CSV file must be smaller than 5MB';
    }
    
    return null;
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;
    
    const validationError = validateCSVFile(selectedFile);
    if (validationError) {
      setError(validationError);
      setFile(null);
      return;
    }
    
    setFile(selectedFile);
    setError(null);
  };

  const parseCSV = (csvContent: string): { date: string; summary: string }[] => {
    const lines = csvContent.trim().split('\n');
    const entries: { date: string; summary: string }[] = [];
    
    // Skip header row if it looks like headers
    const startIndex = (lines[0]?.toLowerCase().includes('date') || lines[0]?.toLowerCase().includes('summary')) ? 1 : 0;
    
    for (let i = startIndex; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      
      // Simple CSV parsing - handle quoted fields
      const match = line.match(/^"?([^",]+)"?,\s*"?([^"]*)"?$/);
      if (match) {
        const [, date, summary] = match;
        if (date && summary) {
          // Validate date format
          if (/^\d{4}-\d{2}-\d{2}$/.test(date.trim())) {
            entries.push({ 
              date: date.trim(), 
              summary: summary.trim().replace(/"/g, '') 
            });
          }
        }
      }
    }
    
    return entries;
  };

  const handleImport = async () => {
    if (!file) return;
    
    setImporting(true);
    setProgress(0);
    setError(null);
    setResult(null);
    
    try {
      const csvContent = await file.text();
      const entries = parseCSV(csvContent);
      
      if (entries.length === 0) {
        throw new Error('No valid entries found in CSV. Please check the format: Date,Summary');
      }
      
      let imported = 0;
      let skipped = 0;
      const errors: string[] = [];
      
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        setProgress(((i + 1) / entries.length) * 100);
        
        try {
          const response = await fetch('/api/manual-entries', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              date: entry.date,
              title: entry.summary,
              summary: entry.summary,
              description: `Imported from CSV on ${new Date().toLocaleDateString()}`
            })
          });
          
          if (response.ok) {
            imported++;
          } else {
            const errorData = await response.text();
            if (response.status === 409) {
              skipped++; // Entry already exists
            } else {
              errors.push(`${entry.date}: ${errorData}`);
            }
          }
        } catch (error) {
          errors.push(`${entry.date}: ${(error as Error).message}`);
        }
      }
      
      setResult({
        total: entries.length,
        imported,
        skipped,
        errors
      });
      
      if (imported > 0) {
        toast({
          title: "Import Complete",
          description: `Successfully imported ${imported} key dates`,
        });
        onImportComplete?.();
      }
      
    } catch (error) {
      const errorMessage = (error as Error).message;
      if (errorMessage.includes('encoding')) {
        setError('File encoding error: Please save your CSV file with UTF-8 encoding and try again');
      } else if (errorMessage.includes('parse') || errorMessage.includes('malformed')) {
        setError('CSV parsing error: File appears to be corrupted or malformed. Please check your file format');
      } else if (errorMessage.includes('memory') || errorMessage.includes('size')) {
        setError('File too large: Cannot process this CSV file due to size limitations');
      } else if (errorMessage.includes('network') || errorMessage.includes('fetch')) {
        setError('Network error: Unable to connect to server. Please check your internet connection');
      } else {
        setError(`Import failed: ${errorMessage}\n\nPlease verify your CSV file format and try again`);
      }
    } finally {
      setImporting(false);
    }
  };

  const handleClose = () => {
    setFile(null);
    setProgress(0);
    setResult(null);
    setError(null);
    setOpen(false);
  };

  const downloadTemplate = () => {
    // Create sample CSV content
    const csvContent = `Date,Summary
2009-01-03,Bitcoin Genesis Block created by Satoshi Nakamoto
2009-01-12,First Bitcoin transaction between Satoshi and Hal Finney
2010-05-22,First commercial Bitcoin transaction - 10000 BTC for two pizzas
2010-07-17,Mt. Gox exchange launches
2011-02-09,Bitcoin reaches parity with US Dollar
2012-11-28,First Bitcoin halving reduces block reward to 25 BTC
2013-12-17,Bitcoin price peaks at over $1000 for first time
2017-12-17,Bitcoin reaches all-time high near $20000
2020-05-11,Third Bitcoin halving reduces block reward to 6.25 BTC
2021-02-08,Tesla announces $1.5B Bitcoin purchase`;
    
    // Create and download file
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', 'bitcoin-events-template.csv');
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    toast({
      title: "Template Downloaded",
      description: "Use this CSV template as a guide for your imports",
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={buttonVariant} size={buttonSize} title="Import Bitcoin Events">
          <Upload className="w-4 h-4" />
          {showLabel && <span className="ml-2">Import Bitcoin Events</span>}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto" aria-describedby="import-description">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="w-5 h-5" />
            Import Bitcoin Events & Key Dates
          </DialogTitle>
        </DialogHeader>
        <div id="import-description" className="sr-only">
          Dialog to import Bitcoin events and key dates from CSV files
        </div>
        
        <div className="space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="csv-file">Select CSV File</Label>
              <Button 
                variant="outline" 
                size="sm" 
                onClick={downloadTemplate}
                className="text-xs"
              >
                <Download className="w-3 h-3 mr-1" />
                Download Template
              </Button>
            </div>
            <Input
              id="csv-file"
              type="file"
              accept=".csv"
              onChange={handleFileChange}
              disabled={importing}
            />
            <p className="text-sm text-slate-500">
              CSV format: Date,Summary (e.g., 2009-01-03,Bitcoin Genesis Block)
            </p>
          </div>
          
          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          
          {importing && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Upload className="w-4 h-4" />
                <span className="text-sm">Importing key dates...</span>
              </div>
              <Progress value={progress} className="w-full" />
            </div>
          )}
          
          {result && (
            <Alert>
              <CheckCircle className="h-4 w-4" />
              <AlertDescription>
                <div className="space-y-1">
                  <p><strong>Import Summary:</strong></p>
                  <p>• Total records: {result.total}</p>
                  <p>• Imported: {result.imported}</p>
                  <p>• Skipped (already exists): {result.skipped}</p>
                  {result.errors.length > 0 && (
                    <p>• Errors: {result.errors.length}</p>
                  )}
                </div>
              </AlertDescription>
            </Alert>
          )}
        </div>
        
        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          <Button 
            onClick={handleImport} 
            disabled={!file || importing}
          >
            {importing ? 'Importing...' : 'Import CSV'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}