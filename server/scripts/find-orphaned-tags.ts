import "dotenv/config";
import { db } from "../db";
import { historicalNewsAnalyses, tags as tagsTable } from "@shared/schema";
import { sql } from "drizzle-orm";

async function main() {
  console.log("🔍 Finding orphaned tag names (in analyses but not in tags table)...\n");
  
  // Get all unique tag names from analyses
  const tagNamesResult = await db.execute(sql`
    WITH tag_expanded AS (
      SELECT DISTINCT unnest(tag_names) as tag_name
      FROM historical_news_analyses
      WHERE tag_names IS NOT NULL AND array_length(tag_names, 1) > 0
    )
    SELECT tag_name, COUNT(*)::integer as usage_count
    FROM tag_expanded
    WHERE tag_name IS NOT NULL
    GROUP BY tag_name
    ORDER BY usage_count DESC
  `);

  const allTagNames = tagNamesResult.rows as Array<{ tag_name: string; usage_count: number }>;
  
  // Get all tag names from tags table
  const tagsInTable = await db.select({
    name: tagsTable.name,
  })
    .from(tagsTable);

  const tagNamesSet = new Set(tagsInTable.map(t => t.name.toLowerCase()));
  
  // Find orphaned tags
  const orphaned = allTagNames.filter(tn => 
    !tagNamesSet.has(tn.tag_name.toLowerCase())
  );

  console.log(`📊 Total unique tag names in analyses: ${allTagNames.length}`);
  console.log(`📊 Tags in tags table: ${tagsInTable.length}`);
  console.log(`❌ Orphaned tag names (not in tags table): ${orphaned.length}\n`);

  if (orphaned.length > 0) {
    console.log("📋 Sample orphaned tags (first 30):");
    orphaned.slice(0, 30).forEach(tag => {
      console.log(`   - "${tag.tag_name}" (used ${tag.usage_count} times)`);
    });
    
    if (orphaned.length > 30) {
      console.log(`   ... and ${orphaned.length - 30} more`);
    }

    console.log(`\n💡 These tags exist in historical_news_analyses.tag_names but not in the tags table.`);
    console.log(`   They need to be added to the tags table and categorized.`);
  } else {
    console.log("✅ No orphaned tags found!");
  }
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});





