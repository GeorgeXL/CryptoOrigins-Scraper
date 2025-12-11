/**
 * Validation script to verify migration completeness and data integrity
 * 
 * This script verifies:
 * - All tags from JSONB exist in tags table
 * - All analyses have corresponding pages_and_tags entries
 * - Tag counts match between JSONB and join table
 * - No orphaned entries
 * 
 * Run with: npx tsx server/scripts/validate-tags-migration.ts
 */

import "dotenv/config";
import { db } from "../db";
import { tags, pagesAndTags, historicalNewsAnalyses } from "@shared/schema";
import { eq, sql } from "drizzle-orm";

interface ValidationResult {
  name: string;
  passed: boolean;
  message: string;
  details?: any;
}

const results: ValidationResult[] = [];

function logValidation(name: string, passed: boolean, message: string, details?: any) {
  results.push({ name, passed, message, details });
  const icon = passed ? "✅" : "❌";
  console.log(`${icon} ${name}: ${message}`);
  if (details) {
    console.log(`   Details:`, details);
  }
}

async function validateAllTagsExist() {
  console.log("\n🔍 Validation 1: All JSONB tags exist in tags table");
  
  try {
    // Get all unique tags from JSONB
    const jsonbTags = await db.execute(sql`
      SELECT DISTINCT
        tag->>'name' as name,
        tag->>'category' as category
      FROM historical_news_analyses,
        jsonb_array_elements(tags) as tag
      WHERE tags IS NOT NULL AND jsonb_typeof(tags) = 'array'
    `);
    
    // Get all tags from tags table
    const normalizedTags = await db.select({
      name: tags.name,
      category: tags.category,
    }).from(tags);
    
    const normalizedTagsSet = new Set(
      normalizedTags.map(t => `${t.category}::${t.name}`)
    );
    
    const missingTags: string[] = [];
    for (const row of jsonbTags.rows as any[]) {
      const key = `${row.category}::${row.name}`;
      if (!normalizedTagsSet.has(key)) {
        missingTags.push(key);
      }
    }
    
    if (missingTags.length === 0) {
      logValidation("All tags exist", true, `All ${jsonbTags.rows.length} JSONB tags found in tags table`);
    } else {
      logValidation("All tags exist", false, `Missing ${missingTags.length} tags in tags table`, {
        missing: missingTags.slice(0, 10),
        total: missingTags.length
      });
    }
    
  } catch (error) {
    logValidation("All tags exist", false, `Error: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function validateAllAnalysesHaveJoinEntries() {
  console.log("\n🔍 Validation 2: All analyses have join table entries");
  
  try {
    // Get analyses with tags in JSONB
    const analysesWithTags = await db.execute(sql`
      SELECT id, tags
      FROM historical_news_analyses
      WHERE tags IS NOT NULL AND jsonb_typeof(tags) = 'array' AND jsonb_array_length(tags) > 0
    `);
    
    let missingCount = 0;
    const missingAnalyses: string[] = [];
    
    for (const analysis of analysesWithTags.rows as any[]) {
      const tagCount = await db.select({ count: sql<number>`count(*)` })
        .from(pagesAndTags)
        .where(eq(pagesAndTags.analysisId, analysis.id));
      
      const count = Number(tagCount[0]?.count || 0);
      const jsonbTagCount = Array.isArray(analysis.tags) ? analysis.tags.length : 0;
      
      if (count === 0 && jsonbTagCount > 0) {
        missingCount++;
        if (missingAnalyses.length < 10) {
          missingAnalyses.push(analysis.id);
        }
      }
    }
    
    if (missingCount === 0) {
      logValidation("All analyses have join entries", true, `All ${analysesWithTags.rows.length} analyses have join table entries`);
    } else {
      logValidation("All analyses have join entries", false, `${missingCount} analyses missing join table entries`, {
        examples: missingAnalyses
      });
    }
    
  } catch (error) {
    logValidation("All analyses have join entries", false, `Error: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function validateTagCountsMatch() {
  console.log("\n🔍 Validation 3: Tag counts match between JSONB and join table");
  
  try {
    // Count tags in JSONB
    const jsonbCounts = await db.execute(sql`
      SELECT 
        tag->>'name' as name,
        tag->>'category' as category,
        COUNT(*)::integer as count
      FROM historical_news_analyses,
        jsonb_array_elements(tags) as tag
      WHERE tags IS NOT NULL AND jsonb_typeof(tags) = 'array'
      GROUP BY tag->>'name', tag->>'category'
    `);
    
    // Count tags in join table
    const joinTableCounts = await db.execute(sql`
      SELECT 
        t.name,
        t.category,
        COUNT(pt.id)::integer as count
      FROM tags t
      LEFT JOIN pages_and_tags pt ON t.id = pt.tag_id
      GROUP BY t.name, t.category
    `);
    
    const jsonbMap = new Map<string, number>();
    for (const row of jsonbCounts.rows as any[]) {
      const key = `${row.category}::${row.name}`;
      jsonbMap.set(key, row.count);
    }
    
    const mismatches: any[] = [];
    for (const row of joinTableCounts.rows as any[]) {
      const key = `${row.category}::${row.name}`;
      const jsonbCount = jsonbMap.get(key) || 0;
      const joinCount = row.count;
      
      if (jsonbCount !== joinCount) {
        mismatches.push({
          tag: key,
          jsonbCount,
          joinCount,
          difference: Math.abs(jsonbCount - joinCount)
        });
      }
    }
    
    if (mismatches.length === 0) {
      logValidation("Tag counts match", true, `All ${jsonbCounts.rows.length} tag counts match`);
    } else {
      logValidation("Tag counts match", false, `${mismatches.length} tags have count mismatches`, {
        examples: mismatches.slice(0, 10)
      });
    }
    
  } catch (error) {
    logValidation("Tag counts match", false, `Error: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function validateNoOrphanedEntries() {
  console.log("\n🔍 Validation 4: No orphaned entries");
  
  try {
    // Check for orphaned join table entries (tag_id doesn't exist)
    const orphanedJoins = await db.execute(sql`
      SELECT pt.id, pt.analysis_id, pt.tag_id
      FROM pages_and_tags pt
      LEFT JOIN tags t ON pt.tag_id = t.id
      WHERE t.id IS NULL
      LIMIT 10
    `);
    
    // Check for orphaned join table entries (analysis_id doesn't exist)
    const orphanedAnalyses = await db.execute(sql`
      SELECT pt.id, pt.analysis_id, pt.tag_id
      FROM pages_and_tags pt
      LEFT JOIN historical_news_analyses hna ON pt.analysis_id = hna.id
      WHERE hna.id IS NULL
      LIMIT 10
    `);
    
    // Check for tags with no join entries (orphaned tags)
    const orphanedTags = await db.execute(sql`
      SELECT t.id, t.name, t.category
      FROM tags t
      LEFT JOIN pages_and_tags pt ON t.id = pt.tag_id
      WHERE pt.id IS NULL
      LIMIT 10
    `);
    
    const orphanedJoinsCount = orphanedJoins.rows?.length || 0;
    const orphanedAnalysesCount = orphanedAnalyses.rows?.length || 0;
    const orphanedTagsCount = orphanedTags.rows?.length || 0;
    
    if (orphanedJoinsCount === 0 && orphanedAnalysesCount === 0) {
      logValidation("No orphaned join entries", true, "No orphaned join table entries found");
    } else {
      logValidation("No orphaned join entries", false, `Found ${orphanedJoinsCount + orphanedAnalysesCount} orphaned join entries`, {
        orphanedJoins: orphanedJoins.rows?.slice(0, 5),
        orphanedAnalyses: orphanedAnalyses.rows?.slice(0, 5)
      });
    }
    
    if (orphanedTagsCount === 0) {
      logValidation("No orphaned tags", true, "No orphaned tags found (tags with no join entries)");
    } else {
      logValidation("No orphaned tags", false, `Found ${orphanedTagsCount} orphaned tags`, {
        examples: orphanedTags.rows?.slice(0, 5)
      });
    }
    
  } catch (error) {
    logValidation("No orphaned entries", false, `Error: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function validateUsageCounts() {
  console.log("\n🔍 Validation 5: Usage counts are accurate");
  
  try {
    // Get usage counts from join table
    const actualCounts = await db.execute(sql`
      SELECT 
        t.id,
        t.name,
        t.category,
        t.usage_count as stored_count,
        COUNT(pt.id)::integer as actual_count
      FROM tags t
      LEFT JOIN pages_and_tags pt ON t.id = pt.tag_id
      GROUP BY t.id, t.name, t.category, t.usage_count
      HAVING t.usage_count != COUNT(pt.id)
      LIMIT 20
    `);
    
    if (actualCounts.rows && actualCounts.rows.length === 0) {
      logValidation("Usage counts accurate", true, "All usage counts match join table counts");
    } else {
      logValidation("Usage counts accurate", false, `${actualCounts.rows?.length || 0} tags have incorrect usage counts`, {
        examples: actualCounts.rows?.slice(0, 10)
      });
    }
    
  } catch (error) {
    logValidation("Usage counts accurate", false, `Error: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function main() {
  console.log("🔍 Starting Tags Migration Validation\n");
  console.log("=".repeat(60));
  
  try {
    await validateAllTagsExist();
    await validateAllAnalysesHaveJoinEntries();
    await validateTagCountsMatch();
    await validateNoOrphanedEntries();
    await validateUsageCounts();
    
    console.log("\n" + "=".repeat(60));
    console.log("\n📊 Validation Summary:");
    
    const passed = results.filter(r => r.passed).length;
    const failed = results.filter(r => !r.passed).length;
    const total = results.length;
    
    console.log(`✅ Passed: ${passed}/${total}`);
    console.log(`❌ Failed: ${failed}/${total}`);
    
    if (failed > 0) {
      console.log("\n❌ Failed Validations:");
      results.filter(r => !r.passed).forEach(r => {
        console.log(`   - ${r.name}: ${r.message}`);
      });
      process.exit(1);
    } else {
      console.log("\n✅ All validations passed!");
      process.exit(0);
    }
    
  } catch (error) {
    console.error("\n❌ Fatal error:", error);
    process.exit(1);
  }
}

main().catch(console.error);







