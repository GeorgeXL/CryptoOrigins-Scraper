import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Upload, Download, FileText, X } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';

interface CSVRow {
  date: string;
  summary: string;
}

export function CSVUploadDialog() {
  const [isOpen, setIsOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [parsedData, setParsedData] = useState<CSVRow[]>([]);
  const [error, setError] = useState<string>('');
  const [isUploading, setIsUploading] = useState(false);
  
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const uploadMutation = useMutation({
    mutationFn: async (data: CSVRow[]) => {
      const response = await fetch('/api/analysis/bulk-upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entries: data }),
      });
      
      if (!response.ok) {
        throw new Error(await response.text());
      }
      
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Upload successful",
        description: `${data.imported} entries imported successfully`,
      });
      queryClient.invalidateQueries({ queryKey: ['/api/analysis'] });
      setIsOpen(false);
      resetForm();
    },
    onError: (error: Error) => {
      toast({
        title: "Upload failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const resetForm = () => {
    setFile(null);
    setParsedData([]);
    setError('');
    setIsUploading(false);
  };

  const downloadTemplate = () => {
    const csvContent = "date,summary\n2009-01-03,Bitcoin Genesis Block created\n2010-05-22,Bitcoin Pizza Day - First real-world transaction";
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'bitcoin-events-template.csv';
    a.click();
    window.URL.revokeObjectURL(url);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;
    
    if (!selectedFile.name.endsWith('.csv')) {
      setError('Please upload a CSV file');
      return;
    }
    
    setFile(selectedFile);
    setError('');
    parseCSV(selectedFile);
  };

  const parseCSV = (file: File) => {
    const reader = new FileReader();
    
    reader.onload = (e) => {
      try {
        const text = e.target?.result as string;
        const lines = text.split('\n').filter(line => line.trim());
        
        if (lines.length < 2) {
          setError('CSV file must have a header row and at least one data row');
          return;
        }
        
        // Skip header row and parse data
        const data: CSVRow[] = [];
        for (let i = 1; i < lines.length; i++) {
          const [date, ...summaryParts] = lines[i].split(',');
          const summary = summaryParts.join(',').trim(); // Handle commas in summary
          
          if (!date || !summary) continue;
          
          // Validate date format
          if (!/^\d{4}-\d{2}-\d{2}$/.test(date.trim())) {
            setError(`Invalid date format on line ${i + 1}: ${date}. Use YYYY-MM-DD format.`);
            return;
          }
          
          data.push({
            date: date.trim(),
            summary: summary.replace(/^"|"$/g, ''), // Remove quotes if present
          });
        }
        
        if (data.length === 0) {
          setError('No valid data found in CSV file');
          return;
        }
        
        setParsedData(data);
        setError('');
      } catch (err) {
        setError('Failed to parse CSV file');
      }
    };
    
    reader.readAsText(file);
  };

  const handleUpload = () => {
    if (parsedData.length === 0) return;
    setIsUploading(true);
    uploadMutation.mutate(parsedData);
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" title="Upload CSV">
          <Upload className="w-4 h-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Upload Bitcoin Events CSV</DialogTitle>
          <DialogDescription>
            Upload a CSV file with important Bitcoin dates and summaries. These entries will be permanently stored and cannot be edited.
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-4">
          {/* Download Template Button */}
          <div className="flex items-center justify-between p-4 bg-slate-50 rounded-lg">
            <div className="flex items-center space-x-3">
              <FileText className="w-5 h-5 text-slate-600" />
              <div>
                <p className="text-sm font-medium">Download CSV Template</p>
                <p className="text-xs text-slate-600">Use this template to format your data correctly</p>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={downloadTemplate}>
              <Download className="w-4 h-4 mr-2" />
              Download
            </Button>
          </div>

          {/* File Upload */}
          <div className="space-y-2">
            <Label htmlFor="csv-upload">Choose CSV File</Label>
            <Input
              id="csv-upload"
              type="file"
              accept=".csv"
              onChange={handleFileChange}
              className="cursor-pointer"
            />
          </div>

          {/* Error Display */}
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {/* Preview of Parsed Data */}
          {parsedData.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-sm font-medium">Preview ({parsedData.length} entries)</h4>
              <div className="max-h-60 overflow-y-auto border rounded-lg">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="px-4 py-2 text-left">Date</th>
                      <th className="px-4 py-2 text-left">Summary</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsedData.slice(0, 10).map((row, idx) => (
                      <tr key={idx} className="border-t">
                        <td className="px-4 py-2 font-mono">{row.date}</td>
                        <td className="px-4 py-2">{row.summary}</td>
                      </tr>
                    ))}
                    {parsedData.length > 10 && (
                      <tr className="border-t">
                        <td colSpan={2} className="px-4 py-2 text-center text-slate-500">
                          ... and {parsedData.length - 10} more entries
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end space-x-2">
            <Button variant="outline" onClick={() => { setIsOpen(false); resetForm(); }}>
              Cancel
            </Button>
            <Button 
              onClick={handleUpload} 
              disabled={parsedData.length === 0 || isUploading}
            >
              {isUploading ? 'Uploading...' : `Upload ${parsedData.length} Entries`}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}