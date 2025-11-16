import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Calendar, Search, TrendingUp, Clock } from 'lucide-react';
import { useLocation } from 'wouter';

interface QuickDatePickerProps {
  onDateSelect: (date: string) => void;
  className?: string;
}

export default function QuickDatePicker({ onDateSelect, className = '' }: QuickDatePickerProps) {
  const [, setLocation] = useLocation();
  const [inputDate, setInputDate] = useState('');
  const [isOpen, setIsOpen] = useState(false);

  const quickDates = [
    { label: 'Today', date: new Date().toISOString().split('T')[0] },
    { label: 'Yesterday', date: new Date(Date.now() - 86400000).toISOString().split('T')[0] },
    { label: 'Last Week', date: new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0] },
    { label: 'Last Month', date: new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0] },
  ];

  const historicalEvents = [
    { label: 'Bitcoin Genesis', date: '2009-01-03', icon: '🚀' },
    { label: 'First $1', date: '2011-02-09', icon: '💰' },
    { label: 'Mt. Gox Collapse', date: '2014-02-28', icon: '💥' },
    { label: 'First $10k', date: '2017-11-28', icon: '📈' },
    { label: 'Tesla Investment', date: '2021-02-08', icon: '🚗' },
    { label: 'El Salvador Legal', date: '2021-09-07', icon: '🏛️' },
    { label: 'ATH $69k', date: '2021-11-10', icon: '🎯' },
  ];

  const handleDateSubmit = (date: string) => {
    const formattedDate = date || inputDate;
    if (formattedDate) {
      onDateSelect(formattedDate);
      
      // Detect current context to determine source parameter
      const currentPath = window.location.pathname;
      let source = 'month'; // default
      if (currentPath === '/') {
        source = 'annual';
      } else if (currentPath.includes('/month/')) {
        source = 'month';
      }
      
      setLocation(`/day/${formattedDate}?from=${source}`);
      setIsOpen(false);
      setInputDate('');
    }
  };

  const formatDateForDisplay = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  };

  if (!isOpen) {
    return (
      <Button
        onClick={() => setIsOpen(true)}
        variant="outline"
        size="sm"
        className={`${className} bg-white dark:bg-gray-900`}
      >
        <Search className="w-4 h-4 mr-2" />
        Jump to Date
      </Button>
    );
  }

  return (
    <Card className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-96 z-50 shadow-xl bg-white dark:bg-gray-900">
      <CardContent className="p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Calendar className="w-5 h-5" />
            Quick Date Jump
          </h3>
          <Button onClick={() => setIsOpen(false)} variant="ghost" size="sm">
            ×
          </Button>
        </div>

        {/* Manual Date Input */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
            Enter Date (YYYY-MM-DD)
          </label>
          <div className="flex gap-2">
            <Input
              type="date"
              value={inputDate}
              onChange={(e) => setInputDate(e.target.value)}
              className="flex-1"
              placeholder="2024-12-01"
            />
            <Button 
              onClick={() => handleDateSubmit(inputDate)}
              disabled={!inputDate}
              size="sm"
            >
              Go
            </Button>
          </div>
        </div>

        {/* Quick Date Options */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-2">
            <Clock className="w-4 h-4" />
            Quick Options
          </label>
          <div className="grid grid-cols-2 gap-2">
            {quickDates.map((item) => (
              <Button
                key={item.label}
                onClick={() => handleDateSubmit(item.date)}
                variant="outline"
                size="sm"
                className="justify-start"
              >
                {item.label}
              </Button>
            ))}
          </div>
        </div>

        {/* Historical Events */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-2">
            <TrendingUp className="w-4 h-4" />
            Historical Events
          </label>
          <div className="space-y-1 max-h-48 overflow-y-auto">
            {historicalEvents.map((event) => (
              <Button
                key={event.date}
                onClick={() => handleDateSubmit(event.date)}
                variant="ghost"
                size="sm"
                className="w-full justify-between h-auto p-2"
              >
                <div className="flex items-center gap-2">
                  <span>{event.icon}</span>
                  <span className="text-sm">{event.label}</span>
                </div>
                <span className="text-xs text-gray-500">
                  {formatDateForDisplay(event.date)}
                </span>
              </Button>
            ))}
          </div>
        </div>

        <div className="text-xs text-gray-500 text-center">
          Jump directly to any date to see Bitcoin news analysis
        </div>
      </CardContent>
    </Card>
  );
}