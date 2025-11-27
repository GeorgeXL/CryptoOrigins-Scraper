import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Edit2 } from 'lucide-react';

interface RenameDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tag: { name: string; category: string; count: number } | null;
  onConfirm: (newName: string) => void;
  isLoading?: boolean;
}

export function RenameDialog({
  open,
  onOpenChange,
  tag,
  onConfirm,
  isLoading = false,
}: RenameDialogProps) {
  const [newName, setNewName] = useState('');

  useEffect(() => {
    if (tag) {
      setNewName(tag.name);
    }
  }, [tag]);

  if (!tag) return null;

  const handleConfirm = () => {
    if (newName.trim() && newName !== tag.name) {
      onConfirm(newName.trim());
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !isLoading) {
      handleConfirm();
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[450px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Edit2 className="w-5 h-5 text-blue-500" />
            Rename Tag
          </DialogTitle>
          <DialogDescription>
            Update the name of this tag across all analyses.
          </DialogDescription>
        </DialogHeader>

        <div className="py-4 space-y-4">
          <div className="p-3 bg-slate-50 rounded-lg">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-sm font-medium text-slate-600">Current Name:</span>
              <span className="font-semibold text-slate-900">{tag.name}</span>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-xs">
                {tag.category}
              </Badge>
              <Badge variant="secondary" className="text-xs">
                {tag.count} occurrences
              </Badge>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="new-name">New Name</Label>
            <Input
              id="new-name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Enter new tag name"
              disabled={isLoading}
              autoFocus
            />
          </div>

          <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
            <p className="text-sm text-blue-900">
              This will update {tag.count} analyses with the new tag name.
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
            onClick={handleConfirm}
            disabled={isLoading || !newName.trim() || newName === tag.name}
          >
            {isLoading ? 'Renaming...' : 'Rename Tag'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}



