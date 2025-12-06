import 'dotenv/config';
import { storage } from '../storage';
import { qualityChecker } from '../services/quality-checker';
import { aiService } from '../services/ai';
import { type TieredArticles } from '@shared/schema';

async function testBulkRegenerate() {
  console.log('🧪 Testing Bulk Regenerate Summaries Feature\n');
  
  try {
    // Step 1: Find violations with length issues
    console.log('📊 Step 1: Finding summaries with length issues...');
    const allAnalyses = await storage.getAllAnalyses();
    console.log(`   Total analyses: ${allAnalyses.length}`);
    
    const violations: Array<{
      date: string;
      summary: string;
      violations: string[];
      length: number;
    }> = [];
    
    for (const analysis of allAnalyses) {
      if (!analysis.summary) continue;
      
      const issues = qualityChecker.checkSummaryQuality(analysis.summary);
      const hasLengthIssue = issues.some(issue => 
        issue.message.includes('too short') || issue.message.includes('too long')
      );
      
      if (hasLengthIssue) {
        violations.push({
          date: analysis.date,
          summary: analysis.summary,
          violations: issues.map(issue => issue.message),
          length: analysis.summary.length
        });
      }
    }
    
    console.log(`   Found ${violations.length} summaries with length issues\n`);
    
    if (violations.length === 0) {
      console.log('✅ No violations found. Test complete.');
      return;
    }
    
    // Step 2: Test with first 3 dates
    const testDates = violations.slice(0, 3).map(v => v.date);
    console.log(`🧪 Step 2: Testing with ${testDates.length} dates: ${testDates.join(', ')}\n`);
    
    const testViolations = violations.filter(v => testDates.includes(v.date));
    let updated = 0;
    const errors: string[] = [];
    const skipped: string[] = [];
    
    const openaiProvider = aiService.getProvider('openai');
    
    for (const violation of testViolations) {
      try {
        console.log(`\n📅 Processing ${violation.date}...`);
        console.log(`   Current summary (${violation.length} chars): "${violation.summary.substring(0, 80)}..."`);
        
        const analysis = await storage.getAnalysisByDate(violation.date);
        if (!analysis) {
          console.warn(`   ⚠️ Analysis not found, skipping`);
          skipped.push(violation.date);
          continue;
        }
        
        // Find the article using topArticleId
        let selectedArticle: any = null;
        const tieredArticles = analysis.tieredArticles as any;
        
        if (tieredArticles && typeof tieredArticles === 'object' && analysis.topArticleId) {
          const tiers = ['bitcoin', 'crypto', 'macro'] as const;
          for (const tier of tiers) {
            const tierArticles = tieredArticles[tier] || [];
            const article = tierArticles.find((a: any) => a.id === analysis.topArticleId);
            if (article) {
              selectedArticle = article;
              console.log(`   ✅ Found article in ${tier} tier: "${article.title.substring(0, 60)}..."`);
              break;
            }
          }
        }
        
        // Fallback to analyzedArticles
        if (!selectedArticle && analysis.analyzedArticles) {
          const analyzedArticles = Array.isArray(analysis.analyzedArticles) 
            ? analysis.analyzedArticles 
            : [];
          selectedArticle = analyzedArticles.find((a: any) => a.id === analysis.topArticleId) || analyzedArticles[0];
          if (selectedArticle) {
            console.log(`   ✅ Found article in analyzedArticles: "${selectedArticle.title.substring(0, 60)}..."`);
          }
        }
        
        if (!selectedArticle) {
          console.warn(`   ⚠️ Article not found (topArticleId: ${analysis.topArticleId}), skipping`);
          skipped.push(violation.date);
          continue;
        }
        
        // Generate new summary
        const articleText = (selectedArticle.text || selectedArticle.summary || '').substring(0, 2000);
        console.log(`   🤖 Calling OpenAI to regenerate summary...`);
        
        const newSummary = await openaiProvider.generateCompletion({
          context: 'summary-regeneration',
          purpose: 'Regenerate 100-110 character summary for quality check',
          prompt: `Create a summary for a historical timeline entry from this article.

Title: "${selectedArticle.title}"
Text: "${articleText}"

CRITICAL REQUIREMENTS:
1. ⚠️ CHARACTER COUNT IS MANDATORY: Summary MUST be EXACTLY 100-110 characters. Count every character including spaces. Verify the character count before responding. This is a strict requirement that cannot be violated.
2. NO DATES anywhere in summary (no years, months, days, "On [date]", "In [year]")
3. Use active voice and present tense: "Bitcoin reaches $1000" not "Bitcoin reached $1000"
4. Focus on what actually HAPPENED, not what articles discussed
5. NO ending punctuation (no periods/full stops, colons, semicolons, dashes). We are NOT interested in full stops at the end - do not include them.
6. Be conversational yet professional
7. Emphasize the actual event/outcome over the reporting

IMPORTANT: After writing your summary, count the characters. If it's not between 100-110 characters, rewrite it until it is. Return ONLY the summary text, nothing else.`,
          model: 'gpt-4o-mini',
          maxTokens: 150,
          temperature: 0.2
        });
        
        // Validate and adjust length if needed
        let finalSummary = newSummary.text.trim();
        let length = finalSummary.length;
        let adjustmentRound = 0;
        const maxAdjustmentRounds = 3;
        
        while ((length < 100 || length > 110) && adjustmentRound < maxAdjustmentRounds) {
          adjustmentRound++;
          console.log(`   ⚠️ Summary length ${length} chars (round ${adjustmentRound}/${maxAdjustmentRounds}), adjusting...`);
          
          if (length < 100) {
            const adjustPrompt = `⚠️ CRITICAL: The following summary is too short (${length} chars). You MUST expand it to exactly 100-110 characters. Count every character including spaces. Verify the character count before responding.

Current: "${finalSummary}"

Return ONLY the expanded summary (100-110 chars), nothing else.`;
            const adjusted = await openaiProvider.generateCompletion({
              prompt: adjustPrompt,
              model: 'gpt-5-mini',
              maxTokens: 150,
              temperature: 0.2,
              context: 'summary-adjustment',
              purpose: `Adjust summary length (round ${adjustmentRound})`
            });
            finalSummary = adjusted.text.trim();
            length = finalSummary.length;
          } else if (length > 110) {
            const adjustPrompt = `⚠️ CRITICAL: The following summary is too long (${length} chars). You MUST shorten it to exactly 100-110 characters. Count every character including spaces. Verify the character count before responding.

Current: "${finalSummary}"

Return ONLY the shortened summary (100-110 chars), nothing else.`;
            const adjusted = await openaiProvider.generateCompletion({
              prompt: adjustPrompt,
              model: 'gpt-5-mini',
              maxTokens: 150,
              temperature: 0.2,
              context: 'summary-adjustment',
              purpose: `Adjust summary length (round ${adjustmentRound})`
            });
            finalSummary = adjusted.text.trim();
            length = finalSummary.length;
          }
        }
        
        // Final validation
        if (length < 100 || length > 110) {
          console.warn(`   ⚠️ Final summary still ${length} chars after ${adjustmentRound} adjustment rounds`);
          console.warn(`   Summary: "${finalSummary}"`);
        } else {
          console.log(`   ✅ Summary regenerated: ${length} chars`);
          console.log(`   New summary: "${finalSummary}"`);
        }
        
        // Update the database (commented out for testing - uncomment to actually update)
        // await storage.updateAnalysis(violation.date, {
        //   summary: finalSummary
        // });
        console.log(`   📝 [DRY RUN] Would update database with new summary`);
        
        updated++;
        
      } catch (error) {
        console.error(`   ❌ Error processing ${violation.date}:`, error);
        errors.push(violation.date);
      }
    }
    
    console.log(`\n✅ Test completed:`);
    console.log(`   Updated: ${updated}`);
    console.log(`   Skipped: ${skipped.length}${skipped.length > 0 ? ` (${skipped.join(', ')})` : ''}`);
    console.log(`   Errors: ${errors.length}${errors.length > 0 ? ` (${errors.join(', ')})` : ''}`);
    console.log(`\n📊 Summary:`);
    console.log(`   - Found ${violations.length} total violations with length issues`);
    console.log(`   - Tested ${testViolations.length} dates`);
    console.log(`   - Successfully processed ${updated} summaries`);
    
  } catch (error) {
    console.error('💥 Test failed:', error);
    if (error instanceof Error) {
      console.error('Error message:', error.message);
      console.error('Error stack:', error.stack);
    }
    process.exit(1);
  }
}

testBulkRegenerate().then(() => {
  console.log('\n✅ Test script completed');
  process.exit(0);
}).catch((error) => {
  console.error('💥 Unhandled error:', error);
  process.exit(1);
});

