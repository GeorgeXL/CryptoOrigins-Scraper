/**
 * Script to allocate unmatched tags to categories based on similarity
 * 
 * This script:
 * 1. Finds all tags in analyses that don't exist in tag_metadata
 * 2. For each unmatched tag, finds the most similar tag in tag_metadata
 * 3. Creates tag_metadata entries with the category from the most similar match
 */

import * as path from 'path';
import { fileURLToPath } from 'url';
import { config } from 'dotenv';

// Get __dirname equivalent for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
config({ path: path.join(__dirname, '../../.env') });
config({ path: path.join(__dirname, '../../client/.env') });

import { db } from "../db";
import { historicalNewsAnalyses, tagMetadata } from "@shared/schema";
import { findSimilarTags, normalizeTagName, calculateSimilarity } from "../services/tag-similarity";
import { eq, sql } from "drizzle-orm";

interface TagFromAnalysis {
  name: string;
  category?: string;
  count: number;
}

interface MatchedTag {
  name: string;
  category: string;
  id?: string;
  parentTagId?: string | null;
}

async function getAllTagsFromAnalyses(): Promise<Map<string, TagFromAnalysis>> {
  console.log("📊 Fetching all tags from analyses...");
  
  const allAnalyses = await db
    .select({ tags: historicalNewsAnalyses.tags })
    .from(historicalNewsAnalyses);
  
  const tagMap = new Map<string, TagFromAnalysis>();
  
  for (const analysis of allAnalyses) {
    if (analysis.tags && Array.isArray(analysis.tags)) {
      for (const tag of analysis.tags as any[]) {
        if (tag.name) {
          const key = tag.name.toLowerCase().trim();
          if (!tagMap.has(key)) {
            tagMap.set(key, {
              name: tag.name,
              category: tag.category,
              count: 0,
            });
          }
          tagMap.get(key)!.count++;
        }
      }
    }
  }
  
  console.log(`✅ Found ${tagMap.size} unique tags in analyses`);
  return tagMap;
}

async function getAllTagsFromMetadata(): Promise<Map<string, MatchedTag>> {
  console.log("📊 Fetching all tags from tag_metadata...");
  
  const allTags = await db
    .select()
    .from(tagMetadata);
  
  const tagMap = new Map<string, MatchedTag>();
  
  for (const tag of allTags) {
    const key = tag.name.toLowerCase().trim();
    tagMap.set(key, {
      name: tag.name,
      category: tag.category,
      id: tag.id,
      parentTagId: tag.parentTagId,
    });
  }
  
  console.log(`✅ Found ${tagMap.size} tags in tag_metadata`);
  return tagMap;
}

async function findUnmatchedTags(
  analysisTags: Map<string, TagFromAnalysis>,
  metadataTags: Map<string, MatchedTag>
): Promise<TagFromAnalysis[]> {
  const unmatched: TagFromAnalysis[] = [];
  
  for (const [key, tag] of analysisTags) {
    if (!metadataTags.has(key)) {
      unmatched.push(tag);
    }
  }
  
  console.log(`📋 Found ${unmatched.length} unmatched tags`);
  return unmatched;
}

