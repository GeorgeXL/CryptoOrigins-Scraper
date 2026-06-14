import 'dotenv/config';
import { storage } from '../storage';
import { aiService } from '../services/ai';
import { db } from '../db';
import { historicalNewsAnalyses } from '@shared/schema';
import { eq } from 'drizzle-orm';

// Process entries that need Gemini verification
async function manualGeminiVerify() {
  console.log('🔵 Starting manual Gemini verification...\n');

  try {
    // Get all analyses
    const allAnalyses = await storage.getAllAnalyses();
    console.log(`📊 Total analyses: ${allAnalyses.length}\n`);

    // Filter to entries verified by ONE service only (not both) and no Gemini response
    let verifiedAnalyses = allAnalyses.filter(analysis => {
      const isPerplexityVerified = analysis.perplexityVerdict === 'verified';
      const isOpenAIVerified = analysis.factCheckVerdict === 'verified';
      // Only include entries verified by one service (not both)
      const isOneServiceVerified = (isPerplexityVerified && !isOpenAIVerified) || (!isPerplexityVerified && isOpenAIVerified);
      // Exclude entries that already have a Gemini response
      const hasGeminiResponse = analysis.geminiApproved !== null && analysis.geminiApproved !== undefined;
      return isOneServiceVerified && !hasGeminiResponse;
    });

    console.log(`📊 Found ${verifiedAnalyses.length} entries that need Gemini verification\n`);

    if (verifiedAnalyses.length === 0) {
      console.log('✅ No entries to process');
      return;
    }

    // Process entries in batches (20 at a time)
    const batchSize = 20;
    const entriesToProcess = verifiedAnalyses.slice(0, batchSize);
    console.log(`🧪 Processing ${entriesToProcess.length} entries (batch 1 of ${Math.ceil(verifiedAnalyses.length / batchSize)}):\n`);

    const geminiProvider = aiService.getProvider('gemini');
    if (!geminiProvider || !('verifyEventDate' in geminiProvider)) {
      console.log('❌ Gemini provider not available');
      return;
    }

    let processed = 0;
    let approved = 0;
    let rejected = 0;

    for (const analysis of entriesToProcess) {
      try {
        console.log(`\n📅 Processing: ${analysis.date}`);
        console.log(`   Summary: ${analysis.summary.substring(0, 80)}...`);
        console.log(`   Perplexity: ${analysis.perplexityVerdict || 'null'}`);
        console.log(`   OpenAI: ${analysis.factCheckVerdict || 'null'}`);
        console.log(`   Current Gemini: ${analysis.geminiApproved || 'null'}`);

        // Verify with Gemini
        const geminiResult = await (geminiProvider as any).verifyEventDate(analysis.summary, analysis.date);
        
        console.log(`   ✅ Gemini result: ${geminiResult.approved ? 'APPROVED' : 'REJECTED'}`);
        console.log(`   Reasoning: ${geminiResult.reasoning.substring(0, 100)}...`);

        // Convert approved boolean to confidence score
        const confidence = geminiResult.approved ? 80 : 20;

        // Update database
        await db.update(historicalNewsAnalyses)
          .set({
            geminiApproved: geminiResult.approved,
            geminiConfidence: confidence.toString(),
          })
          .where(eq(historicalNewsAnalyses.date, analysis.date));

        processed++;
        if (geminiResult.approved) {
          approved++;
        } else {
          rejected++;
        }

        console.log(`   ✅ Updated database`);

        // Small delay to avoid rate limits
        await new Promise(resolve => setTimeout(resolve, 1000));

      } catch (error) {
        console.error(`   ❌ Error processing ${analysis.date}:`, (error as Error).message);
      }
    }

    console.log(`\n\n📊 Summary:`);
    console.log(`   Processed: ${processed}`);
    console.log(`   Approved: ${approved}`);
    console.log(`   Rejected: ${rejected}`);
    console.log(`   Remaining: ${verifiedAnalyses.length - processed}`);

  } catch (error) {
    console.error('❌ Error:', (error as Error).message);
    console.error((error as Error).stack);
  }
}

manualGeminiVerify().catch(console.error);

