import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import AgentsV2AgentPanel from "@/pages/AgentsV2AgentPanel";
import AgentsV2HomePanel from "@/pages/AgentsV2HomePanel";
import AgentsV2SystemPanel from "@/pages/AgentsV2SystemPanel";

const BASE = "/admin/agents";
const LEGACY_BASE = "/admin/agents-v2";
const AGENT = `${BASE}/agent`;
const SYSTEM = `${BASE}/system`;

function AgentsV2Home() {
  return <AgentsV2HomePanel />;
}

function AgentsV2Agent() {
  return <AgentsV2AgentPanel />;
}

function AgentsV2System() {
  return <AgentsV2SystemPanel />;
}

export default function AdminAgentsV2Page() {
  const [loc] = useLocation();
  const rawPath = loc.split("?")[0].replace(/\/$/, "") || "/";
  const path = rawPath === LEGACY_BASE || rawPath.startsWith(`${LEGACY_BASE}/`)
    ? rawPath.replace(LEGACY_BASE, BASE)
    : rawPath;
  const isAgent = path === AGENT || path.startsWith(`${AGENT}/`);
  const isSystem = path === SYSTEM || path.startsWith(`${SYSTEM}/`);

  const items: { href: string; label: string; match: boolean }[] = [
    { href: BASE, label: "Homepage", match: (path === BASE || path === `${BASE}/`) && !isAgent && !isSystem },
    { href: AGENT, label: "Agent", match: isAgent },
    { href: SYSTEM, label: "System", match: isSystem },
  ];

  return (
    <div className="flex w-full min-h-[calc(100vh-5rem)] border border-border rounded-lg overflow-hidden bg-background">
      <aside className="w-56 shrink-0 border-r border-border bg-muted/30 p-4 flex flex-col gap-1">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground px-2 mb-2">
          Admin Agent
        </p>
        {items.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "rounded-md px-3 py-2 text-sm transition-colors no-underline",
              item.match
                ? "bg-accent text-accent-foreground font-medium"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {item.label}
          </Link>
        ))}
      </aside>
      <main className="flex-1 min-w-0 bg-card/20">
        {isAgent ? <AgentsV2Agent /> : isSystem ? <AgentsV2System /> : <AgentsV2Home />}
      </main>
    </div>
  );
}
