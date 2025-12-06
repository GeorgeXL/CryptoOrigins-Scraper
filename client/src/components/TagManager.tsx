import React, { useState, useMemo } from 'react';
import {
  DndContext,
  DragOverlay,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragStartEvent,
  DragEndEvent,
  useDroppable,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from "@/lib/supabase";
import { buildFilterTreeFromTags } from "@/utils/tagHelpers";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  ChevronDown,
  ChevronRight,
  GripVertical,
  MoreHorizontal,
  Plus,
  Pencil,
  Trash2,
  Search,
  X,
  FolderPlus,
  AlertTriangle,
  CheckCircle,
  Loader2,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface Tag {
  id: string;
  name: string;
  normalizedName?: string;
  usageCount: number;
}

interface Subcategory {
  key: string;
  name: string;
  tags: Tag[];
  subcategories: Subcategory[];
  totalTags: number;
}

interface Category {
  category: string;
  name: string;
  emoji?: string;
  tags: Tag[];
  subcategories: Subcategory[];
  totalTags: number;
}

interface FilterTreeResponse {
  categories: Category[];
  totalTags: number;
}

interface QualityCheckTag {
  id: string;
  name: string;
  category: string;
  usage_count: number;
}

interface QualityCheckResponse {
  tagsWithoutPath: QualityCheckTag[];
  unusedTags: QualityCheckTag[];
  totalTags: number;
  totalUsedInSummaries: number;
}

// Droppable Zone for subcategories
function DroppableZone({ 
  id, 
  children, 
  isOver,
  className = ""
}: { 
  id: string; 
  children: React.ReactNode;
  isOver?: boolean;
  className?: string;
}) {
  const { setNodeRef, isOver: isOverThis } = useDroppable({ id });
  const showHighlight = isOver || isOverThis;
  
  return (
    <div 
      ref={setNodeRef} 
      className={`${className} ${showHighlight ? 'bg-accent/50 ring-2 ring-accent ring-inset' : ''} transition-colors rounded-md`}
    >
      {children}
    </div>
  );
}

// Sortable Tag Item
function SortableTag({ tag, onDelete, onRename }: { 
  tag: Tag; 
  onDelete: (tag: Tag) => void;
  onRename: (tag: Tag) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: tag.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group flex items-center gap-2 p-2 rounded-md bg-muted/30 hover:bg-muted/50 border border-border/50 transition-colors ${
        isDragging ? 'z-50 shadow-lg ring-2 ring-primary' : ''
      }`}
    >
      <button
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground"
      >
        <GripVertical className="w-4 h-4" />
      </button>
      <span className="flex-1 text-sm text-foreground truncate">{tag.name}</span>
      <Badge variant="outline" className="text-xs bg-background">
        {tag.usageCount || 0}
      </Badge>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <MoreHorizontal className="w-3.5 h-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="bg-background border-border">
          <DropdownMenuItem onClick={() => onRename(tag)}>
            <Pencil className="w-3.5 h-3.5 mr-2" />
            Rename
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem 
            onClick={() => onDelete(tag)}
            className="text-red-400 focus:text-red-400"
          >
            <Trash2 className="w-3.5 h-3.5 mr-2" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

// Subcategory Section (recursive)
function SubcategorySection({
  subcategory,
  categoryKey,
  depth,
  openPaths,
  togglePath,
  onDeleteTag,
  onRenameTag,
  onAddTag,
  onAddSubcategory,
  onRenameSubcategory,
  onDeleteSubcategory,
  activeDropId,
}: {
  subcategory: Subcategory;
  categoryKey: string;
  depth: number;
  openPaths: Set<string>;
  togglePath: (path: string) => void;
  onDeleteTag: (tag: Tag) => void;
  onRenameTag: (tag: Tag) => void;
  onAddTag: (categoryKey: string, subcategoryPath: string[]) => void;
  onAddSubcategory: (categoryKey: string, parentPath: string[], parentName: string) => void;
  onRenameSubcategory: (categoryKey: string, subcategoryKey: string, currentName: string) => void;
  onDeleteSubcategory: (categoryKey: string, subcategoryKey: string, name: string, tagCount: number) => void;
  activeDropId: string | null;
}) {
  const isOpen = openPaths.has(subcategory.key);
  const tagIds = subcategory.tags.map((t) => t.id);
  const hasContent = subcategory.tags.length > 0 || subcategory.subcategories.length > 0;
  const dropId = `drop:${categoryKey}:${subcategory.key}`;
  const isDropTarget = activeDropId === dropId;

  // Parse the subcategory path from the key
  const getSubcategoryPath = (key: string): string[] => {
    // Key format is like "1.2.3" - split into path array
    return key.split('.');
  };

  return (
    <div className="ml-4 border-l border-border/30 pl-3">
      <Collapsible open={isOpen} onOpenChange={() => togglePath(subcategory.key)}>
        <DroppableZone id={dropId} isOver={isDropTarget}>
          <div className="flex items-center justify-between py-1.5 hover:bg-muted/20 rounded-md px-2 -ml-2 group">
            <CollapsibleTrigger asChild>
              <button className="flex items-center gap-2 text-sm flex-1">
                <span className="text-xs text-muted-foreground/60 font-mono min-w-[2.5rem]">
                  {subcategory.key}
                </span>
                <span className="text-muted-foreground font-medium">{subcategory.name}</span>
                <Badge variant="secondary" className="text-xs h-5 px-1.5">
                  {subcategory.totalTags}
                </Badge>
              </button>
            </CollapsibleTrigger>
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100">
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0"
                onClick={(e) => {
                  e.stopPropagation();
                  onAddTag(categoryKey, getSubcategoryPath(subcategory.key));
                }}
                title="Add tag"
              >
                <Plus className="w-3.5 h-3.5" />
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <MoreHorizontal className="w-3.5 h-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="bg-background border-border">
                  <DropdownMenuItem onClick={() => onAddSubcategory(categoryKey, getSubcategoryPath(subcategory.key), subcategory.name)}>
                    <FolderPlus className="w-3.5 h-3.5 mr-2" />
                    Add Subcategory
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onRenameSubcategory(categoryKey, subcategory.key, subcategory.name)}>
                    <Pencil className="w-3.5 h-3.5 mr-2" />
                    Rename
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem 
                    onClick={() => onDeleteSubcategory(categoryKey, subcategory.key, subcategory.name, subcategory.totalTags)}
                    className="text-red-400 focus:text-red-400"
                  >
                    <Trash2 className="w-3.5 h-3.5 mr-2" />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </DroppableZone>
        <CollapsibleContent>
          {/* Nested subcategories */}
          {subcategory.subcategories.map((sub) => (
            <SubcategorySection
              key={sub.key}
              subcategory={sub}
              categoryKey={categoryKey}
              depth={depth + 1}
              openPaths={openPaths}
              togglePath={togglePath}
              onDeleteTag={onDeleteTag}
              onRenameTag={onRenameTag}
              onAddTag={onAddTag}
              onAddSubcategory={onAddSubcategory}
              onRenameSubcategory={onRenameSubcategory}
              onDeleteSubcategory={onDeleteSubcategory}
              activeDropId={activeDropId}
            />
          ))}
          
          {/* Tags in this subcategory */}
          {subcategory.tags.length > 0 && (
            <div className="space-y-1 py-2 ml-4">
              <SortableContext items={tagIds} strategy={verticalListSortingStrategy}>
                {subcategory.tags.map((tag) => (
                  <SortableTag
                    key={tag.id}
                    tag={tag}
                    onDelete={onDeleteTag}
                    onRename={onRenameTag}
                  />
                ))}
              </SortableContext>
            </div>
          )}
          
          {/* Empty drop zone when no tags */}
          {subcategory.tags.length === 0 && subcategory.subcategories.length === 0 && (
            <div className="py-2 ml-4 text-xs text-muted-foreground italic">
              Drop tags here
            </div>
          )}
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

// Category Section
function CategorySection({
  category,
  isOpen,
  onToggle,
  openPaths,
  togglePath,
  onDeleteTag,
  onRenameTag,
  onAddTag,
  onAddSubcategory,
  onRenameSubcategory,
  onDeleteSubcategory,
  activeDropId,
}: {
  category: Category;
  isOpen: boolean;
  onToggle: () => void;
  openPaths: Set<string>;
  togglePath: (path: string) => void;
  onDeleteTag: (tag: Tag) => void;
  onRenameTag: (tag: Tag) => void;
  onAddTag: (categoryKey: string, subcategoryPath: string[]) => void;
  onAddSubcategory: (categoryKey: string, parentPath: string[], parentName: string) => void;
  onRenameSubcategory: (categoryKey: string, subcategoryKey: string, currentName: string) => void;
  onDeleteSubcategory: (categoryKey: string, subcategoryKey: string, name: string, tagCount: number) => void;
  activeDropId: string | null;
}) {
  const tagIds = category.tags.map((t) => t.id);
  const dropId = `drop:${category.category}:root`;
  const isDropTarget = activeDropId === dropId;

  return (
    <Collapsible open={isOpen} onOpenChange={onToggle}>
      <div className="border border-border rounded-lg bg-background overflow-hidden">
        <DroppableZone id={dropId} isOver={isDropTarget}>
          <CollapsibleTrigger asChild>
            <div className="flex items-center justify-between p-3 hover:bg-muted/30 cursor-pointer transition-colors group">
              <div className="flex items-center gap-2">
                {isOpen ? (
                  <ChevronDown className="w-4 h-4 text-muted-foreground" />
                ) : (
                  <ChevronRight className="w-4 h-4 text-muted-foreground" />
                )}
                {category.emoji && <span>{category.emoji}</span>}
                <span className="font-medium text-foreground">{category.name}</span>
                <Badge variant="secondary" className="text-xs">
                  {category.totalTags}
                </Badge>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0"
                  onClick={(e) => {
                    e.stopPropagation();
                    onAddTag(category.category, []);
                  }}
                  title="Add tag"
                >
                  <Plus className="w-4 h-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0 opacity-0 group-hover:opacity-100"
                  onClick={(e) => {
                    e.stopPropagation();
                    onAddSubcategory(category.category, [], category.name);
                  }}
                  title="Add subcategory"
                >
                  <FolderPlus className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </CollapsibleTrigger>
        </DroppableZone>
        <CollapsibleContent>
          <div className="p-3 pt-0 border-t border-border/50">
            {/* Subcategories */}
            {category.subcategories.map((sub) => (
              <SubcategorySection
                key={sub.key}
                subcategory={sub}
                categoryKey={category.category}
                depth={1}
                openPaths={openPaths}
                togglePath={togglePath}
                onDeleteTag={onDeleteTag}
                onRenameTag={onRenameTag}
                onAddTag={onAddTag}
                onAddSubcategory={onAddSubcategory}
                onRenameSubcategory={onRenameSubcategory}
                onDeleteSubcategory={onDeleteSubcategory}
                activeDropId={activeDropId}
              />
            ))}
            
            {/* Root-level tags in category */}
            {category.tags.length > 0 && (
              <div className="space-y-1 py-2">
                <p className="text-xs text-muted-foreground mb-2 ml-1">Root tags:</p>
                <SortableContext items={tagIds} strategy={verticalListSortingStrategy}>
                  {category.tags.map((tag) => (
                    <SortableTag
                      key={tag.id}
                      tag={tag}
                      onDelete={onDeleteTag}
                      onRename={onRenameTag}
                    />
                  ))}
                </SortableContext>
              </div>
            )}
            
            {category.tags.length === 0 && category.subcategories.length === 0 && (
              <p className="text-sm text-muted-foreground py-4 text-center">
                No tags in this category
              </p>
            )}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

// Drag Overlay Tag
function DragOverlayTag({ tag }: { tag: Tag }) {
  return (
    <div className="flex items-center gap-2 p-2 rounded-md bg-accent border border-primary shadow-xl scale-105">
      <GripVertical className="w-4 h-4 text-muted-foreground" />
      <span className="text-sm text-foreground font-medium">{tag.name}</span>
      <Badge variant="outline" className="text-xs">
        {tag.usageCount || 0}
      </Badge>
    </div>
  );
}

export function TagManager() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  // State
  const [searchQuery, setSearchQuery] = useState('');
  const [openCategories, setOpenCategories] = useState<Set<string>>(new Set());
  const [openPaths, setOpenPaths] = useState<Set<string>>(new Set());
  const [activeTag, setActiveTag] = useState<Tag | null>(null);
  const [activeDropId, setActiveDropId] = useState<string | null>(null);
  
  // Dialog states
  const [renameTagDialog, setRenameTagDialog] = useState<{ open: boolean; tag: Tag | null }>({
    open: false,
    tag: null,
  });
  const [addTagDialog, setAddTagDialog] = useState<{ open: boolean; categoryKey: string | null; subcategoryPath: string[] }>({
    open: false,
    categoryKey: null,
    subcategoryPath: [],
  });
  const [deleteConfirmDialog, setDeleteConfirmDialog] = useState<{
    open: boolean;
    tag: Tag | null;
  }>({ open: false, tag: null });
  
  // Subcategory dialog states
  const [addSubcategoryDialog, setAddSubcategoryDialog] = useState<{ 
    open: boolean; 
    categoryKey: string | null; 
    parentPath: string[];
    parentName: string;
  }>({
    open: false,
    categoryKey: null,
    parentPath: [],
    parentName: '',
  });
  const [renameSubcategoryDialog, setRenameSubcategoryDialog] = useState<{ 
    open: boolean; 
    categoryKey: string | null;
    subcategoryKey: string;
    currentName: string;
  }>({
    open: false,
    categoryKey: null,
    subcategoryKey: '',
    currentName: '',
  });
  const [deleteSubcategoryDialog, setDeleteSubcategoryDialog] = useState<{ 
    open: boolean; 
    categoryKey: string | null;
    subcategoryKey: string;
    subcategoryName: string;
    tagCount: number;
  }>({
    open: false,
    categoryKey: null,
    subcategoryKey: '',
    subcategoryName: '',
    tagCount: 0,
  });
  
  // Input states
  const [newTagName, setNewTagName] = useState('');
  const [renameValue, setRenameValue] = useState('');
  const [newSubcategoryName, setNewSubcategoryName] = useState('');

  // Quality check state
  const [showQualityCheck, setShowQualityCheck] = useState(false);

  // Fetch tags from Supabase directly
  const { data: allTagsData, isLoading: isTagsLoading } = useQuery({
    queryKey: ['supabase-all-tags-manager'],
    queryFn: async () => {
      if (!supabase) return [];
      const { data, error } = await supabase
        .from('tags')
        .select('*');
      if (error) throw error;
      return data || [];
    },
    staleTime: 0,
    refetchOnMount: true
  });

  // Fetch labels
  const { data: labelsData } = useQuery({
    queryKey: ['supabase-labels-manager'],
    queryFn: async () => {
      if (!supabase) return [];
      const { data, error } = await supabase.from('subcategory_labels').select('*');
      if (error) return [];
      return data || [];
    },
    staleTime: Infinity
  });

  // Construct filter tree client-side
  const filterTree = useMemo(() => {
    if (!allTagsData) return { categories: [], totalTags: 0 };
    
    const labelsMap = new Map<string, string>();
    labelsData?.forEach(l => labelsMap.set(l.path, l.label));
    
    return buildFilterTreeFromTags(allTagsData as any, labelsMap);
  }, [allTagsData, labelsData]);
  
  const isLoading = isTagsLoading;

  // Fetch quality check data from Supabase
  const { data: qualityCheck, isLoading: qualityCheckLoading } = useQuery<QualityCheckResponse>({
    queryKey: ['supabase-quality-check'],
    queryFn: async () => {
      if (!supabase) throw new Error("Supabase not configured");
      
      let tags = allTagsData;
      if (!tags) {
         const { data, error } = await supabase.from('tags').select('*');
         if (error) throw error;
         tags = data || [];
      }
      
      const tagsList = tags || [];
      
      // 1. Tags without subcategory path
      const tagsWithoutPath = tagsList.filter(t => 
        !t.subcategory_path || t.subcategory_path.length === 0
      ).map(t => ({
        id: t.id,
        name: t.name,
        category: t.category,
        usage_count: t.usage_count
      }));
      
      // 2. Unused tags
      const unusedTags = tagsList.filter(t => t.usage_count === 0).map(t => ({
        id: t.id,
        name: t.name,
        category: t.category,
        usage_count: t.usage_count
      }));
      
      // 3. Totals
      const totalTags = tagsList.length;
      const totalUsedInSummaries = tagsList.filter(t => t.usage_count > 0).length;
      
      return {
        tagsWithoutPath,
        unusedTags,
        totalTags,
        totalUsedInSummaries
      };
    },
    enabled: showQualityCheck,
  });

  // Filter categories by search
  const filteredCategories = useMemo(() => {
    if (!filterTree?.categories) return [];
    if (!searchQuery) return filterTree.categories;

    const query = searchQuery.toLowerCase();
    
    const filterTags = (tags: Tag[]): Tag[] => 
      tags.filter(t => t.name.toLowerCase().includes(query));
    
    const filterSubcategory = (sub: Subcategory): Subcategory | null => {
      const filteredTags = filterTags(sub.tags);
      const filteredSubs = sub.subcategories
        .map(filterSubcategory)
        .filter((s): s is Subcategory => s !== null);
      
      if (filteredTags.length === 0 && filteredSubs.length === 0) return null;
      
      return {
        ...sub,
        tags: filteredTags,
        subcategories: filteredSubs,
        totalTags: filteredTags.length + filteredSubs.reduce((sum, s) => sum + s.totalTags, 0),
      };
    };
    
    return filterTree.categories
      .map(cat => {
        const filteredTags = filterTags(cat.tags);
        const filteredSubs = cat.subcategories
          .map(filterSubcategory)
          .filter((s): s is Subcategory => s !== null);
        
        if (filteredTags.length === 0 && filteredSubs.length === 0) return null;
        
        return {
          ...cat,
          tags: filteredTags,
          subcategories: filteredSubs,
          totalTags: filteredTags.length + filteredSubs.reduce((sum, s) => sum + s.totalTags, 0),
        };
      })
      .filter((cat): cat is Category => cat !== null);
  }, [filterTree, searchQuery]);

  // DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Move tag mutation
  const moveTagMutation = useMutation({
    mutationFn: async ({ tagId, category, subcategoryKey }: { tagId: string; category: string; subcategoryKey: string }) => {
      const res = await fetch(`/api/tags/${tagId}/move`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category, subcategoryKey }),
      });
      if (!res.ok) throw new Error('Failed to move tag');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/tags/filter-tree'] });
      toast({ description: 'Tag moved successfully' });
    },
    onError: (error) => {
      toast({ variant: 'destructive', description: `Failed to move tag: ${error.message}` });
    },
  });

  // Update tag mutation
  const updateTagMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: { name?: string } }) => {
      const res = await fetch(`/api/tags/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      if (!res.ok) throw new Error('Failed to update tag');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/tags/filter-tree'] });
      toast({ description: 'Tag renamed successfully' });
    },
  });

  // Create tag mutation
  const createTagMutation = useMutation({
    mutationFn: async ({ name, category, subcategoryPath }: { name: string; category: string; subcategoryPath: string[] }) => {
      const res = await fetch('/api/tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, category, subcategoryPath }),
      });
      if (!res.ok) throw new Error('Failed to create tag');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/tags/filter-tree'] });
      toast({ description: 'Tag created successfully' });
    },
  });

  // Delete tag mutation
  const deleteTagMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/tags/${id}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Failed to delete tag');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/tags/filter-tree'] });
      toast({ description: 'Tag deleted successfully' });
    },
  });

  // Add subcategory mutation
  const addSubcategoryMutation = useMutation({
    mutationFn: async ({ category, parentPath, name }: { category: string; parentPath: string[]; name: string }) => {
      const res = await fetch('/api/tags/subcategory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category, parentPath, name }),
      });
      if (!res.ok) throw new Error('Failed to create subcategory');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/tags/filter-tree'] });
      toast({ description: 'Subcategory created successfully' });
    },
  });

  // Rename subcategory mutation
  const renameSubcategoryMutation = useMutation({
    mutationFn: async ({ category, subcategoryKey, newName }: { category: string; subcategoryKey: string; newName: string }) => {
      const res = await fetch('/api/tags/subcategory/rename', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category, subcategoryKey, newName }),
      });
      if (!res.ok) throw new Error('Failed to rename subcategory');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/tags/filter-tree'] });
      toast({ description: 'Subcategory renamed successfully' });
    },
  });

  // Delete subcategory mutation
  const deleteSubcategoryMutation = useMutation({
    mutationFn: async ({ category, subcategoryKey, action }: { category: string; subcategoryKey: string; action: 'delete' | 'move_to_parent' }) => {
      const res = await fetch('/api/tags/subcategory/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category, subcategoryKey, action }),
      });
      if (!res.ok) throw new Error('Failed to delete subcategory');
      return res.json();
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['/api/tags/filter-tree'] });
      toast({ description: variables.action === 'delete' ? 'Subcategory and tags deleted' : 'Tags moved to parent, subcategory removed' });
    },
  });

  // Find tag by ID in the tree
  const findTagById = (tagId: string): Tag | null => {
    const searchInCategories = (categories: Category[]): Tag | null => {
      for (const cat of categories) {
        const found = cat.tags.find(t => t.id === tagId);
        if (found) return found;
        
        const searchInSubs = (subs: Subcategory[]): Tag | null => {
          for (const sub of subs) {
            const found = sub.tags.find(t => t.id === tagId);
            if (found) return found;
            const nested = searchInSubs(sub.subcategories);
            if (nested) return nested;
          }
          return null;
        };
        
        const fromSubs = searchInSubs(cat.subcategories);
        if (fromSubs) return fromSubs;
      }
      return null;
    };
    
    return searchInCategories(filteredCategories);
  };

  // DnD handlers
  const handleDragStart = (event: DragStartEvent) => {
    const tag = findTagById(event.active.id as string);
    if (tag) setActiveTag(tag);
  };

  const handleDragOver = (event: any) => {
    const { over } = event;
    if (over?.id && typeof over.id === 'string' && over.id.startsWith('drop:')) {
      setActiveDropId(over.id);
    } else {
      setActiveDropId(null);
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveTag(null);
    setActiveDropId(null);
    
    if (!over || !active) return;
    
    // Check if dropped on a droppable zone
    const overId = over.id as string;
    if (!overId.startsWith('drop:')) return;
    
    // Parse drop target: "drop:categoryKey:subcategoryKey" or "drop:categoryKey:root"
    const parts = overId.split(':');
    if (parts.length < 3) return;
    
    const targetCategory = parts[1];
    const targetSubcategoryKey = parts.slice(2).join(':'); // Handle keys with colons
    
    // Move the tag - send the subcategory key directly, backend will build the path
    moveTagMutation.mutate({
      tagId: active.id as string,
      category: targetCategory,
      subcategoryKey: targetSubcategoryKey,
    });
  };

  // Toggle category
  const toggleCategory = (category: string) => {
    setOpenCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  };

  // Toggle subcategory path
  const togglePath = (path: string) => {
    setOpenPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  // Expand all
  const expandAll = () => {
    const allPaths = new Set<string>();
    const collectPaths = (subs: Subcategory[]) => {
      subs.forEach(sub => {
        allPaths.add(sub.key);
        collectPaths(sub.subcategories);
      });
    };
    
    filteredCategories.forEach(cat => {
      allPaths.add(cat.category);
      collectPaths(cat.subcategories);
    });
    
    setOpenCategories(new Set(filteredCategories.map(c => c.category)));
    setOpenPaths(allPaths);
  };

  // Collapse all
  const collapseAll = () => {
    setOpenCategories(new Set());
    setOpenPaths(new Set());
  };

  // Handle add tag
  const handleAddTag = () => {
    if (!newTagName.trim() || !addTagDialog.categoryKey) return;
    
    createTagMutation.mutate({
      name: newTagName.trim(),
      category: addTagDialog.categoryKey,
      subcategoryPath: addTagDialog.subcategoryPath,
    });
    setNewTagName('');
    setAddTagDialog({ open: false, categoryKey: null, subcategoryPath: [] });
  };

  // Handle rename tag
  const handleRenameTag = () => {
    if (!renameValue.trim() || !renameTagDialog.tag) return;
    updateTagMutation.mutate({
      id: renameTagDialog.tag.id,
      updates: { name: renameValue.trim() },
    });
    setRenameValue('');
    setRenameTagDialog({ open: false, tag: null });
  };

  // Handle delete
  const handleDelete = () => {
    if (deleteConfirmDialog.tag) {
      deleteTagMutation.mutate(deleteConfirmDialog.tag.id);
    }
    setDeleteConfirmDialog({ open: false, tag: null });
  };

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <div className="h-10 w-64 bg-muted animate-pulse rounded-md" />
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-16 bg-muted animate-pulse rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-border">
        <div className="flex items-center gap-4">
          <h2 className="text-lg font-semibold text-foreground">Tag Manager</h2>
          <Badge variant="outline">{filterTree?.totalTags || 0} tags</Badge>
          <Badge variant="secondary">{filteredCategories.length} categories</Badge>
        </div>
        <div className="flex items-center gap-2">
          <Button 
            variant={showQualityCheck ? "default" : "outline"} 
            size="sm" 
            onClick={() => setShowQualityCheck(!showQualityCheck)}
          >
            {qualityCheckLoading || !qualityCheck ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (qualityCheck.tagsWithoutPath?.length || 0) + (qualityCheck.unusedTags?.length || 0) > 0 ? (
              <AlertTriangle className="w-4 h-4 mr-2 text-orange-500" />
            ) : (
              <CheckCircle className="w-4 h-4 mr-2 text-green-500" />
            )}
            Quality Check
          </Button>
          <Button variant="outline" size="sm" onClick={expandAll}>
            Expand All
          </Button>
          <Button variant="outline" size="sm" onClick={collapseAll}>
            Collapse All
          </Button>
        </div>
      </div>

      {/* Quality Check Panel */}
      {showQualityCheck && (
        <div className="p-4 border-b border-border bg-muted/30 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground">Quality Check Results</h3>
            <Button variant="ghost" size="sm" onClick={() => setShowQualityCheck(false)}>
              <X className="w-4 h-4" />
            </Button>
          </div>
          
          {qualityCheckLoading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : qualityCheck ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Tags without subcategory path */}
              <div className="rounded-lg border border-border bg-background p-3">
                <div className="flex items-center gap-2 mb-2">
                  {qualityCheck.tagsWithoutPath.length > 0 ? (
                    <AlertTriangle className="w-4 h-4 text-orange-500" />
                  ) : (
                    <CheckCircle className="w-4 h-4 text-green-500" />
                  )}
                  <span className="text-sm font-medium">Tags without subcategory</span>
                  <Badge variant={qualityCheck.tagsWithoutPath.length > 0 ? "destructive" : "secondary"}>
                    {qualityCheck.tagsWithoutPath.length}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground mb-2">
                  Tags at root level without a subcategory path
                </p>
                {qualityCheck.tagsWithoutPath.length > 0 && (
                  <div className="max-h-32 overflow-y-auto space-y-1">
                    {qualityCheck.tagsWithoutPath.slice(0, 20).map((tag) => (
                      <div key={tag.id} className="text-xs flex items-center justify-between px-2 py-1 bg-muted rounded">
                        <span className="truncate">{tag.name}</span>
                        <Badge variant="outline" className="text-[10px] ml-2">{tag.category}</Badge>
                      </div>
                    ))}
                    {qualityCheck.tagsWithoutPath.length > 20 && (
                      <p className="text-xs text-muted-foreground px-2">
                        +{qualityCheck.tagsWithoutPath.length - 20} more...
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* Unused tags */}
              <div className="rounded-lg border border-border bg-background p-3">
                <div className="flex items-center gap-2 mb-2">
                  {qualityCheck.unusedTags.length > 0 ? (
                    <AlertTriangle className="w-4 h-4 text-orange-500" />
                  ) : (
                    <CheckCircle className="w-4 h-4 text-green-500" />
                  )}
                  <span className="text-sm font-medium">Unused tags</span>
                  <Badge variant={qualityCheck.unusedTags.length > 0 ? "destructive" : "secondary"}>
                    {qualityCheck.unusedTags.length}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground mb-2">
                  Tags in database but never used in summaries
                </p>
                {qualityCheck.unusedTags.length > 0 && (
                  <div className="max-h-32 overflow-y-auto space-y-1">
                    {qualityCheck.unusedTags.slice(0, 20).map((tag) => (
                      <div key={tag.id} className="text-xs flex items-center justify-between px-2 py-1 bg-muted rounded">
                        <span className="truncate">{tag.name}</span>
                        <Badge variant="outline" className="text-[10px] ml-2">{tag.category}</Badge>
                      </div>
                    ))}
                    {qualityCheck.unusedTags.length > 20 && (
                      <p className="text-xs text-muted-foreground px-2">
                        +{qualityCheck.unusedTags.length - 20} more...
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
          ) : null}
          
          {qualityCheck && (
            <div className="text-xs text-muted-foreground">
              Total tags in database: {qualityCheck.totalTags} | Used in summaries: {qualityCheck.totalUsedInSummaries}
            </div>
          )}
        </div>
      )}

      {/* Search */}
      <div className="p-4 border-b border-border">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search tags..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 bg-background"
          />
          {searchQuery && (
            <Button
              variant="ghost"
              size="sm"
              className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 p-0"
              onClick={() => setSearchQuery('')}
            >
              <X className="w-4 h-4" />
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          💡 Drag tags between categories and subcategories to reorganize
        </p>
      </div>

      {/* Categories List */}
      <div className="flex-1 overflow-auto p-4 space-y-3">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
        >
          {filteredCategories.map((category) => (
            <CategorySection
              key={category.category}
              category={category}
              isOpen={openCategories.has(category.category)}
              onToggle={() => toggleCategory(category.category)}
              openPaths={openPaths}
              togglePath={togglePath}
              onDeleteTag={(tag) => setDeleteConfirmDialog({ open: true, tag })}
              onRenameTag={(tag) => {
                setRenameValue(tag.name);
                setRenameTagDialog({ open: true, tag });
              }}
              onAddTag={(categoryKey, subcategoryPath) => setAddTagDialog({ open: true, categoryKey, subcategoryPath })}
              onAddSubcategory={(categoryKey, parentPath, parentName) => {
                setNewSubcategoryName('');
                setAddSubcategoryDialog({ open: true, categoryKey, parentPath, parentName });
              }}
              onRenameSubcategory={(categoryKey, subcategoryKey, currentName) => {
                setRenameValue(currentName);
                setRenameSubcategoryDialog({ open: true, categoryKey, subcategoryKey, currentName });
              }}
              onDeleteSubcategory={(categoryKey, subcategoryKey, subcategoryName, tagCount) => {
                setDeleteSubcategoryDialog({ open: true, categoryKey, subcategoryKey, subcategoryName, tagCount });
              }}
              activeDropId={activeDropId}
            />
          ))}
          
          <DragOverlay>
            {activeTag ? <DragOverlayTag tag={activeTag} /> : null}
          </DragOverlay>
        </DndContext>

        {filteredCategories.length === 0 && (
          <div className="text-center py-12 text-muted-foreground">
            <p>No tags found</p>
            {searchQuery && (
              <Button
                variant="link"
                className="mt-2"
                onClick={() => setSearchQuery('')}
              >
                Clear search
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Add Tag Dialog */}
      <Dialog open={addTagDialog.open} onOpenChange={(open) => setAddTagDialog({ open, categoryKey: open ? addTagDialog.categoryKey : null, subcategoryPath: open ? addTagDialog.subcategoryPath : [] })}>
        <DialogContent className="bg-background border-border">
          <DialogHeader>
            <DialogTitle>Add Tag</DialogTitle>
            <DialogDescription>
              Category: <code className="bg-muted px-1 rounded">{addTagDialog.categoryKey}</code>
              {addTagDialog.subcategoryPath.length > 0 && (
                <> → Path: <code className="bg-muted px-1 rounded">{addTagDialog.subcategoryPath.join(' → ')}</code></>
              )}
            </DialogDescription>
          </DialogHeader>
          <Input
            placeholder="Tag name"
            value={newTagName}
            onChange={(e) => setNewTagName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAddTag()}
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddTagDialog({ open: false, categoryKey: null, subcategoryPath: [] })}>
              Cancel
            </Button>
            <Button onClick={handleAddTag} disabled={!newTagName.trim()}>
              Add Tag
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename Tag Dialog */}
      <Dialog open={renameTagDialog.open} onOpenChange={(open) => setRenameTagDialog({ open, tag: open ? renameTagDialog.tag : null })}>
        <DialogContent className="bg-background border-border">
          <DialogHeader>
            <DialogTitle>Rename Tag</DialogTitle>
            <DialogDescription>
              Renaming: "{renameTagDialog.tag?.name}"
            </DialogDescription>
          </DialogHeader>
          <Input
            placeholder="New tag name"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleRenameTag()}
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameTagDialog({ open: false, tag: null })}>
              Cancel
            </Button>
            <Button onClick={handleRenameTag} disabled={!renameValue.trim()}>
              Rename
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteConfirmDialog.open} onOpenChange={(open) => setDeleteConfirmDialog({ ...deleteConfirmDialog, open })}>
        <DialogContent className="bg-background border-border">
          <DialogHeader>
            <DialogTitle>Delete Tag?</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete "{deleteConfirmDialog.tag?.name}"? 
              This tag is used in {deleteConfirmDialog.tag?.usageCount || 0} analyses.
              This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirmDialog({ open: false, tag: null })}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Subcategory Dialog */}
      <Dialog open={addSubcategoryDialog.open} onOpenChange={(open) => setAddSubcategoryDialog({ ...addSubcategoryDialog, open })}>
        <DialogContent className="bg-background border-border">
          <DialogHeader>
            <DialogTitle>Add Subcategory</DialogTitle>
            <DialogDescription>
              Create a new subcategory under "{addSubcategoryDialog.parentName}"
              {addSubcategoryDialog.parentPath.length > 0 && (
                <span className="block mt-1">
                  Path: <code className="bg-muted px-1 rounded">{addSubcategoryDialog.parentPath.join(' → ')}</code>
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          <Input
            placeholder="Subcategory name"
            value={newSubcategoryName}
            onChange={(e) => setNewSubcategoryName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && newSubcategoryName.trim() && addSubcategoryDialog.categoryKey) {
                addSubcategoryMutation.mutate({
                  category: addSubcategoryDialog.categoryKey,
                  parentPath: addSubcategoryDialog.parentPath,
                  name: newSubcategoryName.trim(),
                });
                setNewSubcategoryName('');
                setAddSubcategoryDialog({ open: false, categoryKey: null, parentPath: [], parentName: '' });
              }
            }}
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddSubcategoryDialog({ open: false, categoryKey: null, parentPath: [], parentName: '' })}>
              Cancel
            </Button>
            <Button 
              onClick={() => {
                if (newSubcategoryName.trim() && addSubcategoryDialog.categoryKey) {
                  addSubcategoryMutation.mutate({
                    category: addSubcategoryDialog.categoryKey,
                    parentPath: addSubcategoryDialog.parentPath,
                    name: newSubcategoryName.trim(),
                  });
                  setNewSubcategoryName('');
                  setAddSubcategoryDialog({ open: false, categoryKey: null, parentPath: [], parentName: '' });
                }
              }} 
              disabled={!newSubcategoryName.trim()}
            >
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename Subcategory Dialog */}
      <Dialog open={renameSubcategoryDialog.open} onOpenChange={(open) => setRenameSubcategoryDialog({ ...renameSubcategoryDialog, open })}>
        <DialogContent className="bg-background border-border">
          <DialogHeader>
            <DialogTitle>Rename Subcategory</DialogTitle>
            <DialogDescription>
              Renaming: "{renameSubcategoryDialog.currentName}"
            </DialogDescription>
          </DialogHeader>
          <Input
            placeholder="New name"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && renameValue.trim() && renameSubcategoryDialog.categoryKey) {
                renameSubcategoryMutation.mutate({
                  category: renameSubcategoryDialog.categoryKey,
                  subcategoryKey: renameSubcategoryDialog.subcategoryKey,
                  newName: renameValue.trim(),
                });
                setRenameValue('');
                setRenameSubcategoryDialog({ open: false, categoryKey: null, subcategoryKey: '', currentName: '' });
              }
            }}
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameSubcategoryDialog({ open: false, categoryKey: null, subcategoryKey: '', currentName: '' })}>
              Cancel
            </Button>
            <Button 
              onClick={() => {
                if (renameValue.trim() && renameSubcategoryDialog.categoryKey) {
                  renameSubcategoryMutation.mutate({
                    category: renameSubcategoryDialog.categoryKey,
                    subcategoryKey: renameSubcategoryDialog.subcategoryKey,
                    newName: renameValue.trim(),
                  });
                  setRenameValue('');
                  setRenameSubcategoryDialog({ open: false, categoryKey: null, subcategoryKey: '', currentName: '' });
                }
              }} 
              disabled={!renameValue.trim()}
            >
              Rename
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Subcategory Dialog */}
      <Dialog open={deleteSubcategoryDialog.open} onOpenChange={(open) => setDeleteSubcategoryDialog({ ...deleteSubcategoryDialog, open })}>
        <DialogContent className="bg-background border-border">
          <DialogHeader>
            <DialogTitle>Delete Subcategory?</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete "{deleteSubcategoryDialog.subcategoryName}"?
              This subcategory contains {deleteSubcategoryDialog.tagCount} tags.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">What would you like to do with the tags?</p>
            <div className="flex flex-col gap-2">
              <Button 
                variant="outline" 
                className="justify-start"
                onClick={() => {
                  if (deleteSubcategoryDialog.categoryKey) {
                    deleteSubcategoryMutation.mutate({
                      category: deleteSubcategoryDialog.categoryKey,
                      subcategoryKey: deleteSubcategoryDialog.subcategoryKey,
                      action: 'move_to_parent',
                    });
                    setDeleteSubcategoryDialog({ open: false, categoryKey: null, subcategoryKey: '', subcategoryName: '', tagCount: 0 });
                  }
                }}
              >
                Move tags to parent category
              </Button>
              <Button 
                variant="destructive" 
                className="justify-start"
                onClick={() => {
                  if (deleteSubcategoryDialog.categoryKey) {
                    deleteSubcategoryMutation.mutate({
                      category: deleteSubcategoryDialog.categoryKey,
                      subcategoryKey: deleteSubcategoryDialog.subcategoryKey,
                      action: 'delete',
                    });
                    setDeleteSubcategoryDialog({ open: false, categoryKey: null, subcategoryKey: '', subcategoryName: '', tagCount: 0 });
                  }
                }}
              >
                Delete subcategory and all tags
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteSubcategoryDialog({ open: false, categoryKey: null, subcategoryKey: '', subcategoryName: '', tagCount: 0 })}>
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
