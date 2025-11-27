import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { DndContext, DragOverlay, closestCenter, DragEndEvent, DragStartEvent } from '@dnd-kit/core';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CategorySection } from '@/components/TagsManager/CategorySection';
import { TagCard } from '@/components/TagsManager/TagCard';
import { MergeDialog } from '@/components/TagsManager/MergeDialog';
import { RenameDialog } from '@/components/TagsManager/RenameDialog';
import { DeleteDialog } from '@/components/TagsManager/DeleteDialog';
import { Search, Tag, RefreshCw, AlertCircle } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase';

interface TagStats {
  tagsByCategory: Record<string, Array<{ name: string; category: string; count: number }>>;
  totalTags: number;
  totalOccurrences: number;
  categories: string[];
}

interface TagData {
  name: string;
  category: string;
  count: number;
}

export default function TagsManager() {
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTag, setActiveTag] = useState<TagData | null>(null);
  const [hoveredTag, setHoveredTag] = useState<TagData | null>(null);
  const [showMergeDialog, setShowMergeDialog] = useState(false);
  const [showRenameDialog, setShowRenameDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [tagToRename, setTagToRename] = useState<TagData | null>(null);
  const [tagToDelete, setTagToDelete] = useState<TagData | null>(null);
  const [mergeSource, setMergeSource] = useState<TagData | null>(null);
  const [mergeTarget, setMergeTarget] = useState<TagData | null>(null);

  // Fetch tag statistics
  const { data: stats, isLoading, error, refetch } = useQuery<TagStats>({
    queryKey: ['tags-manager-stats'],
    staleTime: 0, // Always consider data stale
    gcTime: 0, // Don't cache data (previously cacheTime)
    refetchOnMount: true, // Always refetch on mount
    queryFn: async () => {
      if (!supabase) throw new Error("Supabase not configured");

      // Fetch all analyses with tags
      const BATCH_SIZE = 1000;
      let from = 0;
      let hasMore = true;
      const allAnalyses: any[] = [];

      while (hasMore) {
        const { data, error: queryError } = await supabase
          .from("historical_news_analyses")
          .select("tags")
          .order("date", { ascending: false })
          .range(from, from + BATCH_SIZE - 1);

        if (queryError) throw queryError;

        if (data && data.length > 0) {
          allAnalyses.push(...data);
          from += BATCH_SIZE;
        } else {
          hasMore = false;
        }
      }

      // Process tags to build statistics
      const tagsByCategory: Record<string, Array<{ name: string; category: string; count: number }>> = {};
      const tagCountMap = new Map<string, number>();
      let totalOccurrences = 0;

      allAnalyses.forEach(analysis => {
        if (analysis.tags && Array.isArray(analysis.tags)) {
          analysis.tags.forEach(tag => {
            const key = `${tag.category}::${tag.name}`;
            tagCountMap.set(key, (tagCountMap.get(key) || 0) + 1);
            totalOccurrences++;
          });
        }
      });

      // Group by category
      tagCountMap.forEach((count, key) => {
        const [category, name] = key.split('::');
        if (!tagsByCategory[category]) {
          tagsByCategory[category] = [];
        }
        tagsByCategory[category].push({ name, category, count });
      });

      // Sort tags within each category by count (descending)
      Object.keys(tagsByCategory).forEach(category => {
        tagsByCategory[category].sort((a, b) => b.count - a.count);
      });

      return {
        tagsByCategory,
        totalTags: tagCountMap.size,
        totalOccurrences,
        categories: Object.keys(tagsByCategory).sort()
      };
    },
  });

  // Rename mutation
  const renameMutation = useMutation({
    mutationFn: async ({ oldName, newName, category }: { oldName: string; newName: string; category: string }) => {
      const response = await fetch('/api/tags-manager/rename', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ oldName, newName, category }),
      });

      if (!response.ok) {
        let errorMessage = 'Failed to rename tag';
        try {
          const error = await response.json();
          errorMessage = error.error || errorMessage;
        } catch (e) {
          errorMessage = `Error ${response.status}: ${response.statusText || 'Unknown error'}`;
        }
        throw new Error(errorMessage);
      }

      return await response.json();
    },
    onSuccess: async (data) => {
      toast({
        title: 'Tag Renamed',
        description: `Tag has been renamed in ${data.updated} analyses`,
      });
      // Invalidate and refetch to ensure UI updates
      await queryClient.invalidateQueries({ queryKey: ['tags-manager-stats'] });
      await queryClient.invalidateQueries({ queryKey: ['supabase-tags-catalog'] });
      await refetch(); // Force immediate refetch
      setShowRenameDialog(false);
      setTagToRename(null);
    },
    onError: (error: Error) => {
      toast({
        title: 'Rename Failed',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  // Merge mutation
  const mergeMutation = useMutation({
    mutationFn: async ({ sourceTag, targetTag }: { sourceTag: TagData; targetTag: TagData }) => {
      const response = await fetch('/api/tags-manager/merge', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ sourceTag, targetTag }),
      });

      if (!response.ok) {
        let errorMessage = 'Failed to merge tags';
        try {
          const error = await response.json();
          errorMessage = error.error || errorMessage;
        } catch (e) {
          errorMessage = `Error ${response.status}: ${response.statusText || 'Unknown error'}`;
        }
        throw new Error(errorMessage);
      }

      return await response.json();
    },
    onSuccess: async (data) => {
      toast({
        title: 'Tags Merged',
        description: `Tags have been merged in ${data.updated} analyses`,
      });
      // Invalidate and refetch to ensure UI updates
      await queryClient.invalidateQueries({ queryKey: ['tags-manager-stats'] });
      await queryClient.invalidateQueries({ queryKey: ['supabase-tags-catalog'] });
      await refetch(); // Force immediate refetch
      setShowMergeDialog(false);
      setMergeSource(null);
      setMergeTarget(null);
    },
    onError: (error: Error) => {
      toast({
        title: 'Merge Failed',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  // Change category mutation
  const changeCategoryMutation = useMutation({
    mutationFn: async ({ tagName, oldCategory, newCategory }: { tagName: string; oldCategory: string; newCategory: string }) => {
      const response = await fetch('/api/tags-manager/change-category', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ tagName, oldCategory, newCategory }),
      });

      if (!response.ok) {
        let errorMessage = 'Failed to change category';
        try {
          const error = await response.json();
          errorMessage = error.error || errorMessage;
        } catch (e) {
          errorMessage = `Error ${response.status}: ${response.statusText || 'Unknown error'}`;
        }
        throw new Error(errorMessage);
      }

      return await response.json();
    },
    onSuccess: async (data) => {
      toast({
        title: 'Category Changed',
        description: `Tag category changed in ${data.updated} analyses`,
      });
      // Invalidate and refetch to ensure UI updates
      await queryClient.invalidateQueries({ queryKey: ['tags-manager-stats'] });
      await queryClient.invalidateQueries({ queryKey: ['supabase-tags-catalog'] });
      await refetch(); // Force immediate refetch
    },
    onError: (error: Error) => {
      toast({
        title: 'Category Change Failed',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async ({ tagName, category }: { tagName: string; category: string }) => {
      const response = await fetch('/api/tags-manager/delete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ tagName, category }),
      });

      if (!response.ok) {
        let errorMessage = 'Failed to delete tag';
        try {
          const error = await response.json();
          errorMessage = error.error || errorMessage;
        } catch (e) {
          errorMessage = `Error ${response.status}: ${response.statusText || 'Unknown error'}`;
        }
        throw new Error(errorMessage);
      }

      return await response.json();
    },
    onSuccess: async (data) => {
      toast({
        title: 'Tag Deleted',
        description: `Tag has been deleted from ${data.updated} analyses`,
      });
      // Invalidate and refetch to ensure UI updates
      await queryClient.invalidateQueries({ queryKey: ['tags-manager-stats'] });
      await queryClient.invalidateQueries({ queryKey: ['supabase-tags-catalog'] });
      await refetch(); // Force immediate refetch
      setShowDeleteDialog(false);
      setTagToDelete(null);
    },
    onError: (error: Error) => {
      toast({
        title: 'Delete Failed',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const handleDragStart = (event: DragStartEvent) => {
    const { active } = event;
    if (active.data.current?.type === 'tag') {
      setActiveTag(active.data.current.tag);
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveTag(null);
    setHoveredTag(null);

    if (!over) return;

    const activeData = active.data.current;
    const overData = over.data.current;

    if (!activeData || !overData) return;

    // Dragging tag over another tag = merge
    if (activeData.type === 'tag' && overData.type === 'tag') {
      const sourceTag = activeData.tag;
      const targetTag = overData.tag;

      if (sourceTag.name !== targetTag.name || sourceTag.category !== targetTag.category) {
        setMergeSource(sourceTag);
        setMergeTarget(targetTag);
        setShowMergeDialog(true);
      }
    }

    // Dragging tag over category = change category
    if (activeData.type === 'tag' && overData.type === 'category') {
      const tag = activeData.tag;
      const newCategory = overData.category;

      if (tag.category !== newCategory) {
        changeCategoryMutation.mutate({
          tagName: tag.name,
          oldCategory: tag.category,
          newCategory: newCategory,
        });
      }
    }
  };

  const handleRename = (tag: TagData) => {
    setTagToRename(tag);
    setShowRenameDialog(true);
  };

  const handleDelete = (tag: TagData) => {
    setTagToDelete(tag);
    setShowDeleteDialog(true);
  };

  const confirmRename = (newName: string) => {
    if (tagToRename) {
      renameMutation.mutate({
        oldName: tagToRename.name,
        newName,
        category: tagToRename.category,
      });
    }
  };

  const confirmMerge = () => {
    if (mergeSource && mergeTarget) {
      mergeMutation.mutate({ sourceTag: mergeSource, targetTag: mergeTarget });
    }
  };

  const confirmDelete = () => {
    if (tagToDelete) {
      deleteMutation.mutate({
        tagName: tagToDelete.name,
        category: tagToDelete.category,
      });
    }
  };

  // Filter tags by search query
  const filteredStats = stats
    ? {
        ...stats,
        tagsByCategory: Object.fromEntries(
          Object.entries(stats.tagsByCategory)
            .map(([category, tags]) => [
              category,
              tags.filter((tag) =>
                tag.name.toLowerCase().includes(searchQuery.toLowerCase())
              ),
            ])
            .filter(([_, tags]) => (tags as any[]).length > 0)
        ) as Record<string, TagData[]>,
      }
    : null;

  if (error) {
    return (
      <div className="max-w-7xl mx-auto p-6">
        <Card className="p-8 text-center">
          <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <h2 className="text-xl font-semibold mb-2">Error Loading Tags</h2>
          <p className="text-slate-600 mb-4">{(error as Error).message}</p>
          <Button onClick={() => refetch()}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Retry
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto p-6">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 flex items-center gap-2">
              <Tag className="w-8 h-8 text-blue-600" />
              Tags Manager
            </h1>
            <p className="text-slate-600 mt-1">
              Organize, merge, and manage your tags with drag-and-drop
            </p>
          </div>
          <Button
            onClick={() => refetch()}
            variant="outline"
            disabled={isLoading}
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>

        {/* Stats */}
        {stats && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <Card className="p-4">
              <div className="text-sm text-slate-600 mb-1">Total Tags</div>
              <div className="text-2xl font-bold text-slate-900">{stats.totalTags}</div>
            </Card>
            <Card className="p-4">
              <div className="text-sm text-slate-600 mb-1">Categories</div>
              <div className="text-2xl font-bold text-slate-900">{stats.categories.length}</div>
            </Card>
            <Card className="p-4">
              <div className="text-sm text-slate-600 mb-1">Total Occurrences</div>
              <div className="text-2xl font-bold text-slate-900">{stats.totalOccurrences}</div>
            </Card>
          </div>
        )}

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400 w-5 h-5" />
          <Input
            type="text"
            placeholder="Search tags by name..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
      </div>

      {/* Instructions */}
      <Card className="p-4 mb-6 bg-blue-50 border-blue-200">
        <div className="flex items-start gap-3">
          <Tag className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" />
          <div className="text-sm text-blue-900">
            <strong>How to use:</strong>
            <ul className="list-disc list-inside mt-1 space-y-1">
              <li>Drag a tag onto another tag to <strong>merge</strong> them</li>
              <li>Drag a tag onto a category header to <strong>change its category</strong></li>
              <li>Click the edit icon to <strong>rename</strong> a tag</li>
              <li>Click the trash icon to <strong>delete</strong> a tag</li>
            </ul>
          </div>
        </div>
      </Card>

      {/* Tags by Category */}
      {isLoading ? (
        <div className="text-center py-12">
          <RefreshCw className="w-8 h-8 text-blue-600 animate-spin mx-auto mb-4" />
          <p className="text-slate-600">Loading tags...</p>
        </div>
      ) : filteredStats && Object.keys(filteredStats.tagsByCategory).length > 0 ? (
        <DndContext
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <div className="space-y-4">
            {Object.entries(filteredStats.tagsByCategory)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([category, tags]) => (
                <CategorySection
                  key={category}
                  category={category}
                  tags={tags}
                  onRename={handleRename}
                  onDelete={handleDelete}
                />
              ))}
          </div>

          <DragOverlay>
            {activeTag ? (
              <div className="opacity-90">
                <TagCard tag={activeTag} />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      ) : (
        <Card className="p-12 text-center">
          <Tag className="w-12 h-12 text-slate-300 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-slate-600 mb-2">No Tags Found</h3>
          <p className="text-slate-500">
            {searchQuery
              ? 'Try adjusting your search query'
              : 'Start by analyzing some news to create tags'}
          </p>
        </Card>
      )}

      {/* Dialogs */}
      <MergeDialog
        open={showMergeDialog}
        onOpenChange={setShowMergeDialog}
        sourceTag={mergeSource}
        targetTag={mergeTarget}
        onConfirm={confirmMerge}
        isLoading={mergeMutation.isPending}
      />

      <RenameDialog
        open={showRenameDialog}
        onOpenChange={setShowRenameDialog}
        tag={tagToRename}
        onConfirm={confirmRename}
        isLoading={renameMutation.isPending}
      />

      <DeleteDialog
        open={showDeleteDialog}
        onOpenChange={setShowDeleteDialog}
        tag={tagToDelete}
        onConfirm={confirmDelete}
        isLoading={deleteMutation.isPending}
      />
    </div>
  );
}

