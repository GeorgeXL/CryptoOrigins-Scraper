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
}

async function getTagsToProcess(): Promise<TagRow[]> {
  const result = await db.select({
    id: tagsTable.id,
    name: tagsTable.name,
    category: tagsTable.category,
    subcategoryPath: tagsTable.subcategoryPath,
  })
    .from(tagsTable)
    .where(sql`subcategory_path IS NULL OR array_length(subcategory_path, 1) = 0`);

  return result;
}

async function updateLegacyAnalyses(tagName: string, newCategory: string) {
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
      if (tag?.name === tagName && tag?.category !== newCategory) {
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
      return await categorizeTag(tag.name, tag.category);
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

  await db.update(tagsTable)
    .set({
      subcategoryPath,
      updatedAt: new Date(),
    })
    .where(eq(tagsTable.id, tag.id));

  await updateLegacyAnalyses(tag.name, result.category);

  return subcategoryPath;
}

async function main() {
  const tagsToProcess = await getTagsToProcess();
  if (tagsToProcess.length === 0) {
    console.log("🎉 All tags already have subcategory paths.");
    return;
  }

  console.log(`🧠 Categorizing ${tagsToProcess.length} tags with concurrency ${CONCURRENCY}...`);

  let processed = 0;
  let successful = 0;
  let failed = 0;

  const queue = [...tagsToProcess];

  async function worker(workerId: number) {
    while (queue.length > 0) {
      const tag = queue.shift();
      if (!tag) break;

      try {
        const path = await processTag(tag);
        successful++;
        console.log(`[${processed + successful + failed}/${tagsToProcess.length}] ✅ ${tag.name} → ${path.join(" > ")}`);
      } catch (error) {
        failed++;
        console.error(`[${processed + successful + failed}/${tagsToProcess.length}] ❌ ${tag.name}:`, error);
      } finally {
        processed++;
      }
    }
  }

  const workers = Array.from({ length: CONCURRENCY }, (_, i) => worker(i + 1));
  await Promise.all(workers);

  console.log("\n📊 Categorization complete:");
  console.log(`   ✅ Successful: ${successful}`);
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

