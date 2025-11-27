import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, ArrowRight } from 'lucide-react';

interface MergeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sourceTag: { name: string; category: string; count: number } | null;
  targetTag: { name: string; category: string; count: number } | null;
  onConfirm: () => void;
  isLoading?: boolean;
}

export function MergeDialog({
  open,
  onOpenChange,
  sourceTag,
  targetTag,
  onConfirm,
  isLoading = false,
}: MergeDialogProps) {
  if (!sourceTag || !targetTag) return null;

  const totalCount = sourceTag.count + targetTag.count;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-amber-500" />
            Merge Tags
          </DialogTitle>
          <DialogDescription>
            This action will merge all occurrences of the source tag into the target tag.
            This cannot be undone.
          </DialogDescription>
        </DialogHeader>

        <div className="py-4">
          <div className="flex items-center justify-between gap-4 p-4 bg-slate-50 rounded-lg">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <span className="font-semibold text-slate-900">{sourceTag.name}</span>
                <Badge variant="outline" className="text-xs">
                  {sourceTag.category}
                </Badge>
              </div>
              <p className="text-sm text-slate-600">{sourceTag.count} occurrences</p>
            </div>

            <ArrowRight className="w-5 h-5 text-slate-400 flex-shrink-0" />

            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <span className="font-semibold text-slate-900">{targetTag.name}</span>
                <Badge variant="outline" className="text-xs">
                  {targetTag.category}
                </Badge>
              </div>
              <p className="text-sm text-slate-600">{targetTag.count} occurrences</p>
            </div>
          </div>

          <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
            <p className="text-sm text-blue-900">
              <strong>Result:</strong> "{targetTag.name}" will have {totalCount} total occurrences
            </p>
          </div>

          <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
            <p className="text-sm text-amber-900">
              <strong>Warning:</strong> This will update {sourceTag.count} analyses and remove "{sourceTag.name}" permanently.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isLoading}
          >
            Cancel
          </Button>
          <Button
            onClick={onConfirm}
            disabled={isLoading}
            className="bg-amber-600 hover:bg-amber-700"
          >
            {isLoading ? 'Merging...' : 'Confirm Merge'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}



