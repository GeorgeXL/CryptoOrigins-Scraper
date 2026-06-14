import "dotenv/config";
import { db } from "../db";
import { historicalNewsAnalyses } from "@shared/schema";
import { sql } from "drizzle-orm";
import { categorizeTagWithContext } from "../services/tag-categorizer";
import { TAXONOMY_TREE } from "@shared/taxonomy";
import { aiService } from "../services/ai";
import { writeFileSync } from "fs";
import { join } from "path";

async function main() {
  const tagLimit = parseInt(process.env.TEST_TAG_LIMIT || '30');
  const provider = (process.env.TEST_PROVIDER || 'openai') as 'openai' | 'gemini';
  
  const logFile = join(process.cwd(), `test-results-${provider}-${tagLimit}-${Date.now()}.txt`);
  const log: string[] = [];
  
  const logAndPrint = (msg: string) => {
    console.log(msg);
    log.push(msg);
    // Write to file periodically
    if (log.length % 10 === 0) {
      writeFileSync(logFile, log.join('\n'), 'utf-8');
    }
  };
  
  logAndPrint(`🧪 Testing tag categorization on ${tagLimit} tags using ${provider.toUpperCase()}\n`);
  logAndPrint("=" .repeat(80));

  // Get tags from tags_version2
  const result = await db.execute(sql`
    SELECT DISTINCT unnest(tags_version2) as tag_name
    FROM historical_news_analyses
    WHERE tags_version2 IS NOT NULL 
      AND array_length(tags_version2, 1) > 0
    ORDER BY tag_name
    LIMIT ${tagLimit}
  `);

  const tags = result.rows.map((row: any) => row.tag_name as string);

  if (tags.length === 0) {
    console.log("❌ No tags found in tags_version2. Please run 'Tag All Database' first.");
    process.exit(1);
  }

  logAndPrint(`📊 Found ${tags.length} tags to test:\n`);
  tags.forEach((tag, idx) => {
    logAndPrint(`   ${idx + 1}. ${tag}`);
  });
  logAndPrint('');

  // Helper function to get sample summaries for a tag
  const getTagSummaries = async (tagName: string): Promise<string[]> => {
    const { sql } = await import("drizzle-orm");
    const result = await db.execute(sql`
      SELECT summary
      FROM historical_news_analyses
      WHERE tags_version2 IS NOT NULL 
        AND array_length(tags_version2, 1) > 0
        AND ${tagName} = ANY(tags_version2)
        AND summary IS NOT NULL
        AND summary != ''
      ORDER BY date DESC
      LIMIT 3
    `);
    return result.rows.map((row: any) => row.summary as string);
  };

  // Helper function to find category/subcategory name from path
  function findCategoryPath(categoryKey: string, subcategoryPath: string[]): string {
    const findNode = (nodes: typeof TAXONOMY_TREE, key: string): typeof TAXONOMY_TREE[0] | null => {
      for (const node of nodes) {
        if (node.key === key) return node;
        if (node.children) {
          const found = findNode(node.children as typeof TAXONOMY_TREE, key);
          if (found) return found;
        }
      }
      return null;
    };

    const categoryNode = findNode(TAXONOMY_TREE, categoryKey);
    if (!categoryNode) return `${categoryKey} (not found)`;

    let path = `${categoryNode.emoji || ''} ${categoryNode.name}`;
    let current = categoryNode.children || [];

    for (const subKey of subcategoryPath) {
      const subNode = current.find(n => n.key === subKey);
      if (subNode) {
        path += ` → ${subNode.name}`;
        current = subNode.children || [];
      } else {
        path += ` → ${subKey} (not found)`;
        break;
      }
    }

    return path;
  }

  const results: Array<{
    tag: string;
    category: string;
    subcategoryPath: string[];
    confidence: number;
    reasoning?: string;
    pathDisplay: string;
    success: boolean;
    error?: string;
  }> = [];

  for (let i = 0; i < tags.length; i++) {
    const tag = tags[i];
    logAndPrint(`\n[${i + 1}/${tags.length}] Testing "${tag}"`);
    logAndPrint("-".repeat(80));

    try {
      // Get sample summaries for context
      const summaries = await getTagSummaries(tag);
      logAndPrint(`   📝 Found ${summaries.length} sample summaries for context`);
      if (summaries.length > 0) {
        logAndPrint(`   Preview: "${summaries[0].substring(0, 100)}${summaries[0].length > 100 ? '...' : ''}"`);
      }

      // Categorize with context
      logAndPrint(`   🤖 Categorizing...`);
      const categorization = await categorizeTagWithContext(tag, summaries, undefined, provider);

      const pathDisplay = findCategoryPath(categorization.category, categorization.subcategoryPath);

      results.push({
        tag,
        category: categorization.category,
        subcategoryPath: categorization.subcategoryPath,
        confidence: categorization.confidence,
        reasoning: categorization.reasoning,
        pathDisplay,
        success: true,
      });

      logAndPrint(`   ✅ Category: ${categorization.category}`);
      logAndPrint(`   ✅ Subcategory Path: [${categorization.subcategoryPath.join(', ')}]`);
      logAndPrint(`   ✅ Full Path: ${pathDisplay}`);
      logAndPrint(`   ✅ Confidence: ${(categorization.confidence * 100).toFixed(1)}%`);
      if (categorization.reasoning) {
        logAndPrint(`   💭 Reasoning: ${categorization.reasoning}`);
      }
    } catch (error) {
      const errorMsg = `   ❌ Error: ${error instanceof Error ? error.message : 'Unknown error'}`;
      console.error(errorMsg);
      logAndPrint(errorMsg);
      results.push({
        tag,
        category: '',
        subcategoryPath: [],
        confidence: 0,
        pathDisplay: 'ERROR',
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }

    // Small delay to avoid rate limits
    if (i < tags.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  logAndPrint("\n" + "=".repeat(80));
  logAndPrint("\n📊 SUMMARY:\n");

  const successful = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;
  const avgConfidence = results
    .filter((r) => r.success)
    .reduce((sum, r) => sum + r.confidence, 0) / successful;

  logAndPrint(`   ✅ Successful: ${successful}/${tags.length}`);
  logAndPrint(`   ❌ Failed: ${failed}/${tags.length}`);
  if (successful > 0) {
    logAndPrint(`   📈 Average Confidence: ${(avgConfidence * 100).toFixed(1)}%`);
  }

  logAndPrint("\n📋 DETAILED RESULTS:\n");
  results.forEach((result, idx) => {
    logAndPrint(`${idx + 1}. "${result.tag}"`);
    if (result.success) {
      logAndPrint(`   Category: ${result.category}`);
      logAndPrint(`   Path: [${result.subcategoryPath.join(' → ')}]`);
      logAndPrint(`   Full: ${result.pathDisplay}`);
      logAndPrint(`   Confidence: ${(result.confidence * 100).toFixed(1)}%`);
      if (result.reasoning) {
        logAndPrint(`   Reasoning: ${result.reasoning}`);
      }
    } else {
      logAndPrint(`   ❌ Error: ${result.error}`);
    }
    logAndPrint('');
  });

  // Check if categories match expected taxonomy
  logAndPrint("=".repeat(80));
  logAndPrint("\n🔍 VALIDATION:\n");

  const categoryKeys = new Set(results.filter(r => r.success).map(r => r.category));
  const validCategoryKeys = new Set(TAXONOMY_TREE.map(n => n.key));

  const invalidCategories = Array.from(categoryKeys).filter(cat => !validCategoryKeys.has(cat));
  if (invalidCategories.length > 0) {
    logAndPrint(`   ⚠️  Invalid category keys found: ${invalidCategories.join(', ')}`);
    logAndPrint(`   Valid keys: ${Array.from(validCategoryKeys).join(', ')}`);
  } else {
    logAndPrint(`   ✅ All category keys are valid`);
  }

  // Check subcategory paths
  let invalidPaths = 0;
  results.forEach(r => {
    if (r.success && r.subcategoryPath.length > 0) {
      // Basic validation - paths should start with category number
      const categoryNode = TAXONOMY_TREE.find(n => n.key === r.category);
      if (categoryNode) {
        const categoryNum = categoryNode.key === 'bitcoin' ? '1' :
                           categoryNode.key === 'money-economics' ? '2' :
                           categoryNode.key === 'technology' ? '3' :
                           categoryNode.key === 'organizations' ? '4' :
                           categoryNode.key === 'people' ? '5' :
                           categoryNode.key === 'regulation-law' ? '6' :
                           categoryNode.key === 'markets-geography' ? '7' :
                           categoryNode.key === 'education-community' ? '8' :
                           categoryNode.key === 'crime-security' ? '9' :
                           categoryNode.key === 'topics' ? '10' :
                           categoryNode.key === 'miscellaneous' ? '11' : '?';
        
        const firstPath = r.subcategoryPath[0];
        if (!firstPath.startsWith(categoryNum + '.')) {
          invalidPaths++;
          logAndPrint(`   ⚠️  "${r.tag}": Path [${r.subcategoryPath.join(', ')}] doesn't match category ${r.category} (should start with ${categoryNum}.)`);
        }
      }
    }
  });

  if (invalidPaths === 0) {
    logAndPrint(`   ✅ All subcategory paths are valid`);
  } else {
    logAndPrint(`   ⚠️  ${invalidPaths} tags have invalid subcategory paths`);
  }

  logAndPrint("\n" + "=".repeat(80));
  if (successful === tags.length && invalidCategories.length === 0 && invalidPaths === 0) {
    logAndPrint("✅ ALL TESTS PASSED - Ready for production!");
  } else {
    logAndPrint("⚠️  Some issues found - review results above");
  }
  logAndPrint("=".repeat(80));
  
  // Write final results to file
  writeFileSync(logFile, log.join('\n'), 'utf-8');
  console.log(`\n📄 Results saved to: ${logFile}`);
}

main().catch((err) => {
  console.error("❌ Error:", err);
  process.exit(1);
});

