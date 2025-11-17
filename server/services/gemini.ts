import { GoogleGenAI } from "@google/genai";

interface VerificationResult {
  assessment: 'Valid' | 'Incorrect' | 'Cannot Verify';
  explanation?: string;
}

interface GoogleCheckResults {
  totalDays: number;
  validDays: number;
  incorrectDays: number;
  cannotVerifyDays: number;
  results: Map<string, VerificationResult>;
  affectedDates: string[];
}

class GeminiService {
  private ai: GoogleGenAI;

  constructor() {
    const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("Google API key not found. Please set GOOGLE_API_KEY or GEMINI_API_KEY environment variable");
    }
    this.ai = new GoogleGenAI({ apiKey });
  }

  async verifyDaySummary(
    date: string, 
    summary: string, 
    requestContext?: {
      requestId?: string;
      source?: string;
      referer?: string;
      userAgent?: string;
    }
  ): Promise<VerificationResult> {
    // Import API monitor
    const { apiMonitor } = await import('./api-monitor');
    const startTime = Date.now();
    let requestId: string | null = null;

    try {
      console.log(`🔍 [Google Check] Verifying summary for ${date}: "${summary}"`);
      
      // Start API monitoring
      requestId = apiMonitor.logRequest({
        service: 'openai', // Using openai as closest match for Google AI
        method: 'POST',
        endpoint: '/models/generateContent',
        status: 'pending',
        purpose: 'google-verification',
        requestData: {
          model: 'gemini-2.0-flash-exp',
          date: date,
          summaryLength: summary.length,
          source: requestContext?.source || 'google-check',
          referer: requestContext?.referer,
          userAgent: requestContext?.userAgent
        }
      });
      
      const prompt = `Analyze the following Bitcoin/cryptocurrency news summary for the date '${date}'. Based on publicly verifiable facts from reliable news sources, determine if the summary is factually correct.

Summary: "${summary}"

Instructions:
- Search for reliable news sources from that specific date
- Verify the facts mentioned in the summary
- Focus on Bitcoin, cryptocurrency, and financial news accuracy
- Consider the historical context of Bitcoin for that date period

Respond with only one word: "Valid" or "Incorrect". Do not provide any explanation or other text.`;

      const response = await this.ai.models.generateContent({
        model: "gemini-2.0-flash-exp",
        contents: prompt,
        config: {
          tools: [{ googleSearch: {} }],
        },
      });

      const responseText = response.text?.trim().toLowerCase() || '';
      let assessment: 'Valid' | 'Incorrect' | 'Cannot Verify' = 'Cannot Verify';

      console.log(`🤖 [Google Check] Raw response for ${date}: "${responseText}"`);

      if (responseText.includes('valid')) {
        assessment = 'Valid';
      } else if (responseText.includes('incorrect')) {
        assessment = 'Incorrect';
      }

      console.log(`✅ [Google Check] Final assessment for ${date}: ${assessment}`);
      
      // Update API monitor with success
      if (requestId) {
        apiMonitor.updateRequest(requestId, {
          status: 'success',
          duration: Date.now() - startTime,
          responseSize: 100, // Estimate for Gemini response
          requestData: {
            assessment: assessment,
            summaryLength: summary.length,
            processingTime: Date.now() - startTime
          }
        });
      }
      
      return { assessment };

    } catch (error) {
      console.error(`❌ [Google Check] Error verifying ${date}:`, error);
      
      // Update API monitor with error
      if (requestId) {
        apiMonitor.updateRequest(requestId, {
          status: 'error',
          duration: Date.now() - startTime,
          error: (error as Error).message,
          errorCategory: 'other',
          requestData: {
            date: date,
            summaryLength: summary.length,
            error: (error as Error).message
          }
        });
      }
      
      if (error instanceof Error) {
        throw new Error(`Failed to verify summary for ${date}: ${error.message}`);
      }
      throw new Error(`An unknown error occurred while verifying the summary for ${date}.`);
    }
  }

  async checkMonthAccuracy(analyses: any[]): Promise<GoogleCheckResults> {
    console.log(`🚀 [Google Check] Starting bulk verification for ${analyses.length} analyses`);
    
    const results = new Map<string, VerificationResult>();
    const affectedDates: string[] = [];
    let validDays = 0;
    let incorrectDays = 0; 
    let cannotVerifyDays = 0;

    for (const analysis of analyses) {
      if (!analysis.summary || !analysis.analysisDate) {
        console.log(`⚠️ [Google Check] Skipping analysis - missing summary or date`);
        continue;
      }

      try {
        const result = await this.verifyDaySummary(
          analysis.analysisDate, 
          analysis.summary,
          {
            source: 'bulk-month-check',
            requestId: `bulk-${Date.now()}-${analysis.analysisDate}`
          }
        );
        
        results.set(analysis.analysisDate, result);
        
        switch (result.assessment) {
          case 'Valid':
            validDays++;
            break;
          case 'Incorrect':
            incorrectDays++;
            affectedDates.push(analysis.analysisDate);
            break;
          case 'Cannot Verify':
            cannotVerifyDays++;
            affectedDates.push(analysis.analysisDate);
            break;
        }

        console.log(`📊 [Google Check] ${analysis.analysisDate}: ${result.assessment}`);
        
        // Add delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 1000));
        
      } catch (error) {
        console.error(`❌ [Google Check] Failed to verify ${analysis.analysisDate}:`, error);
        results.set(analysis.analysisDate, { assessment: 'Cannot Verify' });
        cannotVerifyDays++;
        affectedDates.push(analysis.analysisDate);
      }
    }

    const totalDays = validDays + incorrectDays + cannotVerifyDays;
    
    console.log(`🎯 [Google Check] Completed: ${validDays} valid, ${incorrectDays} incorrect, ${cannotVerifyDays} cannot verify out of ${totalDays} total`);

    return {
      totalDays,
      validDays,
      incorrectDays,
      cannotVerifyDays,
      results,
      affectedDates
    };
  }
}

// Lazy initialization to avoid errors at import time
let _geminiServiceInstance: GeminiService | null = null;

export function getGeminiService(): GeminiService {
  if (!_geminiServiceInstance) {
    _geminiServiceInstance = new GeminiService();
  }
  return _geminiServiceInstance;
}

// Export as a getter for backward compatibility
export const geminiService = new Proxy({} as GeminiService, {
  get(_target, prop) {
    return getGeminiService()[prop as keyof GeminiService];
  }
});

export type { VerificationResult, GoogleCheckResults };