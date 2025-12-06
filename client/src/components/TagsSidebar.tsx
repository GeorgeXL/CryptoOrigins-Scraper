import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInput,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubItem,
  SidebarRail,
} from "@/components/ui/sidebar";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { getCategoryDisplayMeta } from "@shared/taxonomy";
import { ChevronRight, Search, X, CheckCircle, AlertTriangle, Loader2 } from "lucide-react";
import { useMemo } from "react";
import { Label } from "@/components/ui/label";

export interface QualityCheckItem {
  id: string;
  label: string;
  count: number;
  hasIssues: boolean;
  isLoading?: boolean;
}

interface CategoryData {
  category: string;
  name: string;
  count: number;
  isParent: boolean;
  isTag?: boolean;
  children?: CategoryData[];
}

interface TagsSidebarProps {
  catalogData: {
    entitiesByCategory: Record<string, CategoryData[]>;
    untaggedCount: number;
  } | null;
  selectedEntities: Set<string>;
  showUntagged: boolean;
  searchQuery: string;
  onEntitySelect: (entity: string) => void;
  onUntaggedToggle: () => void;
  onSearchChange: (value: string) => void;
  onCategoryToggle?: (category: string) => void;
  mode?: "sidebar" | "inline";
  showCategories?: boolean;
  showOverview?: boolean;
  // Quality check props
  qualityCheckItems?: QualityCheckItem[];
  selectedQualityCheck?: string | null;
  onQualityCheckSelect?: (id: string) => void;
  // VeriBadge props
  veriBadgeItems?: QualityCheckItem[];
  selectedVeriBadge?: string | null;
  onVeriBadgeSelect?: (id: string) => void;
}

