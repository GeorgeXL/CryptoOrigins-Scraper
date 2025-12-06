import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { 
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { 
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { 
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AnalysesTable } from "@/components/AnalysesTable";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { 
  Tag, 
  Search, 
  Filter,
  Calendar,
  Building,
  User,
  Globe,
  Coins,
  ChevronDown,
  ChevronRight,
  Check,
  Plus,
  Minus,
  X,
  Building2,
  Sparkles,
  Hash,
  Copy,
  ExternalLink,
  Pencil,
  Trash2,
  Bot,
  StopCircle,
  Loader2,
  RefreshCw,
  FileText,
  Tags
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { SiOpenai } from "react-icons/si";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabase";
import { Link } from "wouter";
import { EditTagDialog } from "@/components/TagsManager/EditTagDialog";
import { DeleteDialog } from "@/components/TagsManager/DeleteDialog";
import { getCategoryDisplayMeta } from "@shared/taxonomy";
import { TagsSidebar } from "@/components/TagsSidebar";
import {
  SidebarProvider,
} from "@/components/ui/sidebar";
import { getTagCategory as getTagCategoryUtil, getCategoryIcon, getCategoryColor } from "@/utils/tagHelpers";

// Main category type definition
export type MainCategory = 
  | 'bitcoin'
  | 'money-economics'
  | 'technology'
  | 'organizations'
  | 'people'
  | 'regulation-law'
  | 'markets-geography'
  | 'education-community'
  | 'crime-security'
  | 'topics'
  | 'miscellaneous';

interface EntityTag {
  name: string;
  category: string;
}

// For tags_version2, we just have tag names as strings
type TagName = string;

interface HistoricalNewsAnalysis {
  date: string;
  summary: string;
  tags?: EntityTag[] | null; // Old tags column (deprecated)
  tags_version2?: string[] | null; // New tags column - array of tag names
  tier?: number;
  url?: string;
  source_url?: string;
  isManualOverride?: boolean;
}

const PAGE_SIZE_OPTIONS = [50, 200, 500];

export default function HomePage() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  
  // View mode state - toggle between Keywords and Topics
  const [viewMode, setViewMode] = useState<'keywords' | 'topics'>('keywords');
  const [pageSize, setPageSize] = useState(50);
  
  const [selectedEntities, setSelectedEntities] = useState<Set<string>>(new Set());
  const [showUntagged, setShowUntagged] = useState(false);
  
  // Date list state
  const [selectedDates, setSelectedDates] = useState<Set<string>>(new Set());
  const [currentPage, setCurrentPage] = useState(1);
  const [selectAllMatching, setSelectAllMatching] = useState(false);
  
  // Search and modal state
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState("");

  // New state for the copy dialog
  const [showCopyDialog, setShowCopyDialog] = useState(false);
  const [textToCopy, setTextToCopy] = useState("");

  // State for edit/delete tag dialogs
  const [showRenameDialog, setShowRenameDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [tagToEdit, setTagToEdit] = useState<{ name: string; category: string; count: number; subcategoryPath?: string[] } | null>(null);

  // Debounce search query - only update after user stops typing for 300ms
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
      setCurrentPage(1); // Reset to first page when search changes
    }, 300);

    return () => clearTimeout(timer);
  }, [searchQuery]);
  
  // Bulk operations state
  const [showBulkAdd, setShowBulkAdd] = useState(false);
  const [showBulkRemove, setShowBulkRemove] = useState(false);
  const [showManageTags, setShowManageTags] = useState(false);
  const [bulkTagName, setBulkTagName] = useState("");
  const [bulkTagCategory, setBulkTagCategory] = useState("crypto");
  const [isReanalyzing, setIsReanalyzing] = useState(false);
  const [isCategorizing, setIsCategorizing] = useState(false);

  // Fetch flat tags from new v2 endpoint for frontend grouping
  const { data: catalogV2Data, error: catalogError } = useQuery<{
    tags: { name: string; count: number }[];
    taggedCount: number;
    untaggedCount: number;
    totalAnalyses: number;
  }>({
    queryKey: ['tags-catalog-v2'],
    queryFn: async () => {
      const response = await fetch(`/api/tags/catalog-v2`);
      if (!response.ok) {
        const errorText = await response.text();
        console.error('Catalog v2 API error:', response.status, errorText);
        throw new Error(`Failed to fetch catalog: ${response.statusText}`);
      }
      const data = await response.json();
      console.log('Catalog v2 data received:', {
        tagCount: data.tags?.length || 0,
        taggedCount: data.taggedCount
      });
      return data;
    },
    retry: 1,
  });

  // Fetch tag filter tree from normalized tags table
  const { data: filterTreeData, refetch: refetchFilterTree } = useQuery<{
    categories: any[];
    totalTags: number;
    builtFrom?: string;
  }>({
    queryKey: ['tags-filter-tree'],
    queryFn: async () => {
      const response = await fetch('/api/tags/filter-tree');
      if (!response.ok) {
        throw new Error('Failed to fetch filter tree');
      }
      return response.json();
    },
    staleTime: 0, // Always refetch when invalidated (was 1 hour, but need immediate updates after deletes)
    refetchOnMount: true, // Always refetch when component mounts
  });

  // Fallback to old hierarchy endpoint if filter-tree is not available
  const { data: hierarchyData } = useQuery<{
    categories: any[];
    totalTags: number;
  }>({
    queryKey: ['tags-hierarchy'],
    queryFn: async () => {
      const response = await fetch('/api/tags/hierarchy');
      if (!response.ok) {
        throw new Error('Failed to fetch hierarchy');
      }
      return response.json();
    },
    staleTime: 1000 * 60 * 60,
    enabled: !filterTreeData, // Only fetch if filter-tree is not available
  });

  // Use filter-tree data if available, otherwise fall back to hierarchy
  const hierarchyDataToUse = filterTreeData || hierarchyData;

  // Map main category names to display names (New 14-Category Taxonomy)
  const categoryDisplayNames: Record<MainCategory, string> = {
    'bitcoin': '🪙 Bitcoin',
    'money-economics': '💰 Money & Economics',
    'technology': '⚡ Technology Concepts',
    'organizations': '🏢 Organizations & Companies',
    'people': '👥 People',
    'regulation-law': '⚖️ Regulation & Government',
    'markets-geography': '🌍 Geography & Markets',
    'education-community': '🎓 Education & Community',
    'crime-security': '🔒 Crime & Security',
    'topics': '🏷️ Topics & Themes',
    'miscellaneous': '📝 Miscellaneous'
  };

  // Frontend grouping logic - Uses filter tree from normalized tags table
  const catalogData = useMemo(() => {
    if (!hierarchyDataToUse?.categories) return null;

    const entitiesByCategory: Record<string, any[]> = {};
    
    // Process each main category directly from the backend response
    hierarchyDataToUse.categories.forEach((category: any) => {
      const categoryKey = category.category; 
      
      // Build subcategory structure with counts recursively
      const buildSubcategoryDisplay = (node: any): any => {
        const children: any[] = [];
        let totalCount = node.totalTags || 0;
        
        // Process subcategories
        if (node.subcategories && Object.keys(node.subcategories).length > 0) {
          Object.values(node.subcategories).forEach((subcat: any) => {
            const subResult = buildSubcategoryDisplay(subcat);
            if (subResult) {
              children.push(subResult);
            }
          });
        }
        
        // Process tags at this level
        if (node.tags && Array.isArray(node.tags)) {
          node.tags.forEach((tag: any) => {
            children.push({
              name: tag.name,
              category: categoryKey,
              count: tag.usageCount || 0,
              isTag: true
            });
          });
        }
        
        // Sort children: subcategories first, then tags, both alphabetical
        children.sort((a, b) => {
          if (a.isTag && !b.isTag) return 1;
          if (!a.isTag && b.isTag) return -1;
          return a.name.localeCompare(b.name);
        });
        
        if (children.length === 0) return null;
        
        return {
          category: categoryKey,
          name: node.name,
          count: totalCount,
          isParent: true,
          children
        };
      };
      
      // Build category items
      const categoryItems: any[] = [];
      
      // Add tags at the root of the category
      if (category.tags && Array.isArray(category.tags)) {
        category.tags.forEach((tag: any) => {
          categoryItems.push({
            name: tag.name,
            category: categoryKey,
            count: tag.usageCount || 0,
            isTag: true
          });
        });
      }
      
      // Add subcategories
      if (category.subcategories) {
        Object.values(category.subcategories).forEach((subcat: any) => {
          const result = buildSubcategoryDisplay(subcat);
          if (result) {
            categoryItems.push(result);
          }
        });
      }
      
      // Sort root items
      categoryItems.sort((a, b) => {
        if (a.isTag && !b.isTag) return 1;
        if (!a.isTag && b.isTag) return -1;
        return a.name.localeCompare(b.name);
      });
      
      if (categoryItems.length > 0) {
        entitiesByCategory[categoryKey] = categoryItems;
      }
    });
    
    return {
      entitiesByCategory,
      taggedCount: catalogV2Data?.taggedCount || 0,
      untaggedCount: catalogV2Data?.untaggedCount || 0,
      totalAnalyses: catalogV2Data?.totalAnalyses || 0
    };
  }, [catalogV2Data, hierarchyDataToUse]);


  // Fetch filtered analyses with server-side filtering and pagination
  const { data: analysesData, isLoading, refetch } = useQuery<{
    analyses: HistoricalNewsAnalysis[];
    pagination: {
      currentPage: number;
      pageSize: number;
      totalCount: number;
      totalPages: number;
    };
  }>({
    queryKey: ['supabase-tags-analyses', Array.from(selectedEntities).sort().join(','), showUntagged, debouncedSearchQuery, currentPage, pageSize],
    refetchOnMount: true,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      if (!supabase) throw new Error("Supabase not configured");

      // Build base query - use tags_version2 instead of tags
      let query = supabase
        .from("historical_news_analyses")
        .select("date, summary, tags_version2, tier_used, is_manual_override", { count: "exact" });

      // Apply filters
      if (showUntagged) {
        // Filter for untagged: tags is null or empty array
        // Since Supabase doesn't have a good way to filter for empty JSONB arrays,
        // we'll fetch all and filter client-side
        // query = query.or(`tags.is.null,tags.eq.[]`);
      } else if (selectedEntities.size > 0) {
        // Filter by selected entities
        // We'll fetch all and filter client-side since JSONB array filtering is complex
        // Don't apply any server-side filter here
      }

      if (debouncedSearchQuery) {
        // Search in summary only (date is a date type, not text, so we can't use ilike on it directly)
        // If you want to search by date, the user should type in YYYY-MM-DD format
        query = query.ilike("summary", `%${debouncedSearchQuery}%`);
      }

      // Order by date
      query = query.order("date", { ascending: false });

      let analyses: any[] = [];
      let totalCount: number | null = null;

      // If we're doing client-side filtering (untagged or entity selection),
      // we need to fetch ALL results to properly filter
      const needsClientSideFiltering = showUntagged || selectedEntities.size > 0;
      
      if (needsClientSideFiltering) {
        // Fetch all results in batches
        let allAnalyses: any[] = [];
        let batchStart = 0;
        const batchSize = 1000;
        
        while (true) {
          const { data: batch, error } = await query.range(batchStart, batchStart + batchSize - 1);
          if (error) throw error;
          if (!batch || batch.length === 0) break;
          
          allAnalyses = allAnalyses.concat(batch);
          if (batch.length < batchSize) break;
          batchStart += batchSize;
        }
        
        analyses = allAnalyses;
        totalCount = allAnalyses.length;
      } else {
        // Apply pagination at the database level for non-filtered queries
        const from = (currentPage - 1) * pageSize;
        const to = from + pageSize - 1;
        
        query = query.range(from, to);
      
        const { data, error, count } = await query;
        if (error) throw error;
        
        analyses = data || [];
        totalCount = count;
      }

      console.log('📊 Analyses Query Result:', JSON.stringify({
        analysesCount: analyses?.length,
        totalCount,
        showUntagged,
        selectedEntitiesCount: selectedEntities.size,
        needsClientSideFiltering,
        firstAnalysisDate: analyses?.[0]?.date,
        firstAnalysisTags: analyses?.[0]?.tags_version2
      }, null, 2));

      // Client-side filtering for untagged and entity selection (since JSONB array filtering is complex)
      let filteredAnalyses = analyses || [];
      
      // Filter for untagged - check tags_version2
      if (showUntagged) {
        filteredAnalyses = filteredAnalyses.filter(analysis => 
          !analysis.tags_version2 || analysis.tags_version2.length === 0
        );
      }
      
      if (selectedEntities.size > 0 && !showUntagged) {
        filteredAnalyses = filteredAnalyses.filter(analysis => {
          if (!analysis.tags_version2 || !Array.isArray(analysis.tags_version2)) return false;
          return Array.from(selectedEntities).some(entityKey => {
            const [category, name] = entityKey.split("::");
            // Match by tag name from tags_version2 array
            return analysis.tags_version2.includes(name);
          });
        });
      }

      // Apply pagination after client-side filtering
      const startIndex = (currentPage - 1) * pageSize;
      const endIndex = startIndex + pageSize;
      const paginatedAnalyses = filteredAnalyses.slice(startIndex, endIndex);
      
      // If we did client-side filtering, use the filtered count
      // Otherwise use the totalCount from Supabase query (which includes count: "exact")
      const actualTotalCount = needsClientSideFiltering ? filteredAnalyses.length : (totalCount || filteredAnalyses.length);
      const totalPages = Math.ceil(actualTotalCount / pageSize);

      console.log('📦 Received:', paginatedAnalyses.length, 'analyses, filtered total:', actualTotalCount);

      return {
        analyses: paginatedAnalyses,
        pagination: {
          currentPage,
          pageSize,
          totalCount: actualTotalCount,
          totalPages
        }
      };
    },
  });

  // Extract data from responses
  const allCategoryData = catalogData 
    ? Object.entries(catalogData.entitiesByCategory)
        .map(([category, entities]) => ({
          category,
          entities: entities.sort((a, b) => b.count - a.count),
          totalCount: entities.reduce((sum, e) => sum + e.count, 0)
        }))
        .sort((a, b) => b.totalCount - a.totalCount)
    : [];
  
  // Debug: log available categories
  if (catalogData && allCategoryData.length > 0) {
    console.log('📊 Available categories:', allCategoryData.map(c => c.category));
  }
  
  // Filter categories based on view mode
  // Define category order (Bitcoin first, then others)
  const CATEGORY_ORDER: MainCategory[] = [
    'bitcoin',
    'money-economics',
    'technology',
    'organizations',
    'people',
    'regulation-law',
    'markets-geography',
    'education-community',
    'crime-security',
    'topics',
    'miscellaneous'
  ];
  
  const ENTITY_CATEGORIES: MainCategory[] = CATEGORY_ORDER;
  let categoryData = viewMode === 'keywords'
    ? (allCategoryData || []).filter(({ category }) => ENTITY_CATEGORIES.includes(category as MainCategory))
    : (allCategoryData || []).filter(({ category }) => category.toLowerCase() === 'topics');
  
  // Ensure categoryData is always an array
  if (!Array.isArray(categoryData)) {
    categoryData = [];
  }
  
  // Fallback: if filtering results in empty array but we have data, show all categories
  if (categoryData.length === 0 && allCategoryData && allCategoryData.length > 0) {
    console.warn('⚠️ Filtering removed all categories, showing all categories instead');
    categoryData = allCategoryData;
  }
  
  // Debug: log filtered categories
  if (catalogData) {
    console.log('🔍 Filtered categories:', categoryData.map(c => c.category), 'viewMode:', viewMode);
    console.log('📋 All categories:', allCategoryData.map(c => ({ cat: c.category, count: c.entities.length })));
  }
  
  const paginatedAnalyses = analysesData?.analyses || [];
  const totalPages = analysesData?.pagination.totalPages || 1;
  const totalCount = analysesData?.pagination.totalCount || 0;

  // Helper function to get tag category from tag name using catalogData
  const getTagCategory = (tagName: string): string => {
    return getTagCategoryUtil(tagName, catalogData);
  };


  // Toggle entity selection
  const toggleEntity = (category: string, name: string) => {
    const key = `${category}::${name}`;
    setSelectedEntities(prev => {
      // If the clicked entity is already selected, clear the selection.
      if (prev.has(key)) {
        return new Set();
      }
      // Otherwise, select only this entity.
      return new Set([key]);
    });
    setShowUntagged(false); // Clear untagged view when selecting entities
    setCurrentPage(1); // Reset to first page when filter changes
    setSelectAllMatching(false); // Reset select all matching
  };

  // Select/deselect all on current page
  const toggleSelectAll = () => {
    // If currently selecting all matching, clear everything
    if (selectAllMatching) {
      setSelectAllMatching(false);
      setSelectedDates(new Set());
      return;
    }

    // Check if all items on current page are selected (ignore other pages)
    const allPageSelected = paginatedAnalyses.length > 0 && paginatedAnalyses.every(a => selectedDates.has(a.date));
    
    if (allPageSelected) {
      // Deselect all on current page
      setSelectedDates(prev => {
        const next = new Set(prev);
        paginatedAnalyses.forEach(a => next.delete(a.date));
        return next;
      });
    } else {
      // Select all on current page
      setSelectedDates(prev => {
        const next = new Set(prev);
        paginatedAnalyses.forEach(a => next.add(a.date));
        return next;
      });
    }
  };

  // Toggle individual date selection
  const toggleDateSelection = (date: string) => {
    if (selectAllMatching) {
      setSelectAllMatching(false);
    }
    setSelectedDates(prev => {
      const next = new Set(prev);
      if (next.has(date)) {
        next.delete(date);
      } else {
        next.add(date);
      }
      return next;
    });
  };

  // Helper to fetch all matching dates based on current filters
  const fetchAllMatchingDates = async (): Promise<string[]> => {
    if (!supabase) throw new Error("Supabase not configured");

    let query = supabase
      .from("historical_news_analyses")
      .select("date, tags_version2, summary");

    // Note: For untagged filtering, we'll do it client-side since Supabase doesn't handle empty arrays well
    // if (showUntagged) {
    //   query = query.or("tags_version2.is.null,tags_version2.eq.[]");
    // }

    if (debouncedSearchQuery) {
      query = query.ilike("summary", `%${debouncedSearchQuery}%`);
    }

    const { data: analyses, error } = await query;
    if (error) throw error;

    // Client-side filtering for untagged and entity selection - use tags_version2
    let filteredAnalyses = analyses || [];
    
    if (showUntagged) {
      filteredAnalyses = filteredAnalyses.filter(analysis => 
        !analysis.tags_version2 || analysis.tags_version2.length === 0
      );
    }
    
    if (selectedEntities.size > 0 && !showUntagged) {
      filteredAnalyses = filteredAnalyses.filter(analysis => {
        if (!analysis.tags_version2 || !Array.isArray(analysis.tags_version2)) return false;
        return Array.from(selectedEntities).some(entityKey => {
          const [category, name] = entityKey.split("::");
          // Match by tag name from tags_version2 array
          return analysis.tags_version2.includes(name);
        });
      });
    }

    return filteredAnalyses.map(a => a.date);
  };

  // Bulk add tags mutation
  const bulkAddMutation = useMutation({
    mutationFn: async ({ dates, tag }: { dates: string[]; tag: EntityTag }) => {
      return apiRequest('POST', '/api/tags/bulk-add', { dates, tag });
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['supabase-tags-catalog'] });
      queryClient.invalidateQueries({ queryKey: ['supabase-tags-analyses'] });
      toast({
        title: "Tags Added",
        description: `Successfully added tag to ${variables.dates.length} analyses`,
      });
      setShowBulkAdd(false);
      setBulkTagName("");
      setSelectedDates(new Set());
      setSelectAllMatching(false);
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive"
      });
    }
  });

  // Bulk remove tags mutation
  const bulkRemoveMutation = useMutation({
    mutationFn: async ({ dates, tag }: { dates: string[]; tag: EntityTag }) => {
      return apiRequest('POST', '/api/tags/bulk-remove', { dates, tag });
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['supabase-tags-catalog'] });
      queryClient.invalidateQueries({ queryKey: ['supabase-tags-analyses'] });
      queryClient.invalidateQueries({ queryKey: ['supabase-tags-selected-summaries'] });
      toast({
        title: "Tag Removed",
        description: `Successfully removed tag from ${variables.dates.length} analyses`,
      });
      // Don't close the dialog or clear selection - user might want to remove more tags
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive"
      });
    }
  });

  // Update tag mutation (name, category, subcategory path)
  const updateTagMutation = useMutation({
    mutationFn: async ({ 
      tagName, 
      oldCategory, 
      newName, 
      newCategory, 
      newSubcategoryPath 
    }: { 
      tagName: string; 
      oldCategory: string; 
      newName?: string; 
      newCategory?: string; 
      newSubcategoryPath?: string[] 
    }) => {
      const response = await fetch('/api/tags-manager/update', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          tagName, 
          oldCategory, 
          newName, 
          newCategory, 
          newSubcategoryPath 
        }),
      });

      if (!response.ok) {
        let errorMessage = 'Failed to update tag';
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
        title: 'Tag Updated',
        description: `Tag has been updated in ${data.updated} analyses`,
      });
      await queryClient.invalidateQueries({ queryKey: ['supabase-tags-catalog'] });
      await queryClient.invalidateQueries({ queryKey: ['tags-catalog-v2'] });
      await queryClient.invalidateQueries({ queryKey: ['tags-filter-tree'] });
      await queryClient.invalidateQueries({ queryKey: ['supabase-tags-analyses'] });
      setShowRenameDialog(false);
      setTagToEdit(null);
    },
    onError: (error: Error) => {
      toast({
        title: 'Update Failed',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  // Delete tag mutation
  const deleteTagMutation = useMutation({
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
      // Invalidate and refetch to ensure UI updates immediately
      await queryClient.invalidateQueries({ queryKey: ['supabase-tags-catalog'] });
      await queryClient.invalidateQueries({ queryKey: ['tags-catalog-v2'] });
      await queryClient.invalidateQueries({ queryKey: ['tags-filter-tree'] }); // Critical: invalidate hierarchy
      await queryClient.invalidateQueries({ queryKey: ['tags-hierarchy'] }); // Fallback hierarchy
      await queryClient.invalidateQueries({ queryKey: ['supabase-tags-analyses'] });
      
      // Force refetch of filter-tree to bypass staleTime cache
      await queryClient.refetchQueries({ queryKey: ['tags-filter-tree'] });
      
      setShowDeleteDialog(false);
      setTagToEdit(null);
    },
    onError: (error: Error) => {
      toast({
        title: 'Delete Failed',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  // Flush cache mutation
  const flushCacheMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/tags/flush-cache', {
        method: 'POST',
      });

      if (!response.ok) {
        throw new Error('Failed to flush cache');
      }

      return await response.json();
    },
    onSuccess: async () => {
      toast({
        title: 'Cache Flushed',
        description: 'Tag cache has been cleared successfully',
      });
      // Invalidate and refetch all tag-related queries
      await queryClient.invalidateQueries({ queryKey: ['tags-catalog-v2'] });
      await queryClient.invalidateQueries({ queryKey: ['tags-filter-tree'] });
      await queryClient.invalidateQueries({ queryKey: ['tags-hierarchy'] });
      await queryClient.refetchQueries({ queryKey: ['tags-catalog-v2'] });
      await queryClient.refetchQueries({ queryKey: ['tags-filter-tree'] });
    },
    onError: (error: Error) => {
      toast({
        title: 'Cache Flush Failed',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const handleBulkAdd = async () => {
    if (!bulkTagName.trim()) {
      toast({
        title: "Error",
        description: "Please enter a tag name",
        variant: "destructive"
      });
      return;
    }

    try {
      let datesToUpdate: string[];
      
      if (selectAllMatching) {
        datesToUpdate = await fetchAllMatchingDates();
      } else {
        datesToUpdate = Array.from(selectedDates);
      }
      
      bulkAddMutation.mutate({
        dates: datesToUpdate,
        tag: {
          name: bulkTagName.trim(),
          category: bulkTagCategory
        }
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to prepare bulk operation",
        variant: "destructive"
      });
    }
  };

  // Fetch unique tags from selected summaries for bulk remove
  const { data: selectedSummariesTags = [], isLoading: isLoadingTags } = useQuery<EntityTag[]>({
    queryKey: ['supabase-tags-selected-summaries', Array.from(selectedDates).sort(), selectAllMatching, debouncedSearchQuery, showUntagged],
    queryFn: async () => {
      if (!supabase) throw new Error("Supabase not configured");

      let datesToCheck: string[];
      
      if (selectAllMatching) {
        try {
          datesToCheck = await fetchAllMatchingDates();
        } catch (e) {
          return [];
        }
      } else {
        if (selectedDates.size === 0) return [];
        datesToCheck = Array.from(selectedDates);
      }
      
      // Fetch analyses for the selected dates
      const { data: analyses, error } = await supabase
        .from("historical_news_analyses")
        .select("tags_version2")
        .in("date", datesToCheck);
      
      if (error) throw error;

      // Extract unique tags from tags_version2
      const uniqueTags = new Map<string, EntityTag>();
      analyses?.forEach((analysis: any) => {
        if (analysis.tags_version2 && Array.isArray(analysis.tags_version2)) {
          analysis.tags_version2.forEach((tagName: string) => {
            const category = getTagCategory(tagName);
            const key = `${category}::${tagName}`;
            if (!uniqueTags.has(key)) {
              uniqueTags.set(key, { name: tagName, category });
            }
          });
        }
      });

      return Array.from(uniqueTags.values());
    },
    enabled: (showBulkRemove || showManageTags) && (selectedDates.size > 0 || selectAllMatching),
  });

  const handleBulkRemove = async (tag: EntityTag) => {
    try {
      let datesToUpdate: string[];
      
      if (selectAllMatching) {
        datesToUpdate = await fetchAllMatchingDates();
      } else {
        datesToUpdate = Array.from(selectedDates);
      }

      bulkRemoveMutation.mutate({
        dates: datesToUpdate,
        tag
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to prepare bulk operation",
        variant: "destructive"
      });
    }
  };

  // Copy all filtered results to clipboard as TXT
  const handleCopyToClipboard = async () => {
    try {
      // If selecting all matching (potentially huge), don't allow copy or warn
      // But existing behavior was "Copy filtered results", which implies ALL results.
      // The user requested limiting it to 50 entries or disabling if more.
      
      // Logic:
      // 1. If selectAllMatching is true -> too many -> Disable/Warn
      // 2. If !selectAllMatching but selectedDates.size > 50 -> Disable/Warn
      // 3. Otherwise copy selectedDates only.
      
      // Wait, previously it copied ALL matching filters. Now we want to copy SELECTION.
      // If nothing selected, previously it copied ALL matching.
      // Let's assume we want to copy SELECTION now.
      
      let datesToCopy: string[];
      
      if (selectAllMatching) {
         // User explicitly selected ALL matching items
         toast({
           title: "Too many items",
           description: "Cannot copy more than 50 items at once. Please refine your selection.",
           variant: "destructive"
         });
         return;
      }
      
      if (selectedDates.size > 0) {
        if (selectedDates.size > 50) {
          toast({
            title: "Too many items",
            description: "Cannot copy more than 50 items at once.",
            variant: "destructive"
          });
          return;
        }
        datesToCopy = Array.from(selectedDates);
      } else {
        // If nothing selected, maybe copy current page? 
        // Or revert to old behavior but limited?
        // "the copy TXT button can be limited to 50 entries"
        // Let's default to copying the current page if nothing selected, 
        // OR if the user wants "all matching" logic from before, we limit it.
        
        // Current implementation fetches ALL matching. Let's keep it but limit to 50?
        // Actually, let's rely on explicit selection. If nothing selected, nothing to copy.
        // Or copy visible page.
        datesToCopy = paginatedAnalyses.map(a => a.date);
      }
      
      // We need to fetch the summaries for these dates.
      // We can use the existing paginatedAnalyses if they are all there, 
      // but if selectedDates spans multiple pages we need to fetch.
      // Simpler: just fetch by IDs.
      
      // Actually, we can reuse the fetchAll logic but filter by IDs on client or server.
      // Let's filter on client since we have the IDs.
      // But we need the SUMMARIES.
      
      // If we just want to copy what's on screen (paginatedAnalyses)
      let analysesToCopy = paginatedAnalyses.filter(a => datesToCopy.includes(a.date));
      
      // If we have selected dates that are NOT in paginatedAnalyses (e.g. other pages),
      // we would need to fetch them. 
      // Given the constraint "limit to 50", we can assume they are likely on the current page 
      // or the user manually selected < 50 across pages.
      
      if (analysesToCopy.length < datesToCopy.length) {
         // We are missing some data. Need to fetch from Supabase.
         if (!supabase) throw new Error("Supabase not configured");

         const { data: fetchedAnalyses, error } = await supabase
           .from("historical_news_analyses")
           .select("date, summary, tags")
           .in("date", datesToCopy);

         if (error) throw error;
         analysesToCopy = fetchedAnalyses || [];
      }
      
      if (analysesToCopy.length === 0) {
        toast({
          title: "Nothing to Copy",
          description: "No analyses selected",
          variant: "destructive"
        });
        return;
      }
      
      // Format all filtered analyses
      const textOutput = analysesToCopy
        .map((analysis: HistoricalNewsAnalysis) => {
          const date = new Date(analysis.date).toLocaleDateString('en-GB', {
            year: 'numeric',
            month: 'long',
            day: '2-digit',
          });
          return `${date} - ${analysis.summary}`;
        })
        .join('\n');
      
      // Set the text and show the dialog instead of copying directly
      setTextToCopy(textOutput);
      setShowCopyDialog(true);

    } catch (error) {
      console.error('Copy to clipboard error:', error);
      toast({
        title: "Copy Failed",
        description: error instanceof Error ? error.message : "Failed to prepare text for copying",
        variant: "destructive"
      });
    }
  };

  const allPageSelected = paginatedAnalyses.length > 0 && 
    paginatedAnalyses.every(a => selectedDates.has(a.date));

  return (
    <SidebarProvider className="w-full">
      <div className="space-y-6">
        <div className="flex flex-col gap-6 lg:flex-row">
          <div className="lg:w-72 shrink-0">
            <TagsSidebar
              catalogData={catalogData}
              selectedEntities={selectedEntities}
              showUntagged={showUntagged}
              searchQuery={searchQuery}
              mode="inline"
              showOverview={false}
              onEntitySelect={(entityKey) => {
                const newSelected = new Set(selectedEntities);
                if (newSelected.has(entityKey)) {
                  newSelected.delete(entityKey);
                } else {
                  newSelected.add(entityKey);
                }
                setSelectedEntities(newSelected);
                setShowUntagged(false);
                setCurrentPage(1);
              }}
              onUntaggedToggle={() => {
                setShowUntagged(!showUntagged);
                setSelectedEntities(new Set());
                setCurrentPage(1);
              }}
              onSearchChange={(value) => {
                setSearchQuery(value);
                setCurrentPage(1);
              }}
            />
          </div>

          <div className="flex-1 space-y-4">
          {/* Main Content Area */}
          <div className="space-y-6">
          <Card className="pt-0 px-6 pb-6 border-0">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center space-x-3">
                <h2 className="text-lg font-semibold text-foreground">
                  {showUntagged ? "Untagged Analyses" : "Bitcoinpedia"}
                </h2>
                <Badge variant="secondary" className="font-normal">
                  {totalCount.toLocaleString()} result{totalCount !== 1 ? 's' : ''}
                </Badge>
              </div>
              {totalCount > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleCopyToClipboard}
                  disabled={selectAllMatching || selectedDates.size > 50}
                  className="flex items-center space-x-2"
                  data-testid="button-copy-txt"
                >
                  <Copy className="w-4 h-4" />
                  <span>Copy TXT</span>
                </Button>
              )}
            </div>

            {/* Analysis Table */}
            <AnalysesTable
              analyses={paginatedAnalyses}
              isLoading={isLoading}
              selectedDates={selectedDates}
              onDateSelect={(date) => {
                setSelectedDates((prev) => new Set(prev).add(date));
              }}
              onDateDeselect={(date) => {
                setSelectedDates((prev) => {
                  const next = new Set(prev);
                  next.delete(date);
                  return next;
                });
              }}
              onRowClick={(date) => setLocation(`/day/${date}`)}
              onTagClick={(tagName) => setSearchQuery(tagName)}
              emptyMessage={
                showUntagged
                  ? "No untagged analyses found"
                  : selectedEntities.size > 0
                  ? "No analyses match the selected entities"
                  : debouncedSearchQuery
                  ? "No analyses match your search"
                  : "No tagged analyses found"
              }
              showCheckbox={true}
              pageSize={pageSize}
              currentPage={currentPage}
              totalCount={totalCount}
              catalogData={catalogData}
              onPageChange={(page) => setCurrentPage(page)}
              onPageSizeChange={(size) => {
                setPageSize(size);
                setCurrentPage(1);
              }}
              onSelectAll={toggleSelectAll}
              selectAllMatching={selectAllMatching}
              pageSizeOptions={PAGE_SIZE_OPTIONS}
              showPagination={true}
              showSelectAll={true}
              showBulkActions={true}
              bulkActions={{
                showSelectAllLink: true,
                onSelectAllMatching: () => setSelectAllMatching(true),
                onClearSelection: () => {
                  setSelectedDates(new Set());
                  setSelectAllMatching(false);
                },
                customActions: (
                  <>
                    {/* Re-analyze Dropdown */}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={isReanalyzing}
                          title="Re-analyze (R)"
                        >
                          <RefreshCw className={`w-4 h-4 mr-2 ${isReanalyzing ? 'animate-spin' : ''}`} />
                          Re-analyze
                          <ChevronDown className="w-4 h-4 ml-2" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={async () => {
                            setIsReanalyzing(true);
                            const dates = selectAllMatching 
                              ? paginatedAnalyses.map(a => a.date) 
                              : Array.from(selectedDates);
                            
                            for (const date of dates) {
                              try {
                                await fetch(`/api/analysis/date/${date}`, { method: 'POST' });
                              } catch (err) {
                                console.error(`Failed to analyze ${date}:`, err);
                              }
                            }
                            setIsReanalyzing(false);
                            queryClient.invalidateQueries({ queryKey: ['analyses'] });
                            toast({
                              title: "Re-analysis complete",
                              description: `Analyzed ${dates.length} date(s)`,
                            });
                          }}
                          disabled={isReanalyzing}
                        >
                          <RefreshCw className="w-4 h-4 mr-2" />
                          Analyse Days
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={async () => {
                            setIsReanalyzing(true);
                            const dates = selectAllMatching 
                              ? paginatedAnalyses.map(a => a.date) 
                              : Array.from(selectedDates);
                            
                            for (const date of dates) {
                              try {
                                await fetch(`/api/analysis/date/${date}/redo-summary`, { method: 'POST' });
                              } catch (err) {
                                console.error(`Failed to redo summary for ${date}:`, err);
                              }
                            }
                            setIsReanalyzing(false);
                            queryClient.invalidateQueries({ queryKey: ['analyses'] });
                            toast({
                              title: "Summaries updated",
                              description: `Redid summaries for ${dates.length} date(s)`,
                            });
                          }}
                          disabled={isReanalyzing}
                        >
                          <FileText className="w-4 h-4 mr-2" />
                          Redo Summaries
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>

                    {/* Auto Tagging Button */}
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={isCategorizing}
                      onClick={async () => {
                        setIsCategorizing(true);
                        try {
                          await fetch('/api/tags/categorize/start', { method: 'POST' });
                          toast({
                            title: "Auto Tagging started",
                            description: "AI is categorizing tags in the background",
                          });
                        } catch (err) {
                          toast({
                            title: "Error",
                            description: "Failed to start auto tagging",
                            variant: "destructive",
                          });
                        }
                        setIsCategorizing(false);
                      }}
                    >
                      {isCategorizing ? (
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      ) : (
                        <SiOpenai className="w-4 h-4 mr-2" />
                      )}
                      Auto Tagging
                    </Button>

                    {/* Manage Tags Button */}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setShowManageTags(true)}
                    >
                      <Tags className="w-4 h-4 mr-2" />
                      Manage Tags
                    </Button>
                  </>
                ),
              }}
            />
          </Card>
          </div>

      {/* New Copy to Clipboard Dialog */}
      <Dialog open={showCopyDialog} onOpenChange={setShowCopyDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Copy Analyses to Clipboard</DialogTitle>
            <DialogDescription>
              The text below has been selected for you. Press Ctrl+C or Cmd+C to copy.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-4">
            <textarea
              readOnly
              value={textToCopy}
              className="w-full h-64 p-2 border rounded bg-slate-50 text-sm text-slate-800"
              onFocus={(e) => e.target.select()}
              autoFocus
              data-testid="textarea-copy"
            />
          </div>
          <div className="flex justify-end pt-4">
            <Button
              onClick={() => setShowCopyDialog(false)}
              variant="outline"
              data-testid="button-close-copy-dialog"
            >
              Close
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Bulk Add Dialog */}
      <Dialog open={showBulkAdd} onOpenChange={setShowBulkAdd}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Tag to {selectAllMatching ? totalCount : selectedDates.size} Analyses</DialogTitle>
          </DialogHeader>
          
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium text-slate-700 mb-1 block">
                Tag Name
              </label>
              <Input
                placeholder="Enter tag name"
                value={bulkTagName}
                onChange={(e) => setBulkTagName(e.target.value)}
                data-testid="input-bulk-tag-name"
              />
            </div>

            <div>
              <label className="text-sm font-medium text-slate-700 mb-1 block">
                Category
              </label>
              <select
                value={bulkTagCategory}
                onChange={(e) => setBulkTagCategory(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-md"
                data-testid="select-bulk-category"
              >
                <option value="crypto">Cryptocurrency</option>
                <option value="company">Company</option>
                <option value="person">Person</option>
                <option value="country">Country</option>
                <option value="organization">Organization</option>
                <option value="protocol">Protocol</option>
                <option value="topic">Topic</option>
              </select>
            </div>

            <div className="flex justify-end space-x-2">
              <Button
                variant="outline"
                onClick={() => setShowBulkAdd(false)}
                data-testid="button-cancel-bulk-add"
              >
                Cancel
              </Button>
              <Button
                onClick={handleBulkAdd}
                disabled={bulkAddMutation.isPending}
                data-testid="button-confirm-bulk-add"
              >
                {bulkAddMutation.isPending ? "Adding..." : "Add Tag"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Bulk Remove Dialog */}
      <Dialog open={showBulkRemove} onOpenChange={setShowBulkRemove}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Remove Tags from {selectAllMatching ? totalCount : selectedDates.size} Analyses</DialogTitle>
          </DialogHeader>
          
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              Click on any tag below to remove it from all selected analyses:
            </p>

            {isLoadingTags ? (
              <div className="text-center py-8 text-slate-500">
                Loading tags...
              </div>
            ) : selectedSummariesTags.length === 0 ? (
              <div className="text-center py-8">
                <Tag className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                <p className="text-slate-500">No tags found in selected analyses</p>
              </div>
            ) : (
              <div className="max-h-96 overflow-y-auto">
                <div className="flex flex-wrap gap-2">
                  {selectedSummariesTags.map((tag) => (
                    <Badge
                      key={`${tag.category}::${tag.name}`}
                      variant="outline"
                      className={`${getCategoryColor(tag.category)} cursor-pointer hover:opacity-70 transition-opacity px-3 py-2`}
                      onClick={() => handleBulkRemove(tag)}
                      data-testid={`badge-remove-${tag.category}-${tag.name}`}
                    >
                      <span className="font-medium">{tag.name}</span>
                      <span className="ml-2 text-xs opacity-60">({tag.category})</span>
                      <X className="w-3 h-3 ml-2" />
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            <div className="flex justify-end space-x-2 pt-2 border-t">
              <Button
                variant="outline"
                onClick={() => setShowBulkRemove(false)}
                data-testid="button-cancel-bulk-remove"
              >
                Close
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Manage Tags Dialog */}
      <Dialog open={showManageTags} onOpenChange={setShowManageTags}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Tags className="w-5 h-5" />
              Manage Tags for {selectAllMatching ? totalCount.toLocaleString() : selectedDates.size} Analyses
            </DialogTitle>
            <DialogDescription>
              View, add, or remove tags from all selected analyses
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4">
            {/* Add New Tag Section */}
            <div className="p-4 bg-muted/30 rounded-lg border">
              <h4 className="text-sm font-medium mb-3 flex items-center gap-2">
                <Plus className="w-4 h-4" />
                Add New Tag
              </h4>
              <div className="flex items-end gap-3">
                <div className="flex-1">
                  <label className="text-xs text-muted-foreground mb-1 block">Tag Name</label>
                  <Input
                    placeholder="Enter tag name"
                    value={bulkTagName}
                    onChange={(e) => setBulkTagName(e.target.value)}
                    className="h-9"
                  />
                </div>
                <div className="w-40">
                  <label className="text-xs text-muted-foreground mb-1 block">Category</label>
                  <Select value={bulkTagCategory} onValueChange={setBulkTagCategory}>
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="crypto">Cryptocurrency</SelectItem>
                      <SelectItem value="company">Company</SelectItem>
                      <SelectItem value="person">Person</SelectItem>
                      <SelectItem value="country">Country</SelectItem>
                      <SelectItem value="organization">Organization</SelectItem>
                      <SelectItem value="protocol">Protocol</SelectItem>
                      <SelectItem value="topic">Topic</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  size="sm"
                  onClick={() => {
                    if (bulkTagName.trim()) {
                      handleBulkAdd();
                      setShowManageTags(false);
                    }
                  }}
                  disabled={!bulkTagName.trim() || bulkAddMutation.isPending}
                  className="h-9"
                >
                  {bulkAddMutation.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Plus className="w-4 h-4" />
                  )}
                </Button>
              </div>
            </div>

            {/* Existing Tags Section */}
            <div>
              <h4 className="text-sm font-medium mb-3 flex items-center gap-2">
                <Tag className="w-4 h-4" />
                Existing Tags
                <Badge variant="secondary" className="font-normal ml-1">
                  {selectedSummariesTags.length}
                </Badge>
              </h4>
              
              {isLoadingTags ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
                  Loading tags...
                </div>
              ) : selectedSummariesTags.length === 0 ? (
                <div className="text-center py-8 border border-dashed rounded-lg">
                  <Tag className="w-10 h-10 text-muted-foreground/30 mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">No tags found in selected analyses</p>
                </div>
              ) : (
                <div className="max-h-64 overflow-y-auto border rounded-lg p-3">
                  <div className="flex flex-wrap gap-2">
                    {selectedSummariesTags.map((tag) => (
                      <Badge
                        key={`manage-${tag.category}::${tag.name}`}
                        variant="outline"
                        className={`${getCategoryColor(tag.category)} group cursor-pointer hover:opacity-80 transition-all px-3 py-1.5`}
                        onClick={() => handleBulkRemove(tag)}
                      >
                        <span className="font-medium">{tag.name}</span>
                        <span className="ml-1.5 text-xs opacity-60">({tag.category})</span>
                        <X className="w-3 h-3 ml-2 opacity-0 group-hover:opacity-100 transition-opacity" />
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
              <p className="text-xs text-muted-foreground mt-2">
                Click on a tag to remove it from all selected analyses
              </p>
            </div>

            <div className="flex justify-end pt-2 border-t">
              <Button
                variant="outline"
                onClick={() => setShowManageTags(false)}
              >
                Done
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit Tag Dialog */}
      <EditTagDialog
        open={showRenameDialog}
        onOpenChange={setShowRenameDialog}
        tag={tagToEdit}
        onConfirm={(changes) => {
          if (tagToEdit) {
            updateTagMutation.mutate({
              tagName: tagToEdit.name,
              oldCategory: tagToEdit.category,
              newName: changes.newName,
              newCategory: changes.newCategory,
              newSubcategoryPath: changes.newSubcategoryPath,
            });
          }
        }}
        isLoading={updateTagMutation.isPending}
      />

      {/* Delete Tag Dialog */}
          <DeleteDialog
            open={showDeleteDialog}
            onOpenChange={setShowDeleteDialog}
            tag={tagToEdit}
            onConfirm={async () => {
              if (tagToEdit) {
                // First, find the actual category from the database
                // This handles cases where tag appears in Miscellaneous but has a different category in DB
                try {
                  const response = await fetch(`/api/tags-manager/find-categories?tagName=${encodeURIComponent(tagToEdit.name)}`);
                  if (response.ok) {
                    const data = await response.json();
                    if (data.categories && data.categories.length > 0) {
                      // Delete from all categories the tag exists in
                      // This handles cases where the same tag name might exist in multiple categories
                      const deletePromises = data.categories.map((cat: { category: string }) => 
                        fetch('/api/tags-manager/delete', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ tagName: tagToEdit.name, category: cat.category }),
                        })
                      );
                      
                      const results = await Promise.all(deletePromises);
                      const allOk = results.every(r => r.ok);
                      
                      if (allOk) {
                        const totalUpdated = await Promise.all(
                          results.map(r => r.json().then((d: any) => d.updated || 0))
                        );
                        const sum = totalUpdated.reduce((a, b) => a + b, 0);
                        
                        toast({
                          title: 'Tag Deleted',
                          description: `Tag has been deleted from ${sum} analyses across ${data.categories.length} category(ies)`,
                        });
                        
                        await queryClient.invalidateQueries({ queryKey: ['supabase-tags-catalog'] });
                        await queryClient.invalidateQueries({ queryKey: ['tags-catalog-v2'] });
                        await queryClient.invalidateQueries({ queryKey: ['supabase-tags-analyses'] });
                        setShowDeleteDialog(false);
                        setTagToEdit(null);
                      } else {
                        throw new Error('Some deletions failed');
                      }
                    } else {
                      // No categories found - try with the provided category anyway
                      console.warn(`No categories found for "${tagToEdit.name}", using provided category: ${tagToEdit.category}`);
                      deleteTagMutation.mutate({
                        tagName: tagToEdit.name,
                        category: tagToEdit.category,
                      });
                    }
                  } else {
                    // If lookup fails, try with provided category
                    console.warn(`Failed to find categories for "${tagToEdit.name}", using provided category: ${tagToEdit.category}`);
                    deleteTagMutation.mutate({
                      tagName: tagToEdit.name,
                      category: tagToEdit.category,
                    });
                  }
                } catch (error) {
                  // If lookup fails, try with provided category
                  console.error(`Error finding categories for "${tagToEdit.name}":`, error);
                  deleteTagMutation.mutate({
                    tagName: tagToEdit.name,
                    category: tagToEdit.category,
                  });
                }
              }
            }}
            isLoading={deleteTagMutation.isPending}
          />
          </div>
        </div>
      </div>
    </SidebarProvider>
  );
}