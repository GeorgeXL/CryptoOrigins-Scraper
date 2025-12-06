import "dotenv/config";
import { db } from "../db";
import { historicalNewsAnalyses } from "@shared/schema";
import { sql, eq } from "drizzle-orm";

async function main() {
  console.log("🚀 Starting backfill of tag_names column...\n");

  // 1. Get all analyses that have tags but might miss tag_names
  const allAnalyses = await db.select({
    id: historicalNewsAnalyses.id,
    tags: historicalNewsAnalyses.tags,
    tagNames: historicalNewsAnalyses.tagNames
  })
  .from(historicalNewsAnalyses)
  .where(sql`tags IS NOT NULL AND jsonb_typeof(tags) = 'array'`);

  console.log(`📊 Found ${allAnalyses.length} analyses with tags.`);

  let updated = 0;
  let skipped = 0;

  // 2. Process each analysis
  for (const analysis of allAnalyses) {
    const tags = analysis.tags as any[];
    
    if (!Array.isArray(tags) || tags.length === 0) {
      continue;
    }

    // Extract just the names
    const extractedNames = tags
      .map(t => t?.name)
      .filter(name => typeof name === 'string' && name.trim().length > 0);

    // Skip if no valid names found
    if (extractedNames.length === 0) continue;

    // Check if update is needed
    const currentNames = analysis.tagNames || [];
    const needsUpdate = 
      currentNames.length !== extractedNames.length || 
      !extractedNames.every(n => currentNames.includes(n));

    if (needsUpdate) {
      await db.update(historicalNewsAnalyses)
        .set({ 
          tagNames: extractedNames,
          updatedAt: new Date() // Touch updated_at to trigger any syncs
        })
        .where(eq(historicalNewsAnalyses.id, analysis.id));
      updated++;
    } else {
      skipped++;
    }
    
    if (updated % 100 === 0 && updated > 0) {
      process.stdout.write(`.`);
    }
  }

  console.log(`\n\n✅ Backfill complete!`);
  console.log(`   Updated: ${updated} records`);
  console.log(`   Skipped: ${skipped} records (already correct)`);
}

main().catch((err) => {
  console.error("❌ Error:", err);
  process.exit(1);
});





