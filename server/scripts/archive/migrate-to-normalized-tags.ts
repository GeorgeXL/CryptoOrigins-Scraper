/**
 * Migration script to convert from JSONB tags to normalized structure
 * 
 * This script:
 * 1. Extracts all unique tags from historical_news_analyses.tags JSONB
 * 2. Inserts unique tags into the new tags table (deduplicate by name+category)
 * 3. Creates pages_and_tags join table entries linking each analysis to its tags
 * 4. Populates subcategoryPath from tags table if available (by traversing parentTagId hierarchy)
 * 5. Updates usageCount in tags table based on join table counts
 * 
 * Run with: npx tsx server/scripts/migrate-to-normalized-tags.ts
 */

import "dotenv/config";
import { db } from "../db";
import { tags, pagesAndTags, historicalNewsAnalyses } from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";
import { normalizeTagName } from "../services/tag-similarity";

interface MigrationStats {
  totalAnalyses: number;
  totalTagsInJsonb: number;
  uniqueTagsFound: number;
  tagsInserted: number;
  tagsSkipped: number;
  joinTableEntriesCreated: number;
  subcategoryPathsPopulated: number;
  errors: string[];
}

async function buildSubcategoryPathFromHierarchy(
  tagName: string,
  category: string,
  tagsMap: Map<string, any>
): Promise<string[] | null> {
  // Find the tag in tags table (tag_metadata was removed; use existing tags rows)
  const metadata = Array.from(tagsMap.values()).find(
    (tm: any) => tm.name === tagName && tm.category === category
  );
  
  if (!metadata || !metadata.parentTagId) {
    return null;
  }
  
  // Traverse up the parent chain to build the path
  const path: string[] = [];
  let currentId: string | null = metadata.parentTagId;
  const visited = new Set<string>();
  
  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    const parent = Array.from(tagsMap.values()).find((tm: any) => tm.id === currentId);
    
    if (!parent) break;
    
    // Try to extract subcategory key from parent name (e.g., "1.2.1 Core Implementations" -> "1.2.1")
    const keyMatch = parent.name.match(/^(\d+(?:\.\d+)*)/);
    if (keyMatch) {
      path.unshift(keyMatch[1]);
    }
    
    currentId = parent.parentTagId || null;
  }
  
  return path.length > 0 ? path : null;
}

