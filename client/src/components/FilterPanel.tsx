import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { CalendarIcon, Filter, X } from 'lucide-react';
import { format } from 'date-fns';

interface FilterConfig {
  confidenceRange: [number, number];
  sentiment: 'all' | 'bullish' | 'bearish' | 'neutral';
  topics: string[];
  dateRange: {
    start: Date | null;
    end: Date | null;
  };
}

interface FilterPanelProps {
  onFilterChange: (filters: FilterConfig) => void;
  onClearFilters: () => void;
  isVisible: boolean;
  onToggle: () => void;
}

const AVAILABLE_TOPICS = [
  'regulation',
  'adoption', 
  'price',
  'technology',
  'mining',
  'institutional',
  'security',
  'market'
];

export default function FilterPanel({ onFilterChange, onClearFilters, isVisible, onToggle }: FilterPanelProps) {
  const [filters, setFilters] = useState<FilterConfig>({
    confidenceRange: [0, 100],
    sentiment: 'all',
    topics: [],
    dateRange: {
      start: null,
      end: null
    }
  });

  const updateFilters = (newFilters: Partial<FilterConfig>) => {
    const updated = { ...filters, ...newFilters };
    setFilters(updated);
    onFilterChange(updated);
  };

  const handleTopicToggle = (topic: string, checked: boolean) => {
    const newTopics = checked 
      ? [...filters.topics, topic]
      : filters.topics.filter(t => t !== topic);
    updateFilters({ topics: newTopics });
  };

  const clearAllFilters = () => {
    const defaultFilters: FilterConfig = {
      confidenceRange: [0, 100],
      sentiment: 'all',
      topics: [],
      dateRange: { start: null, end: null }
    };
    setFilters(defaultFilters);
    onClearFilters();
  };

  if (!isVisible) {
    return (
      <Button
        onClick={onToggle}
        variant="outline"
        size="sm"
        className="fixed top-4 right-4 z-50 bg-white dark:bg-gray-900 shadow-lg"
      >
        <Filter className="w-4 h-4 mr-2" />
        Filters
      </Button>
    );
  }

  return (
    <Card className="fixed top-4 right-4 w-80 z-50 shadow-lg bg-white dark:bg-gray-900">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">Advanced Filters</CardTitle>
          <Button onClick={onToggle} variant="ghost" size="sm">
            <X className="w-4 h-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Confidence Score Range */}
        <div className="space-y-2">
          <Label className="text-sm font-medium">Confidence Score</Label>
          <div className="px-2">
            <Slider
              value={filters.confidenceRange}
              onValueChange={(value) => updateFilters({ confidenceRange: value as [number, number] })}
              min={0}
              max={100}
              step={5}
              className="w-full"
            />
          </div>
          <div className="flex justify-between text-sm text-gray-600 dark:text-gray-400">
            <span>{filters.confidenceRange[0]}%</span>
            <span>{filters.confidenceRange[1]}%</span>
          </div>
        </div>

        {/* Sentiment Filter */}
        <div className="space-y-2">
          <Label className="text-sm font-medium">Sentiment</Label>
          <Select 
            value={filters.sentiment} 
            onValueChange={(value) => updateFilters({ sentiment: value as FilterConfig['sentiment'] })}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select sentiment" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Sentiments</SelectItem>
              <SelectItem value="bullish">🟢 Bullish</SelectItem>
              <SelectItem value="neutral">🟡 Neutral</SelectItem>
              <SelectItem value="bearish">🔴 Bearish</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Topic Categories */}
        <div className="space-y-2">
          <Label className="text-sm font-medium">Topics</Label>
          <div className="grid grid-cols-2 gap-2">
            {AVAILABLE_TOPICS.map((topic) => (
              <div key={topic} className="flex items-center space-x-2">
                <Checkbox
                  id={topic}
                  checked={filters.topics.includes(topic)}
                  onCheckedChange={(checked) => handleTopicToggle(topic, checked as boolean)}
                />
                <Label 
                  htmlFor={topic} 
                  className="text-sm capitalize cursor-pointer"
                >
                  {topic}
                </Label>
              </div>
            ))}
          </div>
        </div>

        {/* Date Range */}
        <div className="space-y-2">
          <Label className="text-sm font-medium">Date Range</Label>
          <div className="grid grid-cols-2 gap-2">
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="justify-start text-left font-normal">
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {filters.dateRange.start ? format(filters.dateRange.start, 'MMM dd') : 'Start date'}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={filters.dateRange.start || undefined}
                  onSelect={(date) => updateFilters({ 
                    dateRange: { ...filters.dateRange, start: date || null } 
                  })}
                />
              </PopoverContent>
            </Popover>
            
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="justify-start text-left font-normal">
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {filters.dateRange.end ? format(filters.dateRange.end, 'MMM dd') : 'End date'}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={filters.dateRange.end || undefined}
                  onSelect={(date) => updateFilters({ 
                    dateRange: { ...filters.dateRange, end: date || null } 
                  })}
                />
              </PopoverContent>
            </Popover>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-2 pt-4">
          <Button onClick={clearAllFilters} variant="outline" size="sm" className="flex-1">
            Clear All
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}