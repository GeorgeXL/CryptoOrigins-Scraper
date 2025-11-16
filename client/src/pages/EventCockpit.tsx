import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { 
  ChevronLeft, 
  ChevronRight, 
  Sparkles, 
  Edit3, 
  Save, 
  X,
  CheckCircle,
  ArrowRight,
  Database
} from 'lucide-react';

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
  aiProvider?: string;
  processedAt?: string;
  reviewedAt?: string;
  createdAt: string;
}

interface EventBatch {
  id: string;
  originalFilename: string;
  status: string;
  totalEvents: number;
  processedEvents: number;
  approvedEvents: number;
  rejectedEvents: number;
  currentBatchNumber: number;
  totalBatches: number;
  createdAt: string;
  completedAt?: string;
}

interface CockpitData {
  batch: EventBatch;
  events: BatchEvent[];
  pagination: {
    currentPage: number;
    totalPages: number;
    totalEvents: number;
    eventsPerPage: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}

export default function EventCockpit() {
  const [selectedBatchId, setSelectedBatchId] = useState<string>('');
  const [currentPage, setCurrentPage] = useState(1);
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');
  const [selectedEvents, setSelectedEvents] = useState<Set<string>>(new Set());
  
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Get available batches
  const { data: batches } = useQuery({
    queryKey: ['/api/batch-events/batches'],
    select: (data: EventBatch[]) => data.sort((a, b) => b.totalEvents - a.totalEvents) // Sort by size, largest first
  });

  // Get cockpit data for selected batch
  const { data: cockpitData, isLoading } = useQuery<CockpitData>({
    queryKey: ['/api/event-cockpit', selectedBatchId, currentPage],
    enabled: !!selectedBatchId,
    queryFn: async () => {
      const response = await fetch(`/api/event-cockpit/${selectedBatchId}?page=${currentPage}`);
      if (!response.ok) throw new Error('Failed to fetch events');
      return response.json();
    }
  });

  // AI Enhancement mutation
  const enhanceMutation = useMutation({
    mutationFn: async (eventId: string) => {
      const response = await fetch(`/api/event-cockpit/enhance/${eventId}`, {
        method: 'POST'
      });
      if (!response.ok) throw new Error('Failed to enhance event');
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/event-cockpit', selectedBatchId] });
      
      if (data.needsEnhancement) {
        toast({ 
          title: '✨ Summary Enhanced', 
          description: `AI improved the summary: ${data.reasoning}` 
        });
      } else {
        toast({ 
          title: '✅ Summary Already Perfect', 
          description: `AI says: ${data.reasoning || data.message}` 
        });
      }
    }
  });

  // Progress tracking for batch enhancement
  const [batchProgress, setBatchProgress] = useState({ current: 0, total: 0 });

  // AI Enhancement mutation (all events on page)
  const enhanceAllMutation = useMutation({
    mutationFn: async () => {
      if (!cockpitData?.events) throw new Error('No events to enhance');
      
      const events = cockpitData.events;
      setBatchProgress({ current: 0, total: events.length });
      
      let enhanced = 0;
      let alreadyGood = 0;
      
      // Process events sequentially with progress updates
      for (let i = 0; i < events.length; i++) {
        const event = events[i];
        setBatchProgress({ current: i + 1, total: events.length });
        
        try {
          const response = await fetch(`/api/event-cockpit/enhance/${event.id}`, {
            method: 'POST'
          });
          
          if (response.ok) {
            const result = await response.json();
            if (result.needsEnhancement) {
              enhanced++;
            } else {
              alreadyGood++;
            }
          } else {
            alreadyGood++; // Count as processed
          }
        } catch (error) {
          console.error(`Failed to enhance event ${event.id}:`, error);
          alreadyGood++; // Count as processed to continue
        }
      }
      
      return { enhanced, alreadyGood, total: events.length };
    },
    onSuccess: (data) => {
      setBatchProgress({ current: 0, total: 0 });
      queryClient.invalidateQueries({ queryKey: ['/api/event-cockpit', selectedBatchId] });
      toast({ 
        title: `✨ AI Enhanced ${data.enhanced} Events`, 
        description: `${data.alreadyGood} were already perfect, ${data.enhanced} improved` 
      });
    },
    onError: () => {
      setBatchProgress({ current: 0, total: 0 });
      toast({ 
        title: 'Enhancement Failed', 
        description: 'Could not enhance all events. Please try again.',
        variant: 'destructive'
      });
    }
  });

  // Manual edit mutation
  const editMutation = useMutation({
    mutationFn: async ({ eventId, summary }: { eventId: string; summary: string }) => {
      const response = await fetch(`/api/event-cockpit/edit/${eventId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ summary })
      });
      if (!response.ok) throw new Error('Failed to edit event');
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/event-cockpit', selectedBatchId] });
      setEditingEventId(null);
      toast({ title: 'Event updated', description: 'Summary has been saved' });
    }
  });

  // Approve events mutation
  const approveMutation = useMutation({
    mutationFn: async (eventIds: string[]) => {
      const response = await fetch('/api/event-cockpit/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventIds })
      });
      if (!response.ok) throw new Error('Failed to approve events');
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/event-cockpit', selectedBatchId] });
      setSelectedEvents(new Set());
      toast({ 
        title: `${data.approved} events approved`, 
        description: 'Events are ready for final database import' 
      });
    }
  });

  // Set first batch as default
  useEffect(() => {
    if (batches && batches.length > 0 && !selectedBatchId) {
      setSelectedBatchId(batches[0].id);
    }
  }, [batches, selectedBatchId]);

  const handleEditStart = (event: BatchEvent) => {
    setEditingEventId(event.id);
    setEditingText(event.enhancedSummary || event.originalSummary);
  };

  const handleEditSave = () => {
    if (editingEventId && editingText.length >= 100 && editingText.length <= 110) {
      editMutation.mutate({ eventId: editingEventId, summary: editingText });
    }
  };

  const handleEditCancel = () => {
    setEditingEventId(null);
    setEditingText('');
  };

  const handleEventToggle = (eventId: string) => {
    const newSelected = new Set(selectedEvents);
    if (newSelected.has(eventId)) {
      newSelected.delete(eventId);
    } else {
      newSelected.add(eventId);
    }
    setSelectedEvents(newSelected);
  };

  const getDisplaySummary = (event: BatchEvent) => {
    return event.enhancedSummary || event.originalSummary;
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending': return 'bg-gray-100 text-gray-800';
      case 'enhanced': return 'bg-blue-100 text-blue-800';
      case 'approved': return 'bg-green-100 text-green-800';
      case 'rejected': return 'bg-red-100 text-red-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  if (!batches || batches.length === 0) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-bold mb-4">Event Cockpit</h1>
        <p className="text-muted-foreground">No uploaded batches found. Please upload a CSV file first.</p>
      </div>
    );
  }

  return (
    <div data-testid="event-cockpit" className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Event Cockpit</h1>
        <div className="flex items-center gap-4">
          <select 
            value={selectedBatchId} 
            onChange={(e) => {
              setSelectedBatchId(e.target.value);
              setCurrentPage(1);
            }}
            className="border rounded px-3 py-2"
            data-testid="batch-selector"
          >
            {batches.map(batch => (
              <option key={batch.id} value={batch.id}>
                {batch.originalFilename} ({batch.totalEvents} events) - {batch.status}
              </option>
            ))}
          </select>
        </div>
      </div>

      {cockpitData && (
        <>
          {/* Batch Stats */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Database className="h-5 w-5" />
                Batch Progress
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-4 gap-4">
                <div className="text-center">
                  <div className="text-2xl font-bold">{cockpitData.batch.totalEvents}</div>
                  <div className="text-sm text-muted-foreground">Total Events</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-blue-600">{cockpitData.batch.processedEvents}</div>
                  <div className="text-sm text-muted-foreground">Processed</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-green-600">{cockpitData.batch.approvedEvents}</div>
                  <div className="text-sm text-muted-foreground">Approved</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-red-600">{cockpitData.batch.rejectedEvents}</div>
                  <div className="text-sm text-muted-foreground">Rejected</div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Page Actions */}
          <div className="flex items-center justify-between mb-4">
            <Button
              onClick={() => enhanceAllMutation.mutate()}
              disabled={enhanceAllMutation.isPending || isLoading}
              className="bg-purple-600 hover:bg-purple-700"
              data-testid="enhance-all-button"
            >
              <Sparkles className="h-4 w-4 mr-2" />
              {enhanceAllMutation.isPending 
                ? `AI Enhancing... ${batchProgress.current}/${batchProgress.total}` 
                : `AI Enhance All ${cockpitData?.events?.length || 0} Events`}
            </Button>
            
            {selectedEvents.size > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">
                  {selectedEvents.size} events selected
                </span>
                <Button
                  onClick={() => approveMutation.mutate(Array.from(selectedEvents))}
                  disabled={approveMutation.isPending}
                  className="bg-green-600 hover:bg-green-700"
                  data-testid="approve-selected"
                >
                  <CheckCircle className="h-4 w-4 mr-2" />
                  Approve Selected
                </Button>
              </div>
            )}
          </div>

          {/* Pagination Controls */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={!cockpitData.pagination.hasPrev}
                data-testid="prev-page"
              >
                <ChevronLeft className="h-4 w-4" />
                Previous
              </Button>
              <span className="text-sm text-muted-foreground">
                Page {cockpitData.pagination.currentPage} of {cockpitData.pagination.totalPages}
              </span>
              <Button
                variant="outline"
                onClick={() => setCurrentPage(p => p + 1)}
                disabled={!cockpitData.pagination.hasNext}
                data-testid="next-page"
              >
                Next
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
            
            {selectedEvents.size > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">
                  {selectedEvents.size} events selected
                </span>
                <Button
                  onClick={() => approveMutation.mutate(Array.from(selectedEvents))}
                  disabled={approveMutation.isPending}
                  className="bg-green-600 hover:bg-green-700"
                  data-testid="approve-selected"
                >
                  <CheckCircle className="h-4 w-4 mr-2" />
                  Approve Selected
                </Button>
              </div>
            )}
          </div>

          {/* Events List */}
          <div className="space-y-4">
            {isLoading ? (
              <div className="text-center py-8">Loading events...</div>
            ) : (
              cockpitData.events.map(event => (
                <Card key={event.id} className="relative">
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <input
                          type="checkbox"
                          checked={selectedEvents.has(event.id)}
                          onChange={() => handleEventToggle(event.id)}
                          className="h-4 w-4"
                          data-testid={`event-checkbox-${event.id}`}
                        />
                        <div className="text-sm font-medium">
                          {event.originalDate}
                        </div>
                        <Badge className={getStatusColor(event.status)}>
                          {event.status}
                        </Badge>
                        <Badge variant="outline">
                          {event.originalGroup}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => enhanceMutation.mutate(event.id)}
                          disabled={enhanceMutation.isPending}
                          data-testid={`enhance-button-${event.id}`}
                        >
                          <Sparkles className="h-4 w-4 mr-1" />
                          AI Enhance
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleEditStart(event)}
                          data-testid={`edit-button-${event.id}`}
                        >
                          <Edit3 className="h-4 w-4 mr-1" />
                          Edit
                        </Button>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    {editingEventId === event.id ? (
                      <div className="space-y-3">
                        <Textarea
                          value={editingText}
                          onChange={(e) => setEditingText(e.target.value)}
                          placeholder="Edit summary (100-110 characters)"
                          className="min-h-[80px]"
                          data-testid={`edit-textarea-${event.id}`}
                        />
                        <div className="flex items-center justify-between">
                          <span className={`text-sm ${
                            editingText.length >= 100 && editingText.length <= 110 
                              ? 'text-green-600' 
                              : 'text-red-600'
                          }`}>
                            {editingText.length}/110 characters
                          </span>
                          <div className="flex items-center gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={handleEditCancel}
                              data-testid={`cancel-edit-${event.id}`}
                            >
                              <X className="h-4 w-4 mr-1" />
                              Cancel
                            </Button>
                            <Button
                              size="sm"
                              onClick={handleEditSave}
                              disabled={editingText.length < 100 || editingText.length > 110}
                              data-testid={`save-edit-${event.id}`}
                            >
                              <Save className="h-4 w-4 mr-1" />
                              Save
                            </Button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="text-sm font-medium text-muted-foreground">
                            {event.enhancedSummary ? 'Enhanced Summary:' : 'Original Summary:'}
                          </div>
                          <div className={`text-xs px-2 py-1 rounded ${
                            getDisplaySummary(event).length >= 100 && getDisplaySummary(event).length <= 110
                              ? 'bg-green-100 text-green-700'
                              : 'bg-red-100 text-red-700'
                          }`}>
                            {getDisplaySummary(event).length} chars
                          </div>
                        </div>
                        <p className="text-sm leading-relaxed">
                          {getDisplaySummary(event)}
                        </p>
                        {event.enhancedSummary && (
                          <div className="pt-2 border-t">
                            <div className="text-xs text-muted-foreground mb-1">
                              {event.enhancedSummary === event.originalSummary 
                                ? '🤖 AI Decision: Summary already optimal - no changes needed'
                                : '✨ AI Enhanced (Original below):'
                              }
                            </div>
                            {event.enhancedSummary !== event.originalSummary && (
                              <div className="space-y-1">
                                <div className="flex items-center justify-between">
                                  <span className="text-xs text-muted-foreground">Original:</span>
                                  <span className={`text-xs px-1 py-0.5 rounded ${
                                    event.originalSummary.length >= 100 && event.originalSummary.length <= 110
                                      ? 'bg-green-50 text-green-600'
                                      : 'bg-red-50 text-red-600'
                                  }`}>
                                    {event.originalSummary.length} chars
                                  </span>
                                </div>
                                <p className="text-xs text-muted-foreground italic">
                                  {event.originalSummary}
                                </p>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}