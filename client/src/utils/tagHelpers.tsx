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

