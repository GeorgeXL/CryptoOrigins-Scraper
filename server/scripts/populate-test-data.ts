import 'dotenv/config';
import { db } from '../db';
import { sql } from 'drizzle-orm';

/**
 * Populate test tables with known issues for agent testing
 * 
 * Test Data Includes:
 * 1. Duplicate news entries (same date, similar summaries)
 * 2. Invalid/irrelevant tags (non-Bitcoin/Web3 related)
 * 3. Timeline gaps (missing dates)
 * 4. Mis-categorized tags
 * 5. Low quality summaries
 */

interface TestNewsEntry {
  date: string;
  summary: string;
  tags: string[];
  isDuplicate?: boolean;
  quality?: 'good' | 'poor';
}

const testNewsEntries: TestNewsEntry[] = [
  // Good entries - should be kept
  {
    date: '2024-01-15',
    summary: 'Bitcoin reaches new all-time high of $50,000 as institutional adoption increases. Major companies announce Bitcoin treasury reserves.',
    tags: ['Bitcoin', 'Price', 'Institutional Adoption'],
    quality: 'good',
  },
  {
    date: '2024-01-20',
    summary: 'Ethereum completes successful upgrade improving transaction speed and reducing gas fees. DeFi protocols see increased activity.',
    tags: ['Ethereum', 'DeFi', 'Technology'],
    quality: 'good',
  },
  {
    date: '2024-01-25',
    summary: 'SEC approves first Bitcoin ETF, marking major milestone for cryptocurrency regulation. Bitcoin price surges 15% on news.',
    tags: ['Bitcoin', 'Regulation', 'ETF'],
    quality: 'good',
  },
  
  // Duplicate entries - should be merged
  {
    date: '2024-02-01',
    summary: 'Bitcoin price hits $55,000 as demand from institutional investors grows. MicroStrategy adds more Bitcoin to treasury.',
    tags: ['Bitcoin', 'Price', 'Institutional Adoption'],
    quality: 'good',
  },
  {
    date: '2024-02-01', // DUPLICATE DATE - should be merged
    summary: 'BTC reaches $55k milestone driven by corporate buying. Several companies announce Bitcoin holdings.',
    tags: ['Bitcoin', 'Price'],
    isDuplicate: true,
    quality: 'good',
  },
  
  // Entries with invalid tags - should be removed
  {
    date: '2024-02-10',
    summary: 'Bitcoin network processes record number of transactions. Mining difficulty increases.',
    tags: ['Bitcoin', 'Technology', 'Cooking Recipes', 'Weather'], // Invalid tags
    quality: 'good',
  },
  {
    date: '2024-02-15',
    summary: 'Major exchange lists new altcoins. Trading volume increases significantly.',
    tags: ['Exchange', 'Altcoins', 'Sports News', 'Movie Reviews'], // Invalid tags
    quality: 'good',
  },
  
  // Low quality summaries - should be improved
  {
    date: '2024-02-20',
    summary: 'Bitcoin went up. People are happy.',
    tags: ['Bitcoin', 'Price'],
    quality: 'poor',
  },
  {
    date: '2024-02-25',
    summary: 'Crypto stuff happened. It was important.',
    tags: ['Cryptocurrency'],
    quality: 'poor',
  },
  
  // Mis-categorized tags - should be fixed
  {
    date: '2024-03-01',
    summary: 'Ethereum smart contract platform sees increased developer activity. New DeFi protocols launch.',
    tags: ['Ethereum', 'DeFi', 'Bitcoin'], // Bitcoin tag is wrong category
    quality: 'good',
  },
  
  // Timeline gap - should be filled
  // Missing: 2024-03-05, 2024-03-10, 2024-03-15
  
  {
    date: '2024-03-20',
    summary: 'Bitcoin halving event approaches. Miners prepare for reduced block rewards.',
    tags: ['Bitcoin', 'Mining', 'Halving'],
    quality: 'good',
  },
];

