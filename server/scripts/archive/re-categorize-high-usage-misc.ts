import "dotenv/config";
import { db } from "../db";
import { categorizeTag } from "../services/tag-categorizer";
import { tags as tagsTable, historicalNewsAnalyses } from "@shared/schema";
import { sql, eq } from "drizzle-orm";

const CONCURRENCY = Number(process.env.AI_CATEGORIZE_CONCURRENCY || 2); // Lower concurrency to avoid rate limits

interface TagRow {
  id: string;
  name: string;
  category: string;
  subcategoryPath: string[] | null;
  usageCount: number;
}

async function getHighUsageMiscTags(): Promise<TagRow[]> {
  // Get miscellaneous tags that are likely mis-categorized (companies, countries, etc.)
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

  // Filter to tags that sound like they should be in other categories
  // (companies, countries, people, etc.)
  const likelyMisplaced = result.filter(tag => {
    const name = tag.name.toLowerCase();
    // Skip obvious misc items: version numbers, generic terms, etc.
    if (name.match(/^v?\d+\.\d+/)) return false; // version numbers
    if (name.match(/^\d+[kmg]?b?$/i)) return false; // sizes like "1MB", "8MB"
    if (['tbd', 'ads', 'icons', 'dentist', 'usenet'].includes(name)) return false;
    // Keep everything else - they might be companies, countries, etc.
    return true;
  });

  return likelyMisplaced;
}

async function updateLegacyAnalyses(tagName: string, oldCategory: string, newCategory: string) {
  const { sql: drizzleSql } = await import("drizzle-orm");

  const analyses = await db.execute(drizzleSql`
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
        const delay = Math.min(5000, 2000 * (attempt + 1)); // Longer delays
        console.warn(`⏳ Rate limit hit for "${tag.name}". Retrying in ${delay}ms...`);
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

  // Check if tag already exists in the target category
  const existingTag = await db.select()
    .from(tagsTable)
    .where(sql`name = ${tag.name} AND category = ${result.category}`)
    .limit(1);

  if (existingTag.length > 0 && existingTag[0].id !== tag.id) {
    // Tag already exists in target category - merge them
    const correctTagId = existingTag[0].id;
    const miscTagId = tag.id;

    console.log(`   🔀 Merging: "${tag.name}" (misc) → existing tag in ${result.category}`);

    // Update all pages_and_tags references from misc tag to correct tag
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

    // Update usage count on correct tag
    await db.execute(sql`
      UPDATE tags
      SET usage_count = (
        SELECT COUNT(*) FROM pages_and_tags WHERE tag_id = ${correctTagId}
      )
      WHERE id = ${correctTagId}
    `);

    // Delete the miscellaneous duplicate
    await db.delete(tagsTable).where(eq(tagsTable.id, miscTagId));

    return { category: result.category, path: existingTag[0].subcategoryPath || subcategoryPath, merged: true };
  } else {
    // No duplicate - safe to update
    await db.update(tagsTable)
      .set({
        category: result.category,
        subcategoryPath,
        updatedAt: new Date(),
      })
      .where(eq(tagsTable.id, tag.id));

    // Update legacy analyses if category changed
    if (result.category !== tag.category) {
      await updateLegacyAnalyses(tag.name, tag.category, result.category);
    }

    return { category: result.category, path: subcategoryPath, merged: false };
  }
}

async function main() {
  console.log("🔍 Finding high-usage miscellaneous tags that might be mis-categorized...\n");
  
  const tagsToProcess = await getHighUsageMiscTags();
  
  if (tagsToProcess.length === 0) {
    console.log("🎉 No tags to re-categorize!");
    return;
  }

  console.log(`📊 Found ${tagsToProcess.length} tags to re-check:`);
  tagsToProcess.slice(0, 30).forEach(tag => {
    console.log(`   - ${tag.name} (used ${tag.usageCount} times)`);
  });
  if (tagsToProcess.length > 30) {
    console.log(`   ... and ${tagsToProcess.length - 30} more`);
  }
  
  console.log(`\n🧠 Re-categorizing with AI (concurrency ${CONCURRENCY}, slower to avoid rate limits)...\n`);

  let processed = 0;
  let successful = 0;
  let failed = 0;
  let moved = 0;
  let merged = 0;

  const queue = [...tagsToProcess];

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
        console.log(`[${processed + successful + failed}/${tagsToProcess.length}] ${movedFlag}${mergeFlag} ${tag.name} → ${category} ${path.join(" > ")}`);
        
        // Longer delay between requests to avoid rate limits
        await sleep(2000);
      } catch (error) {
        failed++;
        console.error(`[${processed + successful + failed}/${tagsToProcess.length}] ❌ ${tag.name}:`, error);
        // Wait longer on error
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

  if (failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});

