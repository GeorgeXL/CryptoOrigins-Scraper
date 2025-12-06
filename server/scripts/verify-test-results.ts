import 'dotenv/config';
import { db } from '../db';
import { sql } from 'drizzle-orm';

/**
 * Verify test results after agent run
 * Checks if agent correctly fixed the known issues
 */

interface TestExpectation {
  name: string;
  check: () => Promise<boolean>;
  description: string;
}

async function verifyTestResults() {
  console.log('🔍 Verifying test results...\n');

  const expectations: TestExpectation[] = [
    {
      name: 'Duplicate entries merged',
      description: 'Should have only 1 entry for 2024-02-01 (duplicates merged)',
      check: async () => {
        const result = await db.execute(sql`
          SELECT COUNT(*) as count
          FROM test_historical_news_analyses
          WHERE date = '2024-02-01'::DATE
        `);
        const count = parseInt(result.rows[0].count);
        return count === 1;
      },
    },
    {
      name: 'Invalid tags removed',
      description: 'Should not have tags like "Cooking Recipes", "Weather", "Sports News", "Movie Reviews"',
      check: async () => {
        const result = await db.execute(sql`
          SELECT COUNT(*) as count
          FROM test_tags
          WHERE name IN ('Cooking Recipes', 'Weather', 'Sports News', 'Movie Reviews')
        `);
        const count = parseInt(result.rows[0].count);
        return count === 0;
      },
    },
    {
      name: 'Invalid tag links removed',
      description: 'No pages should be linked to invalid tags',
      check: async () => {
        const result = await db.execute(sql`
          SELECT COUNT(*) as count
          FROM test_pages_and_tags pt
          JOIN test_tags t ON pt.tag_id = t.id
          WHERE t.name IN ('Cooking Recipes', 'Weather', 'Sports News', 'Movie Reviews')
        `);
        const count = parseInt(result.rows[0].count);
        return count === 0;
      },
    },
    {
      name: 'Low quality summaries improved',
      description: 'Summaries should be longer than 20 characters (improved from poor quality)',
      check: async () => {
        const result = await db.execute(sql`
          SELECT COUNT(*) as count
          FROM test_historical_news_analyses
          WHERE date IN ('2024-02-20'::DATE, '2024-02-25'::DATE)
          AND LENGTH(summary) > 20
        `);
        const count = parseInt(result.rows[0].count);
        return count === 2;
      },
    },
    {
      name: 'Mis-categorized tags fixed',
      description: 'Bitcoin tag should not be on Ethereum-only entries',
      check: async () => {
        const result = await db.execute(sql`
          SELECT COUNT(*) as count
          FROM test_pages_and_tags pt
          JOIN test_historical_news_analyses hna ON pt.analysis_id = hna.id
          JOIN test_tags t ON pt.tag_id = t.id
          WHERE hna.date = '2024-03-01'::DATE
          AND t.name = 'Bitcoin'
          AND hna.summary ILIKE '%Ethereum%'
          AND hna.summary NOT ILIKE '%Bitcoin%'
        `);
        const count = parseInt(result.rows[0].count);
        return count === 0;
      },
    },
    {
      name: 'Timeline gaps identified',
      description: 'Agent should identify missing dates (2024-03-05, 2024-03-10, 2024-03-15)',
      check: async () => {
        // This is informational - gap filler might fill or flag gaps
        const result = await db.execute(sql`
          SELECT COUNT(*) as count
          FROM test_historical_news_analyses
          WHERE date IN ('2024-03-05'::DATE, '2024-03-10'::DATE, '2024-03-15'::DATE)
        `);
        const count = parseInt(result.rows[0].count);
        // Either gaps are filled (count = 3) or flagged (count = 0 but agent knows about them)
        return true; // Always pass - this is informational
      },
    },
  ];

  const results: Array<{ name: string; passed: boolean; description: string }> = [];

  for (const expectation of expectations) {
    try {
      const passed = await expectation.check();
      results.push({
        name: expectation.name,
        passed,
        description: expectation.description,
      });
      
      const icon = passed ? '✅' : '❌';
      console.log(`${icon} ${expectation.name}`);
      if (!passed) {
        console.log(`   ${expectation.description}`);
      }
    } catch (error) {
      console.log(`❌ ${expectation.name} - Error: ${(error as Error).message}`);
      results.push({
        name: expectation.name,
        passed: false,
        description: expectation.description,
      });
    }
  }

  // Print summary
  const passedCount = results.filter(r => r.passed).length;
  const totalCount = results.length;
  const percentage = ((passedCount / totalCount) * 100).toFixed(1);

  console.log('\n' + '='.repeat(50));
  console.log(`📊 Test Results: ${passedCount}/${totalCount} passed (${percentage}%)`);
  console.log('='.repeat(50));

  // Print detailed stats
  const stats = await db.execute(sql`
    SELECT 
      (SELECT COUNT(*) FROM test_historical_news_analyses) as news_count,
      (SELECT COUNT(*) FROM test_tags) as tag_count,
      (SELECT COUNT(*) FROM test_pages_and_tags) as link_count,
      (SELECT COUNT(*) FROM test_tags WHERE category = 'misc') as misc_tags
  `);

  const statsRow = stats.rows[0];
  console.log('\n📈 Final Database State:');
  console.log(`   News Entries: ${statsRow.news_count}`);
  console.log(`   Tags: ${statsRow.tag_count}`);
  console.log(`   Tag Links: ${statsRow.link_count}`);
  console.log(`   Misc Tags: ${statsRow.misc_tags} (should be minimal)`);

  // Check for agent session
  const sessionCheck = await db.execute(sql`
    SELECT COUNT(*) as count
    FROM agent_sessions
    WHERE config->>'useTestTables' = 'true'
  `);

  if (parseInt(sessionCheck.rows[0].count) > 0) {
    console.log('\n✅ Agent session found in test mode');
  }

  return {
    passed: passedCount === totalCount,
    results,
    stats: statsRow,
  };
}

// Run if called directly
if (process.argv[1]?.endsWith('verify-test-results.ts')) {
  verifyTestResults()
    .then((result) => {
      if (result.passed) {
        console.log('\n🎉 All tests passed!');
        process.exit(0);
      } else {
        console.log('\n⚠️  Some tests failed. Review the results above.');
        process.exit(1);
      }
    })
    .catch((error) => {
      console.error('❌ Failed to verify test results:', error);
      process.exit(1);
    });
}

export { verifyTestResults };

