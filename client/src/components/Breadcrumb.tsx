import { Link } from "wouter";
import { ChevronRight, Home } from "lucide-react";

interface BreadcrumbItem {
  label: string;
  href?: string;
}

interface BreadcrumbProps {
  items: BreadcrumbItem[];
  className?: string;
}

export function Breadcrumb({ items, className = "" }: BreadcrumbProps) {
  return (
    <nav className={`flex items-center space-x-1 text-sm text-muted-foreground ${className}`} aria-label="Breadcrumb">
      <Link href="/" className="flex items-center hover:text-foreground transition-colors">
        <Home className="h-4 w-4" />
        <span className="sr-only">Home</span>
      </Link>
      
      {items.map((item, index) => (
        <div key={index} className="flex items-center space-x-1">
          <ChevronRight className="h-4 w-4" />
          {item.href ? (
            <Link 
              href={item.href} 
              className="hover:text-foreground transition-colors font-medium"
            >
              {item.label}
            </Link>
          ) : (
            <span className="text-foreground font-medium">{item.label}</span>
          )}
        </div>
      ))}
    </nav>
  );
}

// Helper function to generate breadcrumbs for date-based navigation
export function generateDateBreadcrumbs(date: string): BreadcrumbItem[] {
  const dateObj = new Date(date);
  const year = dateObj.getFullYear();
  const month = dateObj.toLocaleDateString('en-US', { month: 'long' });
  const day = dateObj.getDate();
  
  return [
    {
      label: year.toString(),
      href: `/`
    },
    {
      label: month,
      href: `/month/${year}/${dateObj.getMonth() + 1}`
    },
    {
      label: `${month.slice(0, 3)} ${day}`,
    }
  ];
}

// Helper function to generate breadcrumbs for month view
export function generateMonthBreadcrumbs(year: number, month: number): BreadcrumbItem[] {
  const monthName = new Date(year, month - 1).toLocaleDateString('en-US', { month: 'long' });
  
  return [
    {
      label: year.toString(),
      href: `/`
    },
    {
      label: monthName,
    }
  ];
}
