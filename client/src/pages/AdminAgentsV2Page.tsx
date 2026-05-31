import { useState } from "react";
import { Link, useLocation } from "wouter";
import { Menu } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import AgentsV2AgentPanel from "@/pages/AgentsV2AgentPanel";
import AgentsV2HomePanel from "@/pages/AgentsV2HomePanel";
import AgentsV2MetricsPanel from "@/pages/AgentsV2MetricsPanel";
import AgentsV2SystemPanel from "@/pages/AgentsV2SystemPanel";

const BASE = "/admin/agents";
const LEGACY_BASE = "/admin/agents-v2";
const AGENT = `${BASE}/agent`;
const METRICS = `${BASE}/metrics`;
const SYSTEM = `${BASE}/system`;

function AgentsV2Home() {
  return <AgentsV2HomePanel />;
}

function AgentsV2Agent() {
  return <AgentsV2AgentPanel />;
}

function AgentsV2Metrics() {
  return <AgentsV2MetricsPanel />;
}

function AgentsV2System() {
  return <AgentsV2SystemPanel />;
}

export default function AdminAgentsV2Page() {
  const [loc] = useLocation();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const rawPath = loc.split("?")[0].replace(/\/$/, "") || "/";
  const path = rawPath === LEGACY_BASE || rawPath.startsWith(`${LEGACY_BASE}/`)
    ? rawPath.replace(LEGACY_BASE, BASE)
    : rawPath;
  const isAgent = path === AGENT || path.startsWith(`${AGENT}/`);
  const isMetrics = path === METRICS || path.startsWith(`${METRICS}/`);
  const isSystem = path === SYSTEM || path.startsWith(`${SYSTEM}/`);

  const items: { href: string; label: string; match: boolean }[] = [
    { href: BASE, label: "Homepage", match: (path === BASE || path === `${BASE}/`) && !isAgent && !isMetrics && !isSystem },
    { href: AGENT, label: "Agent", match: isAgent },
    { href: METRICS, label: "Metrics", match: isMetrics },
    { href: SYSTEM, label: "System", match: isSystem },
  ];

  const currentLabel = items.find((item) => item.match)?.label ?? "Admin Agent";

  const navLinkClass = (active: boolean) =>
    cn(
      "block rounded-md px-3 py-2.5 text-sm no-underline transition-colors",
      active
        ? "bg-accent font-medium text-accent-foreground"
        : "text-muted-foreground hover:bg-muted hover:text-foreground",
    );

  return (
    <div className="flex min-h-[calc(100vh-4.5rem)] w-full flex-col overflow-hidden rounded-none border border-border bg-background sm:min-h-[calc(100vh-5rem)] sm:rounded-lg md:flex-row">
      <div className="flex items-center justify-between border-b border-border bg-muted/30 px-3 py-2 md:hidden">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Admin Agent</p>
          <p className="text-sm font-medium text-foreground">{currentLabel}</p>
        </div>
        <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label="Open admin menu"
            onClick={() => setMobileNavOpen(true)}
          >
            <Menu className="h-5 w-5" />
          </Button>
          <SheetContent side="right" className="w-[min(100vw-2rem,18rem)] p-0">
            <SheetHeader className="border-b border-border px-4 py-4 text-left">
              <SheetTitle>Admin Agent</SheetTitle>
            </SheetHeader>
            <nav className="flex flex-col gap-1 p-3">
              {items.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={navLinkClass(item.match)}
                  onClick={() => setMobileNavOpen(false)}
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </SheetContent>
        </Sheet>
      </div>

      <aside className="hidden w-56 shrink-0 flex-col gap-1 border-r border-border bg-muted/30 p-4 md:flex">
        <p className="mb-2 px-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Admin Agent
        </p>
        {items.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "rounded-md px-3 py-2 text-sm no-underline transition-colors",
              item.match
                ? "bg-accent font-medium text-accent-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {item.label}
          </Link>
        ))}
      </aside>

      <main className="min-w-0 flex-1 overflow-x-hidden bg-card/20">
        {isAgent ? <AgentsV2Agent /> : isMetrics ? <AgentsV2Metrics /> : isSystem ? <AgentsV2System /> : <AgentsV2Home />}
      </main>
    </div>
  );
}
