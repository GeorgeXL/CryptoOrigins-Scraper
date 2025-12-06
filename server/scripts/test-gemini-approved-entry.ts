import 'dotenv/config';
import { storage } from '../storage';
import { aiService } from '../services/ai';

// Test with an entry that was previously approved by Gemini
const testDate = '2024-12-23'; // MicroStrategy joins Nasdaq-100 - was approved

async function testGeminiApprovedEntry() {
  console.log(`🧪 Testing Gemini verification on previously approved entry...\n`);
  console.log(`📅 Test date: ${testDate}\n`);

  try {
    // Get the analysis
    const analysis = await storage.getAnalysisByDate(testDate);
    if (!analysis) {
      console.log('❌ Entry not found');
      return;
    }

    console.log('📋 Entry details:');
    console.log(`   Date: ${analysis.date}`);
    console.log(`   Summary: ${analysis.summary}`);
    console.log(`   Previous Gemini Approved: ${analysis.geminiApproved}`);
    console.log(`   Previous Gemini Confidence: ${analysis.geminiConfidence}\n`);

    // Test Gemini verification
    console.log('🔵 Testing Gemini verification...\n');
    const geminiProvider = aiService.getProvider('gemini');
    
    if (!geminiProvider || !('verifyEventDate' in geminiProvider)) {
      console.log('❌ Gemini provider not available');
      return;
    }

    const startTime = Date.now();
    const result = await (geminiProvider as any).verifyEventDate(analysis.summary, analysis.date);
    const duration = Date.now() - startTime;

    console.log('✅ Gemini verification result:');
    console.log(`   Approved: ${result.approved}`);
    console.log(`   Reasoning: ${result.reasoning}`);
    console.log(`   Duration: ${duration}ms\n`);

    // Compare with previous result
    if (analysis.geminiApproved === true && result.approved === false) {
      console.log('⚠️  WARNING: Entry was previously approved but is now rejected!');
      console.log(`   Previous: Approved (confidence: ${analysis.geminiConfidence})`);
      console.log(`   Current: Rejected`);
      console.log(`   Reasoning: ${result.reasoning}\n`);
    } else if (analysis.geminiApproved === true && result.approved === true) {
      console.log('✅ Consistent: Entry is still approved');
    } else if (analysis.geminiApproved === false && result.approved === true) {
      console.log('🔄 Changed: Entry was rejected but is now approved');
    } else {
      console.log('✅ Consistent: Entry is still rejected');
    }

  } catch (error) {
    console.error('❌ Error:', (error as Error).message);
  }
}

testGeminiApprovedEntry().catch(console.error);





