import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { config } from 'dotenv';

// Get __dirname equivalent for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables FIRST, before importing anything that uses them
config({ path: join(__dirname, '../../.env') });

// Now import after env is loaded
const { aiService } = await import('../services/ai/index.js');

async function testProviders() {
  console.log('🧪 Testing AI Providers...\n');

  // Test Gemini
  console.log('1️⃣ Testing Gemini...');
  try {
    const geminiProvider = aiService.getProvider('gemini');
    console.log('   ✅ Gemini provider initialized');
    
    // Test with a simple verification
    const testSummary = "Bitcoin reached $100,000 on December 1, 2024";
    const testDate = "2024-12-01";
    
    console.log(`   📝 Testing verification with:`);
    console.log(`      Date: ${testDate}`);
    console.log(`      Summary: "${testSummary}"`);
    
    const geminiResult = await (geminiProvider as any).verifyEventDate(testSummary, testDate);
    console.log('   ✅ Gemini API call successful!');
    console.log(`   📊 Result:`, geminiResult);
  } catch (error) {
    console.error('   ❌ Gemini test failed:', (error as Error).message);
  }

  console.log('\n');

  // Test Perplexity
  console.log('2️⃣ Testing Perplexity...');
  try {
    const perplexityProvider = aiService.getProvider('perplexity');
    console.log('   ✅ Perplexity provider initialized');
    
    // Test with a simple verification
    const testSummary = "Bitcoin reached $100,000 on December 1, 2024";
    const testDate = "2024-12-01";
    
    console.log(`   📝 Testing verification with:`);
    console.log(`      Date: ${testDate}`);
    console.log(`      Summary: "${testSummary}"`);
    
    const perplexityResult = await (perplexityProvider as any).verifyEventDate(testSummary, testDate);
    console.log('   ✅ Perplexity API call successful!');
    console.log(`   📊 Result:`, perplexityResult);
  } catch (error) {
    console.error('   ❌ Perplexity test failed:', (error as Error).message);
  }

  console.log('\n✅ Testing complete!');
}

testProviders().catch(console.error);

