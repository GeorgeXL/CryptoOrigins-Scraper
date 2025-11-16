import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatDate(date: string): string {
  return new Date(date).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
}

export function formatDateShort(date: string): string {
  return new Date(date).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric'
  });
}

export function formatProgress(current: number, total: number): string {
  if (total === 0) return '0%';
  return `${Math.round((current / total) * 100)}%`;
}

export function getProgressColor(percentage: number): string {
  if (percentage === 100) return 'bg-emerald-500';
  if (percentage >= 90) return 'bg-blue-500';
  if (percentage >= 50) return 'bg-amber-500';
  return 'bg-red-400';
}

export function getStatusVariant(percentage: number): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (percentage === 100) return 'secondary';
  if (percentage >= 90) return 'default';
  if (percentage >= 50) return 'outline';
  return 'destructive';
}

export function generateDateRange(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  const start = new Date(startDate);
  const end = new Date(endDate);
  
  while (start <= end) {
    dates.push(start.toISOString().split('T')[0]);
    start.setDate(start.getDate() + 1);
  }
  
  return dates;
}

export function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

export function getFirstDayOfMonth(year: number, month: number): number {
  return new Date(year, month - 1, 1).getDay();
}

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
}

export function getHistoricalPeriod(year: number): { 
  name: string; 
  description: string; 
  icon: string; 
  color: string;
} {
  if (year <= 2010) return { 
    name: "Early Era", 
    description: "Early Bitcoin Era (2008-2010)",
    icon: "Seedling", 
    color: "text-green-500" 
  };
  if (year <= 2013) return { 
    name: "First Bubble", 
    description: "First Bubble (2011-2013)",
    icon: "TrendingUp", 
    color: "text-blue-500" 
  };
  if (year <= 2015) return { 
    name: "Mt. Gox Crisis", 
    description: "Mt. Gox Crisis (2014-2015)",
    icon: "AlertTriangle", 
    color: "text-red-500" 
  };
  if (year <= 2017) return { 
    name: "Altcoin Era", 
    description: "Altcoin Era (2016-2017)",
    icon: "Coins", 
    color: "text-yellow-500" 
  };
  if (year <= 2020) return { 
    name: "Crypto Winter", 
    description: "Crypto Winter (2018-2020)",
    icon: "Snowflake", 
    color: "text-cyan-500" 
  };
  if (year <= 2022) return { 
    name: "Institutional", 
    description: "Institutional Adoption (2020-2022)",
    icon: "Building", 
    color: "text-indigo-500" 
  };
  if (year <= 2023) return { 
    name: "DeFi/NFT", 
    description: "DeFi/NFT Era (2021-2023)",
    icon: "Rocket", 
    color: "text-purple-500" 
  };
  return { 
    name: "ETF Era", 
    description: "ETF Era (2024+)",
    icon: "Star", 
    color: "text-amber-500" 
  };
}

export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + '...';
}

export function extractDomainFromUrl(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return 'unknown';
  }
}

export function calculateConfidenceColor(score: number): string {
  if (score >= 80) return 'text-emerald-600';
  if (score >= 60) return 'text-blue-600';
  if (score >= 40) return 'text-amber-600';
  return 'text-red-600';
}

export function calculateConfidenceBadgeVariant(score: number): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (score >= 80) return 'default';
  if (score >= 60) return 'secondary';
  if (score >= 40) return 'outline';
  return 'destructive';
}

export function formatTimeAgo(date: string): string {
  const now = new Date();
  const past = new Date(date);
  const diffMs = now.getTime() - past.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 30) return `${diffDays} days ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
  return `${Math.floor(diffDays / 365)} years ago`;
}

export function validateDateFormat(date: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date);
}

export function getCurrentYear(): number {
  return new Date().getFullYear();
}

export function getCurrentDate(): string {
  return new Date().toISOString().split('T')[0];
}
