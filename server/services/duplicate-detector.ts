import OpenAI from 'openai';
import { storage } from '../storage';
import type { HistoricalNewsAnalysis } from '@shared/schema';
import { apiMonitor } from './api-monitor';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

interface DuplicateDetectionResult {
  similar_dates: string[];
}

export class DuplicateDetectorService {
  /**
   * Analyze a single date for duplicates by comparing with surrounding 30 days
   */
  async analyzeDate(sourceDate: string): Promise<string[]> {
    console.log(`🔍 [duplicate-detector] Analyzing ${sourceDate} for duplicates...`);

    // Get the source analysis
    const sourceAnalysis = await storage.getAnalysisByDate(sourceDate);
    if (!sourceAnalysis) {
      console.log(`⚠️ [duplicate-detector] No analysis found for ${sourceDate}`);
      return [];
    }

    // Get comparison window (30 days before and after)
    const sourceDateTime = new Date(sourceDate);
    const startDate = new Date(sourceDateTime);
    startDate.setDate(startDate.getDate() - 30);
    const endDate = new Date(sourceDateTime);
    endDate.setDate(endDate.getDate() + 30);

    const candidateAnalyses = await storage.getAnalysesByDateRange(
      startDate.toISOString().split('T')[0],
      endDate.toISOString().split('T')[0]
    );

    // Filter out the source date itself
    const candidates = candidateAnalyses.filter(a => a.date !== sourceDate);

    if (candidates.length === 0) {
      console.log(`📭 [duplicate-detector] No candidate dates found for ${sourceDate}`);
      return [];
    }

    console.log(`📊 [duplicate-detector] Found ${candidates.length} candidate dates to compare`);

    // Build OpenAI prompt
    const candidatesText = candidates
      .map(c => `${c.date} - ${c.summary}`)
      .join('\n');

    try {
      // Track API call
      const requestId = apiMonitor.logRequest({
        service: 'openai',
        endpoint: '/chat/completions',
        method: 'POST',
        status: 'pending',
        context: 'Duplicate Detection',
        purpose: `Comparing ${sourceDate} with ${candidates.length} candidates`,
        date: sourceDate,
      });

      const startTime = Date.now();

      const completion = await openai.chat.completions.create({
        model: 'gpt-5-mini',
        response_format: { type: 'json_object' },
        max_completion_tokens: 2000,
        messages: [
          {
            role: 'system',
            content: `You are a duplicate news detector. Your job is to identify when multiple dates describe THE SAME SPECIFIC EVENT.

RETURN duplicates when:
✅ Same event reported by different outlets on different days
✅ Delayed coverage of the same announcement/milestone
✅ Nearly identical facts but different wording

DO NOT return when:
❌ Same person but different actions (Obama inauguration ≠ Obama policy 2 weeks later)
❌ Same topic but different events (Bitcoin reaches $10 ≠ Bitcoin reaches $100)
❌ Cause and effect (Event happens ≠ Reaction to event)
❌ Related but distinct (Company announces plan ≠ Company executes plan later)

Be strict: only flag true duplicates of the SAME specific event.

Return JSON: { "similar_dates": ["2009-05-24", "2009-05-20"] }`,
          },
          {
            role: 'user',
            content: `SOURCE: ${sourceDate}
"${sourceAnalysis.summary}"

COMPARE TO:
${candidatesText}

Which dates describe the SAME EVENT as the source (not just related)?`,
          },
        ],
        temperature: 0.3,
      });

      const duration = Date.now() - startTime;

      const responseText = completion.choices[0]?.message?.content;
      if (!responseText) {
        console.log(`⚠️ [duplicate-detector] No response from OpenAI`);
        apiMonitor.updateRequest(requestId, {
          status: 'error',
          duration,
          error: 'No response from OpenAI',
        });
        return [];
      }

      const result: DuplicateDetectionResult = JSON.parse(responseText);
      const similarDates = result.similar_dates || [];

      // Safety filter: Remove source date if AI incorrectly included it
      const filteredDates = similarDates.filter(date => date !== sourceDate);

      // Update request as successful
      apiMonitor.updateRequest(requestId, {
        status: 'success',
        duration,
        responseSize: JSON.stringify(result).length,
      });

      console.log(`✅ [duplicate-detector] Found ${filteredDates.length} similar dates for ${sourceDate}`);
      return filteredDates;
    } catch (error: any) {
      console.error(`❌ [duplicate-detector] Error analyzing ${sourceDate}:`, error);
      
      // Track the error
      const errorCategory = error?.status === 429 ? 'rate-limit' : 
                           error?.code === 'ENOTFOUND' ? 'network' : 'other';
      
      apiMonitor.logRequest({
        service: 'openai',
        endpoint: '/chat/completions',
        method: 'POST',
        status: 'error',
        error: error?.message || String(error),
        errorCategory,
        context: 'Duplicate Detection',
        purpose: `Comparing ${sourceDate}`,
        date: sourceDate,
      });
      
      return [];
    }
  }

  /**
   * Analyze all dates in a year for duplicates
   */
  async analyzeYear(
    year: number,
    onProgress?: (completed: number, total: number, currentDate: string) => void
  ): Promise<void> {
    console.log(`🧹 [duplicate-detector] Starting duplicate analysis for year ${year}...`);

    // Clear existing conflicts for this year
    await storage.clearConflictsByYear(year);

    // Get all analyses for the year
    const startDate = `${year}-01-01`;
    const endDate = `${year}-12-31`;
    const analyses = await storage.getAnalysesByDateRange(startDate, endDate);

    console.log(`📊 [duplicate-detector] Found ${analyses.length} dates to analyze in ${year}`);

    let completed = 0;
    const total = analyses.length;

    for (const analysis of analyses) {
      // Analyze this date
      const similarDates = await this.analyzeDate(analysis.date);

      // Store conflicts in canonical form (sourceDate < relatedDate)
      if (similarDates.length > 0) {
        const conflicts = similarDates.map(relatedDate => {
          // Normalize to canonical order (smaller date first)
          const [first, second] = [analysis.date, relatedDate].sort();
          return {
            sourceDate: first,
            relatedDate: second,
          };
        });
        await storage.createEventConflicts(conflicts);
        console.log(`💾 [duplicate-detector] Stored ${conflicts.length} conflicts for ${analysis.date}`);
      }

      completed++;
      if (onProgress) {
        onProgress(completed, total, analysis.date);
      }

      // Add a small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    console.log(`✅ [duplicate-detector] Completed duplicate analysis for year ${year}`);
  }
}

export const duplicateDetector = new DuplicateDetectorService();
