/**
 * Script to check what tags were recently categorized by AI
 * Run with: npx tsx server/scripts/check-ai-categorization-changes.ts
 */

import "dotenv/config";
import { db } from "../db";
import { tags } from "@shared/schema";
import { desc, sql } from "drizzle-orm";

async function checkChanges() {
  console.log("🔍 Checking recently categorized tags...\n");
  
  // Get tags updated in the last hour
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  
  const recentlyUpdated = await db.select({
    id: tags.id,
    name: tags.name,
    category: tags.category,
    parentTagId: tags.parentTagId,
    updatedAt: tags.updatedAt,
    createdAt: tags.createdAt
  })
  .from(tags)
  .where(sql`updated_at > ${oneHourAgo}`)
  .orderBy(desc(tags.updatedAt))
  .limit(50);
  
  if (recentlyUpdated.length === 0) {
    console.log("❌ No tags were updated in the last hour.");
    return;
  }
  
  console.log(`✅ Found ${recentlyUpdated.length} recently updated tags:\n`);
  
  // Get parent tag names
  const parentIds = recentlyUpdated
    .map(t => t.parentTagId)
    .filter(Boolean) as string[];
  
  const parentTags = parentIds.length > 0 
    ? await db.select({
        id: tags.id,
        name: tags.name,
        category: tags.category
      })
      .from(tags)
      .where(sql`id = ANY(${parentIds})`)
    : [];
  
  const parentMap = new Map(parentTags.map(p => [p.id, p]));
  
  // Get usage counts
  for (const tag of recentlyUpdated) {
    const countResult = await db.execute(sql`
      SELECT COUNT(*)::integer as count
      FROM historical_news_analyses
      WHERE tags @> ${JSON.stringify([{ name: tag.name, category: tag.category }])}::jsonb
    `);
    
    const usageCount = countResult.rows[0]?.count || 0;
    const parent = tag.parentTagId ? parentMap.get(tag.parentTagId) : null;
    const isNew = tag.createdAt && tag.updatedAt && 
                  Math.abs(tag.createdAt.getTime() - tag.updatedAt.getTime()) < 1000;
    
    console.log(`📌 ${tag.name}`);
    console.log(`   Category: ${tag.category}`);
    if (parent) {
      console.log(`   Parent: ${parent.name} (${parent.category})`);
    }
    console.log(`   Used in: ${usageCount} analyses`);
    console.log(`   Updated: ${tag.updatedAt?.toISOString()}`);
    if (isNew) {
      console.log(`   ⭐ New tag (just created)`);
    }
    console.log('');
  }
  
  console.log(`\n📊 Summary: ${recentlyUpdated.length} tags categorized`);
}

checkChanges()
  .then(() => {
    console.log("\n✅ Done!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("❌ Error:", error);
    process.exit(1);
  });







