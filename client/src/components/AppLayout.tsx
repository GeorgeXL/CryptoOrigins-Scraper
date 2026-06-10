import { ReactNode, useState } from "react";
import { Link, useLocation } from "wouter";
import { Bitcoin, Calendar, Menu, Tag } from "lucide-react";
import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
  navigationMenuTriggerStyle,
} from "@/components/ui/navigation-menu";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import ApiMonitor from "./ApiMonitor";
import { ApiStatusIndicator } from "./ApiStatusIndicator";
import { GlobalProgressBanner } from "./GlobalProgressBanner";
import { cn } from "@/lib/utils";

interface AppLayoutProps {
  children: ReactNode;
}

const navItems = [
  { path: "/", label: "Home", icon: Tag },
  { path: "/monthly", label: "Monthly View", icon: Calendar },
] as const;

const managerItems = [
  {
    path: "/admin",
    label: "Admin",
    description: "Export data and settings.",
  },
  {
    path: "/admin/agents",
    label: "Admin Agent",
    description: "Run cleanup agents and review proposed actions.",
  },
  {
    path: "/tags-manager",
    label: "Tags",
    description: "Organize and manage tags with drag-drop.",
  },
  {
    path: "/main-events-check",
    label: "Main events check",
    description: "Gemini main-events pass per storyline leaf; auto-locks matches.",
  },
  {
    path: "/events-manager",
    label: "Events",
    description: "View and change events.",
  },
] as const;

function isManagerPath(path: string): boolean {
  return managerItems.some((item) => path === item.path || path.startsWith(`${item.path}/`));
}

export default function AppLayout({ children }: AppLayoutProps) {
  const [location] = useLocation();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const managerActive = isManagerPath(location);

  const mobileLinkClass = (active: boolean) =>
    cn(
      "block rounded-md px-3 py-2.5 text-sm no-underline transition-colors",
      active
        ? "bg-accent font-medium text-accent-foreground"
        : "text-foreground hover:bg-muted",
    );

  return (
    <div className="min-h-screen">
      <GlobalProgressBanner />

      <header className="sticky top-0 z-40 border-b border-border/60 bg-card">
        <div className="mx-auto max-w-7xl px-3 sm:px-6 lg:px-8">
          <div className="relative flex h-14 items-center justify-between gap-2 sm:h-16">
            <div className="min-w-0 flex-shrink-0">
              <Link href="/" className="flex items-center space-x-2 hover:opacity-80">
                <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full border border-white bg-black">
                  <Bitcoin className="h-4 w-4 text-white" />
                </div>
                <div className="flex min-w-0 flex-col">
                  <h1 className="truncate text-base font-bold leading-tight text-foreground sm:text-xl">
                    The Origins
                  </h1>
                  <span className="truncate text-[10px] leading-tight text-muted-foreground">
                    News Analyser
                  </span>
                </div>
              </Link>
            </div>

            <div className="absolute left-1/2 hidden -translate-x-1/2 transform md:block">
              <NavigationMenu delayDuration={0}>
                <NavigationMenuList className="gap-1">
                  {navItems.map((item) => {
                    const isActive = location === item.path;

                    return (
                      <NavigationMenuItem key={item.path}>
                        <Link href={item.path}>
                          <NavigationMenuLink
                            className={navigationMenuTriggerStyle({
                              className: isActive ? "bg-accent text-accent-foreground" : "",
                            })}
                          >
                            {item.label}
                          </NavigationMenuLink>
                        </Link>
                      </NavigationMenuItem>
                    );
                  })}

                  <NavigationMenuItem>
                    <NavigationMenuTrigger className={managerActive ? "bg-accent text-accent-foreground" : ""}>
                      Manager
                    </NavigationMenuTrigger>
                    <NavigationMenuContent>
                      <ul className="grid w-[280px] gap-1 rounded-md border border-border bg-card p-2 shadow-sm">
                        {managerItems.map((item) => (
                          <li key={item.path}>
                            <NavigationMenuLink asChild>
                              <Link
                                href={item.path}
                                className="group block cursor-pointer select-none space-y-0.5 rounded-md bg-card p-2 leading-none no-underline outline-none transition-all duration-200 hover:bg-muted focus:bg-muted focus:text-foreground"
                              >
                                <div className="text-xs font-medium leading-none transition-colors group-hover:text-primary">
                                  {item.label}
                                </div>
                                <p className="line-clamp-2 text-xs leading-snug text-muted-foreground transition-colors group-hover:text-foreground/80">
                                  {item.description}
                                </p>
                              </Link>
                            </NavigationMenuLink>
                          </li>
                        ))}
                      </ul>
                    </NavigationMenuContent>
                  </NavigationMenuItem>
                </NavigationMenuList>
              </NavigationMenu>
            </div>

            <div className="flex flex-shrink-0 items-center gap-1 sm:gap-3">
              <ApiStatusIndicator />
              <div className="hidden sm:block">
                <ApiMonitor />
              </div>

              <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="md:hidden"
                  aria-label="Open menu"
                  onClick={() => setMobileNavOpen(true)}
                >
                  <Menu className="h-5 w-5" />
                </Button>
                <SheetContent side="right" className="w-[min(100vw-2rem,20rem)] p-0">
                  <SheetHeader className="border-b border-border px-4 py-4 text-left">
                    <SheetTitle>Menu</SheetTitle>
                  </SheetHeader>
                  <nav className="flex flex-col gap-1 p-3">
                    {navItems.map((item) => (
                      <Link
                        key={item.path}
                        href={item.path}
                        className={mobileLinkClass(location === item.path)}
                        onClick={() => setMobileNavOpen(false)}
                      >
                        {item.label}
                      </Link>
                    ))}
                    <div className="my-2 border-t border-border" />
                    <p className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Manager
                    </p>
                    {managerItems.map((item) => {
                      const active =
                        location === item.path || location.startsWith(`${item.path}/`);
                      return (
                        <Link
                          key={item.path}
                          href={item.path}
                          className={mobileLinkClass(active)}
                          onClick={() => setMobileNavOpen(false)}
                        >
                          <span className="block font-medium">{item.label}</span>
                          <span className="mt-0.5 block text-xs text-muted-foreground">{item.description}</span>
                        </Link>
                      );
                    })}
                  </nav>
                </SheetContent>
              </Sheet>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-3 py-4 sm:px-6 sm:py-6 lg:px-8 lg:py-8">
        {children}
      </main>
    </div>
  );
}
