import "dotenv/config";
import { cacheManager } from "../services/cache-manager";

async function main() {
  console.log("🧹 Clearing tag-related caches...\n");
  
  const cacheKeys = [
    'tags:filter-tree',
    'tags:hierarchy',
    'tags:catalog',
    'tags:catalog:manual',
    'tags:catalog-v2',
    'tags:catalog-v2:manual',
    'tags:analyses:all',
    'tags:analyses:manual',
  ];
  
  let cleared = 0;
  for (const key of cacheKeys) {
    if (cacheManager.invalidate(key)) {
      console.log(`   ✅ Cleared: ${key}`);
      cleared++;
    } else {
      console.log(`   ⏭️  Not cached: ${key}`);
    }
  }
  
  console.log(`\n✅ Cache clear complete: ${cleared}/${cacheKeys.length} caches cleared`);
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});







