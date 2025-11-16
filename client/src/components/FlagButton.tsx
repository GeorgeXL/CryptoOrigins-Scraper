import React, { useState } from 'react';
import { Flag, FlagOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { queryClient } from '@/lib/queryClient';

interface FlagButtonProps {
  date: string;
  isFlagged: boolean;
  flagReason?: string;
  type: 'analysis' | 'manual';
  entryId?: string;
  className?: string;
}

export function FlagButton({ date, isFlagged, flagReason, type, entryId, className }: FlagButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [reason, setReason] = useState(flagReason || '');
  const [isUpdating, setIsUpdating] = useState(false);
  const { toast } = useToast();
  
  // Use a ref to track if we're already processing to prevent multiple calls
  const processingRef = React.useRef(false);

  const handleToggleFlag = async (flagged: boolean, newReason?: string) => {
    // Prevent multiple simultaneous flag operations using both state and ref
    if (isUpdating || processingRef.current) {
      console.log('Flag operation already in progress, skipping');
      return;
    }
    
    processingRef.current = true;
    setIsUpdating(true);
    console.log(`Flag operation starting for ${date}: ${flagged ? 'flagging' : 'unflagging'}`);
    
    try {
      const endpoint = type === 'analysis' 
        ? `/api/analysis/flag/${date}`
        : `/api/manual-entries/flag/${entryId}`;
      
      const response = await fetch(endpoint, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          isFlagged: flagged,
          flagReason: flagged ? newReason : null,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to update flag');
      }

      // Invalidate relevant caches
      await queryClient.invalidateQueries({ queryKey: ['/api/analysis'] });
      await queryClient.invalidateQueries({ queryKey: ['/api/manual-entries'] });
      // Also invalidate specific date query
      await queryClient.invalidateQueries({ queryKey: [`/api/analysis/date/${date}`] });
      // Invalidate year data to update monthly/yearly views
      const year = new Date(date).getFullYear();
      await queryClient.invalidateQueries({ queryKey: [`/api/analysis/year/${year}`] });
      // Invalidate the year filter query used by YearListView
      await queryClient.invalidateQueries({ queryKey: [`/api/analysis/filter?startDate=${year}-01-01&endDate=${year}-12-31`] });
      // Invalidate month data for MonthView
      const month = new Date(date).getMonth() + 1;
      const monthStr = month.toString().padStart(2, '0');
      await queryClient.invalidateQueries({ queryKey: [`/api/analysis/month/${year}/${monthStr}`] });

      toast({
        description: flagged ? 'Day flagged for attention' : 'Flag removed',
      });

      setIsOpen(false);
    } catch (error) {
      toast({
        variant: 'destructive',
        description: 'Failed to update flag',
      });
    } finally {
      setIsUpdating(false);
      processingRef.current = false;
    }
  };

  const handleSubmit = () => {
    handleToggleFlag(true, reason);
  };

  const handleRemoveFlag = () => {
    handleToggleFlag(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={`p-1 h-6 w-6 hover:bg-slate-100 transition-colors ${className || ''}`}
          disabled={isUpdating}
          onClick={(e) => e.stopPropagation()}
          title={isFlagged ? `Flagged: ${flagReason}` : 'Flag for attention'}
        >
          {isFlagged ? (
            <Flag className="h-4 w-4 text-red-500 fill-red-500" />
          ) : (
            <FlagOff className="h-4 w-4 text-gray-400 hover:text-red-500" />
          )}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]" aria-describedby="flag-description">
        <DialogHeader>
          <DialogTitle>
            {isFlagged ? 'Update Flag' : 'Flag for Attention'}
          </DialogTitle>
        </DialogHeader>
        <div id="flag-description" className="sr-only">
          Dialog to flag or unflag a day for attention with optional notes
        </div>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="reason">
              What needs attention about {date}?
            </Label>
            <Textarea
              id="reason"
              placeholder="e.g., Low quality analysis, missing key events, factual errors..."
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              onKeyDown={(e) => {
                // Prevent any accidental submissions
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  e.stopPropagation();
                }
              }}
              disabled={isUpdating}
              rows={3}
            />
          </div>
          <div className="flex gap-2 justify-end">
            {isFlagged && (
              <Button
                variant="outline"
                onClick={handleRemoveFlag}
                disabled={isUpdating}
              >
                Remove Flag
              </Button>
            )}
            <Button
              onClick={handleSubmit}
              disabled={isUpdating || (!reason.trim() && !isFlagged)}
            >
              {isFlagged ? 'Update Flag' : 'Flag Day'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}