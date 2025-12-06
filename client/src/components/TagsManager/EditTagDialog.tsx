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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Edit2, Loader2 } from 'lucide-react';
import { TAXONOMY_TREE, getTaxonomyLabel } from '@shared/taxonomy';
import { useQuery } from '@tanstack/react-query';

interface EditTagDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tag: { 
    name: string; 
    category: string; 
    count: number;
    subcategoryPath?: string[];
  } | null;
  onConfirm: (data: { newName?: string; newCategory?: string; newSubcategoryPath?: string[] }) => void;
  isLoading?: boolean;
}

// Get all categories from taxonomy
const CATEGORIES = TAXONOMY_TREE.map(node => ({
  key: node.key,
  name: node.name,
  emoji: node.emoji || '',
}));

// Get subcategories for a given category
function getSubcategoriesForCategory(categoryKey: string): Array<{ key: string; name: string; path: string[] }> {
  const category = TAXONOMY_TREE.find(c => c.key === categoryKey);
  if (!category) return [];

  const subcategories: Array<{ key: string; name: string; path: string[] }> = [];

  function traverse(node: typeof category, path: string[] = []) {
    if (!node) return;
    if (node.children) {
      for (const child of node.children) {
        const newPath = [...path, child.key];
        subcategories.push({
          key: child.key,
          name: child.name,
          path: newPath,
        });
        if (child.children) {
          traverse(child, newPath);
        }
      }
    }
  }

  traverse(category);
  return subcategories;
}

