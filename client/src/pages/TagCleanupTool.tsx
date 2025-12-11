import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  Tag, 
  RefreshCw, 
  AlertCircle, 
  CheckCircle2, 
  ArrowRight, 
  Sparkles,
  Filter,
  Search,
  Loader2
} from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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

interface UnmatchedTag {
  name: string;
  category: string;
  usageCount: number;
  suggestedMatches?: Array<{ name: string; category: string; similarity: number }>;
}

interface MergeSuggestion {
  source: { name: string; category: string };
  target: { name: string; category: string };
  confidence: number;
  usageCount: number;
}

interface Categorization {
  name: string;
  oldCategory: string;
  newCategory: string;
  usageCount: number;
}

export default function TagCleanupTool() {
  const queryClient = useQueryClient();
  const [selectedMerges, setSelectedMerges] = useState<Set<number>>(new Set());
  const [selectedCategorizations, setSelectedCategorizations] = useState<Set<number>>(new Set());
  const [selectedUnmatched, setSelectedUnmatched] = useState<Set<number>>(new Set());
  const [mergeThreshold, setMergeThreshold] = useState(0.85);
  const [searchQuery, setSearchQuery] = useState('');
  const [showApplyDialog, setShowApplyDialog] = useState(false);

  // Fetch unmatched tags
  const { data: unmatchedData, isLoading: isLoadingUnmatched, refetch: refetchUnmatched } = useQuery<{
    unmatched: UnmatchedTag[];
    total: number;
    totalUsage: number;
  }>({
    queryKey: ['tags-cleanup-unmatched'],
    queryFn: async () => {
      const response = await fetch('/api/tags-manager/unmatched');
      if (!response.ok) throw new Error('Failed to fetch unmatched tags');
      return response.json();
    },
  });

  // Fetch merge suggestions
  const { data: mergeSuggestions, isLoading: isLoadingMerges, refetch: refetchMerges } = useQuery<{
    suggestions: MergeSuggestion[];
    total: number;
    totalUsage: number;
  }>({
    queryKey: ['tags-cleanup-merges', mergeThreshold],
    queryFn: async () => {
      const response = await fetch('/api/tags-manager/auto-merge-suggestions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ threshold: mergeThreshold }),
      });
      if (!response.ok) throw new Error('Failed to fetch merge suggestions');
      return response.json();
    },
    enabled: false, // Manual trigger
  });

  // Fetch bulk categorizations
  const { data: categorizations, isLoading: isLoadingCategorizations, refetch: refetchCategorizations } = useQuery<{
    categorized: Categorization[];
    total: number;
    totalUsage: number;
  }>({
    queryKey: ['tags-cleanup-categorizations'],
    queryFn: async () => {
      const response = await fetch('/api/tags-manager/bulk-categorize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!response.ok) throw new Error('Failed to fetch categorizations');
      return response.json();
    },
    enabled: false, // Manual trigger
  });

  // Bulk apply mutation
  const bulkApplyMutation = useMutation({
    mutationFn: async (data: {
      merges?: MergeSuggestion[];
      categorizations?: Categorization[];
      addToMetadata?: Array<{ name: string; category: string; usageCount: number }>;
    }) => {
      const response = await fetch('/api/tags-manager/bulk-apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to apply changes');
      }
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: 'Changes Applied',
        description: `Successfully updated ${data.updated} analyses`,
      });
      setSelectedMerges(new Set());
      setSelectedCategorizations(new Set());
      setSelectedUnmatched(new Set());
      setShowApplyDialog(false);
      queryClient.invalidateQueries({ queryKey: ['tags-cleanup'] });
      queryClient.invalidateQueries({ queryKey: ['tags-manager-stats'] });
      queryClient.invalidateQueries({ queryKey: ['supabase-tags-catalog'] });
      refetchUnmatched();
      refetchMerges();
      refetchCategorizations();
    },
    onError: (error: Error) => {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const handleGenerateMerges = () => {
    refetchMerges();
  };

  const handleGenerateCategorizations = () => {
    refetchCategorizations();
  };

  const handleApplyChanges = () => {
    const mergesToApply = mergeSuggestions?.suggestions.filter((_, i) => selectedMerges.has(i)) || [];
    const categorizationsToApply = categorizations?.categorized.filter((_, i) => selectedCategorizations.has(i)) || [];
    const unmatchedToAdd = unmatchedData?.unmatched.filter((_, i) => selectedUnmatched.has(i)).map(tag => ({
      name: tag.name,
      category: tag.category,
      usageCount: tag.usageCount,
    })) || [];

    bulkApplyMutation.mutate({
      merges: mergesToApply,
      categorizations: categorizationsToApply,
      addToMetadata: unmatchedToAdd,
    });
  };

  const toggleMerge = (index: number) => {
    const newSet = new Set(selectedMerges);
    if (newSet.has(index)) {
      newSet.delete(index);
    } else {
      newSet.add(index);
    }
    setSelectedMerges(newSet);
  };

  const toggleCategorization = (index: number) => {
    const newSet = new Set(selectedCategorizations);
    if (newSet.has(index)) {
      newSet.delete(index);
    } else {
      newSet.add(index);
    }
    setSelectedCategorizations(newSet);
  };

  const toggleUnmatched = (index: number) => {
    const newSet = new Set(selectedUnmatched);
    if (newSet.has(index)) {
      newSet.delete(index);
    } else {
      newSet.add(index);
    }
    setSelectedUnmatched(newSet);
  };

  const selectAllMerges = () => {
    if (mergeSuggestions?.suggestions) {
      if (selectedMerges.size === mergeSuggestions.suggestions.length) {
        setSelectedMerges(new Set());
      } else {
        setSelectedMerges(new Set(mergeSuggestions.suggestions.map((_, i) => i)));
      }
    }
  };

  const selectAllCategorizations = () => {
    if (categorizations?.categorized) {
      if (selectedCategorizations.size === categorizations.categorized.length) {
        setSelectedCategorizations(new Set());
      } else {
        setSelectedCategorizations(new Set(categorizations.categorized.map((_, i) => i)));
      }
    }
  };

  const filteredUnmatched = unmatchedData?.unmatched.filter(tag =>
    tag.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    tag.category.toLowerCase().includes(searchQuery.toLowerCase())
  ) || [];

  const filteredMerges = mergeSuggestions?.suggestions.filter(suggestion =>
    suggestion.source.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    suggestion.target.name.toLowerCase().includes(searchQuery.toLowerCase())
  ) || [];

  const filteredCategorizations = categorizations?.categorized.filter(cat =>
    cat.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    cat.oldCategory.toLowerCase().includes(searchQuery.toLowerCase()) ||
    cat.newCategory.toLowerCase().includes(searchQuery.toLowerCase())
  ) || [];

  const totalSelected = selectedMerges.size + selectedCategorizations.size + selectedUnmatched.size;
  const canApply = totalSelected > 0 && !bulkApplyMutation.isPending;

  return (
    <div className="max-w-7xl mx-auto p-6">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 flex items-center gap-2">
              <Sparkles className="w-8 h-8 text-blue-600" />
              Tag Cleanup Tool
            </h1>
            <p className="text-slate-600 mt-1">
              Auto-merge suggestions, bulk categorize, and fix ~300 unmatched tags
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              onClick={() => {
                refetchUnmatched();
                refetchMerges();
                refetchCategorizations();
              }}
              variant="outline"
              disabled={isLoadingUnmatched || isLoadingMerges || isLoadingCategorizations}
            >
              <RefreshCw className={`w-4 h-4 mr-2 ${(isLoadingUnmatched || isLoadingMerges || isLoadingCategorizations) ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
            {canApply && (
              <Button
                onClick={() => setShowApplyDialog(true)}
                disabled={bulkApplyMutation.isPending}
              >
                <CheckCircle2 className="w-4 h-4 mr-2" />
                Apply {totalSelected} Changes
              </Button>
            )}
          </div>
        </div>

        {/* Stats */}
        {unmatchedData && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <Card className="p-4">
              <div className="text-sm text-slate-600 mb-1">Unmatched Tags</div>
              <div className="text-2xl font-bold text-slate-900">{unmatchedData.total}</div>
              <div className="text-xs text-slate-500 mt-1">{unmatchedData.totalUsage} occurrences</div>
            </Card>
            <Card className="p-4">
              <div className="text-sm text-slate-600 mb-1">Merge Suggestions</div>
              <div className="text-2xl font-bold text-slate-900">{mergeSuggestions?.total || 0}</div>
              <div className="text-xs text-slate-500 mt-1">{mergeSuggestions?.totalUsage || 0} occurrences</div>
            </Card>
            <Card className="p-4">
              <div className="text-sm text-slate-600 mb-1">Categorizations</div>
              <div className="text-2xl font-bold text-slate-900">{categorizations?.total || 0}</div>
              <div className="text-xs text-slate-500 mt-1">{categorizations?.totalUsage || 0} occurrences</div>
            </Card>
          </div>
        )}
      </div>

      {/* Search */}
      <div className="mb-6">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400 w-5 h-5" />
          <Input
            type="text"
            placeholder="Search tags..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="unmatched" className="space-y-4">
        <TabsList>
          <TabsTrigger value="unmatched">
            Unmatched Tags
            {unmatchedData && unmatchedData.total > 0 && (
              <Badge variant="secondary" className="ml-2">{unmatchedData.total}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="merges">
            Auto-Merge
            {mergeSuggestions && mergeSuggestions.total > 0 && (
              <Badge variant="secondary" className="ml-2">{mergeSuggestions.total}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="categorize">
            Bulk Categorize
            {categorizations && categorizations.total > 0 && (
              <Badge variant="secondary" className="ml-2">{categorizations.total}</Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* Unmatched Tags Tab */}
        <TabsContent value="unmatched" className="space-y-4">
          <Card>
            <div className="p-4 border-b">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold">Unmatched Tags</h3>
                <div className="flex items-center gap-2">
                  <Label htmlFor="select-all-unmatched" className="text-sm cursor-pointer">
                    Select All
                  </Label>
                  <Checkbox
                    id="select-all-unmatched"
                    checked={unmatchedData && selectedUnmatched.size === filteredUnmatched.length && filteredUnmatched.length > 0}
                    onCheckedChange={(checked) => {
                      if (checked) {
                        setSelectedUnmatched(new Set(filteredUnmatched.map((_, i) => i)));
                      } else {
                        setSelectedUnmatched(new Set());
                      }
                    }}
                  />
                </div>
              </div>
            </div>
            {isLoadingUnmatched ? (
              <div className="p-12 text-center">
                <Loader2 className="w-8 h-8 text-blue-600 animate-spin mx-auto mb-4" />
                <p className="text-slate-600">Loading unmatched tags...</p>
              </div>
            ) : filteredUnmatched.length === 0 ? (
              <div className="p-12 text-center">
                <CheckCircle2 className="w-12 h-12 text-green-500 mx-auto mb-4" />
                <h3 className="text-lg font-semibold text-slate-600 mb-2">All Tags Matched!</h3>
                <p className="text-slate-500">No unmatched tags found.</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12"></TableHead>
                    <TableHead>Tag Name</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead className="text-right">Usage Count</TableHead>
                    <TableHead>Suggestions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredUnmatched.map((tag, index) => (
                    <TableRow key={`${tag.name}-${tag.category}`}>
                      <TableCell>
                        <Checkbox
                          checked={selectedUnmatched.has(index)}
                          onCheckedChange={() => toggleUnmatched(index)}
                        />
                      </TableCell>
                      <TableCell className="font-medium">{tag.name}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{tag.category}</Badge>
                      </TableCell>
                      <TableCell className="text-right">{tag.usageCount}</TableCell>
                      <TableCell>
                        {tag.suggestedMatches && tag.suggestedMatches.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {tag.suggestedMatches.slice(0, 3).map((match, i) => (
                              <Badge key={i} variant="secondary" className="text-xs">
                                {match.name} ({Math.round(match.similarity * 100)}%)
                              </Badge>
                            ))}
                          </div>
                        ) : (
                          <span className="text-slate-400 text-sm">No suggestions</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Card>
        </TabsContent>

        {/* Auto-Merge Tab */}
        <TabsContent value="merges" className="space-y-4">
          <Card>
            <div className="p-4 border-b">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-semibold">Auto-Merge Suggestions</h3>
                  <p className="text-sm text-slate-600 mt-1">
                    High-confidence matches (e.g., "Obama" → "Barack Obama")
                  </p>
                </div>
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <Label htmlFor="threshold" className="text-sm">Threshold:</Label>
                    <Input
                      id="threshold"
                      type="number"
                      min="0"
                      max="1"
                      step="0.05"
                      value={mergeThreshold}
                      onChange={(e) => setMergeThreshold(parseFloat(e.target.value))}
                      className="w-20"
                    />
                  </div>
                  <Button onClick={handleGenerateMerges} disabled={isLoadingMerges}>
                    <Sparkles className="w-4 h-4 mr-2" />
                    Generate
                  </Button>
                  {mergeSuggestions && mergeSuggestions.suggestions.length > 0 && (
                    <div className="flex items-center gap-2">
                      <Label htmlFor="select-all-merges" className="text-sm cursor-pointer">
                        Select All
                      </Label>
                      <Checkbox
                        id="select-all-merges"
                        checked={selectedMerges.size === filteredMerges.length && filteredMerges.length > 0}
                        onCheckedChange={selectAllMerges}
                      />
                    </div>
                  )}
                </div>
              </div>
            </div>
            {isLoadingMerges ? (
              <div className="p-12 text-center">
                <Loader2 className="w-8 h-8 text-blue-600 animate-spin mx-auto mb-4" />
                <p className="text-slate-600">Generating merge suggestions...</p>
              </div>
            ) : !mergeSuggestions || filteredMerges.length === 0 ? (
              <div className="p-12 text-center">
                <AlertCircle className="w-12 h-12 text-slate-300 mx-auto mb-4" />
                <h3 className="text-lg font-semibold text-slate-600 mb-2">No Merge Suggestions</h3>
                <p className="text-slate-500 mb-4">Click "Generate" to find high-confidence merge candidates.</p>
                <Button onClick={handleGenerateMerges}>
                  <Sparkles className="w-4 h-4 mr-2" />
                  Generate Suggestions
                </Button>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12"></TableHead>
                    <TableHead>Source Tag</TableHead>
                    <TableHead className="w-8"></TableHead>
                    <TableHead>Target Tag</TableHead>
                    <TableHead className="text-right">Confidence</TableHead>
                    <TableHead className="text-right">Usage</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredMerges.map((suggestion, index) => (
                    <TableRow key={`${suggestion.source.name}-${suggestion.target.name}`}>
                      <TableCell>
                        <Checkbox
                          checked={selectedMerges.has(index)}
                          onCheckedChange={() => toggleMerge(index)}
                        />
                      </TableCell>
                      <TableCell>
                        <div>
                          <div className="font-medium">{suggestion.source.name}</div>
                          <Badge variant="outline" className="text-xs mt-1">
                            {suggestion.source.category}
                          </Badge>
                        </div>
                      </TableCell>
                      <TableCell>
                        <ArrowRight className="w-4 h-4 text-slate-400" />
                      </TableCell>
                      <TableCell>
                        <div>
                          <div className="font-medium">{suggestion.target.name}</div>
                          <Badge variant="outline" className="text-xs mt-1">
                            {suggestion.target.category}
                          </Badge>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge variant={suggestion.confidence >= 0.9 ? "default" : "secondary"}>
                          {Math.round(suggestion.confidence * 100)}%
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">{suggestion.usageCount}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Card>
        </TabsContent>

        {/* Bulk Categorize Tab */}
        <TabsContent value="categorize" className="space-y-4">
          <Card>
            <div className="p-4 border-b">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-semibold">Bulk Categorization</h3>
                  <p className="text-sm text-slate-600 mt-1">
                    Automatically categorize obvious tags (countries, people, companies, crypto)
                  </p>
                </div>
                <div className="flex items-center gap-4">
                  <Button onClick={handleGenerateCategorizations} disabled={isLoadingCategorizations}>
                    <Filter className="w-4 h-4 mr-2" />
                    Generate
                  </Button>
                  {categorizations && categorizations.categorized.length > 0 && (
                    <div className="flex items-center gap-2">
                      <Label htmlFor="select-all-cats" className="text-sm cursor-pointer">
                        Select All
                      </Label>
                      <Checkbox
                        id="select-all-cats"
                        checked={selectedCategorizations.size === filteredCategorizations.length && filteredCategorizations.length > 0}
                        onCheckedChange={selectAllCategorizations}
                      />
                    </div>
                  )}
                </div>
              </div>
            </div>
            {isLoadingCategorizations ? (
              <div className="p-12 text-center">
                <Loader2 className="w-8 h-8 text-blue-600 animate-spin mx-auto mb-4" />
                <p className="text-slate-600">Generating categorizations...</p>
              </div>
            ) : !categorizations || filteredCategorizations.length === 0 ? (
              <div className="p-12 text-center">
                <AlertCircle className="w-12 h-12 text-slate-300 mx-auto mb-4" />
                <h3 className="text-lg font-semibold text-slate-600 mb-2">No Categorizations</h3>
                <p className="text-slate-500 mb-4">Click "Generate" to find tags that need recategorization.</p>
                <Button onClick={handleGenerateCategorizations}>
                  <Filter className="w-4 h-4 mr-2" />
                  Generate Categorizations
                </Button>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12"></TableHead>
                    <TableHead>Tag Name</TableHead>
                    <TableHead>Old Category</TableHead>
                    <TableHead className="w-8"></TableHead>
                    <TableHead>New Category</TableHead>
                    <TableHead className="text-right">Usage</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredCategorizations.map((cat, index) => (
                    <TableRow key={`${cat.name}-${cat.oldCategory}-${cat.newCategory}`}>
                      <TableCell>
                        <Checkbox
                          checked={selectedCategorizations.has(index)}
                          onCheckedChange={() => toggleCategorization(index)}
                        />
                      </TableCell>
                      <TableCell className="font-medium">{cat.name}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{cat.oldCategory}</Badge>
                      </TableCell>
                      <TableCell>
                        <ArrowRight className="w-4 h-4 text-slate-400" />
                      </TableCell>
                      <TableCell>
                        <Badge>{cat.newCategory}</Badge>
                      </TableCell>
                      <TableCell className="text-right">{cat.usageCount}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Card>
        </TabsContent>
      </Tabs>

      {/* Apply Dialog */}
      <AlertDialog open={showApplyDialog} onOpenChange={setShowApplyDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Apply Changes?</AlertDialogTitle>
            <AlertDialogDescription>
              You are about to apply:
              <ul className="list-disc list-inside mt-2 space-y-1">
                {selectedMerges.size > 0 && (
                  <li>{selectedMerges.size} merge(s)</li>
                )}
                {selectedCategorizations.size > 0 && (
                  <li>{selectedCategorizations.size} categorization(s)</li>
                )}
                {selectedUnmatched.size > 0 && (
                  <li>{selectedUnmatched.size} tag(s) added to metadata</li>
                )}
              </ul>
              <p className="mt-2 font-medium">This action cannot be undone.</p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleApplyChanges}
              disabled={bulkApplyMutation.isPending}
            >
              {bulkApplyMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Applying...
                </>
              ) : (
                'Apply Changes'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}








