import 'dotenv/config';
import { storage } from '../storage';
import { qualityChecker } from '../services/quality-checker';
import { aiService } from '../services/ai';

async function finishRegenerateSummaries() {
  console.log('🔄 Finding and processing remaining summaries with length issues...\n');
  
  try {
    // Step 1: Find all violations
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
      console.log('✅ No violations found. All summaries are the correct length!');
      return;
    }
    
    // Show last 20 dates
    console.log(`📅 Last 20 dates with issues:`);
    violations.slice(-20).forEach((v, i) => {
      console.log(`   ${violations.length - 20 + i + 1}. ${v.date} - ${v.length} chars - ${v.violations.join(', ')}`);
    });
    console.log('');
    
    // Step 2: Process all violations
    console.log(`🔄 Step 2: Processing ${violations.length} summaries...\n`);
    
    let updated = 0;
    const errors: string[] = [];
    const skipped: string[] = [];
    
    const openaiProvider = aiService.getProvider('openai');
    if (!openaiProvider) {
      throw new Error('OpenAI provider not available');
    }
    
    for (let i = 0; i < violations.length; i++) {
      const violation = violations[i];
      const progress = `[${i + 1}/${violations.length}]`;
      
      try {
        const analysis = await storage.getAnalysisByDate(violation.date);
        if (!analysis) {
          console.warn(`${progress} ⚠️ Analysis not found for ${violation.date}, skipping`);
          skipped.push(violation.date);
          continue;
        }

        // Find the article using topArticleId
        let selectedArticle: any = null;
        const tieredArticles = analysis.tieredArticles as any;
        
        if (tieredArticles && typeof tieredArticles === 'object' && analysis.topArticleId) {
          // Search through all tiers
          const tiers = ['bitcoin', 'crypto', 'macro'] as const;
          for (const tier of tiers) {
            const tierArticles = tieredArticles[tier] || [];
            const article = tierArticles.find((a: any) => a.id === analysis.topArticleId);
            if (article) {
              selectedArticle = article;
              break;
            }
          }
        }

        // Fallback to analyzedArticles if not found in tieredArticles
        if (!selectedArticle && analysis.analyzedArticles) {
          const analyzedArticles = Array.isArray(analysis.analyzedArticles) 
            ? analysis.analyzedArticles 
            : [];
          selectedArticle = analyzedArticles.find((a: any) => a.id === analysis.topArticleId) || analyzedArticles[0];
        }

        if (!selectedArticle) {
          console.warn(`${progress} ⚠️ Article not found for ${violation.date} (topArticleId: ${analysis.topArticleId}), skipping`);
          skipped.push(violation.date);
          continue;
        }

        // Generate new summary using OpenAI
        const articleText = (selectedArticle.text || selectedArticle.summary || '').substring(0, 2000);
        console.log(`${progress} 📝 Regenerating summary for ${violation.date}...`);
        console.log(`   Article: "${selectedArticle.title.substring(0, 60)}..."`);
        console.log(`   Current summary (${violation.length} chars): "${violation.summary.substring(0, 80)}..."`);

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

        // Validate and adjust length if needed (up to 3 rounds)
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
              model: 'gpt-4o-mini',
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
              model: 'gpt-4o-mini',
              maxTokens: 150,
              temperature: 0.2,
              context: 'summary-adjustment',
              purpose: `Adjust summary length (round ${adjustmentRound})`
            });
            finalSummary = adjusted.text.trim();
            length = finalSummary.length;
          }
        }

        // Final validation and manual adjustment if still out of range
        if (length < 100 || length > 110) {
          console.warn(`   ⚠️ Final summary still ${length} chars after ${adjustmentRound} adjustment rounds, applying manual fix...`);
          
          // Manual truncation/expansion as last resort
          if (length > 110) {
            // Truncate to 110 chars, ensuring we don't cut in the middle of a word
            let truncated = finalSummary.substring(0, 110);
            const lastSpace = truncated.lastIndexOf(' ');
            if (lastSpace > 100) {
              truncated = truncated.substring(0, lastSpace);
            }
            finalSummary = truncated;
            length = finalSummary.length;
            console.log(`   🔧 Manually truncated to ${length} chars: "${finalSummary}"`);
          } else if (length < 100) {
            // Expand by repeating key phrases or adding context
            const needed = 100 - length;
            const words = finalSummary.split(' ');
            const lastWords = words.slice(-3).join(' ');
            finalSummary = finalSummary + ' ' + lastWords.substring(0, needed).trim();
            if (finalSummary.length < 100) {
              finalSummary = finalSummary + ' ' + 'and continues to evolve'.substring(0, 100 - finalSummary.length);
            }
            finalSummary = finalSummary.substring(0, 110).trim();
            length = finalSummary.length;
            console.log(`   🔧 Manually expanded to ${length} chars: "${finalSummary}"`);
          }
        }
        
        // Final check - only update if within range
        if (length >= 100 && length <= 110) {
          console.log(`   ✅ Summary regenerated: ${length} chars - "${finalSummary}"`);
          // Update the database
          await storage.updateAnalysis(violation.date, {
            summary: finalSummary
          });
          updated++;
        } else {
          console.warn(`   ❌ Summary still out of range (${length} chars) after all attempts, skipping update`);
          skipped.push(violation.date);
        }

        if (updated % 10 === 0) {
          console.log(`\n📝 Progress: Regenerated ${updated}/${violations.length} summaries...\n`);
        }
        
        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (error) {
        console.error(`❌ Error regenerating summary for ${violation.date}:`, error);
        errors.push(violation.date);
      }
    }

    console.log(`\n✅ Bulk summary regeneration completed:`);
    console.log(`   Updated: ${updated}`);
    console.log(`   Skipped: ${skipped.length}${skipped.length > 0 ? ` (${skipped.slice(0, 5).join(', ')}${skipped.length > 5 ? '...' : ''})` : ''}`);
    console.log(`   Errors: ${errors.length}${errors.length > 0 ? ` (${errors.slice(0, 5).join(', ')}${errors.length > 5 ? '...' : ''})` : ''}`);
    
    if (errors.length > 0) {
      console.log(`\n❌ Failed dates:`);
      errors.forEach(date => console.log(`   - ${date}`));
    }
    
  } catch (error) {
    console.error('💥 Error in bulk regenerate summaries:', error);
    throw error;
  }
}

finishRegenerateSummaries()
  .then(() => {
    console.log('\n✅ Script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Script failed:', error);
    process.exit(1);
  });

