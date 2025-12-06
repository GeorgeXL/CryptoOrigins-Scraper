import "dotenv/config";
import { db } from "../db";
import { categorizeTag } from "../services/tag-categorizer";
import { tags as tagsTable } from "@shared/schema";
import { sql, eq } from "drizzle-orm";

const CONCURRENCY = Number(process.env.AI_CATEGORIZE_CONCURRENCY || 3);

interface TagRow {
  id: string;
  name: string;
  category: string;
  subcategoryPath: string[] | null;
}

async function getUncategorizedTags(): Promise<TagRow[]> {
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
  
  // Ensure the path matches the category
  const subcategoryPath = (result.subcategoryPath && result.subcategoryPath.length > 0)
    ? result.subcategoryPath
    : ["14.1"];

  // Update both category and path (in case category was wrong too)
  await db.update(tagsTable)
    .set({
      category: result.category,
      subcategoryPath,
      updatedAt: new Date(),
    })
    .where(eq(tagsTable.id, tag.id));

  return { category: result.category, path: subcategoryPath };
}

async function main() {
  console.log("🔍 Finding tags without subcategory paths...\n");
  
  const uncategorizedTags = await getUncategorizedTags();
  
  if (uncategorizedTags.length === 0) {
    console.log("🎉 All tags already have subcategory paths!");
    return;
  }

  console.log(`📊 Found ${uncategorizedTags.length} tags without paths:`);
  uncategorizedTags.slice(0, 10).forEach(tag => {
    console.log(`   - ${tag.name}: category="${tag.category}"`);
  });
  if (uncategorizedTags.length > 10) {
    console.log(`   ... and ${uncategorizedTags.length - 10} more`);
  }
  console.log(`\n🧠 Categorizing with AI (concurrency ${CONCURRENCY})...\n`);

  let processed = 0;
  let successful = 0;
  let failed = 0;

  const queue = [...uncategorizedTags];

  async function worker(workerId: number) {
    while (queue.length > 0) {
      const tag = queue.shift();
      if (!tag) break;

      try {
        const { category, path } = await processTag(tag);
        successful++;
        console.log(`[${processed + successful + failed}/${uncategorizedTags.length}] ✅ ${tag.name} → ${category} ${path.join(" > ")}`);
      } catch (error) {
        failed++;
        console.error(`[${processed + successful + failed}/${uncategorizedTags.length}] ❌ ${tag.name}:`, error);
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





