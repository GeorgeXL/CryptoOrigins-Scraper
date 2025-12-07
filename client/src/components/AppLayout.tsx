import { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { 
  Bitcoin,
  Tag,
  Calendar
} from "lucide-react";
import {
  NavigationMenu,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
  NavigationMenuContent,
  navigationMenuTriggerStyle,
} from "@/components/ui/navigation-menu";
import ApiMonitor from './ApiMonitor';
import { ApiStatusIndicator } from './ApiStatusIndicator';
import { Breadcrumb, generateDateBreadcrumbs, generateMonthBreadcrumbs } from './Breadcrumb';
import { GlobalProgressBanner } from './GlobalProgressBanner';

interface AppLayoutProps {
  children: ReactNode;
}


export default function AppLayout({ children }: AppLayoutProps) {
  const [location] = useLocation();

  const navItems = [
    { path: "/", label: "Home", icon: Tag },
    { path: "/monthly", label: "Monthly View", icon: Calendar },
  ];

  return (
    <div className="min-h-screen">
      {/* Global Analysis Progress Banner */}
      <GlobalProgressBanner />
      
      {/* Header Navigation */}
      <header className="sticky top-0 z-40 bg-card">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="relative flex justify-between items-center h-16">
            {/* Logo - Left */}
            <div className="flex items-center">
              <Link href="/" className="flex items-center space-x-2 hover:opacity-80">
                <div className="w-8 h-8 bg-black border border-white rounded-full flex items-center justify-center">
                  <Bitcoin className="text-white w-4 h-4" />
                </div>
                <div className="flex flex-col">
                  <h1 className="text-xl font-bold text-foreground leading-tight">The Origins</h1>
                  <span className="text-[10px] text-muted-foreground leading-tight">News Analyser</span>
                </div>
              </Link>
            </div>
            
            {/* Main Navigation - Centered */}
            <div className="absolute left-1/2 transform -translate-x-1/2">
              <NavigationMenu className="hidden md:flex" delayDuration={0}>
                <NavigationMenuList className="gap-1">
                  {navItems.map((item) => {
                    const isActive = location === item.path;
                    
                    return (
                      <NavigationMenuItem key={item.path}>
                        <Link href={item.path}>
                          <NavigationMenuLink
                            className={navigationMenuTriggerStyle({
                              className: `${
                                isActive ? "bg-accent text-accent-foreground" : ""
                              }`,
                            })}
                          >
                            {item.label}
                          </NavigationMenuLink>
                        </Link>
                      </NavigationMenuItem>
                    );
                  })}
                  
                  {/* Manager Menu Item with Dropdown */}
                  <NavigationMenuItem>
                    <NavigationMenuTrigger>
                      Manager
                    </NavigationMenuTrigger>
                    <NavigationMenuContent>
                      <ul className="grid w-[280px] gap-1 p-2 bg-accent rounded-md">
                        <li>
                          <NavigationMenuLink asChild>
                            <Link href="/admin" className="block select-none space-y-0.5 rounded-md p-2 leading-none no-underline outline-none transition-all duration-200 bg-accent hover:bg-primary/10 hover:shadow-sm focus:bg-primary/10 focus:text-accent-foreground cursor-pointer group">
                              <div className="text-xs font-medium leading-none group-hover:text-primary transition-colors">Admin</div>
                              <p className="line-clamp-2 text-xs leading-snug text-muted-foreground group-hover:text-foreground/80 transition-colors">
                                Export data and settings.
                              </p>
                            </Link>
                          </NavigationMenuLink>
                        </li>
                        <li>
                          <NavigationMenuLink asChild>
                            <Link href="/tags-manager" className="block select-none space-y-0.5 rounded-md p-2 leading-none no-underline outline-none transition-all duration-200 bg-accent hover:bg-primary/10 hover:shadow-sm focus:bg-primary/10 focus:text-accent-foreground cursor-pointer group">
                              <div className="text-xs font-medium leading-none group-hover:text-primary transition-colors">Tags</div>
                              <p className="line-clamp-2 text-xs leading-snug text-muted-foreground group-hover:text-foreground/80 transition-colors">
                                Organize and manage tags with drag-drop.
                              </p>
                            </Link>
                          </NavigationMenuLink>
                        </li>
                        <li>
                          <NavigationMenuLink asChild>
                            <Link href="/events-manager" className="block select-none space-y-0.5 rounded-md p-2 leading-none no-underline outline-none transition-all duration-200 bg-accent hover:bg-primary/10 hover:shadow-sm focus:bg-primary/10 focus:text-accent-foreground cursor-pointer group">
                              <div className="text-xs font-medium leading-none group-hover:text-primary transition-colors">Events</div>
                              <p className="line-clamp-2 text-xs leading-snug text-muted-foreground group-hover:text-foreground/80 transition-colors">
                                View and change events.
                              </p>
                            </Link>
                          </NavigationMenuLink>
                        </li>
                      </ul>
                    </NavigationMenuContent>
                  </NavigationMenuItem>
                </NavigationMenuList>
              </NavigationMenu>
            </div>
            
            {/* Right Actions */}
            <div className="flex items-center space-x-4">
              <ApiStatusIndicator />
              <ApiMonitor />
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