async function populateTestData() {
  console.log('🧪 Populating test data...\n');

  try {
    // Clear existing test data
    await db.execute(sql`TRUNCATE TABLE test_pages_and_tags CASCADE`);
    await db.execute(sql`TRUNCATE TABLE test_historical_news_analyses CASCADE`);
    await db.execute(sql`TRUNCATE TABLE test_tags CASCADE`);
    console.log('✅ Cleared existing test data\n');

    // Create tags first
    const tagMap = new Map<string, string>(); // name -> id
    
    // Collect all unique tags
    const allTags = new Set<string>();
    testNewsEntries.forEach(entry => {
      entry.tags.forEach(tag => allTags.add(tag));
    });

    // Insert tags
    for (const tagName of allTags) {
      // Determine category (simplified logic for testing)
      let category = 'misc';
      if (['Bitcoin', 'Ethereum', 'Cryptocurrency', 'Altcoins'].includes(tagName)) {
        category = 'crypto';
      } else if (['Price', 'Mining', 'Halving'].includes(tagName)) {
        category = 'market';
      } else if (['Regulation', 'ETF'].includes(tagName)) {
        category = 'regulation';
      } else if (['Technology', 'DeFi', 'Smart Contract'].includes(tagName)) {
        category = 'technology';
      } else if (['Institutional Adoption', 'Exchange'].includes(tagName)) {
        category = 'adoption';
      } else {
        category = 'misc'; // Invalid tags will be in misc
      }

      const result = await db.execute(sql`
        INSERT INTO test_tags (name, category, normalized_name, usage_count)
        VALUES (${tagName}, ${category}, LOWER(TRIM(${tagName})), 0)
        ON CONFLICT (name, category) DO UPDATE SET name = EXCLUDED.name
        RETURNING id
      `);
      
      const tagId = result.rows[0].id;
      tagMap.set(tagName, tagId);
    }
    console.log(`✅ Created ${tagMap.size} tags`);

    // Insert news entries
    const newsEntryIds: string[] = [];
    
    for (const entry of testNewsEntries) {
      // Handle duplicate dates - second entry should have slightly different date for testing
      let insertDate = entry.date;
      if (entry.isDuplicate) {
        // Keep same date to test duplicate detection
        insertDate = entry.date;
      }

      const result = await db.execute(sql`
        INSERT INTO test_historical_news_analyses (
          date, summary, confidence_score, sentiment_score, 
          verification_status, agent_created, is_flagged
        )
        VALUES (
          ${insertDate}::DATE,
          ${entry.summary},
          ${entry.quality === 'poor' ? 60 : 85},
          ${entry.quality === 'poor' ? 0.3 : 0.7},
          'pending',
          FALSE,
          FALSE
        )
        ON CONFLICT (date) DO UPDATE SET summary = EXCLUDED.summary
        RETURNING id
      `);

      const newsId = result.rows[0].id;
      newsEntryIds.push(newsId);

      // Link tags
      for (const tagName of entry.tags) {
        const tagId = tagMap.get(tagName);
        if (tagId) {
          await db.execute(sql`
            INSERT INTO test_pages_and_tags (analysis_id, tag_id)
            VALUES (${newsId}::UUID, ${tagId}::UUID)
            ON CONFLICT (analysis_id, tag_id) DO NOTHING
          `);

          // Update tag usage count
          await db.execute(sql`
            UPDATE test_tags
            SET usage_count = usage_count + 1
            WHERE id = ${tagId}::UUID
          `);
        }
      }
    }

    console.log(`✅ Created ${newsEntryIds.length} news entries`);
    console.log(`✅ Linked tags to news entries\n`);

    // Print summary
    const stats = await db.execute(sql`
      SELECT 
        (SELECT COUNT(*) FROM test_historical_news_analyses) as news_count,
        (SELECT COUNT(*) FROM test_tags) as tag_count,
        (SELECT COUNT(*) FROM test_pages_and_tags) as link_count
    `);

    const statsRow = stats.rows[0];
    console.log('📊 Test Data Summary:');
    console.log(`   News Entries: ${statsRow.news_count}`);
    console.log(`   Tags: ${statsRow.tag_count}`);
    console.log(`   Tag Links: ${statsRow.link_count}`);
    console.log('\n📋 Test Scenarios Included:');
    console.log('   ✅ Duplicate news entries (same date)');
    console.log('   ✅ Invalid/irrelevant tags (non-Bitcoin/Web3)');
    console.log('   ✅ Low quality summaries');
    console.log('   ✅ Mis-categorized tags');
    console.log('   ✅ Timeline gaps (missing dates)');
    console.log('\n💡 Next step: Run test-agent.ts to test the agent');

  } catch (error) {
    console.error('❌ Error populating test data:', error);
    throw error;
  }
}

// Run if called directly
if (process.argv[1]?.endsWith('populate-test-data.ts')) {
  populateTestData()
    .then(() => {
      console.log('\n✅ Test data population complete!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Failed to populate test data:', error);
      process.exit(1);
    });
}

export { populateTestData };

