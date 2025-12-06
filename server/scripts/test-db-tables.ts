#!/usr/bin/env tsx
import 'dotenv/config';
import { db } from '../db';

async function checkTables() {
  try {
    console.log('🔍 Checking for agent tables...\n');
    
    const result = await db.execute(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name LIKE 'agent%' 
      ORDER BY table_name
    `);
    
    if (result.rows.length === 0) {
      console.log('❌ No agent tables found!');
      console.log('\n📝 You need to apply the migration:');
      console.log('   File: supabase/migrations/20251129000000_create_agent_tables.sql');
      process.exit(1);
    }
    
    console.log(`✅ Agent tables found: ${result.rows.length}`);
    result.rows.forEach((row: any) => {
      console.log(`   - ${row.table_name}`);
    });
    
    console.log('\n✅ Database migration is applied!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error checking tables:', error);
    process.exit(1);
  }
}

checkTables();

