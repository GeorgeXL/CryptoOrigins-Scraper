import { ReactNode, useState } from "react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { 
  Settings, 
  Calendar, 
  History,
  Bitcoin,
  Zap,
  Sparkles,
  Tag,
  FolderKanban
} from "lucide-react";
import CSVImportDialog from './CSVImportDialog';
import ApiMonitor from './ApiMonitor';
import { ApiStatusIndicator } from './ApiStatusIndicator';
import { ApiStatusBanner } from './ApiStatusBanner';
import { SettingsPopup } from './SettingsPopup';
import { StatusBarWarnings } from './StatusBarWarnings';
import { Breadcrumb, generateDateBreadcrumbs, generateMonthBreadcrumbs, generateSettingsBreadcrumbs } from './Breadcrumb';
import { GlobalProgressBanner } from './GlobalProgressBanner';

interface AppLayoutProps {
  children: ReactNode;
}


export default function AppLayout({ children }: AppLayoutProps) {
  const [location] = useLocation();
  const [hoveredItem, setHoveredItem] = useState<string | null>(null);

  const navItems = [
    { path: "/", label: "History View", icon: History, active: location === "/" },
    { path: "/event-cockpit", label: "Event Cockpit", icon: Zap, active: location === "/event-cockpit" },
    { path: "/cleaner", label: "Cleanerrr", icon: Sparkles, active: location === "/cleaner" },
    { path: "/tags-browser", label: "Tags Browser", icon: Tag, active: location === "/tags-browser" },
    { path: "/tags-manager", label: "Tags Manager", icon: FolderKanban, active: location === "/tags-manager" },
  ];

  return (
    <div className="min-h-screen bg-slate-50">
      {/* API Status Banner */}
      <ApiStatusBanner />
      
      {/* Global Analysis Progress Banner */}
      <GlobalProgressBanner />
      
      {/* Header Navigation */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center space-x-4">
              <Link href="/" className="flex items-center space-x-2 hover:opacity-80">
                <div className="w-8 h-8 bg-gradient-to-br from-orange-500 to-red-500 rounded-full flex items-center justify-center">
                  <Bitcoin className="text-white w-4 h-4" />
                </div>
                <h1 className="text-xl font-bold text-slate-900">BitNews Analyzer</h1>
              </Link>
              
              {/* Main Navigation */}
              <nav className="hidden md:flex items-center space-x-1">
                {navItems.map((item) => {
                  const IconComponent = item.icon;
                  const showText = item.active || hoveredItem === item.path;
                  
                  return (
                    <Link 
                      key={item.path} 
                      href={item.path}
                      onMouseEnter={() => setHoveredItem(item.path)}
                      onMouseLeave={() => setHoveredItem(null)}
                    >
                      <Button
                        variant={item.active ? "default" : "ghost"}
                        size="sm"
                        className={`flex items-center transition-all duration-200 ${
                          showText ? "space-x-2 px-3" : "px-2"
                        }`}
                        title={!showText ? item.label : undefined}
                      >
                        <IconComponent className="w-4 h-4 flex-shrink-0" />
                        {showText && (
                          <span className="whitespace-nowrap">{item.label}</span>
                        )}
                      </Button>
                    </Link>
                  );
                })}
              </nav>
              
              {/* Dynamic Breadcrumb Navigation - Only show on non-home pages */}
              {location !== "/" && location !== "/event-cockpit" && location !== "/cleaner" && location !== "/tags-browser" && location !== "/tags-manager" && (
                <div className="hidden md:block">
                  <Breadcrumb items={(() => {
                    // Settings page
                    if (location === "/settings") {
                      return generateSettingsBreadcrumbs();
                    }
                    
                    // Day analysis page (/day/YYYY-MM-DD)
                    const dayMatch = location.match(/^\/day\/(\d{4}-\d{2}-\d{2})$/);
                    if (dayMatch) {
                      return generateDateBreadcrumbs(dayMatch[1]);
                    }
                    
                    // Month view page (/month/YYYY/MM)
                    const monthMatch = location.match(/^\/month\/(\d{4})\/(\d{1,2})$/);
                    if (monthMatch) {
                      const year = parseInt(monthMatch[1]);
                      const month = parseInt(monthMatch[2]);
                      return generateMonthBreadcrumbs(year, month);
                    }
                    
                    // Fallback - should not reach here for home page
                    return [];
                  })()} />
                </div>
              )}
            </div>
            
            <div className="flex items-center space-x-4">
              <StatusBarWarnings />
              <ApiStatusIndicator />
              <ApiMonitor />
              <CSVImportDialog />
              <SettingsPopup />
            </div>
          </div>
        </div>
      </header>



      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {children}
      </main>
    </div>
  );
}
