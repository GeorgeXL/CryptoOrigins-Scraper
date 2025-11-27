import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import { supabase } from "@/lib/supabase";

interface MonthData {
  progress: {
    totalDays: number;
    analyzedDays: number;
    percentage: number;
  };
  analyses: Array<{
    date: string;
    summary: string;
    hasManualEntry: boolean;
    confidenceScore: number;
  }>;
  monthlyBreakdown: Array<{
    month: number;
    analyzedDays: number;
    totalDays: number;
    percentage: number;
  }>;
}

interface MonthCardProps {
  year: number;
  month: number;
}

export default function MonthCard({ year, month }: MonthCardProps) {
  // Fetch data for THIS specific month only
  const { data: monthData, isLoading, error } = useQuery({
    queryKey: [`supabase-month-${year}-${month}`],
    queryFn: async () => {
      if (!supabase) {
        console.error(`MonthCard ${year}-${month}: Supabase not configured`);
        throw new Error("Supabase not configured");
      }
      
      const daysInMonth = new Date(year, month, 0).getDate();
      const startDate = `${year}-${month.toString().padStart(2, '0')}-01`;
      const endDate = `${year}-${month.toString().padStart(2, '0')}-${daysInMonth.toString().padStart(2, '0')}`;
      
      console.log(`MonthCard ${year}-${month}: Querying from ${startDate} to ${endDate}`);
      
      const { count, error } = await supabase
        .from("historical_news_analyses")
        .select("*", { count: "exact", head: true })
        .gte("date", startDate)
        .lte("date", endDate);
      
      if (error) {
        console.error(`MonthCard ${year}-${month}: Query error:`, error);
        throw error;
      }
      
      const analyzedDays = count || 0;
      const percentage = daysInMonth > 0 ? Math.round((analyzedDays / daysInMonth) * 100) : 0;
      
      console.log(`MonthCard ${year}-${month}: Result - ${analyzedDays}/${daysInMonth} days (${percentage}%)`);
      
      return {
        month,
        analyzedDays,
        totalDays: daysInMonth,
        percentage
      };
    },
  });

  const getMonthName = (monthNum: number) => {
    const months = [
      "Jan", "Feb", "Mar", "Apr", "May", "Jun",
      "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
    ];
    return months[monthNum - 1];
  };

  const currentDate = new Date();
  const isCurrentMonth = year === currentDate.getFullYear() && month === currentDate.getMonth() + 1;
  const isFutureMonth = year > currentDate.getFullYear() || 
    (year === currentDate.getFullYear() && month > currentDate.getMonth() + 1);

  const getStatusVariant = () => {
    if (isFutureMonth) return "outline" as const;
    if (isLoading) return "secondary" as const;
    if (error || !monthData) return "secondary" as const;
    if (monthData.percentage === 100) return "default" as const;
    if (monthData.percentage >= 80) return "secondary" as const;
    return "destructive" as const;
  };

  const getStatusLabel = () => {
    if (isFutureMonth) return "Future";
    if (isLoading) return "Loading...";
    if (error) return "Error";
    if (!monthData) return "No Data";
    if (isCurrentMonth) return "Current";
    if (monthData.percentage === 100) return "Complete";
    return `${monthData.percentage}%`;
  };

  return (
    <Link href={`/month/${year}/${month}`}>
      <div className={`rounded-lg border-2 cursor-pointer transition-all duration-200 hover:shadow-lg hover:scale-102 ${
        isCurrentMonth 
          ? "bg-gradient-to-br from-blue-50 to-indigo-100 border-blue-300 shadow-md" 
          : "bg-white border-slate-200 hover:border-slate-300"
      } ${isFutureMonth ? "opacity-50" : ""}`}>
        <div className="p-4">
          {/* Month Header */}
          <div className="flex justify-between items-center mb-3">
            <h4 className="font-bold text-slate-900 text-lg">
              {getMonthName(month)}
            </h4>
            <Badge 
              variant={getStatusVariant()} 
              className="text-xs px-2 py-1 font-medium"
            >
              {getStatusLabel()}
            </Badge>
          </div>
          
          {/* Month Statistics */}
          {!isFutureMonth && isLoading ? (
            <div className="space-y-3">
              <div className="flex items-center justify-center gap-2">
                <Spinner />
                <span className="text-sm text-slate-500">
                  Loading...
                </span>
              </div>
            </div>
          ) : !isFutureMonth && monthData ? (
            <div className="space-y-3">
              <div className="text-center">
                <span className="text-sm text-slate-500">
                  {monthData.analyzedDays} / {monthData.totalDays} days
                </span>
              </div>
              
              <div className="w-full bg-slate-200 rounded-full h-2">
                <div 
                  className={`h-2 rounded-full transition-all duration-300 ${
                    monthData.percentage === 100 ? 'bg-emerald-500' :
                    monthData.percentage >= 50 ? 'bg-blue-500' : 'bg-amber-500'
                  }`}
                  style={{ width: `${monthData.percentage}%` }}
                />
              </div>
            </div>
          ) : (
            <div className="text-center py-6">
              <div className="text-slate-400 text-sm">
                {isFutureMonth ? "Future Month" : "No Data Available"}
              </div>
            </div>
          )}
        </div>
      </div>
    </Link>
  );
}