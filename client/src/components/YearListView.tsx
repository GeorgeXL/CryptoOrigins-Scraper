import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CalendarDays, Eye, Loader2, Calendar, TrendingUp, TrendingDown, Minus, ExternalLink } from "lucide-react";
import { format, parseISO } from "date-fns";
import { Link } from "wouter";
import { FlagButton } from "@/components/FlagButton";

interface YearListViewProps {
  year: number;
}

interface Analysis {
  id: string;
  date: string;
  summary: string;
  confidence: number;
  sentiment: number;
  isManualOverride: boolean;
  isFlagged?: boolean;
  flagReason?: string;
}

interface YearProgress {
  totalDays: number;
  analyzedDays: number;
  completionPercentage: number;
  unanalyzedDates: string[];
}

export default function YearListView({ year }: YearListViewProps) {
  const { data: yearProgress, isLoading: isLoadingProgress } = useQuery<YearProgress>({
    queryKey: [`/api/analysis/year/${year}`],
  });

  const { data: analyses, isLoading: isLoadingAnalyses } = useQuery<Analysis[]>({
    queryKey: [`/api/analysis/filter?startDate=${year}-01-01&endDate=${year}-12-31`],
  });

  // Generate all dates for the year
  const generateDatesForYear = (year: number) => {
    const dates = [];
    const startDate = new Date(year, 0, 1);
    const endDate = new Date(year, 11, 31);
    
    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
      dates.push(new Date(d).toISOString().split('T')[0]);
    }
    
    return dates;
  };

  const allDates = generateDatesForYear(year);
  const analysisMap = new Map(analyses?.map(analysis => [analysis.date, analysis]) || []);

  // Get analysis for a specific date
  const getAnalysisForDate = (date: string) => {
    return analysisMap.get(date);
  };

  // Get sentiment color
  const getSentimentColor = (sentiment: number) => {
    if (sentiment >= 4) return "text-green-600 bg-green-50";
    if (sentiment >= 3) return "text-blue-600 bg-blue-50";
    if (sentiment >= 2) return "text-yellow-600 bg-yellow-50";
    return "text-red-600 bg-red-50";
  };

  // Get sentiment icon
  const getSentimentIcon = (sentiment: number) => {
    if (sentiment >= 3) return TrendingUp;
    if (sentiment >= 2) return Minus;
    return TrendingDown;
  };

  if (isLoadingProgress || isLoadingAnalyses) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="w-5 h-5" />
            {year}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex justify-center items-center py-8">
            <Loader2 className="w-6 h-6 animate-spin" />
          </div>
        </CardContent>
      </Card>
    );
  }

  // Show all dates in the year (both analyzed and unanalyzed)
  // Sort dates chronologically from January to December
  const sortedDates = allDates.sort((a, b) => new Date(a).getTime() - new Date(b).getTime()); // January first

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Calendar className="w-5 h-5" />
            {year}
          </CardTitle>
          <div className="text-sm text-slate-500">
            {yearProgress?.analyzedDays || 0}/{yearProgress?.totalDays || 0} days analyzed
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {sortedDates.length === 0 ? (
          <div className="text-center py-8">
            <div className="w-16 h-16 mx-auto mb-4 bg-slate-100 rounded-full flex items-center justify-center">
              <Calendar className="w-8 h-8 text-slate-400" />
            </div>
            <p className="text-slate-500 mb-2">No dates in {year}</p>
            <p className="text-sm text-slate-400">No dates found for this year</p>
          </div>
        ) : (
          <div className="space-y-2">
            {/* List Header */}
            <div className="flex items-center text-xs font-medium text-slate-500 border-b border-slate-200 pb-2 mb-4">
              <div className="w-24">Date</div>
              <div className="flex-1 px-4">Summary</div>
              <div className="w-20 text-center">Sentiment</div>
              <div className="w-20 text-center">Confidence</div>
              <div className="w-20 text-center">Actions</div>
            </div>

            {/* List Items */}
            {sortedDates.map(date => {
              const analysis = getAnalysisForDate(date);
              const isAnalyzed = !!analysis;

              const dateObj = parseISO(date);
              const isToday = date === new Date().toISOString().split('T')[0];
              const SentimentIcon = isAnalyzed ? getSentimentIcon(analysis.sentiment || 0) : Minus;
              
              return (
                <div
                  key={date}
                  className={`
                    flex items-center py-3 px-2 rounded-lg border transition-all duration-200 hover:shadow-md hover:bg-slate-50
                    ${isToday ? 'ring-2 ring-orange-500 ring-opacity-30 bg-orange-50' : 'bg-white border-slate-200'}
                  `}
                >
                  {/* Main clickable area */}
                  <Link href={`/day/${date}?from=annual`} className="flex items-center flex-1 cursor-pointer">
                    {/* Date */}
                    <div className="w-24">
                      <div className={`text-sm font-medium ${isToday ? 'text-orange-600' : 'text-slate-900'}`}>
                        {format(dateObj, 'MMM d')}
                      </div>
                      <div className="text-xs text-slate-500">
                        {format(dateObj, 'EEE')}
                      </div>
                    </div>

                    {/* Summary */}
                    <div className="flex-1 px-4">
                      {isAnalyzed ? (
                        <div>
                          <div className="text-sm text-slate-900 leading-relaxed line-clamp-2">
                            {analysis.summary}
                          </div>
                          {analysis.isManualOverride && (
                            <Badge variant="secondary" className="text-xs mt-1">
                              Key Date
                            </Badge>
                          )}
                        </div>
                      ) : (
                        <div className="text-sm text-slate-500 italic">
                          No analysis available
                        </div>
                      )}
                    </div>

                    {/* Sentiment */}
                    <div className="w-20 text-center">
                      {isAnalyzed ? (
                        <div className={`
                          inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium
                          ${getSentimentColor(analysis.sentiment || 0)}
                        `}>
                          <SentimentIcon className="w-3 h-3" />
                          <span>{(analysis.sentiment || 0).toFixed(1)}</span>
                        </div>
                      ) : (
                        <div className="text-xs text-slate-400">
                          --
                        </div>
                      )}
                    </div>

                    {/* Confidence */}
                    <div className="w-20 text-center">
                      {isAnalyzed ? (
                        <div className="text-sm font-medium text-slate-900">
                          {(analysis.confidence || 0).toFixed(0)}%
                        </div>
                      ) : (
                        <div className="text-xs text-slate-400">
                          --
                        </div>
                      )}
                    </div>
                  </Link>

                  {/* Actions - separate from main clickable area */}
                  <div className="w-20 text-center flex-shrink-0">
                    <div className="flex items-center justify-center gap-2">
                      {isAnalyzed && (
                        <FlagButton
                          date={date}
                          isFlagged={analysis.isFlagged || false}
                          flagReason={analysis.flagReason}
                          type="analysis"
                        />
                      )}
                      <Link href={`/day/${date}?from=annual`}>
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          className="p-1 h-6 w-6 hover:bg-orange-100 hover:text-orange-600"
                          title="View day details"
                        >
                          <ExternalLink className="w-4 h-4" />
                        </Button>
                      </Link>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Year summary stats */}
        <div className="mt-6 pt-4 border-t border-slate-200">
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div className="text-center">
              <div className="font-semibold text-slate-900">{yearProgress?.analyzedDays || 0}</div>
              <div className="text-slate-500">Analyzed</div>
            </div>
            <div className="text-center">
              <div className="font-semibold text-slate-900">
                {Math.round(yearProgress?.completionPercentage || 0)}%
              </div>
              <div className="text-slate-500">Complete</div>
            </div>
            <div className="text-center">
              <div className="font-semibold text-slate-900">
                {(yearProgress?.totalDays || 0) - (yearProgress?.analyzedDays || 0)}
              </div>
              <div className="text-slate-500">Remaining</div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}