export function EditTagDialog({
  open,
  onOpenChange,
  tag,
  onConfirm,
  isLoading = false,
}: EditTagDialogProps) {
  const [newName, setNewName] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [selectedSubcategoryPath, setSelectedSubcategoryPath] = useState<string[]>([]);
  const [availableSubcategories, setAvailableSubcategories] = useState<Array<{ key: string; name: string; path: string[] }>>([]);

  // Fetch tag details including subcategoryPath
  const { data: tagDetails } = useQuery({
    queryKey: ['tag-details', tag?.name, tag?.category],
    queryFn: async () => {
      if (!tag) return null;
      const response = await fetch(`/api/tags-manager/details?tagName=${encodeURIComponent(tag.name)}&category=${encodeURIComponent(tag.category)}`);
      if (!response.ok) return null;
      return await response.json();
    },
    enabled: !!tag && open,
    staleTime: 0,
  });

  useEffect(() => {
    if (tag) {
      setNewName(tag.name);
      setSelectedCategory(tag.category);
      // Use fetched subcategoryPath or fallback to tag.subcategoryPath
      const path = tagDetails?.subcategoryPath || tag.subcategoryPath || [];
      setSelectedSubcategoryPath(Array.isArray(path) ? path : []);
    }
  }, [tag, tagDetails]);

  useEffect(() => {
    if (selectedCategory) {
      const subcats = getSubcategoriesForCategory(selectedCategory);
      setAvailableSubcategories(subcats);
      // If current path doesn't match new category, reset it
      if (tag?.subcategoryPath && tag.subcategoryPath.length > 0 && selectedCategory !== tag.category) {
        setSelectedSubcategoryPath([]);
      } else if (selectedCategory === tag?.category && tag?.subcategoryPath) {
        // Keep the current path if category hasn't changed
        setSelectedSubcategoryPath(tag.subcategoryPath);
      }
    } else {
      setAvailableSubcategories([]);
      setSelectedSubcategoryPath([]);
    }
  }, [selectedCategory, tag]);

  if (!tag) return null;

  const handleConfirm = () => {
    const changes: { newName?: string; newCategory?: string; newSubcategoryPath?: string[] } = {};
    
    if (newName.trim() && newName !== tag.name) {
      changes.newName = newName.trim();
    }
    
    if (selectedCategory && selectedCategory !== tag.category) {
      changes.newCategory = selectedCategory;
    }
    
    if (selectedSubcategoryPath.length > 0) {
      changes.newSubcategoryPath = selectedSubcategoryPath;
    } else if (selectedCategory && selectedCategory !== tag.category) {
      // If category changed but no subcategory selected, use root of category
      changes.newSubcategoryPath = [];
    }

    if (Object.keys(changes).length > 0) {
      onConfirm(changes);
    }
  };

  const hasChanges = 
    (newName.trim() && newName !== tag.name) ||
    (selectedCategory && selectedCategory !== tag.category) ||
    (selectedSubcategoryPath.length > 0 && JSON.stringify(selectedSubcategoryPath) !== JSON.stringify(tag.subcategoryPath || []));

  const currentCategoryMeta = CATEGORIES.find(c => c.key === tag.category);
  const selectedCategoryMeta = CATEGORIES.find(c => c.key === selectedCategory);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[550px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Edit2 className="w-5 h-5 text-blue-500" />
            Edit Tag
          </DialogTitle>
          <DialogDescription>
            Update the name, category, or subcategory path for this tag.
          </DialogDescription>
        </DialogHeader>

        <div className="py-4 space-y-4">
          {/* Current Tag Info */}
          <div className="p-3 bg-slate-50 rounded-lg">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-sm font-medium text-slate-600">Current Tag:</span>
              <span className="font-semibold text-slate-900">{tag.name}</span>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="outline" className="text-xs">
                {currentCategoryMeta?.emoji} {currentCategoryMeta?.name || tag.category}
              </Badge>
              {tag.subcategoryPath && tag.subcategoryPath.length > 0 && (
                <Badge variant="secondary" className="text-xs">
                  {tag.subcategoryPath.map(key => getTaxonomyLabel(key)).filter(Boolean).join(' > ') || tag.subcategoryPath.join(' > ')}
                </Badge>
              )}
              <Badge variant="secondary" className="text-xs">
                {tag.count} occurrences
              </Badge>
            </div>
          </div>

          {/* Tag Name */}
          <div className="space-y-2">
            <Label htmlFor="tag-name">Tag Name</Label>
            <Input
              id="tag-name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Enter tag name"
              disabled={isLoading}
              autoFocus
            />
          </div>

          {/* Category */}
          <div className="space-y-2">
            <Label htmlFor="category">Category</Label>
            <Select
              value={selectedCategory}
              onValueChange={setSelectedCategory}
              disabled={isLoading}
            >
              <SelectTrigger id="category">
                <SelectValue placeholder="Select category">
                  {selectedCategoryMeta && (
                    <span>{selectedCategoryMeta.emoji} {selectedCategoryMeta.name}</span>
                  )}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {CATEGORIES.map(cat => (
                  <SelectItem key={cat.key} value={cat.key}>
                    {cat.emoji} {cat.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Subcategory Path */}
          {selectedCategory && availableSubcategories.length > 0 && (
            <div className="space-y-2">
              <Label htmlFor="subcategory">Subcategory Path (Optional)</Label>
              <Select
                value={selectedSubcategoryPath.join(' > ') || 'none'}
                onValueChange={(value) => {
                  if (value === 'none') {
                    setSelectedSubcategoryPath([]);
                  } else {
                    // Find the subcategory that matches
                    const subcat = availableSubcategories.find(s => 
                      s.path.join(' > ') === value || s.key === value
                    );
                    if (subcat) {
                      setSelectedSubcategoryPath(subcat.path);
                    }
                  }
                }}
                disabled={isLoading}
              >
                <SelectTrigger id="subcategory">
                  <SelectValue placeholder="Select subcategory (optional)">
                    {selectedSubcategoryPath.length > 0
                      ? selectedSubcategoryPath.map(key => getTaxonomyLabel(key)).filter(Boolean).join(' > ') || selectedSubcategoryPath.join(' > ')
                      : 'None (root of category)'}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None (root of category)</SelectItem>
                  {availableSubcategories.map(subcat => (
                    <SelectItem 
                      key={subcat.path.join(' > ')} 
                      value={subcat.path.join(' > ')}
                    >
                      {subcat.path.map(key => getTaxonomyLabel(key)).filter(Boolean).join(' > ') || subcat.path.join(' > ')}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-slate-500">
                Leave as "None" to place the tag at the root of the selected category.
              </p>
            </div>
          )}

          <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
            <p className="text-sm text-blue-900">
              This will update {tag.count} analyses with the new tag information.
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
            disabled={isLoading || !hasChanges}
          >
            {isLoading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Updating...
              </>
            ) : (
              'Update Tag'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

