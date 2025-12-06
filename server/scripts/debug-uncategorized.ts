import "dotenv/config";
import { db } from "../db";
import { tags as tagsTable } from "@shared/schema";
import { sql } from "drizzle-orm";
import { getCategoryKeyFromPath } from "@shared/taxonomy";

async function main() {
  console.log("🔍 Checking uncategorized tags...\n");
  
  // Get all tags
  const allTags = await db.select({
    id: tagsTable.id,
    name: tagsTable.name,
    category: tagsTable.category,
    subcategoryPath: tagsTable.subcategoryPath,
    usageCount: tagsTable.usageCount,
  })
    .from(tagsTable)
    .orderBy(sql`usage_count DESC`);

  // Find uncategorized (no path or empty path)
  const uncategorized = allTags.filter(tag => 
    !tag.subcategoryPath || tag.subcategoryPath.length === 0
  );

  // Find mismatched (path doesn't match category)
  const mismatched = allTags.filter(tag => {
    if (!tag.subcategoryPath || tag.subcategoryPath.length === 0) return false;
    const pathCategory = getCategoryKeyFromPath(tag.subcategoryPath);
    return pathCategory !== tag.category;
  });

  console.log(`📊 Total tags: ${allTags.length}`);
  console.log(`❌ Uncategorized (no path): ${uncategorized.length}`);
  console.log(`⚠️  Mismatched (wrong path): ${mismatched.length}\n`);

  // Check specific examples
  console.log("🔍 Checking specific tags:");
  const examples = ["Africa", "Airbnb", "United States", "Rishi Sunak", "Altcoins"];
  for (const name of examples) {
    const tag = allTags.find(t => t.name.toLowerCase() === name.toLowerCase());
    if (tag) {
      const pathCategory = tag.subcategoryPath ? getCategoryKeyFromPath(tag.subcategoryPath) : "none";
      const isMismatch = tag.subcategoryPath && pathCategory !== tag.category;
      const status = !tag.subcategoryPath || tag.subcategoryPath.length === 0 
        ? "❌ NO PATH" 
        : isMismatch 
        ? "⚠️  MISMATCH" 
        : "✅ OK";
      console.log(`   ${status} "${tag.name}": category="${tag.category}", path=${JSON.stringify(tag.subcategoryPath)}, usage=${tag.usageCount}`);
    } else {
      console.log(`   ❓ "${name}": NOT FOUND in tags table`);
    }
  }

  if (uncategorized.length > 0) {
    console.log(`\n📋 Sample uncategorized tags (first 20):`);
    uncategorized.slice(0, 20).forEach(tag => {
      console.log(`   - "${tag.name}" (category: ${tag.category}, usage: ${tag.usageCount})`);
    });
  }

  if (mismatched.length > 0) {
    console.log(`\n⚠️  Sample mismatched tags (first 10):`);
    mismatched.slice(0, 10).forEach(tag => {
      const pathCategory = getCategoryKeyFromPath(tag.subcategoryPath!);
      console.log(`   - "${tag.name}": category="${tag.category}", pathCategory="${pathCategory}", path=${JSON.stringify(tag.subcategoryPath)}`);
    });
  }
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});





