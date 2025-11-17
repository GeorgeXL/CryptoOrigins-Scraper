import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import {
  GripVertical,
  Tag,
  Move,
  Merge,
  Search,
  RefreshCw,
  AlertCircle,
  ChevronRight,
  ChevronDown,
} from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

interface TagWithMetadata {
  id: string;
  name: string;
  category: string;
  parentTagId: string | null;
  normalizedName: string | null;
  usageCount: number;
  children: TagWithMetadata[];
  similarTags: Array<{ name: string; category?: string; similarity: number }>;
}

interface TagManagerData {
  tags: TagWithMetadata[];
  byCategory: Record<string, TagWithMetadata[]>;
  totalTags: number;
}

function SortableTagItem({
  tag,
  allTags,
  onMove,
  onNest,
  onMerge,
}: {
  tag: TagWithMetadata;
  allTags: TagWithMetadata[];
  onMove: (tagId: string, newCategory: string) => void;
  onNest: (tagId: string, parentTagId: string | null) => void;
  onMerge: (sourceTagId: string, targetTagId: string) => void;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [showMoveDialog, setShowMoveDialog] = useState(false);
  const [showNestDialog, setShowNestDialog] = useState(false);
  const [showMergeDialog, setShowMergeDialog] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState(tag.category);
  const [selectedParentTag, setSelectedParentTag] = useState<string>("");
  const [selectedMergeTarget, setSelectedMergeTarget] = useState<string>("");

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

  const categories = ["crypto", "company", "country", "organization", "person", "protocol", "topic", "system"];

  return (
    <div ref={setNodeRef} style={style} className="mb-2">
      <div className="flex items-center gap-2 p-3 bg-white border rounded-lg hover:shadow-md transition-shadow">
        <div
          {...attributes}
          {...listeners}
          className="cursor-grab active:cursor-grabbing text-slate-400 hover:text-slate-600"
        >
          <GripVertical className="w-4 h-4" />
        </div>

        <div className="flex-1 flex items-center gap-2">
          <Badge variant="outline" className="font-medium">
            {tag.name}
          </Badge>
          <Badge variant="secondary" className="text-xs">
            {tag.category}
          </Badge>
          <span className="text-sm text-slate-500">
            {tag.usageCount} uses
          </span>
          {tag.similarTags.length > 0 && (
            <Badge variant="outline" className="text-xs bg-yellow-50 text-yellow-700 border-yellow-300">
              {tag.similarTags.length} similar
            </Badge>
          )}
        </div>

        <div className="flex items-center gap-1">
          {tag.children.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsExpanded(!isExpanded)}
            >
              {isExpanded ? (
                <ChevronDown className="w-4 h-4" />
              ) : (
                <ChevronRight className="w-4 h-4" />
              )}
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowMoveDialog(true)}
            title="Move to category"
          >
            <Move className="w-4 h-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowNestDialog(true)}
            title="Nest under parent"
          >
            <Tag className="w-4 h-4" />
          </Button>
          {tag.similarTags.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowMergeDialog(true)}
              title="Merge with similar tag"
            >
              <Merge className="w-4 h-4" />
            </Button>
          )}
        </div>
      </div>

      {/* Similar tags indicator */}
      {tag.similarTags.length > 0 && (
        <div className="ml-8 mt-1 mb-2 text-xs text-slate-500">
          Similar: {tag.similarTags.slice(0, 3).map(s => s.name).join(", ")}
          {tag.similarTags.length > 3 && ` +${tag.similarTags.length - 3} more`}
        </div>
      )}

      {/* Children (nested tags) */}
      {isExpanded && tag.children.length > 0 && (
        <div className="ml-8 mt-2 space-y-2">
          {tag.children.map((child) => (
            <div key={child.id} className="pl-4 border-l-2 border-slate-200">
              <SortableTagItem
                tag={child}
                allTags={allTags}
                onMove={onMove}
                onNest={onNest}
                onMerge={onMerge}
              />
            </div>
          ))}
        </div>
      )}

      {/* Move Dialog */}
      <Dialog open={showMoveDialog} onOpenChange={setShowMoveDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Move Tag to Category</DialogTitle>
            <DialogDescription>
              Move "{tag.name}" to a different category
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>New Category</Label>
              <Select value={selectedCategory} onValueChange={setSelectedCategory}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((cat) => (
                    <SelectItem key={cat} value={cat}>
                      {cat}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowMoveDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                onMove(tag.id, selectedCategory);
                setShowMoveDialog(false);
              }}
            >
              Move
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Nest Dialog */}
      <Dialog open={showNestDialog} onOpenChange={setShowNestDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nest Tag Under Parent</DialogTitle>
            <DialogDescription>
              Make "{tag.name}" a child of another tag
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Parent Tag (leave empty to unnest)</Label>
              <Select value={selectedParentTag} onValueChange={setSelectedParentTag}>
                <SelectTrigger>
                  <SelectValue placeholder="Select parent tag or leave empty" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">None (unnest)</SelectItem>
                  {allTags
                    .filter((t) => t.id !== tag.id && !t.parentTagId) // Can't nest under itself or nested tags
                    .map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name} ({t.category})
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNestDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                onNest(tag.id, selectedParentTag || null);
                setShowNestDialog(false);
              }}
            >
              Nest
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Merge Dialog */}
      <Dialog open={showMergeDialog} onOpenChange={setShowMergeDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Merge Tags</DialogTitle>
            <DialogDescription>
              Merge "{tag.name}" into another tag. This will replace all occurrences.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Target Tag (merge into)</Label>
              <Select value={selectedMergeTarget} onValueChange={setSelectedMergeTarget}>
                <SelectTrigger>
                  <SelectValue placeholder="Select target tag" />
                </SelectTrigger>
                <SelectContent>
                  {tag.similarTags
                    .map((similar) => {
                      // Find the actual tag ID from allTags
                      const targetTag = allTags.find(
                        (t) => t.name === similar.name && t.category === similar.category
                      );
                      return targetTag
                        ? { ...similar, id: targetTag.id }
                        : null;
                    })
                    .filter((t): t is typeof t & { id: string } => t !== null)
                    .map((similar) => (
                      <SelectItem key={similar.id} value={similar.id}>
                        {similar.name} ({similar.category}) - {Math.round(similar.similarity * 100)}% similar
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowMergeDialog(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (selectedMergeTarget) {
                  onMerge(tag.id, selectedMergeTarget);
                  setShowMergeDialog(false);
                }
              }}
            >
              Merge
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function TagManager() {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Fetch tag management data
  const { data, isLoading, error, refetch } = useQuery<TagManagerData>({
    queryKey: ["/api/tags/manage"],
    queryFn: async () => {
      const response = await fetch("/api/tags/manage");
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to fetch tags");
      }
      return response.json();
    },
  });

  // Initialize tag metadata mutation
  const initializeMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/tags/initialize", { method: "POST" });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to initialize tags");
      }
      const data = await response.json();
      return data;
    },
    onSuccess: (data) => {
      toast({
        title: "Tags initialized",
        description: `Successfully initialized ${data.inserted} tags from existing analyses.`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/tags/manage"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tags/catalog"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Move tag mutation
  const moveMutation = useMutation({
    mutationFn: async ({ tagId, newCategory }: { tagId: string; newCategory: string }) => {
      const response = await fetch("/api/tags/move", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tagId, newCategory }),
      });
      if (!response.ok) throw new Error("Failed to move tag");
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Tag moved",
        description: "Tag has been moved to the new category.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/tags/manage"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tags/catalog"] });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Nest tag mutation
  const nestMutation = useMutation({
    mutationFn: async ({ tagId, parentTagId }: { tagId: string; parentTagId: string | null }) => {
      const response = await fetch("/api/tags/nest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tagId, parentTagId }),
      });
      if (!response.ok) throw new Error("Failed to nest tag");
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Tag nested",
        description: "Tag hierarchy has been updated.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/tags/manage"] });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Merge tag mutation
  const mergeMutation = useMutation({
    mutationFn: async ({ sourceTagId, targetTagId }: { sourceTagId: string; targetTagId: string }) => {
      const response = await fetch("/api/tags/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceTagId, targetTagId }),
      });
      if (!response.ok) throw new Error("Failed to merge tags");
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Tags merged",
        description: "Tags have been merged successfully.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/tags/manage"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tags/catalog"] });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    // Handle drag and drop logic here
    // For now, this is a placeholder - you'd implement category change or nesting
    console.log("Drag end:", active.id, "to", over.id);
  };

  const handleMove = (tagId: string, newCategory: string) => {
    moveMutation.mutate({ tagId, newCategory });
  };

  const handleNest = (tagId: string, parentTagId: string | null) => {
    nestMutation.mutate({ tagId, parentTagId });
  };

  const handleMerge = (sourceTagId: string, targetTagId: string) => {
    mergeMutation.mutate({ sourceTagId, targetTagId });
  };

  // Filter tags
  const filteredTags = data?.tags.filter((tag) => {
    if (searchQuery && !tag.name.toLowerCase().includes(searchQuery.toLowerCase())) {
      return false;
    }
    if (selectedCategory !== "all" && tag.category !== selectedCategory) {
      return false;
    }
    return true;
  }) || [];

  const categories = ["all", "crypto", "company", "country", "organization", "person", "protocol", "topic", "system"];

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Tag Manager</h1>
          <p className="text-slate-600 mt-1">
            Manage tags, create hierarchies, and merge similar tags
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => initializeMutation.mutate()}
            disabled={initializeMutation.isPending}
          >
            {initializeMutation.isPending ? (
              <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4 mr-2" />
            )}
            Initialize Tags
          </Button>
          <Button variant="outline" onClick={() => refetch()}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-4">
            <div className="flex-1">
              <Label>Search</Label>
              <div className="relative">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-slate-400" />
                <Input
                  placeholder="Search tags..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-8"
                />
              </div>
            </div>
            <div className="w-48">
              <Label>Category</Label>
              <Select value={selectedCategory} onValueChange={setSelectedCategory}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((cat) => (
                    <SelectItem key={cat} value={cat}>
                      {cat === "all" ? "All Categories" : cat}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Tags List */}
      <Card>
        <CardHeader>
          <CardTitle>
            Tags ({data?.totalTags || 0})
          </CardTitle>
          <CardDescription>
            Drag tags to reorganize, or use buttons to move, nest, or merge
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8 text-slate-500">Loading tags...</div>
          ) : error ? (
            <div className="text-center py-8">
              <AlertCircle className="w-12 h-12 mx-auto text-red-400 mb-4" />
              <p className="text-red-600 mb-2">Error loading tags</p>
              <p className="text-sm text-slate-500 mb-4">{error.message}</p>
              <Button onClick={() => refetch()}>Retry</Button>
            </div>
          ) : !data || data.tags.length === 0 ? (
            <div className="text-center py-8">
              <AlertCircle className="w-12 h-12 mx-auto text-slate-400 mb-4" />
              <p className="text-slate-600 mb-2">No tags found in metadata table.</p>
              <p className="text-sm text-slate-500 mb-4">
                Click "Initialize Tags" to populate the tag metadata from existing analyses.
              </p>
              <Button 
                onClick={() => initializeMutation.mutate()}
                disabled={initializeMutation.isPending}
              >
                {initializeMutation.isPending ? (
                  <>
                    <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                    Initializing...
                  </>
                ) : (
                  "Initialize Tags"
                )}
              </Button>
            </div>
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={filteredTags.map((t) => t.id)}
                strategy={verticalListSortingStrategy}
              >
                <div className="space-y-2">
                  {filteredTags
                    .filter((tag) => !tag.parentTagId) // Only show top-level tags
                    .map((tag) => (
                      <SortableTagItem
                        key={tag.id}
                        tag={tag}
                        allTags={data?.tags || []}
                        onMove={handleMove}
                        onNest={handleNest}
                        onMerge={handleMerge}
                      />
                    ))}
                </div>
              </SortableContext>
            </DndContext>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

