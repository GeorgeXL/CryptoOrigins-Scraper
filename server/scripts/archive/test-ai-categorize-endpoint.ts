/**
 * Test script to directly test the AI categorization endpoint
 * This will help debug why tags aren't being processed
 */

import { db } from '../db';
import { sql } from 'drizzle-orm';

async function testEndpoint() {
  console.log('🧪 Testing AI Categorization Endpoint\n');
  
  try {
    // Step 1: Check how many tags without subcategory_path exist
    console.log('Step 1: Checking tags without subcategory_path...');
    const uncategorized = await db.execute(sql`
      SELECT id, name, category
      FROM tags
      WHERE subcategory_path IS NULL OR array_length(subcategory_path, 1) IS NULL
      ORDER BY name
      LIMIT 10;
    `);
    
    console.log(`   Found ${uncategorized.rows.length} tags (showing first 10):`);
    (uncategorized.rows as any[]).forEach((row, idx) => {
      console.log(`   ${idx + 1}. ${row.name} (category: ${row.category || 'null'})`);
    });
    
    if (uncategorized.rows.length === 0) {
      console.log('\n❌ No tags found without subcategory_path. Cannot test.');
      return;
    }
    
    // Step 2: Test the endpoint
    console.log('\nStep 2: Calling POST /api/tags/ai-categorize/start...');
    
    const response = await fetch('http://localhost:5000/api/tags/ai-categorize/start', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.log(`   ❌ Error: ${response.status} ${response.statusText}`);
      console.log(`   Response: ${errorText}`);
      return;
    }
    
    const data = await response.json();
    console.log(`   ✅ Response:`, data);
    
    // Step 3: Poll status
    console.log('\nStep 3: Polling status...');
    let attempts = 0;
    const maxAttempts = 30; // 30 attempts = 60 seconds
    
    while (attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds
      
      const statusResponse = await fetch('http://localhost:5000/api/tags/ai-categorize/status');
      if (!statusResponse.ok) {
        console.log(`   ❌ Status check failed: ${statusResponse.status}`);
        break;
      }
      
      const status = await statusResponse.json();
      console.log(`   [${attempts + 1}/${maxAttempts}] Status:`, {
        isRunning: status.isRunning,
        processed: status.processed,
        total: status.total,
        currentTag: status.currentTag,
        progress: status.progress
      });
      
      if (!status.isRunning) {
        console.log(`\n   ✅ Process completed!`);
        console.log(`   Processed: ${status.processed}/${status.total}`);
        break;
      }
      
      attempts++;
    }
    
    if (attempts >= maxAttempts) {
      console.log('\n   ⚠️ Timeout waiting for completion');
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    await db.$client.end();
    process.exit(0);
  }
}

testEndpoint();