export function TagsSidebar({
  catalogData,
  selectedEntities,
  showUntagged,
  searchQuery,
  onEntitySelect,
  onUntaggedToggle,
  onSearchChange,
  onCategoryToggle,
  mode = "sidebar",
  showCategories = true,
  showOverview = true,
  qualityCheckItems,
  selectedQualityCheck,
  onQualityCheckSelect,
  veriBadgeItems,
  selectedVeriBadge,
  onVeriBadgeSelect,
}: TagsSidebarProps) {
  const memoizedCatalog = useMemo(() => {
    if (!catalogData) return null;

    const categories = Object.entries(catalogData.entitiesByCategory).map(
      ([key, nodes]) => ({
        key,
        label: getCategoryDisplayMeta(key as any).name,
        total: nodes.reduce((sum, node) => sum + (node.count || 0), 0),
        nodes,
      })
    );

    return {
      categories,
      untaggedCount: catalogData.untaggedCount,
    };
  }, [catalogData]);

  if (!memoizedCatalog) {
    return null;
  }

  const renderTreeNode = (item: CategoryData, fallbackCategory: string) => {
    const entityCategory = item.category || fallbackCategory;
    const entityKey = `${entityCategory}::${item.name}`;
    const hasChildren = Array.isArray(item.children) && item.children.length > 0;
    const isLeaf = item.isTag || !hasChildren;

    if (isLeaf) {
      return (
        <SidebarMenuItem key={entityKey}>
          <SidebarMenuButton
            onClick={() => onEntitySelect(entityKey)}
            isActive={selectedEntities.has(entityKey)}
            className="data-[active=true]:bg-white data-[active=true]:text-black"
            tooltip={`${item.count || 0} analyses`}
          >
            <span className="truncate">{item.name}</span>
            <SidebarMenuBadge>{item.count || 0}</SidebarMenuBadge>
          </SidebarMenuButton>
        </SidebarMenuItem>
      );
    }

    return (
      <SidebarMenuItem key={`${entityKey}-parent`}>
        <Collapsible
          className="group/collapsible [&[data-state=open]>button>svg:first-child]:rotate-90"
          defaultOpen={false}
        >
          <CollapsibleTrigger asChild>
            <SidebarMenuButton className="justify-start gap-2">
              <ChevronRight className="h-3 w-3 transition-transform" />
              <span className="truncate">{item.name}</span>
            </SidebarMenuButton>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <SidebarMenuSub>
              {item.children?.map((child, index) => (
                <SidebarMenuSubItem key={`${entityKey}-${index}`}>
                  {renderTreeNode(child, entityCategory)}
                </SidebarMenuSubItem>
              ))}
            </SidebarMenuSub>
          </CollapsibleContent>
        </Collapsible>
      </SidebarMenuItem>
    );
  };

  const isInline = mode === "inline";

  return (
    <Sidebar collapsible={isInline ? "none" : undefined} className={isInline ? "rounded-xl bg-sidebar/40" : undefined}>
      <SidebarHeader className="pt-0">
        <SidebarGroup className="py-0 px-2">
          <SidebarGroupContent className="relative">
            <Label htmlFor="sidebar-search" className="sr-only">
              Search
            </Label>
            <Search className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 select-none opacity-50" />
            <SidebarInput
              id="sidebar-search"
              placeholder="Search"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              className="pl-8 pr-8"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => onSearchChange("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
              >
                <X className="size-4" />
                <span className="sr-only">Clear search</span>
              </button>
            )}
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarHeader>
      <SidebarContent>
        {showOverview && (
          <SidebarGroup>
            <SidebarGroupLabel>Overview</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    onClick={() => {
                      onUntaggedToggle();
                      onCategoryToggle?.("untagged");
                    }}
                    isActive={showUntagged}
                    tooltip={`${memoizedCatalog.untaggedCount} untagged analyses`}
                  >
                    Untagged
                    <SidebarMenuBadge>{memoizedCatalog.untaggedCount}</SidebarMenuBadge>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {qualityCheckItems && qualityCheckItems.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel>Quality Check</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {qualityCheckItems.map((item) => (
                  <SidebarMenuItem key={item.id}>
                    <SidebarMenuButton
                      onClick={() => onQualityCheckSelect?.(item.id)}
                      isActive={selectedQualityCheck === item.id}
                      className="data-[active=true]:bg-white data-[active=true]:text-black"
                      tooltip={item.isLoading ? 'Loading...' : `${item.count} entries`}
                    >
                      <span className="flex items-center gap-2 truncate">
                        {item.isLoading ? (
                          <Loader2 className="h-3.5 w-3.5 text-muted-foreground shrink-0 animate-spin" />
                        ) : item.hasIssues ? (
                          <AlertTriangle className="h-3.5 w-3.5 text-orange-500 shrink-0" />
                        ) : (
                          <CheckCircle className="h-3.5 w-3.5 text-green-500 shrink-0" />
                        )}
                        <span className="truncate">{item.label}</span>
                      </span>
                      {!item.isLoading && item.hasIssues && (
                        <SidebarMenuBadge className="bg-orange-100 text-orange-700">
                          {item.count}
                        </SidebarMenuBadge>
                      )}
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {veriBadgeItems && veriBadgeItems.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel>VeriBadge</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {veriBadgeItems.map((item) => (
                  <SidebarMenuItem key={item.id}>
                    <SidebarMenuButton
                      onClick={() => onVeriBadgeSelect?.(item.id)}
                      isActive={selectedVeriBadge === item.id}
                      className="data-[active=true]:bg-white data-[active=true]:text-black"
                      tooltip={item.isLoading ? 'Loading...' : `${item.count} entries`}
                    >
                      <span className="flex items-center gap-2 truncate">
                        {item.isLoading ? (
                          <Loader2 className="h-3.5 w-3.5 text-muted-foreground shrink-0 animate-spin" />
                        ) : (
                          <span className="truncate">{item.label}</span>
                        )}
                      </span>
                      {!item.isLoading && (
                        <SidebarMenuBadge className="bg-muted text-muted-foreground">
                          {item.count}
                        </SidebarMenuBadge>
                      )}
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {showCategories && memoizedCatalog.categories.map((category) => {
          if (category.total === 0) return null;
          return (
            <SidebarGroup key={category.key}>
              <SidebarGroupLabel>{category.label}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {category.nodes.map((item) => renderTreeNode(item, category.key))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          );
        })}
      </SidebarContent>
      {!isInline && <SidebarRail />}
    </Sidebar>
  );
}

