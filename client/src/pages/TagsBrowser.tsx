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
  Copy
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

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

const ITEMS_PER_PAGE = 50;

export default function TagsBrowser() {
  const { toast } = useToast();
  
  // View mode state - toggle between Keywords and Topics
  const [viewMode, setViewMode] = useState<'keywords' | 'topics'>('keywords');
  
  // Category panel state
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [selectedEntities, setSelectedEntities] = useState<Set<string>>(new Set());
  const [showUntagged, setShowUntagged] = useState(false);
  const [showManualOnly, setShowManualOnly] = useState(false);
  
  // Date list state
  const [selectedDates, setSelectedDates] = useState<Set<string>>(new Set());
  const [currentPage, setCurrentPage] = useState(1);
  
  // Search and modal state
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState("");
  const [detailDate, setDetailDate] = useState<string | null>(null);

  // New state for the copy dialog
  const [showCopyDialog, setShowCopyDialog] = useState(false);
  const [textToCopy, setTextToCopy] = useState("");

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

  // Fetch catalog data for sidebar
  const { data: catalogData } = useQuery<{
    entitiesByCategory: Record<string, { category: string; name: string; count: number }[]>;
    taggedCount: number;
    untaggedCount: number;
    totalAnalyses: number;
  }>({
    queryKey: ['/api/tags/catalog', showManualOnly],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (showManualOnly) {
        params.set('manualOnly', 'true');
      }
      const url = `/api/tags/catalog${params.toString() ? `?${params}` : ''}`;
      const response = await fetch(url);
      if (!response.ok) throw new Error('Failed to fetch catalog');
      return response.json();
    },
  });

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
    queryKey: ['/api/tags/analyses', Array.from(selectedEntities).sort().join(','), showUntagged, debouncedSearchQuery, currentPage, showManualOnly],
    refetchOnMount: true,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      // Build query params inside queryFn to avoid closure issues
      const params = new URLSearchParams();
      if (selectedEntities.size > 0) {
        params.set('entities', Array.from(selectedEntities).join(','));
      }
      if (showUntagged) {
        params.set('untagged', 'true');
      }
      if (showManualOnly) {
        params.set('manualOnly', 'true');
      }
      if (debouncedSearchQuery) {
        params.set('search', debouncedSearchQuery);
      }
      params.set('page', currentPage.toString());
      params.set('pageSize', ITEMS_PER_PAGE.toString());
      
      const url = `/api/tags/analyses?${params}`;
      console.log('🌐 Fetching:', url);
      const response = await fetch(url);
      if (!response.ok) throw new Error('Failed to fetch analyses');
      const data = await response.json();
      console.log('📦 Received:', data.analyses?.length || 0, 'analyses, total count:', data.pagination?.totalCount || 0);
      return data;
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
  
  // Filter categories based on view mode
  const ENTITY_CATEGORIES = ['country', 'company', 'person', 'crypto', 'cryptocurrency', 'organization', 'protocol'];
  const categoryData = viewMode === 'keywords'
    ? allCategoryData.filter(({ category }) => ENTITY_CATEGORIES.includes(category.toLowerCase()))
    : allCategoryData.filter(({ category }) => category.toLowerCase() === 'topic');
  
  const paginatedAnalyses = analysesData?.analyses || [];
  const totalPages = analysesData?.pagination.totalPages || 1;
  const totalCount = analysesData?.pagination.totalCount || 0;

  // Get icon for category
  const getCategoryIcon = (category: string) => {
    switch (category.toLowerCase()) {
      case 'country':
        return Globe;
      case 'company':
        return Building;
      case 'person':
        return User;
      case 'crypto':
      case 'cryptocurrency':
        return Coins;
      case 'organization':
        return Building2;
      case 'protocol':
        return Hash;
      case 'topic':
        return Sparkles;
      case 'system':
        return Minus;
      default:
        return Tag;
    }
  };

  // Get color for category
  const getCategoryColor = (category: string) => {
    switch (category.toLowerCase()) {
      case 'country':
        return 'bg-blue-100 text-blue-700 border-blue-300';
      case 'company':
        return 'bg-purple-100 text-purple-700 border-purple-300';
      case 'person':
        return 'bg-green-100 text-green-700 border-green-300';
      case 'crypto':
      case 'cryptocurrency':
        return 'bg-orange-100 text-orange-700 border-orange-300';
      case 'organization':
        return 'bg-indigo-100 text-indigo-700 border-indigo-300';
      case 'protocol':
        return 'bg-cyan-100 text-cyan-700 border-cyan-300';
      case 'topic':
        return 'bg-pink-100 text-pink-700 border-pink-300';
      case 'system':
        return 'bg-gray-100 text-gray-500 border-gray-300 italic';
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
  };

  // Select/deselect all on current page
  const toggleSelectAll = () => {
    // Check if all items on current page are selected (ignore other pages)
    const allPageSelected = paginatedAnalyses.every(a => selectedDates.has(a.date));
    
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

  // Bulk add tags mutation
  const bulkAddMutation = useMutation({
    mutationFn: async ({ dates, tag }: { dates: string[]; tag: EntityTag }) => {
      return apiRequest('POST', '/api/tags/bulk-add', { dates, tag });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/tags/catalog'] });
      queryClient.invalidateQueries({ queryKey: ['/api/tags/analyses'] });
      toast({
        title: "Tags Added",
        description: `Successfully added tag to ${selectedDates.size} analyses`,
      });
      setShowBulkAdd(false);
      setBulkTagName("");
      setSelectedDates(new Set());
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/tags/catalog'] });
      queryClient.invalidateQueries({ queryKey: ['/api/tags/analyses'] });
      queryClient.invalidateQueries({ queryKey: ['/api/tags/selected-summaries-tags'] });
      toast({
        title: "Tag Removed",
        description: `Successfully removed tag from ${selectedDates.size} analyses`,
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

  const handleBulkAdd = () => {
    if (!bulkTagName.trim()) {
      toast({
        title: "Error",
        description: "Please enter a tag name",
        variant: "destructive"
      });
      return;
    }
    
    bulkAddMutation.mutate({
      dates: Array.from(selectedDates),
      tag: {
        name: bulkTagName.trim(),
        category: bulkTagCategory
      }
    });
  };

  // Fetch unique tags from selected summaries for bulk remove
  const { data: selectedSummariesTags = [], isLoading: isLoadingTags } = useQuery<EntityTag[]>({
    queryKey: ['/api/tags/selected-summaries-tags', Array.from(selectedDates).sort()],
    queryFn: async () => {
      if (selectedDates.size === 0) return [];
      
      const response = await fetch('/api/tags/selected-summaries-tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dates: Array.from(selectedDates) })
      });
      
      if (!response.ok) {
        throw new Error('Failed to fetch tags');
      }
      
      const data = await response.json();
      return data.tags || [];
    },
    enabled: showBulkRemove && selectedDates.size > 0,
  });

  const handleBulkRemove = (tag: EntityTag) => {
    bulkRemoveMutation.mutate({
      dates: Array.from(selectedDates),
      tag
    });
  };

  // Copy all filtered results to clipboard as TXT
  const handleCopyToClipboard = async () => {
    try {
      // Fetch all results (without pagination) for the current filters
      const allQueryParams = new URLSearchParams();
      if (selectedEntities.size > 0) {
        allQueryParams.set('entities', Array.from(selectedEntities).join(','));
      }
      if (showUntagged) {
        allQueryParams.set('untagged', 'true');
      }
      if (debouncedSearchQuery) {
        allQueryParams.set('search', debouncedSearchQuery);
      }
      // Don't set page/pageSize to get all results
      allQueryParams.set('all', 'true');

      const response = await fetch(`/api/tags/analyses?${allQueryParams}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch analyses: ${response.status} ${response.statusText}`);
      }
      
      const data = await response.json();
      const allAnalyses: HistoricalNewsAnalysis[] = data.analyses || [];

      if (allAnalyses.length === 0) {
        toast({
          title: "Nothing to Copy",
          description: "No analyses found to copy",
          variant: "destructive"
        });
        return;
      }

      // Format all filtered analyses
      const textOutput = allAnalyses
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
      {selectedDates.size > 0 && (
        <Card className="p-4 bg-blue-50 border-blue-200">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <Check className="w-5 h-5 text-blue-600" />
              <span className="font-medium text-blue-900">
                {selectedDates.size} date{selectedDates.size !== 1 ? 's' : ''} selected
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
                onClick={() => setSelectedDates(new Set())}
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
              {categoryData.map(({ category, entities, totalCount }) => {
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
                        {category.charAt(0).toUpperCase() + category.slice(1)}
                        <Badge variant="secondary" className="ml-auto">
                          {entities.length}
                        </Badge>
                      </Button>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="pl-6 space-y-1 mt-1">
                      {entities.map(({ name, count }) => {
                        const entityKey = `${category}::${name}`;
                        const isSelected = selectedEntities.has(entityKey);
                        
                        return (
                          <Button
                            key={entityKey}
                            variant={isSelected ? "secondary" : "ghost"}
                            size="sm"
                            className="w-full justify-start text-sm"
                            onClick={() => toggleEntity(category, name)}
                            data-testid={`entity-${entityKey}`}
                          >
                            {isSelected && <Check className="w-3 h-3 mr-1" />}
                            <span className="flex-1 text-left truncate">{name}</span>
                            <Badge variant="outline" className="ml-2 text-xs">
                              {count}
                            </Badge>
                          </Button>
                        );
                      })}
                    </CollapsibleContent>
                  </Collapsible>
                );
              })}
            </div>

            {categoryData.length === 0 && (
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
                    className="flex items-center space-x-1"
                    data-testid="button-copy-txt"
                  >
                    <Copy className="w-4 h-4" />
                    <span>Copy TXT</span>
                  </Button>
                )}
              </div>
            </div>

            {/* Select All Checkbox */}
            {paginatedAnalyses.length > 0 && (
              <div className="flex items-center space-x-2 mb-4 pb-3 border-b">
                <Checkbox
                  checked={allPageSelected}
                  onCheckedChange={toggleSelectAll}
                  data-testid="checkbox-select-all"
                />
                <span className="text-sm text-slate-600">
                  Select all on this page
                </span>
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
                      className={`border rounded-lg p-4 transition-colors ${
                        isSelected 
                          ? 'border-blue-400 bg-blue-50' 
                          : 'border-slate-200 hover:border-blue-300 hover:bg-blue-50/30'
                      }`}
                      data-testid={`analysis-${analysis.date}`}
                    >
                      <div className="flex items-start space-x-3">
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
                                    className={`${getCategoryColor(tag.category)} flex items-center space-x-1`}
                                    data-testid={`tag-${tag.name}`}
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

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between mt-6 pt-4 border-t">
                <div className="text-sm text-slate-600">
                  Page {currentPage} of {totalPages}
                  <span className="mx-2">•</span>
                  Showing {((currentPage - 1) * ITEMS_PER_PAGE) + 1}-{Math.min(currentPage * ITEMS_PER_PAGE, totalCount)} of {totalCount}
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
            <DialogTitle>Add Tag to {selectedDates.size} Analyses</DialogTitle>
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
            <DialogTitle>Remove Tags from {selectedDates.size} Analyses</DialogTitle>
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
    </div>
  );
}
