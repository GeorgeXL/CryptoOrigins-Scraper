import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { GripVertical, Edit2, Trash2 } from 'lucide-react';

interface TagCardProps {
  tag: {
    name: string;
    category: string;
    count: number;
  };
  onRename?: (tag: { name: string; category: string }) => void;
  onDelete?: (tag: { name: string; category: string }) => void;
}

export function TagCard({ tag, onRename, onDelete }: TagCardProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `${tag.category}::${tag.name}`,
    data: {
      type: 'tag',
      tag: tag,
    },
  });

  const style = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.5 : 1,
    cursor: isDragging ? 'grabbing' : 'grab',
  };

  return (
    <Card
      ref={setNodeRef}
      style={style}
      className={`p-3 hover:shadow-md transition-all duration-200 ${
        isDragging ? 'ring-2 ring-blue-500 shadow-lg' : ''
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <button
            {...listeners}
            {...attributes}
            className="cursor-grab active:cursor-grabbing text-slate-400 hover:text-slate-600 flex-shrink-0"
          >
            <GripVertical className="w-4 h-4" />
          </button>
          
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-medium text-sm truncate">{tag.name}</span>
              <Badge variant="secondary" className="text-xs flex-shrink-0">
                {tag.count}
              </Badge>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1 flex-shrink-0">
          {onRename && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              onClick={() => onRename(tag)}
            >
              <Edit2 className="w-3 h-3" />
            </Button>
          )}
          {onDelete && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 text-red-600 hover:text-red-700 hover:bg-red-50"
              onClick={() => onDelete(tag)}
            >
              <Trash2 className="w-3 h-3" />
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}