async function allocateUnmatchedTags() {
  try {
    console.log("🚀 Starting unmatched tag allocation...\n");
    
    // Get all tags from analyses and metadata
    const analysisTags = await getAllTagsFromAnalyses();
    const metadataTags = await getAllTagsFromMetadata();
    
    // Find unmatched tags
    const unmatchedTags = await findUnmatchedTags(analysisTags, metadataTags);
    
    if (unmatchedTags.length === 0) {
      console.log("✅ No unmatched tags found. All tags are already allocated!");
      return;
    }
    
    // Convert metadata tags to array for similarity matching
    const matchedTagsArray: Array<{ name: string; category: string }> = Array.from(metadataTags.values()).map(t => ({
      name: t.name,
      category: t.category,
    }));
    
    console.log(`\n🔍 Finding similar tags for ${unmatchedTags.length} unmatched tags...\n`);
    
    const allocations: Array<{
      unmatchedTag: TagFromAnalysis;
      matchedTag: MatchedTag | null;
      similarity: number;
    }> = [];
    
    // Find best match for each unmatched tag
    for (const unmatchedTag of unmatchedTags) {
      const similar = findSimilarTags(unmatchedTag.name, matchedTagsArray, 0.6); // Lower threshold for more matches
      
      if (similar.length > 0) {
        const bestMatch = similar[0];
        const matchedTag = metadataTags.get(bestMatch.name!.toLowerCase().trim());
        
        if (matchedTag) {
          allocations.push({
            unmatchedTag,
            matchedTag,
            similarity: bestMatch.similarity,
          });
        }
      } else {
        allocations.push({
          unmatchedTag,
          matchedTag: null,
          similarity: 0,
        });
      }
    }
    
    // Sort by similarity (highest first)
    allocations.sort((a, b) => b.similarity - a.similarity);
    
    // Show summary
    const allocatable = allocations.filter(a => a.matchedTag !== null && a.similarity >= 0.7);
    const lowConfidence = allocations.filter(a => a.matchedTag !== null && a.similarity >= 0.6 && a.similarity < 0.7);
    const unallocatable = allocations.filter(a => a.matchedTag === null || a.similarity < 0.6);
    
    console.log("📊 Allocation Summary:");
    console.log(`   ✅ High confidence (≥0.7): ${allocatable.length}`);
    console.log(`   ⚠️  Low confidence (0.6-0.7): ${lowConfidence.length}`);
    console.log(`   ❌ No match found (<0.6): ${unallocatable.length}\n`);
    
    // Show high confidence allocations
    if (allocatable.length > 0) {
      console.log("✅ High confidence allocations:");
      for (const alloc of allocatable.slice(0, 20)) {
        console.log(`   "${alloc.unmatchedTag.name}" → "${alloc.matchedTag!.name}" (${alloc.matchedTag!.category}) [${(alloc.similarity * 100).toFixed(1)}%]`);
      }
      if (allocatable.length > 20) {
        console.log(`   ... and ${allocatable.length - 20} more`);
      }
      console.log();
    }
    
    // Ask for confirmation (in automated mode, we'll proceed with high confidence only)
    const toAllocate = allocatable;
    
    if (toAllocate.length === 0) {
      console.log("⚠️  No tags with high confidence matches found. Nothing to allocate.");
      return;
    }
    
    console.log(`\n💾 Creating ${toAllocate.length} tag_metadata entries...\n`);
    
    let created = 0;
    let skipped = 0;
    
    for (const alloc of toAllocate) {
      try {
        // Check if tag already exists (race condition protection)
        const existing = await db
          .select()
          .from(tagMetadata)
          .where(
            sql`LOWER(TRIM(${tagMetadata.name})) = LOWER(TRIM(${alloc.unmatchedTag.name}))`
          )
          .limit(1);
        
        if (existing.length > 0) {
          console.log(`   ⏭️  Skipping "${alloc.unmatchedTag.name}" (already exists)`);
          skipped++;
          continue;
        }
        
        // Create new tag_metadata entry
        await db.insert(tagMetadata).values({
          name: alloc.unmatchedTag.name,
          category: alloc.matchedTag!.category,
          normalizedName: normalizeTagName(alloc.unmatchedTag.name),
          usageCount: alloc.unmatchedTag.count,
          parentTagId: alloc.matchedTag!.parentTagId || null,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        
        console.log(`   ✅ Created "${alloc.unmatchedTag.name}" → ${alloc.matchedTag!.category} [${(alloc.similarity * 100).toFixed(1)}% match]`);
        created++;
      } catch (error: any) {
        // Handle unique constraint violations
        if (error.code === '23505') {
          console.log(`   ⏭️  Skipping "${alloc.unmatchedTag.name}" (duplicate)`);
          skipped++;
        } else {
          console.error(`   ❌ Error creating "${alloc.unmatchedTag.name}":`, error.message);
        }
      }
    }
    
    console.log(`\n✅ Allocation complete!`);
    console.log(`   Created: ${created}`);
    console.log(`   Skipped: ${skipped}`);
    console.log(`   Low confidence (not allocated): ${lowConfidence.length}`);
    console.log(`   No match (not allocated): ${unallocatable.length}`);
    
    // Show unallocatable tags for manual review
    if (unallocatable.length > 0) {
      console.log(`\n📋 Tags that couldn't be allocated (for manual review):`);
      for (const alloc of unallocatable.slice(0, 30)) {
        console.log(`   - "${alloc.unmatchedTag.name}" (used ${alloc.unmatchedTag.count} times)`);
      }
      if (unallocatable.length > 30) {
        console.log(`   ... and ${unallocatable.length - 30} more`);
      }
    }
    
  } catch (error) {
    console.error("❌ Error allocating unmatched tags:", error);
    throw error;
  }
}

// Run the script
// Check if this is the main module (ES modules way)
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.includes('allocate-unmatched-tags')) {
  allocateUnmatchedTags()
    .then(() => {
      console.log("\n✅ Script completed successfully");
      process.exit(0);
    })
    .catch((error) => {
      console.error("\n❌ Script failed:", error);
      process.exit(1);
    });
}

export { allocateUnmatchedTags };
