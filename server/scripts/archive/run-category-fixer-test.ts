import 'dotenv/config';
import { CategoryFixer } from '../services/curator-agent/modules/category-fixer';
import { setUseTestTables } from '../services/curator-agent/utils/table-helper';
import { db } from '../db';
import { sql } from 'drizzle-orm';

async function testCategoryFixer() {
  console.log('🧪 Testing Category Fixer...');
  
  // Use test tables
  setUseTestTables(true);
  
  const fixer = new CategoryFixer();
  
  // Run the fixer
  const result = await fixer.fixAllCategories('test-session');
  
  console.log('\n📊 Fixer Result:', result);
  
  // Verify the specific mismatch was fixed
  const check = await db.execute(sql`
    SELECT COUNT(*) as count
    FROM test_pages_and_tags pt
    JOIN test_historical_news_analyses hna ON pt.analysis_id = hna.id
    JOIN test_tags t ON pt.tag_id = t.id
    WHERE hna.date = '2024-03-01'::DATE
    AND t.name = 'Bitcoin'
    AND hna.summary ILIKE '%Ethereum%'
    AND hna.summary NOT ILIKE '%Bitcoin%'
  `);
  
  const remaining = parseInt(check.rows[0].count);
  if (remaining === 0) {
    console.log('\n✅ SUCCESS: Mismatch fixed!');
  } else {
    console.log(`\n❌ FAILURE: ${remaining} mismatches remaining.`);
  }
  
  process.exit(0);
}

testCategoryFixer();

