import { 
  Globe, 
  Building, 
  User, 
  Coins, 
  Building2, 
  Hash, 
  Sparkles, 
  Calendar, 
  Tag 
} from "lucide-react";
import { LucideIcon } from "lucide-react";
import { TAXONOMY_TREE, getTaxonomyLabel, getCategoryDisplayMeta } from "@shared/taxonomy";

interface CategoryData {
  category: string;
  name: string;
  count: number;
  isParent: boolean;
  isTag?: boolean;
  children?: CategoryData[];
}

// Helper function to get tag category from tag name using catalogData
export function getTagCategory(
  tagName: string,
  catalogData?: { entitiesByCategory: Record<string, CategoryData[]> } | null
): string {
  if (!catalogData?.entitiesByCategory) return 'miscellaneous';
  
  // Search through all categories to find the tag
  for (const [category, entities] of Object.entries(catalogData.entitiesByCategory)) {
    const findTag = (items: CategoryData[]): boolean => {
      for (const item of items) {
        if (item.name === tagName) {
          return true;
        }
        if (item.children && Array.isArray(item.children)) {
          if (findTag(item.children)) return true;
        }
      }
      return false;
    };
    
    if (findTag(entities)) {
      return category;
    }
  }
  
  return 'miscellaneous';
}

// Get icon for category (using new taxonomy)
export function getCategoryIcon(category: string): LucideIcon {
  switch (category.toLowerCase()) {
    case 'countries':
    case 'country':
      return Globe;
    case 'companies':
    case 'company':
      return Building;
    case 'people':
    case 'person':
      return User;
    case 'digital-assets':
    case 'crypto':
    case 'cryptocurrency':
      return Coins;
    case 'bitcoin-orgs':
    case 'regulatory':
    case 'organization':
      return Building2;
    case 'protocols':
    case 'protocol':
      return Hash;
    case 'topics':
    case 'topic':
      return Sparkles;
    case 'currencies':
    case 'currency':
      return Coins;
    case 'crime':
      return Building2;
    case 'events':
      return Calendar;
    case 'miscellaneous':
    case 'other':
      return Tag;
    default:
      return Tag;
  }
}

// Get color for category (using new taxonomy)
export function getCategoryColor(category: string): string {
  switch (category.toLowerCase()) {
    case 'countries':
    case 'country':
      return 'bg-blue-500/20 text-blue-400 border-blue-500/30';
    case 'companies':
    case 'company':
      return 'bg-purple-500/20 text-purple-400 border-purple-500/30';
    case 'people':
    case 'person':
      return 'bg-green-500/20 text-green-400 border-green-500/30';
    case 'digital-assets':
    case 'crypto':
    case 'cryptocurrency':
      return 'bg-orange-500/20 text-orange-400 border-orange-500/30';
    case 'bitcoin-orgs':
    case 'regulatory':
    case 'organization':
      return 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30';
    case 'protocols':
    case 'protocol':
      return 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30';
    case 'topics':
    case 'topic':
      return 'bg-pink-500/20 text-pink-400 border-pink-500/30';
    case 'currencies':
    case 'currency':
      return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
    case 'crime':
      return 'bg-red-500/20 text-red-400 border-red-500/30';
    case 'events':
      return 'bg-teal-500/20 text-teal-400 border-teal-500/30';
    case 'miscellaneous':
    case 'other':
      return 'bg-gray-500/20 text-gray-400 border-gray-500/30';
    default:
      return 'bg-gray-500/20 text-gray-400 border-gray-500/30';
  }
}

// --- New Client-Side Tree Building Logic ---

export interface Tag {
  id: string;
  name: string;
  category: string;
  normalizedName?: string;
  usageCount: number;
  subcategoryPath?: string[];
  // Supabase raw field name
  subcategory_path?: string[]; 
}

export interface Subcategory {
  key: string;
  name: string;
  tags: Tag[];
  subcategories: Subcategory[];
  totalTags: number;
}

export interface Category {
  category: string;
  name: string;
  emoji?: string;
  tags: Tag[];
  subcategories: Subcategory[];
  totalTags: number;
}

export interface FilterTreeResponse {
  categories: Category[];
  totalTags: number;
}

export function buildFilterTreeFromTags(allTags: Tag[], customLabels: Map<string, string> = new Map()): FilterTreeResponse {
  if (!allTags || allTags.length === 0) {
    return { categories: [], totalTags: 0 };
  }

  const categoryMap = new Map<string, Category>();

  // Helper to get or create category
  const getCategory = (catKey: string): Category => {
    if (!categoryMap.has(catKey)) {
      const meta = getCategoryDisplayMeta(catKey);
      categoryMap.set(catKey, {
        category: catKey,
        name: meta.name,
        emoji: meta.emoji,
        tags: [],
        subcategories: [],
        totalTags: 0
      });
    }
    return categoryMap.get(catKey)!;
  };

  // Helper to find or create subcategory path
  const getSubcategoryNode = (root: Category | Subcategory, path: string[]): Subcategory | Category => {
    if (path.length === 0) return root;

    const currentKey = path[0]; // "1.2"
    const remainingPath = path.slice(1);

    // Find existing subcategory in the current root
    // Note: root can be Category or Subcategory, both have 'subcategories' array
    let sub = root.subcategories.find(s => s.key === currentKey);
    
    if (!sub) {
      // Create new
      const label = customLabels.get(currentKey) || getTaxonomyLabel(currentKey) || currentKey;
      sub = {
        key: currentKey,
        name: label,
        tags: [],
        subcategories: [],
        totalTags: 0
      };
      root.subcategories.push(sub);
    }

    return getSubcategoryNode(sub, remainingPath);
  };

  for (const rawTag of allTags) {
    if (!rawTag.category) continue; // Skip tags without category
    
    // Map to internal Tag structure (handle snake_case from DB)
    const tag: Tag = {
      id: rawTag.id,
      name: rawTag.name,
      category: rawTag.category,
      normalizedName: rawTag.normalizedName || (rawTag as any).normalized_name,
      usageCount: rawTag.usageCount ?? (rawTag as any).usage_count ?? 0,
      subcategoryPath: rawTag.subcategoryPath || (rawTag as any).subcategory_path || []
    };
    
    const cat = getCategory(tag.category);
    
    if (tag.subcategoryPath && tag.subcategoryPath.length > 0) {
      // Add to subcategory
      const parent = getSubcategoryNode(cat, tag.subcategoryPath);
      parent.tags.push(tag);
    } else {
      // Add to root
      cat.tags.push(tag);
    }
  }

  // Calculate recursive totals and sort
  const processNode = (node: Category | Subcategory) => {
    let total = node.tags.length;
    
    // Process children
    if (node.subcategories) {
      node.subcategories.forEach(sub => {
        processNode(sub);
        total += sub.totalTags;
      });
      
      // Sort subcategories by key (usually number-based like 1.1, 1.2)
      node.subcategories.sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true }));
    }
    
    // Sort tags
    node.tags.sort((a, b) => a.name.localeCompare(b.name));
    
    node.totalTags = total;
  };

  const categories = Array.from(categoryMap.values());
  categories.forEach(processNode);

  // Sort categories by TAXONOMY_TREE order
  const categoryOrder = new Map<string, number>();
  TAXONOMY_TREE.forEach((node, index) => {
    categoryOrder.set(node.key, index);
  });

  categories.sort((a, b) => {
    const orderA = categoryOrder.get(a.category) ?? 999;
    const orderB = categoryOrder.get(b.category) ?? 999;
    return orderA - orderB;
  });

  return {
    categories,
    totalTags: allTags.length
  };
}
