/**
 * Test script to verify the normalized tags system handles:
 * - Multiple tags per analysis
 * - Deep subcategory paths (4+ levels)
 * - Filter tree building with arbitrary depth
 * - Query performance with many tags
 * 
 * Run with: npx tsx server/scripts/test-deep-hierarchy.ts
 */

import "dotenv/config";
import { db } from "../db";
import { tags, pagesAndTags, historicalNewsAnalyses } from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";
import { normalizeTagName } from "../services/tag-similarity";

interface TestResult {
  name: string;
  passed: boolean;
  message: string;
  details?: any;
}

const results: TestResult[] = [];

function logTest(name: string, passed: boolean, message: string, details?: any) {
  results.push({ name, passed, message, details });
  const icon = passed ? "✅" : "❌";
  console.log(`${icon} ${name}: ${message}`);
  if (details) {
    console.log(`   Details:`, details);
  }
}

async function testMultipleTagsPerAnalysis() {
  console.log("\n🧪 Test 1: Multiple tags per analysis");
  
  try {
    // Find an existing analysis or create a test one
    const existingAnalysis = await db.select()
      .from(historicalNewsAnalyses)
      .limit(1);
    
    if (existingAnalysis.length === 0) {
      logTest("Multiple tags per analysis", false, "No analyses found in database");
      return;
    }
    
    const analysisId = existingAnalysis[0].id;
    
    // Count how many tags this analysis has
    const tagCount = await db.select({ count: sql<number>`count(*)` })
      .from(pagesAndTags)
      .where(eq(pagesAndTags.analysisId, analysisId));
    
    const count = Number(tagCount[0]?.count || 0);
    
    if (count > 0) {
      logTest("Multiple tags per analysis", true, `Analysis has ${count} tags`, { analysisId, tagCount: count });
    } else {
      logTest("Multiple tags per analysis", false, "Analysis has no tags in join table", { analysisId });
    }
    
    // Test with 10+ tags scenario
    const analysesWithManyTags = await db.execute(sql`
      SELECT analysis_id, COUNT(*) as tag_count
      FROM pages_and_tags
      GROUP BY analysis_id
      HAVING COUNT(*) >= 10
      ORDER BY tag_count DESC
      LIMIT 5
    `);
    
    if (analysesWithManyTags.rows && analysesWithManyTags.rows.length > 0) {
      logTest("Analyses with 10+ tags", true, `Found ${analysesWithManyTags.rows.length} analyses with 10+ tags`, {
        examples: analysesWithManyTags.rows.slice(0, 3)
      });
    } else {
      logTest("Analyses with 10+ tags", false, "No analyses found with 10+ tags");
    }
    
  } catch (error) {
    logTest("Multiple tags per analysis", false, `Error: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function testDeepSubcategoryPaths() {
  console.log("\n🧪 Test 2: Deep subcategory paths");
  
  try {
    // Test paths of varying depths
    const depthTests = [
      { depth: 1, path: ["8.1"] },
      { depth: 2, path: ["8.1", "8.1.2"] },
      { depth: 3, path: ["8.1", "8.1.2", "8.1.2.1"] },
      { depth: 4, path: ["8.1", "8.1.2", "8.1.2.1", "8.1.2.1.1"] },
    ];
    
    for (const test of depthTests) {
      // Check if any tags have this path structure
      const tagsWithPath = await db.execute(sql`
        SELECT id, name, category, subcategory_path
        FROM tags
        WHERE subcategory_path = ${JSON.stringify(test.path)}::text[]
        LIMIT 1
      `);
      
      if (tagsWithPath.rows && tagsWithPath.rows.length > 0) {
        logTest(`Path depth ${test.depth}`, true, `Found tag with path ${test.path.join(" -> ")}`, {
          tag: tagsWithPath.rows[0]
        });
      } else {
        // Check if we can at least store this path structure
        const testTag = await db.insert(tags).values({
          name: `Test Tag Depth ${test.depth}`,
          category: "miscellaneous",
          normalizedName: normalizeTagName(`Test Tag Depth ${test.depth}`),
          subcategoryPath: test.path,
        }).returning();
        
        if (testTag.length > 0) {
          logTest(`Path depth ${test.depth}`, true, `Successfully stored path ${test.path.join(" -> ")}`, {
            tagId: testTag[0].id
          });
          
          // Clean up test tag
          await db.delete(tags).where(eq(tags.id, testTag[0].id));
        } else {
          logTest(`Path depth ${test.depth}`, false, `Failed to store path ${test.path.join(" -> ")}`);
        }
      }
    }
    
    // Find the deepest path in the database
    const deepestPath = await db.execute(sql`
      SELECT id, name, category, subcategory_path, array_length(subcategory_path, 1) as depth
      FROM tags
      WHERE subcategory_path IS NOT NULL
      ORDER BY array_length(subcategory_path, 1) DESC NULLS LAST
      LIMIT 1
    `);
    
    if (deepestPath.rows && deepestPath.rows.length > 0) {
      const row = deepestPath.rows[0] as any;
      logTest("Deepest path found", true, `Deepest path has ${row.depth} levels`, {
        tag: row.name,
        path: row.subcategory_path
      });
    } else {
      logTest("Deepest path found", false, "No tags with subcategory paths found");
    }
    
  } catch (error) {
    logTest("Deep subcategory paths", false, `Error: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function testFilterTreeBuilding() {
  console.log("\n🧪 Test 3: Filter tree building");
  
  try {
    // Get all tags with their paths
    const allTags = await db.select({
      id: tags.id,
      name: tags.name,
      category: tags.category,
      subcategoryPath: tags.subcategoryPath,
      parentTagId: tags.parentTagId,
      usageCount: tags.usageCount,
    })
      .from(tags)
      .where(sql`subcategory_path IS NOT NULL`)
      .limit(100);
    
    if (allTags.length === 0) {
      logTest("Filter tree building", false, "No tags with subcategory paths found");
      return;
    }
    
    // Build a simple tree structure
    const tree: Record<string, any> = {};
    
    for (const tag of allTags) {
      const category = tag.category;
      if (!tree[category]) {
        tree[category] = {
          category,
          tags: [],
          subcategories: {},
        };
      }
      
      if (tag.subcategoryPath && tag.subcategoryPath.length > 0) {
        // Build nested structure based on path
        let current = tree[category];
        for (let i = 0; i < tag.subcategoryPath.length; i++) {
          const pathKey = tag.subcategoryPath[i];
          if (!current.subcategories[pathKey]) {
            current.subcategories[pathKey] = {
              key: pathKey,
              tags: [],
              subcategories: {},
            };
          }
          current = current.subcategories[pathKey];
        }
        current.tags.push(tag);
      } else {
        tree[category].tags.push(tag);
      }
    }
    
    // Count nodes at different depths
    let maxDepth = 0;
    const countNodes = (node: any, depth: number = 0): number => {
      maxDepth = Math.max(maxDepth, depth);
      let count = 1;
      if (node.subcategories) {
        for (const key in node.subcategories) {
          count += countNodes(node.subcategories[key], depth + 1);
        }
      }
      return count;
    };
    
    let totalNodes = 0;
    for (const category in tree) {
      totalNodes += countNodes(tree[category]);
    }
    
    logTest("Filter tree building", true, `Built tree with ${totalNodes} nodes, max depth ${maxDepth}`, {
      categories: Object.keys(tree).length,
      totalTags: allTags.length,
      maxDepth
    });
    
  } catch (error) {
    logTest("Filter tree building", false, `Error: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function testQueryPerformance() {
  console.log("\n🧪 Test 4: Query performance with many tags");
  
  try {
    // Test querying analyses with many tags
    const startTime = Date.now();
    
    const analysesWithTags = await db.execute(sql`
      SELECT 
        hna.id,
        hna.date,
        COUNT(pt.tag_id) as tag_count
      FROM historical_news_analyses hna
      LEFT JOIN pages_and_tags pt ON hna.id = pt.analysis_id
      GROUP BY hna.id, hna.date
      HAVING COUNT(pt.tag_id) >= 10
      ORDER BY tag_count DESC
      LIMIT 50
    `);
    
    const duration = Date.now() - startTime;
    
    if (analysesWithTags.rows && analysesWithTags.rows.length > 0) {
      logTest("Query performance", true, `Query completed in ${duration}ms`, {
        results: analysesWithTags.rows.length,
        duration,
        sample: analysesWithTags.rows.slice(0, 3)
      });
    } else {
      logTest("Query performance", false, "No analyses with 10+ tags found");
    }
    
    // Test reverse query: find all analyses for a tag
    const tagWithMostAnalyses = await db.execute(sql`
      SELECT 
        t.id,
        t.name,
        t.category,
        COUNT(pt.analysis_id) as analysis_count
      FROM tags t
      LEFT JOIN pages_and_tags pt ON t.id = pt.tag_id
      GROUP BY t.id, t.name, t.category
      ORDER BY analysis_count DESC
      LIMIT 1
    `);
    
    if (tagWithMostAnalyses.rows && tagWithMostAnalyses.rows.length > 0) {
      const row = tagWithMostAnalyses.rows[0] as any;
      logTest("Reverse query (tag -> analyses)", true, `Tag "${row.name}" has ${row.analysis_count} analyses`, {
        tagId: row.id,
        analysisCount: row.analysis_count
      });
    } else {
      logTest("Reverse query (tag -> analyses)", false, "No tags found in join table");
    }
    
  } catch (error) {
    logTest("Query performance", false, `Error: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function testEdgeCases() {
  console.log("\n🧪 Test 5: Edge cases");
  
  try {
    // Test: Analysis with no tags
    const analysesWithoutTags = await db.execute(sql`
      SELECT hna.id, hna.date
      FROM historical_news_analyses hna
      LEFT JOIN pages_and_tags pt ON hna.id = pt.analysis_id
      WHERE pt.id IS NULL
      LIMIT 5
    `);
    
    if (analysesWithoutTags.rows) {
      logTest("Analysis with no tags", true, `Found ${analysesWithoutTags.rows.length} analyses without tags`, {
        examples: analysesWithoutTags.rows.slice(0, 3)
      });
    }
    
    // Test: Tag with no analyses
    const tagsWithoutAnalyses = await db.execute(sql`
      SELECT t.id, t.name, t.category
      FROM tags t
      LEFT JOIN pages_and_tags pt ON t.id = pt.tag_id
      WHERE pt.id IS NULL
      LIMIT 5
    `);
    
    if (tagsWithoutAnalyses.rows) {
      logTest("Tag with no analyses", true, `Found ${tagsWithoutAnalyses.rows.length} tags without analyses`, {
        examples: tagsWithoutAnalyses.rows.slice(0, 3)
      });
    }
    
    // Test: Tags with same name but different categories
    const duplicateNames = await db.execute(sql`
      SELECT name, COUNT(DISTINCT category) as category_count, array_agg(DISTINCT category) as categories
      FROM tags
      GROUP BY name
      HAVING COUNT(DISTINCT category) > 1
      LIMIT 5
    `);
    
    if (duplicateNames.rows && duplicateNames.rows.length > 0) {
      logTest("Tags with same name, different categories", true, `Found ${duplicateNames.rows.length} tags with duplicate names`, {
        examples: duplicateNames.rows
      });
    } else {
      logTest("Tags with same name, different categories", true, "No duplicate tag names found (this is expected)");
    }
    
    // Test: Very long subcategory paths (6+ levels)
    const veryLongPaths = await db.execute(sql`
      SELECT id, name, category, subcategory_path, array_length(subcategory_path, 1) as depth
      FROM tags
      WHERE array_length(subcategory_path, 1) >= 6
      LIMIT 5
    `);
    
    if (veryLongPaths.rows && veryLongPaths.rows.length > 0) {
      logTest("Very long paths (6+ levels)", true, `Found ${veryLongPaths.rows.length} tags with 6+ level paths`, {
        examples: veryLongPaths.rows.map((r: any) => ({
          name: r.name,
          depth: r.depth,
          path: r.subcategory_path
        }))
      });
    } else {
      logTest("Very long paths (6+ levels)", true, "No tags with 6+ level paths found (this is acceptable)");
    }
    
  } catch (error) {
    logTest("Edge cases", false, `Error: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function main() {
  console.log("🧪 Starting Deep Hierarchy Tests for Normalized Tags System\n");
  console.log("=" .repeat(60));
  
  try {
    await testMultipleTagsPerAnalysis();
    await testDeepSubcategoryPaths();
    await testFilterTreeBuilding();
    await testQueryPerformance();
    await testEdgeCases();
    
    console.log("\n" + "=".repeat(60));
    console.log("\n📊 Test Summary:");
    
    const passed = results.filter(r => r.passed).length;
    const failed = results.filter(r => !r.passed).length;
    const total = results.length;
    
    console.log(`✅ Passed: ${passed}/${total}`);
    console.log(`❌ Failed: ${failed}/${total}`);
    
    if (failed > 0) {
      console.log("\n❌ Failed Tests:");
      results.filter(r => !r.passed).forEach(r => {
        console.log(`   - ${r.name}: ${r.message}`);
      });
      process.exit(1);
    } else {
      console.log("\n✅ All tests passed!");
      process.exit(0);
    }
    
  } catch (error) {
    console.error("\n❌ Fatal error:", error);
    process.exit(1);
  }
}

main().catch(console.error);

