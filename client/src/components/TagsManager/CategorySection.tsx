import { useDroppable } from '@dnd-kit/core';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { TagCard } from './TagCard';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';

interface CategorySectionProps {
  category: string;
  tags: Array<{ name: string; category: string; count: number }>;
  onRename?: (tag: { name: string; category: string }) => void;
  onDelete?: (tag: { name: string; category: string }) => void;
  defaultExpanded?: boolean;
}

export function CategorySection({
  category,
  tags,
  onRename,
  onDelete,
  defaultExpanded = true,
}: CategorySectionProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  
  const { setNodeRef, isOver } = useDroppable({
    id: `category-${category}`,
    data: {
      type: 'category',
      category: category,
    },
  });

  const totalOccurrences = tags.reduce((sum, tag) => sum + tag.count, 0);

  return (
    <Card
      ref={setNodeRef}
      className={`p-4 transition-all duration-200 ${
        isOver ? 'ring-2 ring-blue-500 bg-blue-50' : ''
      }`}
    >
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between mb-3 hover:opacity-70 transition-opacity"
      >
        <div className="flex items-center gap-2">
          {isExpanded ? (
            <ChevronDown className="w-4 h-4 text-slate-500" />
          ) : (
            <ChevronRight className="w-4 h-4 text-slate-500" />
          )}
          <h3 className="font-semibold text-lg">{category}</h3>
          <Badge variant="outline" className="ml-2">
            {tags.length} tags
          </Badge>
          <Badge variant="secondary" className="text-xs">
            {totalOccurrences} occurrences
          </Badge>
        </div>
      </button>

      {isExpanded && (
        <div className="space-y-2">
          {tags.length === 0 ? (
            <div className="text-center py-8 text-slate-400 text-sm">
              No tags in this category yet. Drag tags here to add them.
            </div>
          ) : (
            tags.map((tag) => (
              <TagCard
                key={`${tag.category}::${tag.name}`}
                tag={tag}
                onRename={onRename}
                onDelete={onDelete}
              />
            ))
          )}
        </div>
      )}
    </Card>
  );
}



