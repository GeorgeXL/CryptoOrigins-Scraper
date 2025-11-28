import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
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
  Loader2
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabase";
import { Link } from "wouter";
import { RenameDialog } from "@/components/TagsManager/RenameDialog";
import { DeleteDialog } from "@/components/TagsManager/DeleteDialog";

// Main category type definition
export type MainCategory = 
  | 'bitcoin'
  | 'blockchain-platforms'
  | 'digital-assets'
  | 'technology'
  | 'organizations'
  | 'people'
  | 'regulation-law'
  | 'markets-geography'
  | 'traditional-finance'
  | 'markets-trading'
  | 'security-crime'
  | 'education-community'
  | 'history-culture'
  | 'miscellaneous';

interface EntityTag {
  name: string;
  category: string;
}

interface HistoricalNewsAnalysis {
  date: string;
  summary: string;
  tags: EntityTag[] | null;
  tier?: number;
  url?: string;
  source_url?: string;
  isManualOverride?: boolean;
}

const PAGE_SIZE_OPTIONS = [50, 200, 500];

// AI Categorization Panel Component
function AiCategorizationPanel() {
  const { toast } = useToast();
  const [status, setStatus] = useState<{
    isRunning: boolean;
    processed: number;
    total: number;
    currentTag: string;
    progress: number;
  } | null>(null);

  // Poll for status updates
  useEffect(() => {
    if (!status?.isRunning) return;

    const interval = setInterval(async () => {
      try {
        const response = await fetch('/api/tags/ai-categorize/status');
        if (response.ok) {
          const data = await response.json();
          setStatus(data);
          if (!data.isRunning) {
            toast({
              title: "Categorization Complete",
              description: `Processed ${data.processed} of ${data.total} tags`,
            });
            // Invalidate queries to refresh data
            queryClient.invalidateQueries({ queryKey: ['tags-catalog-v2'] });
            queryClient.invalidateQueries({ queryKey: ['tags-hierarchy'] });
          }
        }
      } catch (error) {
        console.error('Error fetching categorization status:', error);
      }
    }, 2000); // Poll every 2 seconds

    return () => clearInterval(interval);
  }, [status?.isRunning, toast]);

  const startCategorization = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/tags/ai-categorize/start', {
        method: 'POST',
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to start categorization');
      }
      return response.json();
    },
    onSuccess: (data) => {
      setStatus({
        isRunning: true,
        processed: 0,
        total: data.total,
        currentTag: '',
        progress: 0,
      });
      toast({
        title: "Categorization Started",
        description: `Processing ${data.total} tags...`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const stopCategorization = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/tags/ai-categorize/stop', {
        method: 'POST',
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to stop categorization');
      }
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Stopping Categorization",
        description: "The process will stop after the current tag completes",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Initial status fetch
  useEffect(() => {
    fetch('/api/tags/ai-categorize/status')
      .then(res => {
        if (!res.ok) {
          // If endpoint doesn't exist or returns error, set default status
          setStatus({
            isRunning: false,
            processed: 0,
            total: 0,
            currentTag: '',
            progress: 0
          });
          return;
        }
        return res.json();
      })
      .then(data => {
        if (data) {
          setStatus(data);
        }
      })
      .catch(err => {
        console.error('Error fetching initial status:', err);
        // Set default status on error so component still renders
        setStatus({
          isRunning: false,
          processed: 0,
          total: 0,
          currentTag: '',
          progress: 0
        });
      });
  }, []);

  // Always render, even if status is not loaded yet
  if (!status) {
    return (
      <Card className="p-4 bg-gradient-to-r from-purple-50 to-blue-50 border-purple-200">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <Bot className="w-5 h-5 text-purple-600" />
            <div>
              <h3 className="font-semibold text-slate-900">AI Tag Categorization</h3>
              <p className="text-sm text-slate-600">
                Automatically categorize all tags into the new taxonomy structure using AI
              </p>
            </div>
          </div>
          <Button
            onClick={() => startCategorization.mutate()}
            disabled={startCategorization.isPending}
            className="bg-purple-600 hover:bg-purple-700"
          >
            {startCategorization.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Starting...
              </>
            ) : (
              <>
                <Bot className="w-4 h-4 mr-2" />
                Categorize All Tags with AI
              </>
            )}
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-4 bg-gradient-to-r from-purple-50 to-blue-50 border-purple-200">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <Bot className="w-5 h-5 text-purple-600" />
          <div>
            <h3 className="font-semibold text-slate-900">AI Tag Categorization</h3>
            <p className="text-sm text-slate-600">
              Automatically categorize all tags into the new taxonomy structure using AI
            </p>
          </div>
        </div>
        <div className="flex items-center space-x-4">
          {status.isRunning ? (
            <>
              <div className="text-right">
                <div className="text-sm font-medium text-slate-900">
                  {status.processed} / {status.total} tags
                </div>
                <div className="text-xs text-slate-600">
                  {status.currentTag && `Processing: ${status.currentTag}`}
                </div>
                <div className="w-48 bg-slate-200 rounded-full h-2 mt-1">
                  <div
                    className="bg-purple-600 h-2 rounded-full transition-all duration-300"
                    style={{ width: `${status.progress}%` }}
                  />
                </div>
              </div>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => stopCategorization.mutate()}
                disabled={stopCategorization.isPending}
              >
                <StopCircle className="w-4 h-4 mr-2" />
                Stop
              </Button>
            </>
          ) : (
            <Button
              onClick={() => startCategorization.mutate()}
              disabled={startCategorization.isPending}
              className="bg-purple-600 hover:bg-purple-700"
            >
              {startCategorization.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Starting...
                </>
              ) : (
                <>
                  <Bot className="w-4 h-4 mr-2" />
                  Categorize All Tags with AI
                </>
              )}
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}

export default function TagsBrowser() {
  const { toast } = useToast();
  
  // View mode state - toggle between Keywords and Topics
  const [viewMode, setViewMode] = useState<'keywords' | 'topics'>('keywords');
  const [pageSize, setPageSize] = useState(50);
  
  // Category panel state
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [selectedEntities, setSelectedEntities] = useState<Set<string>>(new Set());
  const [showUntagged, setShowUntagged] = useState(false);
  const [showManualOnly, setShowManualOnly] = useState(false);
  
  // Date list state
  const [selectedDates, setSelectedDates] = useState<Set<string>>(new Set());
  const [currentPage, setCurrentPage] = useState(1);
  const [selectAllMatching, setSelectAllMatching] = useState(false);
  
  // Search and modal state
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState("");
  const [detailDate, setDetailDate] = useState<string | null>(null);

  // New state for the copy dialog
  const [showCopyDialog, setShowCopyDialog] = useState(false);
  const [textToCopy, setTextToCopy] = useState("");

  // State for edit/delete tag dialogs
  const [showRenameDialog, setShowRenameDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [tagToEdit, setTagToEdit] = useState<{ name: string; category: string; count: number } | null>(null);

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
  const [bulkTagName, setBulkTagName] = useState("");
  const [bulkTagCategory, setBulkTagCategory] = useState("crypto");

  // Fetch flat tags from new v2 endpoint for frontend grouping
  const { data: catalogV2Data, error: catalogError } = useQuery<{
    tags: { name: string; count: number }[];
    taggedCount: number;
    untaggedCount: number;
    totalAnalyses: number;
  }>({
    queryKey: ['tags-catalog-v2', showManualOnly],
    queryFn: async () => {
      const response = await fetch(`/api/tags/catalog-v2${showManualOnly ? '?manualOnly=true' : ''}`);
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

  // Fetch tag hierarchy from database
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
    staleTime: 1000 * 60 * 60, // Cache for 1 hour (hierarchy rarely changes)
  });

  // Map main category names to display names (New 14-Category Taxonomy)
  const categoryDisplayNames: Record<MainCategory, string> = {
    'bitcoin': '🪙 Bitcoin',
    'blockchain-platforms': '🔗 Blockchain Platforms',
    'digital-assets': '💰 Digital Assets & Tokens',
    'technology': '⚡ Technology & Concepts',
    'organizations': '🏢 Companies & Organizations',
    'people': '👥 People',
    'regulation-law': '⚖️ Regulation & Law',
    'markets-geography': '🌍 Markets & Geography',
    'traditional-finance': '💵 Traditional Finance & Economics',
    'markets-trading': '📊 Markets & Trading',
    'security-crime': '🔒 Security & Crime',
    'education-community': '🎓 Education & Community',
    'history-culture': '📜 History & Culture',
    'miscellaneous': '📝 Miscellaneous'
  };

  // Frontend grouping logic - Uses hierarchy from database
  const catalogData = useMemo(() => {
    if (!catalogV2Data?.tags || !hierarchyData?.categories) return null;

    const tags = catalogV2Data.tags;
    const entitiesByCategory: Record<string, any[]> = {};
    
    // Build lookup map: tagName (lowercase) -> { categoryKey, subcategoryId, subcategoryName, parentChain }
    const tagLookup = new Map<string, { categoryKey: string; subcategoryPath: string[] }>();
    
    const buildLookup = (node: any, categoryKey: string, path: string[] = []) => {
      const currentPath = [...path, node.name];
      
      // If this node has no children or only has tags as children (leaf subcategory)
      if (node.children && node.children.length > 0) {
        // Check if children are tags (no further children) or subcategories
        const hasSubcategories = node.children.some((child: any) => child.children && child.children.length > 0);
        
        if (hasSubcategories) {
          // Recurse into subcategories
          node.children.forEach((child: any) => buildLookup(child, categoryKey, currentPath));
      } else {
          // Children are tags - register them
          node.children.forEach((child: any) => {
            const normalizedName = (child.normalizedName || child.name.toLowerCase()).trim();
            tagLookup.set(normalizedName, { categoryKey, subcategoryPath: currentPath });
          });
        }
      }
    };
    
    // Process each main category from hierarchy
    hierarchyData.categories.forEach((category: any) => {
      const categoryKey = category.category; // e.g., 'bitcoin', 'money-economics'
      
      if (category.children && category.children.length > 0) {
        category.children.forEach((subcategory: any) => {
          buildLookup(subcategory, categoryKey, []);
        });
      }
    });
    
    console.log(`Built tag lookup with ${tagLookup.size} entries from hierarchy`);
    
    // Group tags by their category using the lookup
    const tagsByCategory = new Map<string, Map<string, { tag: typeof tags[0]; path: string[] }>>();
    const unmatchedTags: typeof tags = [];
    
    tags.forEach(tag => {
      const normalizedName = tag.name.toLowerCase().trim();
      const lookup = tagLookup.get(normalizedName);
      
      if (lookup) {
        if (!tagsByCategory.has(lookup.categoryKey)) {
          tagsByCategory.set(lookup.categoryKey, new Map());
        }
        const categoryTags = tagsByCategory.get(lookup.categoryKey)!;
        const pathKey = lookup.subcategoryPath.join(' > ');
        categoryTags.set(tag.name, { tag, path: lookup.subcategoryPath });
      } else {
        unmatchedTags.push(tag);
      }
    });
    
    // Build the display structure for each category
    hierarchyData.categories.forEach((category: any) => {
      const categoryKey = category.category;
      const categoryTags = tagsByCategory.get(categoryKey);
      
      if (!categoryTags || categoryTags.size === 0) return;
      
      // Build subcategory structure with counts
      const buildSubcategoryDisplay = (node: any, depth: number = 0): any => {
        const children: any[] = [];
        let totalCount = 0;
        
        if (node.children && node.children.length > 0) {
          const hasSubcategories = node.children.some((child: any) => 
            child.children && child.children.length > 0
          );
          
          if (hasSubcategories) {
            // Process nested subcategories
            node.children.forEach((child: any) => {
              const childResult = buildSubcategoryDisplay(child, depth + 1);
              if (childResult && childResult.count > 0) {
                children.push(childResult);
                totalCount += childResult.count;
              }
            });
          } else {
            // Process tags (leaf level)
            node.children.forEach((child: any) => {
              const normalizedName = (child.normalizedName || child.name.toLowerCase()).trim();
              // Find matching tag from catalogV2Data
              const matchingTag = tags.find(t => t.name.toLowerCase().trim() === normalizedName);
              if (matchingTag) {
                children.push({
                  name: matchingTag.name,
                  category: categoryKey,
                  count: matchingTag.count
                });
                totalCount += matchingTag.count;
              }
            });
            
            // Sort tags by count
            children.sort((a, b) => b.count - a.count);
          }
        }
        
        if (totalCount === 0) return null;
        
        return {
          category: categoryKey,
          name: node.name,
        count: totalCount,
        isParent: true,
          children
        };
      };
      
      // Build category items from subcategories
      const categoryItems: any[] = [];
      if (category.children) {
        category.children.forEach((subcategory: any) => {
          const result = buildSubcategoryDisplay(subcategory);
          if (result && result.count > 0) {
            categoryItems.push(result);
          }
        });
      }
      
      if (categoryItems.length > 0) {
        entitiesByCategory[categoryKey] = categoryItems;
      }
    });
    
    // Add miscellaneous category for unmatched tags
    if (unmatchedTags.length > 0) {
      const miscItems = unmatchedTags
      .map(tag => ({
        name: tag.name,
        category: 'miscellaneous',
        count: tag.count
      }))
      .sort((a, b) => b.count - a.count);
    
      entitiesByCategory['miscellaneous'] = [{
        category: 'miscellaneous',
        name: 'Unmatched Tags',
        count: miscItems.reduce((sum, t) => sum + t.count, 0),
        isParent: true,
        children: miscItems
      }];
    }
    
    return {
      entitiesByCategory,
      taggedCount: catalogV2Data.taggedCount,
      untaggedCount: catalogV2Data.untaggedCount,
      totalAnalyses: catalogV2Data.totalAnalyses
    };
  }, [catalogV2Data, hierarchyData]);


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
    queryKey: ['supabase-tags-analyses', Array.from(selectedEntities).sort().join(','), showUntagged, debouncedSearchQuery, currentPage, showManualOnly, pageSize],
    refetchOnMount: true,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      if (!supabase) throw new Error("Supabase not configured");

      // Build base query
      let query = supabase
        .from("historical_news_analyses")
        .select("date, summary, tags, tier_used, is_manual_override", { count: "exact" });

      // Apply filters
      if (showManualOnly) {
        query = query.eq("is_manual_override", true);
      }

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
        firstAnalysisTags: analyses?.[0]?.tags
      }, null, 2));

      // Client-side filtering for untagged and entity selection (since JSONB array filtering is complex)
      let filteredAnalyses = analyses || [];
      
      // Filter for untagged
      if (showUntagged) {
        filteredAnalyses = filteredAnalyses.filter(analysis => 
          !analysis.tags || analysis.tags.length === 0
        );
      }
      
      if (selectedEntities.size > 0 && !showUntagged) {
        filteredAnalyses = filteredAnalyses.filter(analysis => {
          if (!analysis.tags || !Array.isArray(analysis.tags)) return false;
          return Array.from(selectedEntities).some(entityKey => {
            const [category, name] = entityKey.split("::");
            // Match by tag name only, since taxonomy categories are for display only
            // Database tags may have different category names (e.g., "crypto" vs "digital-assets")
            return analysis.tags.some((tag: EntityTag) => 
              tag.name === name
            );
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
    'blockchain-platforms',
    'digital-assets',
    'technology',
    'organizations',
    'people',
    'regulation-law',
    'markets-geography',
    'traditional-finance',
    'markets-trading',
    'security-crime',
    'education-community',
    'history-culture',
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

  // Get icon for category (using new taxonomy)
  const getCategoryIcon = (category: string) => {
    switch (category.toLowerCase()) {
      case 'countries':
      case 'country':
        return Globe;
      case 'companies':
      case 'company':
        return Building;
      case 'people':
      case 'person':
        return User;
      case 'digital-assets':
      case 'crypto':
      case 'cryptocurrency':
        return Coins;
      case 'bitcoin-orgs':
      case 'regulatory':
      case 'organization':
        return Building2;
      case 'protocols':
      case 'protocol':
        return Hash;
      case 'topics':
      case 'topic':
        return Sparkles;
      case 'currencies':
      case 'currency':
        return Coins;
      case 'crime':
        return Building2;
      case 'events':
        return Calendar;
      case 'miscellaneous':
      case 'other':
        return Tag;
      default:
        return Tag;
    }
  };

  // Get color for category (using new taxonomy)
  const getCategoryColor = (category: string) => {
    switch (category.toLowerCase()) {
      case 'countries':
      case 'country':
        return 'bg-blue-100 text-blue-700 border-blue-300';
      case 'companies':
      case 'company':
        return 'bg-purple-100 text-purple-700 border-purple-300';
      case 'people':
      case 'person':
        return 'bg-green-100 text-green-700 border-green-300';
      case 'digital-assets':
      case 'crypto':
      case 'cryptocurrency':
        return 'bg-orange-100 text-orange-700 border-orange-300';
      case 'bitcoin-orgs':
      case 'regulatory':
      case 'organization':
        return 'bg-indigo-100 text-indigo-700 border-indigo-300';
      case 'protocols':
      case 'protocol':
        return 'bg-cyan-100 text-cyan-700 border-cyan-300';
      case 'topics':
      case 'topic':
        return 'bg-pink-100 text-pink-700 border-pink-300';
      case 'currencies':
      case 'currency':
        return 'bg-yellow-100 text-yellow-700 border-yellow-300';
      case 'crime':
        return 'bg-red-100 text-red-700 border-red-300';
      case 'events':
        return 'bg-violet-100 text-violet-700 border-violet-300';
      case 'miscellaneous':
      case 'other':
        return 'bg-slate-100 text-slate-700 border-slate-300';
      default:
        return 'bg-slate-100 text-slate-700 border-slate-300';
    }
  };

  // Toggle category expansion
  const toggleCategory = (category: string) => {
    setExpandedCategories(prev => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
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
      .select("date, tags, summary");

    if (showManualOnly) {
      query = query.eq("is_manual_override", true);
    }

    if (showUntagged) {
      query = query.or("tags.is.null,tags.eq.[]");
    }

    if (debouncedSearchQuery) {
      query = query.or(`summary.ilike.%${debouncedSearchQuery}%,date.ilike.%${debouncedSearchQuery}%`);
    }

    const { data: analyses, error } = await query;
    if (error) throw error;

    // Client-side filtering for entity selection
    let filteredAnalyses = analyses || [];
    if (selectedEntities.size > 0 && !showUntagged) {
      filteredAnalyses = filteredAnalyses.filter(analysis => {
        if (!analysis.tags || !Array.isArray(analysis.tags)) return false;
        return Array.from(selectedEntities).some(entityKey => {
          const [category, name] = entityKey.split("::");
          // Match by tag name only, since taxonomy categories are for display only
          // Database tags may have different category names (e.g., "crypto" vs "digital-assets")
          return analysis.tags.some((tag: EntityTag) => 
            tag.name === name
          );
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

  // Rename tag mutation
  const renameTagMutation = useMutation({
    mutationFn: async ({ tagName, newName, category }: { tagName: string; newName: string; category: string }) => {
      const response = await fetch('/api/tags-manager/rename', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ tagName, newName, category }),
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
      await queryClient.invalidateQueries({ queryKey: ['supabase-tags-catalog'] });
      await queryClient.invalidateQueries({ queryKey: ['tags-catalog-v2'] });
      await queryClient.invalidateQueries({ queryKey: ['supabase-tags-analyses'] });
      setShowRenameDialog(false);
      setTagToEdit(null);
    },
    onError: (error: Error) => {
      toast({
        title: 'Rename Failed',
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
      await queryClient.invalidateQueries({ queryKey: ['supabase-tags-catalog'] });
      await queryClient.invalidateQueries({ queryKey: ['tags-catalog-v2'] });
      await queryClient.invalidateQueries({ queryKey: ['supabase-tags-analyses'] });
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
    queryKey: ['supabase-tags-selected-summaries', Array.from(selectedDates).sort(), selectAllMatching, debouncedSearchQuery, showManualOnly, showUntagged],
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
        .select("tags")
        .in("date", datesToCheck);
      
      if (error) throw error;

      // Extract unique tags
      const uniqueTags = new Map<string, EntityTag>();
      analyses?.forEach(analysis => {
        if (analysis.tags && Array.isArray(analysis.tags)) {
          analysis.tags.forEach((tag: EntityTag) => {
            const key = `${tag.category}::${tag.name}`;
            if (!uniqueTags.has(key)) {
              uniqueTags.set(key, tag);
            }
          });
        }
      });

      return Array.from(uniqueTags.values());
    },
    enabled: showBulkRemove && (selectedDates.size > 0 || selectAllMatching),
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

  // Get detail analysis - fetch from paginated results or make a separate query if needed
  const detailAnalysis = detailDate ? paginatedAnalyses.find(a => a.date === detailDate) : null;

  const allPageSelected = paginatedAnalyses.length > 0 && 
    paginatedAnalyses.every(a => selectedDates.has(a.date));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Tags Browser</h1>
          <p className="text-slate-600 mt-1">
            Explore and manage extracted entities from Bitcoin news analyses
          </p>
        </div>
        <div className="flex items-center space-x-2 text-sm text-slate-600">
          <Tag className="w-4 h-4" />
          <span>{catalogData?.taggedCount || 0} tagged analyses</span>
        </div>
      </div>

      {/* AI Categorization Tool */}
      <AiCategorizationPanel />

      {/* Search Bar */}
      <Card className="p-4">
        <div className="flex items-center space-x-3 mb-3">
          <Search className="w-5 h-5 text-slate-400" />
          <Input
            placeholder="Search by tag name, summary, or date..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              // Don't reset page here - let the debounce effect handle it
            }}
            className="flex-1"
            data-testid="input-search-tags"
          />
          {searchQuery && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSearchQuery("")}
              data-testid="button-clear-search"
            >
              Clear
            </Button>
          )}
        </div>
        {/* Manual Import Filter Toggle */}
        <div className="flex items-center space-x-2 pt-3 border-t border-slate-200">
          <Switch
            id="manual-only-filter"
            checked={showManualOnly}
            onCheckedChange={async (checked) => {
              console.log('🔄 Toggle changed:', checked);
              setShowManualOnly(checked);
              setCurrentPage(1); // Reset to first page when filter changes
            }}
            data-testid="switch-manual-only"
          />
          <Label 
            htmlFor="manual-only-filter" 
            className="text-sm font-medium text-slate-700 cursor-pointer"
          >
            Show only manually imported events
          </Label>
        </div>
      </Card>

      {/* Bulk Operations Toolbar */}
      {(selectedDates.size > 0 || selectAllMatching) && (
        <Card className="p-4 bg-blue-50 border-blue-200">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <Check className="w-5 h-5 text-blue-600" />
              <span className="font-medium text-blue-900">
                {selectAllMatching 
                  ? `All ${totalCount} dates selected` 
                  : `${selectedDates.size} date${selectedDates.size !== 1 ? 's' : ''} selected`}
              </span>
            </div>
            <div className="flex items-center space-x-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowBulkAdd(true)}
                data-testid="button-bulk-add"
              >
                <Plus className="w-4 h-4 mr-1" />
                Add Tag
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowBulkRemove(true)}
                data-testid="button-bulk-remove"
              >
                <Minus className="w-4 h-4 mr-1" />
                Remove Tag
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSelectedDates(new Set());
                  setSelectAllMatching(false);
                }}
                data-testid="button-clear-selection"
              >
                <X className="w-4 h-4 mr-1" />
                Clear
              </Button>
            </div>
          </div>
        </Card>
      )}

      {/* Main Content */}
      <div className="grid grid-cols-12 gap-6">
        {/* Left Panel - Category Navigation (1/3) */}
        <div className="col-span-12 lg:col-span-4">
          <Card className="p-6">
            {/* Untagged Category Section - Only show in Keywords mode */}
            {viewMode === 'keywords' && (
              <>
                <Button
                  variant={showUntagged ? "secondary" : "ghost"}
                  className="w-full justify-start mb-3"
                  onClick={() => {
                    setShowUntagged(!showUntagged);
                    setSelectedEntities(new Set()); // Clear entity filters when showing untagged
                    setCurrentPage(1);
                  }}
                  data-testid="category-untagged"
                >
                  <Tag className="w-4 h-4 mr-2" />
                  Untagged
                  <Badge variant="secondary" className="ml-auto">
                    {catalogData?.untaggedCount || 0}
                  </Badge>
                </Button>
                <div className="border-t border-slate-200 mb-4"></div>
              </>
            )}

            {/* View Mode Toggle */}
            <div className="flex gap-2 mb-4 p-1 bg-slate-100 rounded-lg">
              <Button
                variant={viewMode === 'keywords' ? 'default' : 'ghost'}
                size="sm"
                className="flex-1"
                onClick={() => {
                  setViewMode('keywords');
                  setSelectedEntities(new Set());
                  setShowUntagged(false);
                }}
                data-testid="toggle-keywords"
              >
                Keywords
              </Button>
              <Button
                variant={viewMode === 'topics' ? 'default' : 'ghost'}
                size="sm"
                className="flex-1"
                onClick={() => {
                  setViewMode('topics');
                  setSelectedEntities(new Set());
                  setShowUntagged(false);
                }}
                data-testid="toggle-topics"
              >
                Topics
              </Button>
            </div>
            
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-slate-900 flex items-center">
                <Filter className="w-5 h-5 mr-2" />
                {viewMode === 'keywords' ? 'Entities' : 'Topics'}
              </h2>
              {(selectedEntities.size > 0 || showUntagged || showManualOnly) && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setSelectedEntities(new Set());
                    setShowUntagged(false);
                    setShowManualOnly(false);
                  }}
                  data-testid="button-clear-filters"
                >
                  Clear filters
                </Button>
              )}
            </div>
            
            {/* Category Tree */}
            <div className="space-y-1">
              {categoryData && Array.isArray(categoryData) && categoryData.length > 0 ? (
                categoryData.map(({ category, entities, totalCount }) => {
                const Icon = getCategoryIcon(category);
                const isExpanded = expandedCategories.has(category);
                
                return (
                  <Collapsible
                    key={category}
                    open={isExpanded}
                    onOpenChange={() => toggleCategory(category)}
                  >
                    <CollapsibleTrigger asChild>
                      <Button
                        variant="ghost"
                        className="w-full justify-start"
                        data-testid={`category-${category}`}
                      >
                        {isExpanded ? (
                          <ChevronDown className="w-4 h-4 mr-1" />
                        ) : (
                          <ChevronRight className="w-4 h-4 mr-1" />
                        )}
                        <Icon className="w-4 h-4 mr-2" />
                          {categoryDisplayNames[category as MainCategory] || category.charAt(0).toUpperCase() + category.slice(1)}
                        <Badge variant="secondary" className="ml-auto">
                          {entities.length}
                        </Badge>
                      </Button>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="pl-6 space-y-1 mt-1">
                      {entities.map((entity: any) => {
                        const { name, count, category: entityCategory, isParent, children } = entity;
                        // Use entity's original category for filtering
                        const filterCategory = entityCategory || category;
                        const entityKey = `${filterCategory}::${name}`;
                        const isSelected = selectedEntities.has(entityKey);
                        
                        // Handle subcategories (nested structure)
                        if (isParent && children && Array.isArray(children) && children.length > 0) {
                          const nestedKey = `${name.toLowerCase().replace(/\s+/g, '-')}-${category}`;
                          const isNestedExpanded = expandedCategories.has(nestedKey);
                          return (
                            <div key={entityKey} className="space-y-1">
                              <Button
                                variant={isSelected ? "secondary" : "ghost"}
                                size="sm"
                                className="w-full justify-start text-sm"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setExpandedCategories(prev => {
                                    const next = new Set(prev);
                                    if (next.has(nestedKey)) {
                                      next.delete(nestedKey);
                                    } else {
                                      next.add(nestedKey);
                                    }
                                    return next;
                                  });
                                }}
                                data-testid={`entity-${entityKey}`}
                              >
                                {isSelected && <Check className="w-3 h-3 mr-1" />}
                                {isNestedExpanded ? (
                                  <ChevronDown className="w-3 h-3 mr-1" />
                                ) : (
                                  <ChevronRight className="w-3 h-3 mr-1" />
                                )}
                                <span className="flex-1 text-left truncate">{name}</span>
                                <Badge variant="outline" className="ml-2 text-xs">
                                  {count}
                                </Badge>
                              </Button>
                              {isNestedExpanded && (
                                <div className="pl-6 space-y-1">
                                  {children.map((child: any) => {
                                    const childFilterCategory = child.category || filterCategory;
                                    const childEntityKey = `${childFilterCategory}::${child.name}`;
                                    const isChildSelected = selectedEntities.has(childEntityKey);
                                    
                                    // Handle 3rd level nesting (sub-subcategory)
                                    if (child.isParent && child.children && Array.isArray(child.children) && child.children.length > 0) {
                                      const subNestedKey = `${child.name.toLowerCase().replace(/\s+/g, '-')}-${nestedKey}`;
                                      const isSubNestedExpanded = expandedCategories.has(subNestedKey);
                                      return (
                                        <div key={childEntityKey} className="space-y-1">
                                          <Button
                                            variant={isChildSelected ? "secondary" : "ghost"}
                                            size="sm"
                                            className="w-full justify-start text-xs"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              setExpandedCategories(prev => {
                                                const next = new Set(prev);
                                                if (next.has(subNestedKey)) {
                                                  next.delete(subNestedKey);
                                                } else {
                                                  next.add(subNestedKey);
                                                }
                                                return next;
                                              });
                                            }}
                                            data-testid={`entity-${childEntityKey}`}
                                          >
                                            {isChildSelected && <Check className="w-2 h-2 mr-1" />}
                                            {isSubNestedExpanded ? (
                                              <ChevronDown className="w-2 h-2 mr-1" />
                                            ) : (
                                              <ChevronRight className="w-2 h-2 mr-1" />
                                            )}
                                            <span className="flex-1 text-left truncate">{child.name}</span>
                                            <Badge variant="outline" className="ml-2 text-xs">
                                              {child.count}
                                            </Badge>
                                          </Button>
                                          {isSubNestedExpanded && (
                                            <div className="pl-6 space-y-1">
                                              {child.children.map((grandchild: any) => {
                                                const grandchildFilterCategory = grandchild.category || childFilterCategory;
                                                const grandchildEntityKey = `${grandchildFilterCategory}::${grandchild.name}`;
                                                const isGrandchildSelected = selectedEntities.has(grandchildEntityKey);
                                                return (
                                                  <div key={grandchildEntityKey} className="flex items-center group">
                                                  <Button
                                                    variant={isGrandchildSelected ? "secondary" : "ghost"}
                                                    size="sm"
                                                      className="flex-1 justify-start text-xs"
                                                    onClick={() => toggleEntity(grandchildFilterCategory, grandchild.name)}
                                                    data-testid={`entity-${grandchildEntityKey}`}
                                                  >
                                                    {isGrandchildSelected && <Check className="w-2 h-2 mr-1" />}
                                                    <span className="flex-1 text-left truncate">{grandchild.name}</span>
                                                    <Badge variant="outline" className="ml-2 text-xs">
                                                      {grandchild.count}
                                                    </Badge>
                                                  </Button>
                                                    <DropdownMenu>
                                                      <DropdownMenuTrigger asChild>
                                                        <Button
                                                          variant="ghost"
                                                          size="sm"
                                                          className="p-1 h-5 w-5 ml-1 opacity-0 group-hover:opacity-100 transition-opacity text-slate-400 hover:text-slate-600"
                                                          onClick={(e) => {
                                                            e.stopPropagation();
                                                          }}
                                                          title="Edit or delete tag"
                                                        >
                                                          <Pencil className="w-2.5 h-2.5" />
                                                        </Button>
                                                      </DropdownMenuTrigger>
                                                      <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                                                        <DropdownMenuItem
                                                          onClick={(e) => {
                                                            e.stopPropagation();
                                                            setTagToEdit({ name: grandchild.name, category: grandchildFilterCategory, count: grandchild.count });
                                                            setShowRenameDialog(true);
                                                          }}
                                                        >
                                                          <Pencil className="w-3 h-3 mr-2" />
                                                          Rename
                                                        </DropdownMenuItem>
                                                        <DropdownMenuItem
                                                          onClick={(e) => {
                                                            e.stopPropagation();
                                                            setTagToEdit({ name: grandchild.name, category: grandchildFilterCategory, count: grandchild.count });
                                                            setShowDeleteDialog(true);
                                                          }}
                                                          className="text-red-600 focus:text-red-600"
                                                        >
                                                          <Trash2 className="w-3 h-3 mr-2" />
                                                          Delete
                                                        </DropdownMenuItem>
                                                      </DropdownMenuContent>
                                                    </DropdownMenu>
                                                  </div>
                                                );
                                              })}
                                            </div>
                                          )}
                                        </div>
                                      );
                                    }
                                    
                                    // Regular child (no further nesting)
                                    return (
                                      <div key={childEntityKey} className="flex items-center group">
                                      <Button
                                        variant={isChildSelected ? "secondary" : "ghost"}
                                        size="sm"
                                          className="flex-1 justify-start text-xs"
                                        onClick={() => toggleEntity(childFilterCategory, child.name)}
                                        data-testid={`entity-${childEntityKey}`}
                                      >
                                        {isChildSelected && <Check className="w-2 h-2 mr-1" />}
                                        <span className="flex-1 text-left truncate">{child.name}</span>
                                        <Badge variant="outline" className="ml-2 text-xs">
                                          {child.count}
                                        </Badge>
                                      </Button>
                                        <DropdownMenu>
                                          <DropdownMenuTrigger asChild>
                                            <Button
                                              variant="ghost"
                                              size="sm"
                                              className="p-1 h-5 w-5 ml-1 opacity-0 group-hover:opacity-100 transition-opacity text-slate-400 hover:text-slate-600"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                              }}
                                              title="Edit or delete tag"
                                            >
                                              <Pencil className="w-2.5 h-2.5" />
                                            </Button>
                                          </DropdownMenuTrigger>
                                          <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                                            <DropdownMenuItem
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                setTagToEdit({ name: child.name, category: childFilterCategory, count: child.count });
                                                setShowRenameDialog(true);
                                              }}
                                            >
                                              <Pencil className="w-3 h-3 mr-2" />
                                              Rename
                                            </DropdownMenuItem>
                                            <DropdownMenuItem
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                setTagToEdit({ name: child.name, category: childFilterCategory, count: child.count });
                                                setShowDeleteDialog(true);
                                              }}
                                              className="text-red-600 focus:text-red-600"
                                            >
                                              <Trash2 className="w-3 h-3 mr-2" />
                                              Delete
                                            </DropdownMenuItem>
                                          </DropdownMenuContent>
                                        </DropdownMenu>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          );
                        }
                        
                        // Regular entity (no nesting)
                        return (
                          <div key={entityKey} className="flex items-center group">
                          <Button
                            variant={isSelected ? "secondary" : "ghost"}
                            size="sm"
                              className="flex-1 justify-start text-sm"
                            onClick={() => toggleEntity(filterCategory, name)}
                            data-testid={`entity-${entityKey}`}
                          >
                            {isSelected && <Check className="w-3 h-3 mr-1" />}
                            <span className="flex-1 text-left truncate">{name}</span>
                            <Badge variant="outline" className="ml-2 text-xs">
                              {count}
                            </Badge>
                          </Button>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="p-1 h-6 w-6 ml-1 opacity-0 group-hover:opacity-100 transition-opacity text-slate-400 hover:text-slate-600"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                  }}
                                  title="Edit or delete tag"
                                >
                                  <Pencil className="w-3 h-3" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                                <DropdownMenuItem
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setTagToEdit({ name, category: filterCategory, count });
                                    setShowRenameDialog(true);
                                  }}
                                >
                                  <Pencil className="w-3 h-3 mr-2" />
                                  Rename
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setTagToEdit({ name, category: filterCategory, count });
                                    setShowDeleteDialog(true);
                                  }}
                                  className="text-red-600 focus:text-red-600"
                                >
                                  <Trash2 className="w-3 h-3 mr-2" />
                                  Delete
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        );
                      })}
                    </CollapsibleContent>
                  </Collapsible>
                );
              })
              ) : (
                <p className="text-sm text-slate-500 text-center py-4">
                  No categories available
                </p>
              )}
            </div>

            {catalogError && (
              <p className="text-sm text-red-500 text-center py-4">
                Error loading tags: {catalogError.message}
              </p>
            )}
            {!catalogError && categoryData.length === 0 && catalogData && (
              <p className="text-sm text-slate-500 text-center py-4">
                No tags found in selected categories. Found {Object.keys(catalogData.entitiesByCategory || {}).length} total categories.
              </p>
            )}
            {!catalogError && !catalogData && (
              <p className="text-sm text-slate-500 text-center py-4">
                Loading tags...
              </p>
            )}
            {!catalogError && !catalogData && categoryData.length === 0 && (
              <p className="text-sm text-slate-500 text-center py-4">
                No tags found. Run "Tag All Database" to extract entities.
              </p>
            )}
          </Card>
        </div>

        {/* Right Panel - Date List (2/3) */}
        <div className="col-span-12 lg:col-span-8">
          <Card className="p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-slate-900 flex items-center">
                <Calendar className="w-5 h-5 mr-2" />
                {showUntagged ? "Untagged Analyses" : showManualOnly ? "Manually Imported Events" : "Tagged Analyses"}
              </h2>
              <div className="flex items-center space-x-3">
                {showManualOnly && (
                  <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-300">
                    Manual Only
                  </Badge>
                )}
                <span className="text-sm text-slate-600">
                  {totalCount} result{totalCount !== 1 ? 's' : ''}
                </span>
                {totalCount > 0 && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleCopyToClipboard}
                      disabled={selectAllMatching || selectedDates.size > 50}
                      className="flex items-center space-x-1"
                      data-testid="button-copy-txt"
                    >
                      <Copy className="w-4 h-4" />
                      <span>Copy TXT</span>
                    </Button>
                )}
              </div>
            </div>

            {/* Select All Banner */}
            {allPageSelected && totalCount > paginatedAnalyses.length && (
              <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-md flex items-center justify-center text-sm text-blue-900">
                {selectAllMatching ? (
                  <span>
                    All <b>{totalCount}</b> items are selected.
                    <button 
                      className="ml-2 font-medium underline hover:text-blue-700"
                      onClick={() => {
                        setSelectAllMatching(false);
                        setSelectedDates(new Set());
                      }}
                    >
                      Clear selection
                    </button>
                  </span>
                ) : (
                  <span>
                    All <b>{paginatedAnalyses.length}</b> items on this page are selected.
                    <button 
                      className="ml-2 font-medium underline hover:text-blue-700"
                      onClick={() => setSelectAllMatching(true)}
                    >
                      Select all {totalCount} items matching current filter
                    </button>
                  </span>
                )}
              </div>
            )}

            {/* Select All Checkbox */}
            {paginatedAnalyses.length > 0 && (
              <div className="flex items-center space-x-2 mb-4 pb-3 border-b">
                <Checkbox
                  checked={allPageSelected || selectAllMatching}
                  onCheckedChange={toggleSelectAll}
                  data-testid="checkbox-select-all"
                />
                <span className="text-sm text-slate-600">
                  Select all on this page
                </span>
              </div>
            )}

            {/* Pagination - Top */}
            {totalCount > 0 && (
              <div className="flex items-center justify-between mb-4 pb-4 border-b">
                <div className="flex items-center space-x-4">
                  <div className="text-sm text-slate-600">
                    Page {currentPage} of {totalPages}
                    <span className="mx-2">•</span>
                    Showing {((currentPage - 1) * pageSize) + 1}-{Math.min(currentPage * pageSize, totalCount)} of {totalCount}
                  </div>
                  
                  <div className="flex items-center space-x-2">
                    <span className="text-sm text-slate-600">Per page:</span>
                    <select 
                      value={pageSize}
                      onChange={(e) => {
                        setPageSize(Number(e.target.value));
                        setCurrentPage(1); // Reset to first page
                      }}
                      className="h-8 text-sm border border-slate-200 rounded-md px-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      {PAGE_SIZE_OPTIONS.map(size => (
                        <option key={size} value={size}>{size}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="flex items-center space-x-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                    data-testid="button-prev-page-top"
                  >
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                    disabled={currentPage === totalPages}
                    data-testid="button-next-page-top"
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}

            {/* Analysis List */}
            <div className="space-y-3 max-h-[500px] overflow-y-auto relative">
              {isLoading ? (
                <div className="flex items-center justify-center py-12">
                  <div className="text-center">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
                    <p className="mt-3 text-sm text-slate-600">Loading results...</p>
                  </div>
                </div>
              ) : paginatedAnalyses.length === 0 ? (
                <div className="text-center py-12">
                  <Tag className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                  <p className="text-slate-500">
                    {showUntagged
                      ? "No untagged analyses found"
                      : showManualOnly
                      ? "No manually imported events found"
                      : selectedEntities.size > 0
                      ? "No analyses match the selected entities"
                      : debouncedSearchQuery
                      ? "No analyses match your search"
                      : "No tagged analyses found"}
                  </p>
                </div>
              ) : (
                paginatedAnalyses.map((analysis) => {
                  const isSelected = selectedDates.has(analysis.date);
                  
                  return (
                    <div
                      key={analysis.date}
                      className={`border rounded-lg p-4 transition-colors relative ${
                        isSelected 
                          ? 'border-blue-400 bg-blue-50' 
                          : 'border-slate-200 hover:border-blue-300 hover:bg-blue-50/30'
                      }`}
                      data-testid={`analysis-${analysis.date}`}
                    >
                      {/* Link icon in top right */}
                      <div className="absolute top-4 right-4">
                        <Link href={`/day/${analysis.date}?from=tags`}>
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            className="p-1 h-6 w-6 hover:bg-orange-100 hover:text-orange-600"
                            title="View day details"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <ExternalLink className="w-4 h-4" />
                          </Button>
                        </Link>
                      </div>

                      <div className="flex items-start space-x-3 pr-8">
                        {/* Checkbox */}
                        <div onClick={(e) => e.stopPropagation()}>
                          <Checkbox
                            checked={isSelected}
                            onCheckedChange={() => toggleDateSelection(analysis.date)}
                            className="mt-1"
                            data-testid={`checkbox-${analysis.date}`}
                          />
                        </div>
                        
                        {/* Content */}
                        <div 
                          className="flex-1 cursor-pointer"
                          onClick={() => setDetailDate(analysis.date)}
                        >
                          <div className="flex items-center space-x-2 mb-2">
                              <Calendar className="w-4 h-4 text-slate-400" />
                              <span className="font-medium text-slate-900">
                                {new Date(analysis.date).toLocaleDateString('en-US', {
                                  year: 'numeric',
                                  month: 'long',
                                  day: 'numeric'
                                })}
                              </span>
                          </div>
                          
                          <p className="text-sm text-slate-700 mb-3">
                            {analysis.summary}
                          </p>

                          {/* Tags */}
                          {analysis.tags && analysis.tags.length > 0 && (
                            <div className="flex flex-wrap gap-2">
                              {analysis.tags.map((tag, idx) => {
                                const Icon = getCategoryIcon(tag.category);
                                return (
                                  <Badge
                                    key={`${tag.name}-${idx}`}
                                    variant="outline"
                                    className={`${getCategoryColor(tag.category)} flex items-center space-x-1 cursor-pointer hover:bg-slate-100 transition-colors`}
                                    data-testid={`tag-${tag.name}`}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setSearchQuery(tag.name);
                                    }}
                                    title={`Click to filter by ${tag.name}`}
                                  >
                                    <Icon className="w-3 h-3" />
                                    <span>{tag.name}</span>
                                  </Badge>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Pagination - Bottom */}
            {totalCount > 0 && (
              <div className="flex items-center justify-between mt-6 pt-4 border-t">
                <div className="flex items-center space-x-4">
                  <div className="text-sm text-slate-600">
                    Page {currentPage} of {totalPages}
                    <span className="mx-2">•</span>
                    Showing {((currentPage - 1) * pageSize) + 1}-{Math.min(currentPage * pageSize, totalCount)} of {totalCount}
                  </div>
                  
                  <div className="flex items-center space-x-2">
                    <span className="text-sm text-slate-600">Per page:</span>
                    <select 
                      value={pageSize}
                      onChange={(e) => {
                        setPageSize(Number(e.target.value));
                        setCurrentPage(1); // Reset to first page
                      }}
                      className="h-8 text-sm border border-slate-200 rounded-md px-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      {PAGE_SIZE_OPTIONS.map(size => (
                        <option key={size} value={size}>{size}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="flex items-center space-x-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                    data-testid="button-prev-page"
                  >
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                    disabled={currentPage === totalPages}
                    data-testid="button-next-page"
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </Card>
        </div>
      </div>

      {/* Detail Modal */}
      <Dialog open={!!detailDate} onOpenChange={(open) => !open && setDetailDate(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {detailAnalysis && new Date(detailAnalysis.date).toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'long',
                day: 'numeric'
              })}
            </DialogTitle>
          </DialogHeader>
          
          {detailAnalysis && (
            <div className="space-y-4">
              {/* Summary */}
              <div>
                <h3 className="text-sm font-semibold text-slate-700 mb-2">Summary</h3>
                <p className="text-sm text-slate-900">{detailAnalysis.summary}</p>
              </div>

              {/* Tier */}
              {detailAnalysis.tier && (
                <div>
                  <h3 className="text-sm font-semibold text-slate-700 mb-2">Tier</h3>
                  <Badge variant="outline">
                    Tier {detailAnalysis.tier}
                  </Badge>
                </div>
              )}

              {/* Tags */}
              {detailAnalysis.tags && detailAnalysis.tags.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-slate-700 mb-2">Extracted Entities</h3>
                  <div className="flex flex-wrap gap-2">
                    {detailAnalysis.tags.map((tag, idx) => {
                      const Icon = getCategoryIcon(tag.category);
                      return (
                        <Badge
                          key={`${tag.name}-${idx}`}
                          variant="outline"
                          className={`${getCategoryColor(tag.category)} flex items-center space-x-1`}
                        >
                          <Icon className="w-3 h-3" />
                          <span>{tag.name}</span>
                          <span className="text-xs opacity-70">({tag.category})</span>
                        </Badge>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Source URLs */}
              {(detailAnalysis.url || detailAnalysis.source_url) && (
                <div>
                  <h3 className="text-sm font-semibold text-slate-700 mb-2">Sources</h3>
                  <div className="space-y-1">
                    {detailAnalysis.url && (
                      <a
                        href={detailAnalysis.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-blue-600 hover:underline block truncate"
                      >
                        {detailAnalysis.url}
                      </a>
                    )}
                    {detailAnalysis.source_url && detailAnalysis.source_url !== detailAnalysis.url && (
                      <a
                        href={detailAnalysis.source_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-blue-600 hover:underline block truncate"
                      >
                        {detailAnalysis.source_url}
                      </a>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

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

      {/* Rename Tag Dialog */}
      <RenameDialog
        open={showRenameDialog}
        onOpenChange={setShowRenameDialog}
        tag={tagToEdit}
        onConfirm={async (newName) => {
          if (tagToEdit) {
            // First, find the actual category from the database
            try {
              const response = await fetch(`/api/tags-manager/find-categories?tagName=${encodeURIComponent(tagToEdit.name)}`);
              if (response.ok) {
                const data = await response.json();
                if (data.categories && data.categories.length > 0) {
                  // Use the most common category (first in the sorted list)
                  const actualCategory = data.categories[0].category;
                  console.log(`Found actual category for "${tagToEdit.name}": ${actualCategory} (was using: ${tagToEdit.category})`);
                  
                  // Rename using the actual category
                  renameTagMutation.mutate({
                    tagName: tagToEdit.name,
                    newName,
                    category: actualCategory,
                  });
                } else {
                  // No categories found - try with the provided category anyway
                  renameTagMutation.mutate({
                    tagName: tagToEdit.name,
                    newName,
                    category: tagToEdit.category,
                  });
                }
              } else {
                // If lookup fails, try with provided category
                renameTagMutation.mutate({
                  tagName: tagToEdit.name,
                  newName,
                  category: tagToEdit.category,
                });
              }
            } catch (error) {
              // If lookup fails, try with provided category
              console.error(`Error finding categories for "${tagToEdit.name}":`, error);
              renameTagMutation.mutate({
                tagName: tagToEdit.name,
                newName,
                category: tagToEdit.category,
              });
            }
          }
        }}
        isLoading={renameTagMutation.isPending}
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
  );
}
