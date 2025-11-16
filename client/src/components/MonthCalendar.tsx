import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { 
  CheckCircle, 
  CircleAlert, 
  Clock, 
  Star,
  Edit,
  AlertTriangle,
  Check,
  X,
  AlertCircle
} from "lucide-react";
import { FlagButton } from "./FlagButton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface Analysis {
  date: string;
  summary: string;
  hasManualEntry: boolean;
  confidenceScore: number;
  isFlagged?: boolean;
  flagReason?: string;
  factCheckVerdict?: 'verified' | 'contradicted' | 'uncertain' | null;
  factCheckConfidence?: number | null;
  factCheckReasoning?: string | null;
}

interface MonthCalendarProps {
  year: number;
  month: number;
  analyses: Analysis[];
}

export default function MonthCalendar({ year, month, analyses }: MonthCalendarProps) {
  const daysInMonth = new Date(year, month, 0).getDate();
  // Adjust first day to start with Monday (0 = Monday, 6 = Sunday)
  const firstDayOfMonth = (new Date(year, month - 1, 1).getDay() + 6) % 7;
  
  // Create analysis map for quick lookup
  const analysisMap = new Map<string, Analysis>();
  analyses.forEach(analysis => {
    analysisMap.set(analysis.date, analysis);
  });

  const getDayStatus = (day: number) => {
    const dateStr = `${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
    const analysis = analysisMap.get(dateStr);
    
    if (!analysis) {
      return { 
        status: 'missing', 
        icon: CircleAlert, 
        color: 'bg-red-50 border-red-200', 
        iconColor: 'text-red-500',
        label: 'No Data'
      };
    }
    
    if (analysis.hasManualEntry) {
      return { 
        status: 'manual', 
        icon: Edit, 
        color: 'bg-purple-50 border-purple-200', 
        iconColor: 'text-purple-500',
        label: 'Manual Entry'
      };
    }
    
    if (analysis.confidenceScore >= 80) {
      return { 
        status: 'high-confidence', 
        icon: CheckCircle, 
        color: 'bg-emerald-50 border-emerald-200', 
        iconColor: 'text-emerald-500',
        label: 'AI Summary'
      };
    }
    
    if (analysis.confidenceScore >= 60) {
      return { 
        status: 'medium-confidence', 
        icon: CheckCircle, 
        color: 'bg-blue-50 border-blue-200', 
        iconColor: 'text-blue-500',
        label: 'AI Summary'
      };
    }
    
    return { 
      status: 'low-confidence', 
      icon: AlertTriangle, 
      color: 'bg-amber-50 border-amber-200', 
      iconColor: 'text-amber-500',
      label: 'Low Confidence'
    };
  };

  const getFactCheckBadge = (verdict: string | null | undefined) => {
    if (!verdict) return null;
    
    switch (verdict) {
      case 'verified':
        return { icon: Check, color: 'text-green-600', label: 'Verified' };
      case 'contradicted':
        return { icon: X, color: 'text-red-600', label: 'Contradicted' };
      case 'uncertain':
        return { icon: AlertCircle, color: 'text-amber-600', label: 'Uncertain' };
      default:
        return null;
    }
  };

  const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  return (
    <TooltipProvider>
      <div className="space-y-4">
        {/* Calendar Grid */}
        <div className="grid grid-cols-7 gap-1">
        {/* Header */}
        {dayNames.map(day => (
          <div key={day} className="text-center text-sm font-medium text-slate-500 py-2">
            {day}
          </div>
        ))}

        {/* Empty cells for days before the first day of the month */}
        {Array.from({ length: firstDayOfMonth }, (_, i) => (
          <div key={`empty-${i}`} className="aspect-square"></div>
        ))}

        {/* Calendar Days */}
        {Array.from({ length: daysInMonth }, (_, i) => {
          const day = i + 1;
          const dateStr = `${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
          const dayStatus = getDayStatus(day);
          const StatusIcon = dayStatus.icon;
          const analysis = analysisMap.get(dateStr);
          const factCheckBadge = analysis?.factCheckVerdict ? getFactCheckBadge(analysis.factCheckVerdict) : null;

          return (
            <div key={day} className="relative">
              <Link href={`/day/${dateStr}?from=month`}>
                <Card className={`aspect-square ${dayStatus.color} cursor-pointer hover:shadow-md transition-all border-2`}>
                  <CardContent className="p-2 h-full flex flex-col">
                    <div className="flex justify-between items-center">
                      <div className="text-sm font-medium text-slate-900">{day}</div>
                      {/* Fact-check badge */}
                      {factCheckBadge && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div className="cursor-help" data-testid={`fact-check-badge-${dateStr}`}>
                              <factCheckBadge.icon className={`w-3.5 h-3.5 ${factCheckBadge.color}`} />
                            </div>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-xs">
                            <div className="space-y-1">
                              <div className="font-semibold">{factCheckBadge.label}</div>
                              {analysis?.factCheckConfidence && (
                                <div className="text-xs">Confidence: {Math.round(Number(analysis.factCheckConfidence))}%</div>
                              )}
                              {analysis?.factCheckReasoning && (
                                <div className="text-xs text-slate-600 mt-2">{analysis.factCheckReasoning}</div>
                              )}
                            </div>
                          </TooltipContent>
                        </Tooltip>
                      )}
                    </div>
                    <div className="flex-1 flex items-center justify-center mt-1">
                      <StatusIcon className={`w-4 h-4 ${dayStatus.iconColor}`} />
                    </div>
                    <div className="text-xs text-slate-500 mt-1 truncate">
                      {dayStatus.label}
                    </div>
                    {analysis && analysis.confidenceScore > 0 && (
                      <div className="text-xs text-slate-400 mt-1">
                        {Math.round(analysis.confidenceScore)}%
                      </div>
                    )}
                  </CardContent>
                </Card>
              </Link>
              
              {/* Flag button positioned absolutely, outside the Link */}
              {analysis && (
                <div className="absolute top-2 right-2 z-10">
                  <FlagButton
                    date={dateStr}
                    isFlagged={analysis.isFlagged || false}
                    flagReason={analysis.flagReason}
                    type="analysis"
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div className="space-y-3">
        <div className="text-sm font-semibold text-slate-700">Status Legend:</div>
        <div className="flex flex-wrap gap-4 text-sm">
          <div className="flex items-center space-x-2">
            <CheckCircle className="w-4 h-4 text-emerald-500" />
            <span>Analyzed (High Confidence)</span>
          </div>
          <div className="flex items-center space-x-2">
            <CheckCircle className="w-4 h-4 text-blue-500" />
            <span>Analyzed (Medium Confidence)</span>
          </div>
          <div className="flex items-center space-x-2">
            <AlertTriangle className="w-4 h-4 text-amber-500" />
            <span>Low Confidence</span>
          </div>
          <div className="flex items-center space-x-2">
            <Edit className="w-4 h-4 text-purple-500" />
            <span>Manual Entry</span>
          </div>
          <div className="flex items-center space-x-2">
            <CircleAlert className="w-4 h-4 text-red-500" />
            <span>Missing Data</span>
          </div>
        </div>
        <div className="text-sm font-semibold text-slate-700 pt-2">Fact-Check Status:</div>
        <div className="flex flex-wrap gap-4 text-sm">
          <div className="flex items-center space-x-2">
            <Check className="w-4 h-4 text-green-600" />
            <span>Verified</span>
          </div>
          <div className="flex items-center space-x-2">
            <X className="w-4 h-4 text-red-600" />
            <span>Contradicted</span>
          </div>
          <div className="flex items-center space-x-2">
            <AlertCircle className="w-4 h-4 text-amber-600" />
            <span>Uncertain</span>
          </div>
        </div>
      </div>
    </div>
    </TooltipProvider>
  );
}
