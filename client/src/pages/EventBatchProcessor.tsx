import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { cn, formatDate } from "@/lib/utils";
import { 
  Upload, 
  FileText, 
  CheckCircle, 
  XCircle, 
  Clock, 
  AlertCircle,
  Download,
  Play,
  Eye,
  ThumbsUp,
  ThumbsDown,
  RotateCw,
  Database
} from "lucide-react";

interface EventBatch {
  id: string;
  originalFilename: string;
  status: 'uploaded' | 'processing' | 'reviewing' | 'completed' | 'cancelled';
  totalEvents: number;
  processedEvents: number;
  approvedEvents: number;
  rejectedEvents: number;
  currentBatchNumber: number;
  totalBatches: number;
  createdAt: string;
  completedAt?: string;
}

interface BatchEvent {
  id: string;
  batchId: string;
  batchNumber: number;
  originalDate: string;
  originalSummary: string;
  originalGroup: string;
  enhancedSummary?: string;
  enhancedReasoning?: string;
  status: 'pending' | 'enhanced' | 'approved' | 'rejected';
  processedAt?: string;
  reviewedAt?: string;
}

interface CsvEvent {
  date: string;
  summary: string;
  group: string;
}

export default function EventBatchProcessor() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [csvData, setCsvData] = useState<CsvEvent[]>([]);
  const [uploadErrors, setUploadErrors] = useState<string[]>([]);
  const [currentBatch, setCurrentBatch] = useState<EventBatch | null>(null);
  const [reviewingBatchNumber, setReviewingBatchNumber] = useState<number>(1);
  const [selectedEventIds, setSelectedEventIds] = useState<Set<string>>(new Set());

  // Fetch all batches
  const { data: batches = [], isLoading: batchesLoading } = useQuery<EventBatch[]>({
    queryKey: ['/api/batch-events/batches'],
    refetchInterval: currentBatch ? 5000 : false // Auto-refresh if processing
  });

  // Fetch events for review
  const { data: reviewEvents = [], isLoading: reviewLoading } = useQuery<BatchEvent[]>({
    queryKey: ['/api/batch-events/review', currentBatch?.id, reviewingBatchNumber],
    enabled: !!currentBatch && currentBatch.status === 'reviewing',
  });

  // Upload CSV mutation
  const uploadMutation = useMutation({
    mutationFn: async ({ filename, events }: { filename: string; events: CsvEvent[] }) => {
      const response = await apiRequest('POST', '/api/batch-events/upload', { filename, events });
      return await response.json();
    },
    onSuccess: (data) => {
      setCurrentBatch(data.batch);
      queryClient.invalidateQueries({ queryKey: ['/api/batch-events/batches'] });
      toast({
        title: "Upload Successful",
        description: `Uploaded ${csvData.length} events in ${data.batch.totalBatches} batches`,
      });
    },
    onError: (error) => {
      toast({
        title: "Upload Failed",
        description: (error as Error).message,
        variant: "destructive"
      });
    }
  });

  // Process batch mutation
  const processMutation = useMutation({
    mutationFn: async ({ batchId, batchNumber }: { batchId: string; batchNumber: number }) => {
      const response = await apiRequest('POST', `/api/batch-events/process/${batchId}/${batchNumber}`);
      return await response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/batch-events/batches'] });
      queryClient.invalidateQueries({ queryKey: ['/api/batch-events/review'] });
      toast({
        title: "Batch Processed",
        description: "Events have been enhanced with AI summaries",
      });
    },
    onError: (error) => {
      toast({
        title: "Processing Failed",
        description: (error as Error).message,
        variant: "destructive"
      });
    }
  });

  // Approve events mutation
  const approveMutation = useMutation({
    mutationFn: async ({ batchId, batchNumber, eventIds }: { batchId: string; batchNumber: number; eventIds: string[] }) => {
      const response = await apiRequest('POST', `/api/batch-events/approve/${batchId}/${batchNumber}`, { eventIds });
      return await response.json();
    },
    onSuccess: () => {
      setSelectedEventIds(new Set());
      queryClient.invalidateQueries({ queryKey: ['/api/batch-events/batches'] });
      queryClient.invalidateQueries({ queryKey: ['/api/batch-events/review'] });
      toast({
        title: "Events Approved",
        description: `Approved ${selectedEventIds.size} events`,
      });
    }
  });

  // Reject events mutation
  const rejectMutation = useMutation({
    mutationFn: async ({ batchId, batchNumber, eventIds }: { batchId: string; batchNumber: number; eventIds: string[] }) => {
      const response = await apiRequest('POST', `/api/batch-events/reject/${batchId}/${batchNumber}`, { eventIds });
      return await response.json();
    },
    onSuccess: () => {
      setSelectedEventIds(new Set());
      queryClient.invalidateQueries({ queryKey: ['/api/batch-events/batches'] });
      queryClient.invalidateQueries({ queryKey: ['/api/batch-events/review'] });
      toast({
        title: "Events Rejected",
        description: `Rejected ${selectedEventIds.size} events`,
      });
    }
  });

  // Finalize batch mutation
  const finalizeMutation = useMutation({
    mutationFn: async (batchId: string) => {
      const response = await apiRequest('POST', `/api/batch-events/finalize/${batchId}`);
      return await response.json();
    },
    onSuccess: (data) => {
      setCurrentBatch(null);
      queryClient.invalidateQueries({ queryKey: ['/api/batch-events/batches'] });
      toast({
        title: "Import Complete",
        description: data.message,
      });
    }
  });

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      parseCsvFile(file);
    }
  };

  const parseCsvFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      try {
        const lines = text.trim().split('\n');
        const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
        
        const dateIndex = headers.findIndex(h => h.toLowerCase() === 'date');
        const summaryIndex = headers.findIndex(h => h.toLowerCase() === 'summary');
        const groupIndex = headers.findIndex(h => h.toLowerCase() === 'group');

        if (dateIndex === -1 || summaryIndex === -1 || groupIndex === -1) {
          setUploadErrors(['CSV must contain date, summary, and group columns']);
          return;
        }

        const events: CsvEvent[] = [];
        const errors: string[] = [];

        for (let i = 1; i < lines.length; i++) {
          const values = lines[i].split(',').map(v => v.trim().replace(/"/g, ''));
          
          if (values.length < 3) continue;

          const date = values[dateIndex];
          const summary = values[summaryIndex];
          const group = values[groupIndex];

          // Basic validation
          if (!date.match(/^\d{4}-\d{2}-\d{2}$/)) {
            errors.push(`Line ${i + 1}: Invalid date format (${date})`);
            continue;
          }

          if (!summary || summary.length < 10) {
            errors.push(`Line ${i + 1}: Summary too short`);
            continue;
          }

          if (!group) {
            errors.push(`Line ${i + 1}: Group is required`);
            continue;
          }

          events.push({ date, summary, group });
        }

        setCsvData(events);
        setUploadErrors(errors);
      } catch (error) {
        setUploadErrors(['Failed to parse CSV file']);
      }
    };
    reader.readAsText(file);
  };

  const handleUpload = () => {
    if (!selectedFile || csvData.length === 0) return;
    uploadMutation.mutate({ filename: selectedFile.name, events: csvData });
  };

  const handleProcessBatch = (batchNumber: number) => {
    if (!currentBatch) return;
    processMutation.mutate({ batchId: currentBatch.id, batchNumber });
  };

  const handleApproveSelected = () => {
    if (!currentBatch || selectedEventIds.size === 0) return;
    approveMutation.mutate({ 
      batchId: currentBatch.id, 
      batchNumber: reviewingBatchNumber, 
      eventIds: Array.from(selectedEventIds) 
    });
  };

  const handleRejectSelected = () => {
    if (!currentBatch || selectedEventIds.size === 0) return;
    rejectMutation.mutate({ 
      batchId: currentBatch.id, 
      batchNumber: reviewingBatchNumber, 
      eventIds: Array.from(selectedEventIds) 
    });
  };

  const handleEventSelection = (eventId: string, checked: boolean) => {
    const newSelected = new Set(selectedEventIds);
    if (checked) {
      newSelected.add(eventId);
    } else {
      newSelected.delete(eventId);
    }
    setSelectedEventIds(newSelected);
  };

  const getStatusBadge = (status: string) => {
    const variants = {
      uploaded: { variant: "secondary" as const, icon: Clock, label: "Uploaded" },
      processing: { variant: "default" as const, icon: RotateCw, label: "Processing" },
      reviewing: { variant: "outline" as const, icon: Eye, label: "Reviewing" },
      completed: { variant: "default" as const, icon: CheckCircle, label: "Completed" },
      cancelled: { variant: "destructive" as const, icon: XCircle, label: "Cancelled" }
    };
    
    const config = variants[status as keyof typeof variants];
    if (!config) return null;
    
    const IconComponent = config.icon;
    return (
      <Badge variant={config.variant} className="flex items-center gap-1">
        <IconComponent className="w-3 h-3" />
        {config.label}
      </Badge>
    );
  };

  return (
    <div className="space-y-6" data-testid="event-batch-processor">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900" data-testid="page-title">Event Batch Processor</h1>
          <p className="text-gray-600 mt-2">Upload and enhance Bitcoin event summaries with AI assistance</p>
        </div>
        <Button 
          variant="outline" 
          onClick={() => fileInputRef.current?.click()}
          data-testid="upload-button"
        >
          <Upload className="w-4 h-4 mr-2" />
          Upload CSV
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv"
          onChange={handleFileSelect}
          className="hidden"
          data-testid="file-input"
        />
      </div>

      <Tabs defaultValue="upload" className="space-y-6">
        <TabsList>
          <TabsTrigger value="upload" data-testid="tab-upload">Upload</TabsTrigger>
          <TabsTrigger value="batches" data-testid="tab-batches">Batches</TabsTrigger>
          <TabsTrigger value="review" data-testid="tab-review" disabled={!currentBatch}>Review</TabsTrigger>
        </TabsList>

        <TabsContent value="upload" className="space-y-6">
          <Card data-testid="upload-card">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="w-5 h-5" />
                CSV Upload
              </CardTitle>
              <CardDescription>
                Upload a CSV file with Bitcoin events to enhance with AI summaries
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {selectedFile && (
                <Alert data-testid="file-info">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    Selected: {selectedFile.name} ({csvData.length} events)
                  </AlertDescription>
                </Alert>
              )}

              {uploadErrors.length > 0 && (
                <Alert variant="destructive" data-testid="upload-errors">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    <div className="space-y-1">
                      {uploadErrors.map((error, i) => (
                        <div key={i}>{error}</div>
                      ))}
                    </div>
                  </AlertDescription>
                </Alert>
              )}

              {csvData.length > 0 && (
                <div className="space-y-4">
                  <div className="border rounded-lg p-4 bg-gray-50" data-testid="csv-preview">
                    <h4 className="font-medium mb-2">Preview ({csvData.length} events)</h4>
                    <div className="space-y-2 max-h-60 overflow-y-auto">
                      {csvData.slice(0, 5).map((event, i) => (
                        <div key={i} className="text-sm border-l-2 border-blue-200 pl-3">
                          <div className="font-medium">{event.date} - {event.group}</div>
                          <div className="text-gray-600">{event.summary}</div>
                        </div>
                      ))}
                      {csvData.length > 5 && (
                        <div className="text-sm text-gray-500">...and {csvData.length - 5} more events</div>
                      )}
                    </div>
                  </div>

                  <Button 
                    onClick={handleUpload}
                    disabled={uploadMutation.isPending}
                    className="w-full"
                    data-testid="confirm-upload-button"
                  >
                    {uploadMutation.isPending ? (
                      <>
                        <RotateCw className="w-4 h-4 mr-2 animate-spin" />
                        Uploading...
                      </>
                    ) : (
                      <>
                        <Upload className="w-4 h-4 mr-2" />
                        Upload {csvData.length} Events
                      </>
                    )}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="batches" className="space-y-6">
          <div className="grid gap-4" data-testid="batches-list">
            {batchesLoading ? (
              <Card>
                <CardContent className="p-6 text-center">
                  <RotateCw className="w-8 h-8 mx-auto mb-2 animate-spin" />
                  Loading batches...
                </CardContent>
              </Card>
            ) : batches.length === 0 ? (
              <Card>
                <CardContent className="p-6 text-center text-gray-500">
                  No batches found. Upload a CSV file to get started.
                </CardContent>
              </Card>
            ) : (
              batches.map((batch) => (
                <Card key={batch.id} data-testid={`batch-${batch.id}`}>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <div>
                        <CardTitle className="text-lg">{batch.originalFilename}</CardTitle>
                        <CardDescription>
                          {formatDate(batch.createdAt)} • {batch.totalEvents} events • {batch.totalBatches} batches
                        </CardDescription>
                      </div>
                      {getStatusBadge(batch.status)}
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      <div className="flex justify-between text-sm">
                        <span>Progress: {batch.processedEvents}/{batch.totalEvents}</span>
                        <span>{Math.round((batch.processedEvents / batch.totalEvents) * 100)}%</span>
                      </div>
                      <Progress 
                        value={(batch.processedEvents / batch.totalEvents) * 100} 
                        className="h-2"
                        data-testid={`batch-progress-${batch.id}`}
                      />
                      
                      <div className="flex gap-2">
                        {batch.status === 'uploaded' && (
                          <Button
                            size="sm"
                            onClick={() => {
                              setCurrentBatch(batch);
                              handleProcessBatch(1);
                            }}
                            disabled={processMutation.isPending}
                            data-testid={`process-batch-${batch.id}`}
                          >
                            <Play className="w-4 h-4 mr-1" />
                            Start Processing
                          </Button>
                        )}
                        
                        {batch.status === 'reviewing' && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setCurrentBatch(batch);
                            }}
                            data-testid={`review-batch-${batch.id}`}
                          >
                            <Eye className="w-4 h-4 mr-1" />
                            Review
                          </Button>
                        )}
                        
                        {batch.status === 'completed' && batch.approvedEvents > 0 && (
                          <Button
                            size="sm"
                            onClick={() => finalizeMutation.mutate(batch.id)}
                            disabled={finalizeMutation.isPending}
                            data-testid={`finalize-batch-${batch.id}`}
                          >
                            <Database className="w-4 h-4 mr-1" />
                            Import to Database
                          </Button>
                        )}
                      </div>
                      
                      {batch.approvedEvents > 0 && (
                        <div className="text-sm text-green-600">
                          {batch.approvedEvents} events approved for import
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </TabsContent>

        <TabsContent value="review" className="space-y-6">
          {currentBatch && (
            <Card data-testid="review-card">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>Review Enhanced Events</CardTitle>
                    <CardDescription>
                      Batch {reviewingBatchNumber} of {currentBatch.totalBatches} - {currentBatch.originalFilename}
                    </CardDescription>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={handleApproveSelected}
                      disabled={selectedEventIds.size === 0 || approveMutation.isPending}
                      data-testid="approve-selected-button"
                    >
                      <ThumbsUp className="w-4 h-4 mr-1" />
                      Approve ({selectedEventIds.size})
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={handleRejectSelected}
                      disabled={selectedEventIds.size === 0 || rejectMutation.isPending}
                      data-testid="reject-selected-button"
                    >
                      <ThumbsDown className="w-4 h-4 mr-1" />
                      Reject ({selectedEventIds.size})
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {reviewLoading ? (
                  <div className="text-center py-8">
                    <RotateCw className="w-8 h-8 mx-auto mb-2 animate-spin" />
                    Loading events for review...
                  </div>
                ) : (
                  <div className="space-y-4" data-testid="review-events">
                    {reviewEvents.map((event) => (
                      <div
                        key={event.id}
                        className={cn(
                          "border rounded-lg p-4 space-y-3",
                          selectedEventIds.has(event.id) && "border-blue-500 bg-blue-50"
                        )}
                        data-testid={`review-event-${event.id}`}
                      >
                        <div className="flex items-start gap-3">
                          <Checkbox
                            checked={selectedEventIds.has(event.id)}
                            onCheckedChange={(checked) => handleEventSelection(event.id, checked as boolean)}
                            data-testid={`event-checkbox-${event.id}`}
                          />
                          <div className="flex-1 space-y-2">
                            <div className="flex items-center justify-between">
                              <span className="font-medium">{event.originalDate}</span>
                              <Badge variant="outline">{event.originalGroup}</Badge>
                            </div>
                            
                            <div className="space-y-2">
                              <div>
                                <label className="text-sm font-medium text-gray-500">Original:</label>
                                <p className="text-sm">{event.originalSummary}</p>
                              </div>
                              
                              {event.enhancedSummary && (
                                <div>
                                  <label className="text-sm font-medium text-green-600">Enhanced ({event.enhancedSummary.length} chars):</label>
                                  <p className="text-sm font-medium">{event.enhancedSummary}</p>
                                </div>
                              )}
                              
                              {event.enhancedReasoning && (
                                <div>
                                  <label className="text-sm font-medium text-gray-500">AI Reasoning:</label>
                                  <p className="text-xs text-gray-600">{event.enhancedReasoning}</p>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}