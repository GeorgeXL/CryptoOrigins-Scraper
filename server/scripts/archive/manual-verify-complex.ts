import 'dotenv/config';
import { db } from '../db';
import { sql } from 'drizzle-orm';

async function verifyComplexTest() {
  console.log('🔍 Verifying Complex Test Results...');
  
  // 1. Validator
  const tags1 = await db.execute(sql`SELECT name FROM test_tags`);
  const tagNames = tags1.rows.map((r: any) => r.name);
  const validatorPassed = !tagNames.includes('Cooking') && !tagNames.includes('Gardening') && tagNames.includes('Bitcoin');
  console.log(`Scenario 1 (Validator): ${validatorPassed ? '✅ PASSED' : '❌ FAILED'}`);
  if (!validatorPassed) console.log('  Tags present:', tagNames);

  // 2. Deduper
  const deduperRes = await db.execute(sql`SELECT count(*) as count FROM test_historical_news_analyses WHERE date = '2024-01-02'`);
  const deduperPassed = parseInt(deduperRes.rows[0].count) === 1;
  console.log(`Scenario 2 (Deduper): ${deduperPassed ? '✅ PASSED' : '❌ FAILED'}`);
  if (!deduperPassed) console.log('  Count:', deduperRes.rows[0].count);

  // 3. Category Fixer
  const catFixerRes = await db.execute(sql`
    SELECT count(*) as count 
    FROM test_pages_and_tags pt
    JOIN test_historical_news_analyses hna ON pt.analysis_id = hna.id
    JOIN test_tags t ON pt.tag_id = t.id
    WHERE hna.date = '2024-01-03' AND t.name = 'Bitcoin'
  `);
  const catFixerPassed = parseInt(catFixerRes.rows[0].count) === 0;
  console.log(`Scenario 3 (Category Fixer): ${catFixerPassed ? '✅ PASSED' : '❌ FAILED'}`);
  if (!catFixerPassed) console.log('  Bitcoin tag still present on Ethereum entry');

  // 4. Quality Improver
  const qualityRes = await db.execute(sql`SELECT summary FROM test_historical_news_analyses WHERE date = '2024-01-04'`);
  const summary = qualityRes.rows[0]?.summary;
  const qualityPassed = summary && summary.length > 50 && summary !== 'Price went up.';
  console.log(`Scenario 4 (Quality Improver): ${qualityPassed ? '✅ PASSED' : '❌ FAILED'}`);
  if (!qualityPassed) console.log('  Summary:', summary);

  // 5. Gap Filler
  const gapRes = await db.execute(sql`SELECT summary FROM test_historical_news_analyses WHERE date = '2009-01-03'`);
  const gapPassed = gapRes.rows.length > 0 && gapRes.rows[0].summary.includes('Genesis');
  console.log(`Scenario 5 (Gap Filler): ${gapPassed ? '✅ PASSED' : '❌ FAILED'}`);
  if (!gapPassed) console.log('  Entry found:', gapRes.rows.length > 0);

  process.exit(0);
}

verifyComplexTest();

