/**
 * Migration Script: Recategorize all tags to new 11-category taxonomy
 * 
 * This script will:
 * 1. Query all tags from the tags table
 * 2. Use AI to recategorize each tag to the new taxonomy
 * 3. Update category and subcategoryPath in tags table
 * 4. Update JSONB tags in historical_news_analyses to stay in sync
 * 
 * Expected runtime: 30-45 minutes (AI categorization is slow)
 */

import 'dotenv/config';
import { db } from '../db';
import { tags, historicalNewsAnalyses } from '@shared/schema';
import { sql } from 'drizzle-orm';
import { categorizeTag } from '../services/tag-categorizer';

interface TagToMigrate {
  id: string;
  name: string;
  category: string;
  subcategoryPath: string[] | null;
  usageCount: number;
}

async function main() {
  console.log('🚀 Starting tag recategorization migration...\n');
  
  try {
    // Step 1: Get all tags
    console.log('📊 Fetching all tags from database...');
    const allTags = await db.execute<TagToMigrate>(sql`
      SELECT id, name, category, subcategory_path, usage_count
      FROM tags
      ORDER BY usage_count DESC
    `);
    
    const totalTags = allTags.rows.length;
    console.log(`Found ${totalTags} tags to recategorize\n`);
    
    if (totalTags === 0) {
      console.log('✅ No tags to migrate');
      process.exit(0);
    }
    
    // Step 2: Recategorize each tag
    let processed = 0;
    let updated = 0;
    let failed = 0;
    const failedTags: string[] = [];
    
    console.log('🤖 Starting AI categorization (this will take a while)...\n');
    
    for (const tag of allTags.rows) {
      try {
        // Call AI to categorize
        const result = await categorizeTag(tag.name, tag.category);
        
        // Check if a tag with same (name, category) already exists
        const existingTag = await db.execute<{ id: string }>(sql`
          SELECT id FROM tags 
          WHERE name = ${tag.name} 
            AND category = ${result.category}
            AND id != ${tag.id}
          LIMIT 1
        `);
        
        if (existingTag.rows.length > 0) {
          // Merge: delete the current tag (the duplicate will remain)
          console.log(`   🔀 Merging duplicate: "${tag.name}" (${tag.category} → ${result.category})`);
          await db.execute(sql`DELETE FROM tags WHERE id = ${tag.id}`);
        } else {
          // Update tag in database - use proper PostgreSQL array syntax
          await db.execute(sql`
            UPDATE tags
            SET 
              category = ${result.category},
              subcategory_path = ${sql.raw(`ARRAY[${result.subcategoryPath.map(p => `'${p}'`).join(', ')}]`)},
              updated_at = NOW()
            WHERE id = ${tag.id}
          `);
        }
        
        // Also update JSONB tags in historical_news_analyses
        await db.execute(sql`
          UPDATE historical_news_analyses
          SET tags = (
            SELECT jsonb_agg(
              CASE 
                WHEN tag->>'name' = ${tag.name} 
                THEN jsonb_set(tag, '{category}', to_jsonb(${result.category}::text))
                ELSE tag
              END
            )
            FROM jsonb_array_elements(tags) as tag
          )
          WHERE tags IS NOT NULL 
            AND jsonb_typeof(tags) = 'array'
            AND EXISTS (
              SELECT 1 FROM jsonb_array_elements(tags) t 
              WHERE t->>'name' = ${tag.name}
            )
        `);
        
        updated++;
        processed++;
        
        // Progress logging every 100 tags
        if (processed % 100 === 0) {
          const progress = ((processed / totalTags) * 100).toFixed(1);
          console.log(`✅ Progress: ${processed}/${totalTags} (${progress}%) - Updated: ${updated}, Failed: ${failed}`);
          console.log(`   Last: "${tag.name}" → ${result.category} [${result.subcategoryPath.join(' → ')}]`);
        }
        
        // Small delay to avoid rate limits (200ms between calls)
        await new Promise(resolve => setTimeout(resolve, 200));
        
      } catch (error) {
        failed++;
        processed++;
        failedTags.push(tag.name);
        console.error(`❌ Failed to recategorize "${tag.name}":`, error instanceof Error ? error.message : 'Unknown error');
        
        // Continue with next tag
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }
    
    // Final summary
    console.log('\n' + '='.repeat(60));
    console.log('🎉 Migration Complete!\n');
    console.log(`Total tags: ${totalTags}`);
    console.log(`✅ Successfully updated: ${updated}`);
    console.log(`❌ Failed: ${failed}`);
    console.log(`Success rate: ${((updated / totalTags) * 100).toFixed(1)}%`);
    
    if (failedTags.length > 0) {
      console.log(`\n⚠️  Failed tags (${failedTags.length}):`);
      failedTags.slice(0, 20).forEach(name => console.log(`   - ${name}`));
      if (failedTags.length > 20) {
        console.log(`   ... and ${failedTags.length - 20} more`);
      }
    }
    
    console.log('\n✨ Tags have been recategorized to the new 11-category taxonomy!');
    console.log('💡 Next steps:');
    console.log('   1. Flush the cache: curl -X POST http://localhost:5000/api/tags/flush-cache');
    console.log('   2. Refresh your browser to see the new categories');
    console.log('='.repeat(60) + '\n');
    
    process.exit(0);
    
  } catch (error) {
    console.error('💥 Fatal error during migration:', error);
    process.exit(1);
  }
}

main();

