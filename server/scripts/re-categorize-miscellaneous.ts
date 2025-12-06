import "dotenv/config";
import { db } from "../db";
import { categorizeTag } from "../services/tag-categorizer";
import { tags as tagsTable, historicalNewsAnalyses } from "@shared/schema";
import { sql, eq } from "drizzle-orm";

const CONCURRENCY = Number(process.env.AI_CATEGORIZE_CONCURRENCY || 3);

interface TagRow {
  id: string;
  name: string;
  category: string;
  subcategoryPath: string[] | null;
  usageCount: number;
}

async function getMiscellaneousTags(): Promise<TagRow[]> {
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
      // Don't pass existing category - let AI decide fresh
      return await categorizeTag(tag.name);
    } catch (error: any) {
      const errorCode = error?.code || error?.error?.code;
      if (errorCode === "rate_limit_exceeded" || error?.status === 429) {
        const delay = 1000 * (attempt + 1);
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

  // Update both category and path
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

  return { category: result.category, path: subcategoryPath };
}

async function main() {
  console.log("🔍 Finding tags in miscellaneous category...\n");
  
  const miscellaneousTags = await getMiscellaneousTags();
  
  if (miscellaneousTags.length === 0) {
    console.log("🎉 No tags in miscellaneous category!");
    return;
  }

  console.log(`📊 Found ${miscellaneousTags.length} tags in miscellaneous:`);
  miscellaneousTags.slice(0, 20).forEach(tag => {
    console.log(`   - ${tag.name} (used ${tag.usageCount} times)`);
  });
  if (miscellaneousTags.length > 20) {
    console.log(`   ... and ${miscellaneousTags.length - 20} more`);
  }
  
  console.log(`\n🧠 Re-categorizing with AI (concurrency ${CONCURRENCY})...`);
  console.log(`   This will allow AI to move them to proper categories.\n`);

  let processed = 0;
  let successful = 0;
  let failed = 0;
  let moved = 0;

  const queue = [...miscellaneousTags];

  async function worker(workerId: number) {
    while (queue.length > 0) {
      const tag = queue.shift();
      if (!tag) break;

      try {
        const { category, path } = await processTag(tag);
        successful++;
        const movedFlag = category !== 'miscellaneous' ? '🚀 MOVED' : '📍 STAYED';
        if (category !== 'miscellaneous') moved++;
        console.log(`[${processed + successful + failed}/${miscellaneousTags.length}] ${movedFlag} ${tag.name} → ${category} ${path.join(" > ")}`);
      } catch (error) {
        failed++;
        console.error(`[${processed + successful + failed}/${miscellaneousTags.length}] ❌ ${tag.name}:`, error);
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





