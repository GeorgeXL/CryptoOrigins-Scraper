import 'dotenv/config';
import { db } from '../db';
import { sql } from 'drizzle-orm';

/**
 * Create test tables for agent testing
 * These tables mirror the production tables but with _test suffix
 */

async function createTestTables() {
  console.log('🧪 Creating test tables...\n');

  try {
    // 1. Create test_historical_news_analyses table
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS test_historical_news_analyses (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        date DATE NOT NULL UNIQUE,
        summary TEXT NOT NULL,
        top_article_id TEXT,
        last_analyzed TIMESTAMP DEFAULT NOW(),
        is_manual_override BOOLEAN DEFAULT FALSE,
        ai_provider TEXT DEFAULT 'openai',
        reasoning TEXT,
        article_tags JSONB,
        confidence_score NUMERIC(5, 2),
        sentiment_score NUMERIC(3, 2),
        sentiment_label TEXT,
        topic_categories JSONB,
        duplicate_article_ids JSONB,
        total_articles_fetched INTEGER DEFAULT 0,
        unique_articles_analyzed INTEGER DEFAULT 0,
        tier_used TEXT,
        winning_tier TEXT,
        tiered_articles JSONB,
        analyzed_articles JSONB,
        is_flagged BOOLEAN DEFAULT FALSE,
        flag_reason TEXT,
        flagged_at TIMESTAMP,
        fact_check_verdict TEXT,
        fact_check_confidence NUMERIC(5, 2),
        fact_check_reasoning TEXT,
        fact_checked_at TIMESTAMP,
        perplexity_verdict TEXT,
        perplexity_confidence NUMERIC(5, 2),
        perplexity_reasoning TEXT,
        perplexity_correct_date DATE,
        perplexity_correct_date_text TEXT,
        perplexity_citations JSONB,
        perplexity_checked_at TIMESTAMP,
        re_verified BOOLEAN DEFAULT FALSE,
        re_verified_at TIMESTAMP,
        re_verification_date TEXT,
        re_verification_summary TEXT,
        re_verification_tier TEXT,
        re_verification_articles JSONB,
        re_verification_reasoning TEXT,
        re_verification_status TEXT,
        re_verification_winner TEXT,
        tags JSONB,
        tag_names TEXT[],
        gemini_approved BOOLEAN,
        gemini_confidence NUMERIC(5, 2),
        gemini_sources JSONB,
        gemini_importance INTEGER,
        perplexity_approved BOOLEAN,
        perplexity_confidence_score NUMERIC(5, 2),
        perplexity_sources JSONB,
        perplexity_importance INTEGER,
        agreement_score NUMERIC(5, 2),
        verification_status TEXT,
        verified_at TIMESTAMP,
        final_analysis_checked_at TIMESTAMP,
        agent_created BOOLEAN DEFAULT FALSE,
        agent_session TEXT
      );
    `);
    console.log('✅ Created test_historical_news_analyses');

    // Create indexes
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_test_historical_news_date ON test_historical_news_analyses(date);
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_test_historical_news_last_analyzed ON test_historical_news_analyses(last_analyzed);
    `);

    // 2. Create test_tags table
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS test_tags (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL,
        category TEXT NOT NULL,
        normalized_name TEXT,
        parent_tag_id UUID REFERENCES test_tags(id) ON DELETE SET NULL,
        subcategory_path TEXT[],
        usage_count INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(name, category)
      );
    `);
    console.log('✅ Created test_tags');

    // Create indexes for test_tags
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_test_tags_category ON test_tags(category);
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_test_tags_normalized_name ON test_tags(normalized_name);
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_test_tags_parent_tag ON test_tags(parent_tag_id);
    `);

    // 3. Create test_pages_and_tags join table
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS test_pages_and_tags (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        analysis_id UUID NOT NULL REFERENCES test_historical_news_analyses(id) ON DELETE CASCADE,
        tag_id UUID NOT NULL REFERENCES test_tags(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(analysis_id, tag_id)
      );
    `);
    console.log('✅ Created test_pages_and_tags');

    // Create indexes
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_test_pages_and_tags_analysis ON test_pages_and_tags(analysis_id);
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_test_pages_and_tags_tag ON test_pages_and_tags(tag_id);
    `);

    console.log('\n✅ All test tables created successfully!');
    console.log('\n📋 Test tables:');
    console.log('   - test_historical_news_analyses');
    console.log('   - test_tags');
    console.log('   - test_pages_and_tags');
    console.log('\n💡 Next step: Run populate-test-data.ts to add test data');

  } catch (error) {
    console.error('❌ Error creating test tables:', error);
    throw error;
  }
}

// Run if called directly
if (process.argv[1]?.endsWith('create-test-tables.ts')) {
  createTestTables()
    .then(() => {
      console.log('\n✅ Test tables setup complete!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Failed to create test tables:', error);
      process.exit(1);
    });
}

export { createTestTables };

