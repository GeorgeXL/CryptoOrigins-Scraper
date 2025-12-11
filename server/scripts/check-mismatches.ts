import "dotenv/config";
import { db } from "../db";
import { tags as tagsTable } from "@shared/schema";
import { sql } from "drizzle-orm";
import { getCategoryKeyFromPath } from "@shared/taxonomy";

async function main() {
  console.log("🔍 Checking for mismatched tags in database...\n");
  
  const allTags = await db.select({
    id: tagsTable.id,
    name: tagsTable.name,
    category: tagsTable.category,
    subcategoryPath: tagsTable.subcategoryPath,
  })
    .from(tagsTable);

  const mismatches: any[] = [];
  
  for (const tag of allTags) {
    if (!tag.subcategoryPath || tag.subcategoryPath.length === 0) {
      mismatches.push({ ...tag, reason: "No path" });
      continue;
    }
    
    const pathCategory = getCategoryKeyFromPath(tag.subcategoryPath);
    if (pathCategory !== tag.category) {
      mismatches.push({ 
        ...tag, 
        reason: `Path category "${pathCategory}" doesn't match tag category "${tag.category}"` 
      });
    }
  }

  if (mismatches.length === 0) {
    console.log("✅ No mismatches found in database!");
  } else {
    console.log(`❌ Found ${mismatches.length} mismatches:\n`);
    mismatches.slice(0, 20).forEach(tag => {
      console.log(`   "${tag.name}":`);
      console.log(`      Category: ${tag.category}`);
      console.log(`      Path: ${JSON.stringify(tag.subcategoryPath)}`);
      console.log(`      Issue: ${tag.reason}`);
      console.log();
    });
    if (mismatches.length > 20) {
      console.log(`   ... and ${mismatches.length - 20} more`);
    }
  }
  
  // Also check for specific examples
  console.log("\n📋 Checking specific tags:");
  const examples = ["Rishi Sunak", "Altcoins", "United States"];
  for (const name of examples) {
    const tag = allTags.find(t => t.name.toLowerCase() === name.toLowerCase());
    if (tag) {
      const pathCategory = getCategoryKeyFromPath(tag.subcategoryPath);
      console.log(`   "${tag.name}": category="${tag.category}", path=${JSON.stringify(tag.subcategoryPath)}, pathCategory="${pathCategory}"`);
    } else {
      console.log(`   "${name}": Not found in database`);
    }
  }
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});