async function main() {
  console.log("🚀 Starting migration to normalized tags structure...\n");
  console.log("=".repeat(60));
  
  const stats: MigrationStats = {
    totalAnalyses: 0,
    totalTagsInJsonb: 0,
    uniqueTagsFound: 0,
    tagsInserted: 0,
    tagsSkipped: 0,
    joinTableEntriesCreated: 0,
    subcategoryPathsPopulated: 0,
    errors: [],
  };
  
  try {
    // Step 1: Get all analyses with tags
    console.log("\n📊 Step 1: Analyzing existing data...");
    const allAnalyses = await db.select({
      id: historicalNewsAnalyses.id,
      tags: historicalNewsAnalyses.tags,
    })
      .from(historicalNewsAnalyses)
      .where(sql`tags IS NOT NULL AND jsonb_typeof(tags) = 'array'`);
    
    stats.totalAnalyses = allAnalyses.length;
    
    // Extract all unique tags from JSONB
    const uniqueTagsMap = new Map<string, { name: string; category: string; analyses: string[] }>();
    
    for (const analysis of allAnalyses) {
      if (analysis.tags && Array.isArray(analysis.tags)) {
        for (const tag of analysis.tags as any[]) {
          if (tag.name && tag.category) {
            const key = `${tag.category}::${tag.name}`;
            if (!uniqueTagsMap.has(key)) {
              uniqueTagsMap.set(key, {
                name: tag.name,
                category: tag.category,
                analyses: [],
              });
            }
            uniqueTagsMap.get(key)!.analyses.push(analysis.id);
            stats.totalTagsInJsonb++;
          }
        }
      }
    }
    
    stats.uniqueTagsFound = uniqueTagsMap.size;
    console.log(`   Found ${stats.totalAnalyses} analyses with tags`);
    console.log(`   Total tag occurrences: ${stats.totalTagsInJsonb}`);
    console.log(`   Unique tags: ${stats.uniqueTagsFound}`);
    
    // Step 2: Load tags table for subcategory path lookup (tag_metadata is gone)
    console.log("\n📋 Step 2: Loading tags table for hierarchy...");
    const existingTags = await db.select().from(tags);
    const tagsMap = new Map<string, any>();
    for (const tm of existingTags) {
      tagsMap.set(tm.id, tm);
    }
    console.log(`   Loaded ${existingTags.length} tags entries`);
    
    // Step 3: Insert unique tags into tags table
    console.log("\n💾 Step 3: Inserting tags into tags table...");
    const tagIdMap = new Map<string, string>(); // key: "category::name" -> tagId
    
    for (const [key, tagData] of uniqueTagsMap.entries()) {
      try {
        // Try to build subcategory path from tags table hierarchy
        const subcategoryPath = await buildSubcategoryPathFromHierarchy(
          tagData.name,
          tagData.category,
          tagsMap
        );
        
        const insertResult = await db.insert(tags).values({
          name: tagData.name,
          category: tagData.category,
          normalizedName: normalizeTagName(tagData.name),
          subcategoryPath: subcategoryPath,
          usageCount: tagData.analyses.length, // Will be recalculated later
        })
          .onConflictDoNothing()
          .returning();
        
        if (insertResult.length > 0) {
          tagIdMap.set(key, insertResult[0].id);
          stats.tagsInserted++;
          if (subcategoryPath) {
            stats.subcategoryPathsPopulated++;
          }
        } else {
          // Tag already exists, get its ID
          const existing = await db.select()
            .from(tags)
            .where(and(
              eq(tags.name, tagData.name),
              eq(tags.category, tagData.category)
            ))
            .limit(1);
          
          if (existing.length > 0) {
            tagIdMap.set(key, existing[0].id);
            stats.tagsSkipped++;
            
            // Update subcategory path if we found one and it's not set
            if (subcategoryPath && !existing[0].subcategoryPath) {
              await db.update(tags)
                .set({ subcategoryPath })
                .where(eq(tags.id, existing[0].id));
              stats.subcategoryPathsPopulated++;
            }
          }
        }
      } catch (error) {
        const errorMsg = `Error inserting tag ${tagData.name} (${tagData.category}): ${error instanceof Error ? error.message : String(error)}`;
        stats.errors.push(errorMsg);
        console.error(`   ❌ ${errorMsg}`);
      }
    }
    
    console.log(`   ✅ Inserted: ${stats.tagsInserted}`);
    console.log(`   ⏭️  Skipped (duplicates): ${stats.tagsSkipped}`);
    console.log(`   📍 Subcategory paths populated: ${stats.subcategoryPathsPopulated}`);
    
    // Step 4: Create join table entries
    console.log("\n🔗 Step 4: Creating pages_and_tags join table entries...");
    let batchSize = 0;
    const BATCH_LIMIT = 1000;
    
    for (const analysis of allAnalyses) {
      if (analysis.tags && Array.isArray(analysis.tags)) {
        for (const tag of analysis.tags as any[]) {
          if (tag.name && tag.category) {
            const key = `${tag.category}::${tag.name}`;
            const tagId = tagIdMap.get(key);
            
            if (tagId) {
              try {
                await db.insert(pagesAndTags).values({
                  analysisId: analysis.id,
                  tagId: tagId,
                })
                  .onConflictDoNothing();
                
                stats.joinTableEntriesCreated++;
                batchSize++;
                
                if (batchSize >= BATCH_LIMIT) {
                  console.log(`   Processed ${stats.joinTableEntriesCreated} entries...`);
                  batchSize = 0;
                }
              } catch (error) {
                const errorMsg = `Error creating join entry for ${analysis.id} -> ${tagId}: ${error instanceof Error ? error.message : String(error)}`;
                stats.errors.push(errorMsg);
              }
            } else {
              stats.errors.push(`Tag ID not found for ${key}`);
            }
          }
        }
      }
    }
    
    console.log(`   ✅ Created ${stats.joinTableEntriesCreated} join table entries`);
    
    // Step 5: Recalculate usage counts from join table
    console.log("\n🔢 Step 5: Recalculating usage counts...");
    const usageCounts = await db.execute(sql`
      SELECT tag_id, COUNT(*)::integer as count
      FROM pages_and_tags
      GROUP BY tag_id
    `);
    
    let updatedCounts = 0;
    for (const row of usageCounts.rows as any[]) {
      await db.update(tags)
        .set({ usageCount: row.count })
        .where(eq(tags.id, row.tag_id));
      updatedCounts++;
    }
    
    console.log(`   ✅ Updated usage counts for ${updatedCounts} tags`);
    
    // Summary
    console.log("\n" + "=".repeat(60));
    console.log("\n📊 Migration Summary:");
    console.log(`   Total analyses processed: ${stats.totalAnalyses}`);
    console.log(`   Total tag occurrences: ${stats.totalTagsInJsonb}`);
    console.log(`   Unique tags found: ${stats.uniqueTagsFound}`);
    console.log(`   Tags inserted: ${stats.tagsInserted}`);
    console.log(`   Tags skipped (duplicates): ${stats.tagsSkipped}`);
    console.log(`   Join table entries created: ${stats.joinTableEntriesCreated}`);
    console.log(`   Subcategory paths populated: ${stats.subcategoryPathsPopulated}`);
    console.log(`   Errors: ${stats.errors.length}`);
    
    if (stats.errors.length > 0) {
      console.log("\n⚠️  Errors encountered:");
      stats.errors.slice(0, 10).forEach(err => console.log(`   - ${err}`));
      if (stats.errors.length > 10) {
        console.log(`   ... and ${stats.errors.length - 10} more errors`);
      }
    }
    
    console.log("\n✅ Migration completed successfully!");
    process.exit(0);
    
  } catch (error) {
    console.error("\n❌ Fatal error during migration:", error);
    process.exit(1);
  }
}

main().catch(console.error);

