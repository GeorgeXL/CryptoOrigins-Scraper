import "dotenv/config";
import { db } from "../db";
import { categorizeTag } from "../services/tag-categorizer";
import { tags as tagsTable, historicalNewsAnalyses } from "@shared/schema";
import { sql, eq } from "drizzle-orm";

const CONCURRENCY = 2; // Lower to avoid rate limits

interface TagRow {
  id: string;
  name: string;
  category: string;
  subcategoryPath: string[] | null;
  usageCount: number;
}

async function getMiscTags(): Promise<TagRow[]> {
  const result = await db.select({
    id: tagsTable.id,
    name: tagsTable.name,
    category: tagsTable.category,
    subcategoryPath: tagsTable.subcategoryPath,
    usageCount: tagsTable.usageCount,
  })
    .from(tagsTable)
    .where(eq(tagsTable.category, 'miscellaneous'))
    .orderBy(sql`usage_count DESC`);

  return result;
}

async function checkForDuplicate(tagName: string, targetCategory: string): Promise<string | null> {
  const existing = await db.select()
    .from(tagsTable)
    .where(sql`name = ${tagName} AND category = ${targetCategory}`)
    .limit(1);
  
  return existing.length > 0 ? existing[0].id : null;
}

async function mergeTags(miscTagId: string, correctTagId: string) {
  // Move all references from misc tag to correct tag
  await db.execute(sql`
    UPDATE pages_and_tags
    SET tag_id = ${correctTagId}
    WHERE tag_id = ${miscTagId}
    AND NOT EXISTS (
      SELECT 1 FROM pages_and_tags pt2
      WHERE pt2.analysis_id = pages_and_tags.analysis_id
      AND pt2.tag_id = ${correctTagId}
    )
  `);

  // Update usage count
  await db.execute(sql`
    UPDATE tags
    SET usage_count = (
      SELECT COUNT(*) FROM pages_and_tags WHERE tag_id = ${correctTagId}
    )
    WHERE id = ${correctTagId}
  `);

  // Delete misc duplicate
  await db.delete(tagsTable).where(eq(tagsTable.id, miscTagId));
}

async function updateLegacyAnalyses(tagName: string, oldCategory: string, newCategory: string) {
  const analyses = await db.execute(sql`
    SELECT id, tags, tag_names
    FROM historical_news_analyses
    WHERE tags @> ${JSON.stringify([{ name: tagName }])}::jsonb
  `);

  for (const row of analyses.rows as any[]) {
    if (!row.tags || !Array.isArray(row.tags)) continue;

    let changed = false;
    const updatedTags = row.tags.map((tag: any) => {
      if (tag?.name === tagName && tag?.category === oldCategory) {
        changed = true;
        return { ...tag, category: newCategory };
      }
      return tag;
    });

    if (!changed) continue;

    const tagNames = updatedTags.map((t: any) => t?.name).filter(Boolean);
    await db.update(historicalNewsAnalyses)
      .set({
        tags: updatedTags,
        tagNames,
      })
      .where(eq(historicalNewsAnalyses.id, row.id));
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function categorizeWithRetry(tag: TagRow) {
  const MAX_RETRIES = 6;
  let attempt = 0;
  let lastError: unknown;

  while (attempt < MAX_RETRIES) {
    try {
      return await categorizeTag(tag.name);
    } catch (error: any) {
      const errorCode = error?.code || error?.error?.code;
      if (errorCode === "rate_limit_exceeded" || error?.status === 429) {
        const delay = Math.min(10000, 3000 * (attempt + 1));
        await sleep(delay);
        attempt++;
        lastError = error;
        continue;
      }
      throw error;
    }
  }

  throw lastError;
}

async function processTag(tag: TagRow) {
  const result = await categorizeWithRetry(tag);
  
  const subcategoryPath = (result.subcategoryPath && result.subcategoryPath.length > 0)
    ? result.subcategoryPath
    : ["14.1"];

  // Check for duplicate in target category
  const duplicateId = await checkForDuplicate(tag.name, result.category);
  
  if (duplicateId && duplicateId !== tag.id) {
    // Merge with existing tag
    await mergeTags(tag.id, duplicateId);
    return { category: result.category, path: subcategoryPath, merged: true };
  } else {
    // No duplicate - update the category field in the tags table
    await db.update(tagsTable)
      .set({
        category: result.category, // This updates the category field in Supabase
        subcategoryPath,
        updatedAt: new Date(),
      })
      .where(eq(tagsTable.id, tag.id));

    // Update legacy analyses JSONB tags field
    if (result.category !== tag.category) {
      await updateLegacyAnalyses(tag.name, tag.category, result.category);
    }

    return { category: result.category, path: subcategoryPath, merged: false };
  }
}

async function main() {
  console.log("🔍 Finding remaining miscellaneous tags...\n");
  
  const miscTags = await getMiscTags();
  
  if (miscTags.length === 0) {
    console.log("🎉 No tags in miscellaneous!");
    return;
  }

  console.log(`📊 Found ${miscTags.length} tags in miscellaneous`);
  console.log(`   Sample: ${miscTags.slice(0, 10).map(t => t.name).join(", ")}`);
  console.log(`\n🧠 Re-categorizing with AI (concurrency ${CONCURRENCY})...`);
  console.log(`   This will UPDATE the 'category' field in the tags table.\n`);

  let processed = 0;
  let successful = 0;
  let failed = 0;
  let moved = 0;
  let merged = 0;

  const queue = [...miscTags];

  async function worker(workerId: number) {
    while (queue.length > 0) {
      const tag = queue.shift();
      if (!tag) break;

      try {
        const { category, path, merged: wasMerged } = await processTag(tag);
        successful++;
        const movedFlag = category !== 'miscellaneous' ? '🚀 MOVED' : '📍 STAYED';
        const mergeFlag = wasMerged ? ' 🔀 MERGED' : '';
        if (category !== 'miscellaneous') moved++;
        if (wasMerged) merged++;
        console.log(`[${processed + successful + failed}/${miscTags.length}] ${movedFlag}${mergeFlag} ${tag.name} → ${category} ${path.join(" > ")}`);
        
        await sleep(2500); // Slower to avoid rate limits
      } catch (error) {
        failed++;
        console.error(`[${processed + successful + failed}/${miscTags.length}] ❌ ${tag.name}:`, error);
        await sleep(5000);
      } finally {
        processed++;
      }
    }
  }

  const workers = Array.from({ length: CONCURRENCY }, (_, i) => worker(i + 1));
  await Promise.all(workers);

  console.log("\n📊 Re-categorization complete:");
  console.log(`   ✅ Successful: ${successful}`);
  console.log(`   🚀 Moved out of miscellaneous: ${moved}`);
  console.log(`   🔀 Merged with existing tags: ${merged}`);
  console.log(`   📍 Stayed in miscellaneous: ${successful - moved}`);
  console.log(`   ❌ Failed: ${failed}`);
  console.log(`   🏁 Total processed: ${processed}`);

  // Clear cache
  const { cacheManager } = await import("../services/cache-manager");
  cacheManager.delete('tags:filter-tree');
  cacheManager.delete('tags:catalog-v2');
  console.log("\n🗑️  Cleared tag caches");

  if (failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});





