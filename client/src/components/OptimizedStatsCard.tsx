/**
 * Optimized Statistics Card Component
 * Replaces repetitive stats display code with reusable component
 */

import { Card, CardContent } from "@/components/ui/card";
import { LucideIcon } from "lucide-react";

interface StatItemProps {
  label: string;
  value: string | number;
  color: string;
  description?: string;
}

interface StatsCardProps {
  title: string;
  icon?: LucideIcon;
  stats: StatItemProps[];
  className?: string;
}

export function StatItem({ label, value, color, description }: StatItemProps) {
  return (
    <div className="text-center p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
      <div className={`text-2xl font-bold ${color}`}>
        {typeof value === 'number' ? value.toLocaleString() : value}
      </div>
      <div className="text-sm text-gray-600 dark:text-gray-400">{label}</div>
      {description && (
        <div className="text-xs text-gray-500 dark:text-gray-500 mt-1">{description}</div>
      )}
    </div>
  );
}

export function StatsCard({ title, icon: Icon, stats, className = "" }: StatsCardProps) {
  return (
    <Card className={className}>
      <CardContent className="p-6">
        <h3 className="flex items-center space-x-2 font-semibold mb-4">
          {Icon && <Icon className="w-4 h-4" />}
          <span>{title}</span>
        </h3>
        <div className={`grid gap-4 ${stats.length <= 2 ? 'grid-cols-2' : stats.length <= 4 ? 'grid-cols-2 md:grid-cols-4' : 'grid-cols-2 md:grid-cols-3 lg:grid-cols-4'}`}>
          {stats.map((stat, index) => (
            <StatItem key={index} {...stat} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// Predefined stat configurations for common use cases
export const statConfigs = {
  performance: [
    { label: "Speed Improvement", value: "3x", color: "text-blue-600", description: "Faster processing" },
    { label: "Concurrent Requests", value: 3, color: "text-green-600", description: "Parallel execution" },
    { label: "Batch Delay", value: "1s", color: "text-orange-600", description: "Rate limiting" },
    { label: "Progress Updates", value: "Real-time", color: "text-purple-600", description: "Live feedback" }
  ],
  
  optimization: [
    { label: "Query Speed", value: "50%+", color: "text-emerald-600" },
    { label: "API Calls", value: "70%", color: "text-blue-600" },
    { label: "Bandwidth", value: "60-80%", color: "text-orange-600" },
    { label: "Memory", value: "3x better", color: "text-purple-600" }
  ]
};