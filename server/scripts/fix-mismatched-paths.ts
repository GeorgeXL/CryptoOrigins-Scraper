import "dotenv/config";
import { db } from "../db";
import { fixSubcategoryPath } from "../services/tag-categorizer";
import { tags as tagsTable } from "@shared/schema";
import { sql, eq } from "drizzle-orm";
import { getCategoryKeyFromPath } from "@shared/taxonomy";

const CONCURRENCY = Number(process.env.AI_CATEGORIZE_CONCURRENCY || 3);

interface TagRow {
  id: string;
  name: string;
  category: string;
  subcategoryPath: string[] | null;
}

/**
 * Check if category and path match
 * Returns true if they match, false if they don't
 */
function isPathMismatched(category: string, path: string[] | null): boolean {
  if (!path || path.length === 0) {
    return true; // No path is considered a mismatch
  }
  
  const pathCategory = getCategoryKeyFromPath(path);
  return pathCategory !== category;
}

async function getMismatchedTags(): Promise<TagRow[]> {
  const allTags = await db.select({
    id: tagsTable.id,
    name: tagsTable.name,
    category: tagsTable.category,
    subcategoryPath: tagsTable.subcategoryPath,
  })
    .from(tagsTable);

  // Filter to only mismatched tags
  return allTags.filter(tag => isPathMismatched(tag.category, tag.subcategoryPath));
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function fixPathWithRetry(tag: TagRow) {
  const MAX_RETRIES = 6;
  let attempt = 0;
  let lastError: unknown;

  while (attempt < MAX_RETRIES) {
    try {
      return await fixSubcategoryPath(tag.name, tag.category);
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
  const newPath = await fixPathWithRetry(tag);
  
  await db.update(tagsTable)
    .set({
      subcategoryPath: newPath,
      updatedAt: new Date(),
    })
    .where(eq(tagsTable.id, tag.id));

  return newPath;
}

async function main() {
  console.log("🔍 Finding tags with mismatched category/path...\n");
  
  const mismatchedTags = await getMismatchedTags();
  
  if (mismatchedTags.length === 0) {
    console.log("🎉 No mismatched tags found! All tags have correct paths.");
    return;
  }

  console.log(`📊 Found ${mismatchedTags.length} tags with mismatched paths:`);
  mismatchedTags.slice(0, 10).forEach(tag => {
    console.log(`   - ${tag.name}: category="${tag.category}", path=${JSON.stringify(tag.subcategoryPath)}`);
  });
  if (mismatchedTags.length > 10) {
    console.log(`   ... and ${mismatchedTags.length - 10} more`);
  }
  console.log(`\n🧠 Fixing paths with concurrency ${CONCURRENCY}...\n`);

  let processed = 0;
  let successful = 0;
  let failed = 0;

  const queue = [...mismatchedTags];

  async function worker(workerId: number) {
    while (queue.length > 0) {
      const tag = queue.shift();
      if (!tag) break;

      try {
        const newPath = await processTag(tag);
        successful++;
        console.log(`[${processed + successful + failed}/${mismatchedTags.length}] ✅ ${tag.name} (${tag.category}) → ${newPath.join(" > ")}`);
      } catch (error) {
        failed++;
        console.error(`[${processed + successful + failed}/${mismatchedTags.length}] ❌ ${tag.name}:`, error);
      } finally {
        processed++;
      }
    }
  }

  const workers = Array.from({ length: CONCURRENCY }, (_, i) => worker(i + 1));
  await Promise.all(workers);

  console.log("\n📊 Path fix complete:");
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





