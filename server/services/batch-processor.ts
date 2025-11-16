import OpenAI from "openai";
import { type BatchEvent } from "@shared/schema";
import { apiMonitor } from './api-monitor';

const openai = new OpenAI({ 
  apiKey: process.env.OPENAI_API_KEY
});

export interface BatchEnhancementResult {
  success: boolean;
  enhancedEvents?: EnhancedEvent[];
  errors?: string[];
}

export interface EnhancedEvent {
  id: string;
  enhancedSummary: string;
  enhancedReasoning: string;
}

export interface BatchProcessingContext {
  batchId: string;
  batchNumber: number;
  events: BatchEvent[];
  groupContext: string;
}

export class BatchProcessorService {
  /**
   * Enhance a batch of events using OpenAI with group context
   */
  public async enhanceBatch(context: BatchProcessingContext): Promise<BatchEnhancementResult> {
    try {
      console.log(`🚀 [Batch ${context.batchId}:${context.batchNumber}] Starting enhancement of ${context.events.length} events`);
      
      if (context.events.length === 0) {
        return {
          success: false,
          errors: ['No events to process']
        };
      }

      // Group events by category for context-aware processing
      const groupedEvents = this.groupEventsByCategory(context.events);
      const enhancedEvents: EnhancedEvent[] = [];
      const errors: string[] = [];

      // Process each group with specific context
      for (const [group, events] of Object.entries(groupedEvents)) {
        console.log(`📝 [Batch ${context.batchId}:${context.batchNumber}] Processing ${events.length} events in group: ${group}`);
        
        try {
          const groupResults = await this.enhanceEventGroup(events, group, context);
          enhancedEvents.push(...groupResults);
        } catch (error) {
          const errorMsg = `Failed to enhance group '${group}': ${(error as Error).message}`;
          console.error(`❌ [Batch ${context.batchId}:${context.batchNumber}] ${errorMsg}`);
          errors.push(errorMsg);
        }
      }

      console.log(`✅ [Batch ${context.batchId}:${context.batchNumber}] Enhanced ${enhancedEvents.length}/${context.events.length} events`);

      return {
        success: errors.length === 0,
        enhancedEvents,
        errors: errors.length > 0 ? errors : undefined
      };
    } catch (error) {
      console.error(`💥 [Batch ${context.batchId}:${context.batchNumber}] Critical batch processing error:`, error);
      return {
        success: false,
        errors: [`Critical error: ${(error as Error).message}`]
      };
    }
  }

  /**
   * Group events by their original group for context-aware processing
   */
  private groupEventsByCategory(events: BatchEvent[]): Record<string, BatchEvent[]> {
    const grouped: Record<string, BatchEvent[]> = {};
    
    events.forEach(event => {
      const group = event.originalGroup || 'General';
      if (!grouped[group]) {
        grouped[group] = [];
      }
      grouped[group].push(event);
    });

    return grouped;
  }

  /**
   * Enhance a group of events with shared context
   */
  private async enhanceEventGroup(events: BatchEvent[], groupName: string, context: BatchProcessingContext): Promise<EnhancedEvent[]> {
    const enhancedEvents: EnhancedEvent[] = [];

    // Create group context for better summaries
    const groupContext = this.buildGroupContext(events, groupName);
    
    // Process events individually but with group context
    for (const event of events) {
      try {
        const enhanced = await this.enhanceSingleEvent(event, groupContext);
        enhancedEvents.push(enhanced);
      } catch (error) {
        console.error(`❌ Failed to enhance event ${event.id}:`, error);
        // Continue with other events, don't fail the entire batch
        enhancedEvents.push({
          id: event.id,
          enhancedSummary: event.originalSummary, // Fallback to original
          enhancedReasoning: `Enhancement failed: ${(error as Error).message}`
        });
      }
    }

    return enhancedEvents;
  }

  /**
   * Build context for a group of events
   */
  private buildGroupContext(events: BatchEvent[], groupName: string): string {
    const dates = events.map(e => e.originalDate).sort();
    const dateRange = dates.length > 1 ? `${dates[0]} to ${dates[dates.length - 1]}` : dates[0];
    
    return `
Group: ${groupName}
Date Range: ${dateRange}
Event Count: ${events.length}
Theme: Events related to ${groupName.toLowerCase()} during Bitcoin's history
Context: These events are part of a curated collection focusing on ${groupName.toLowerCase()} aspects of Bitcoin's development and adoption.
`.trim();
  }

  /**
   * Enhance a single event with group context
   */
  private async enhanceSingleEvent(event: BatchEvent, groupContext: string): Promise<EnhancedEvent> {
    const systemPrompt = this.buildSystemPrompt(groupContext);
    const userPrompt = this.buildUserPrompt(event);

    console.log(`🔄 [Event ${event.id}] Enhancing summary: "${event.originalSummary}"`);

    // Track API call
    const requestId = apiMonitor.logRequest({
      service: 'openai',
      endpoint: '/chat/completions',
      method: 'POST',
      status: 'pending',
      context: 'Batch Enhancement',
      purpose: `Enhancing event ${event.id}`,
      date: event.originalDate,
    });

    const startTime = Date.now();

    try {
      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        temperature: 0.3,
        max_tokens: 300
      });

      const duration = Date.now() - startTime;

      const content = response.choices[0]?.message?.content;
      if (!content) {
        apiMonitor.updateRequest(requestId, {
          status: 'error',
          duration,
          error: 'Empty response from OpenAI',
        });
        throw new Error('Empty response from OpenAI');
      }

      try {
        const result = JSON.parse(content);
        
        // Validate the enhanced summary
        const validatedSummary = this.validateAndCorrectSummary(result.enhancedSummary);
        
        // Update request as successful
        apiMonitor.updateRequest(requestId, {
          status: 'success',
          duration,
          responseSize: content.length,
        });

        console.log(`✅ [Event ${event.id}] Enhanced: "${validatedSummary}" (${validatedSummary.length} chars)`);

        return {
          id: event.id,
          enhancedSummary: validatedSummary,
          enhancedReasoning: result.reasoning || 'AI-enhanced summary with group context'
        };
      } catch (parseError) {
        apiMonitor.updateRequest(requestId, {
          status: 'error',
          duration,
          error: `Failed to parse response: ${parseError}`,
          errorCategory: 'parsing',
        });
        console.error(`❌ [Event ${event.id}] Failed to parse OpenAI response:`, parseError);
        throw new Error(`Failed to parse OpenAI response: ${parseError}`);
      }
    } catch (error: any) {
      const duration = Date.now() - startTime;
      const errorCategory = error?.status === 429 ? 'rate-limit' : 
                           error?.code === 'ENOTFOUND' ? 'network' : 'other';
      
      apiMonitor.updateRequest(requestId, {
        status: 'error',
        duration,
        error: error?.message || String(error),
        errorCategory,
      });
      throw error;
    }
  }

  /**
   * Build system prompt for summary enhancement
   */
  private buildSystemPrompt(groupContext: string): string {
    return `You are a Bitcoin historian specializing in creating concise, factual summaries of Bitcoin-related events.

CONTEXT:
${groupContext}

TASK: Enhance manual Bitcoin event summaries to be more accurate, engaging, and historically precise.

CRITICAL REQUIREMENTS:
1. Summary MUST be EXACTLY 100-110 characters (strict requirement)
2. NO DATES anywhere in summary (no years, months, days, "On [date]", "In [year]")
3. Use active voice and present tense: "Bitcoin reaches $1000" not "Bitcoin reached $1000"
4. Focus on what actually HAPPENED, not what articles discussed
5. NO ending punctuation (no periods, colons, semicolons, dashes)
6. Be conversational yet professional
7. Emphasize the actual event/outcome over the reporting

VOICE GUIDELINES:
- Active, engaging, factual
- Present tense for historical events
- Focus on outcomes and concrete actions
- Remove filler words and speculation
- Make it sound like a friend explaining what happened

FORBIDDEN:
- ANY DATES: "On October 12", "In 2009", "2024", months, years, etc.
- Ending punctuation: . : ; -
- Passive voice: "was announced" → use "announces"
- Past tense: "reached" → use "reaches"
- Speculation or opinion words
- Quotation marks around the summary

OUTPUT FORMAT:
Return JSON only:
{
  "enhancedSummary": "exact 100-110 character summary here",
  "reasoning": "brief explanation of enhancements made"
}`;
  }

  /**
   * Build user prompt for specific event
   */
  private buildUserPrompt(event: BatchEvent): string {
    return `Original Event:
Date: ${event.originalDate}
Summary: "${event.originalSummary}"
Group: ${event.originalGroup}

Please enhance this summary following all requirements. Make it more engaging and historically accurate while maintaining the core facts.`;
  }

  /**
   * Validate and correct summary length
   */
  private validateAndCorrectSummary(summary: string): string {
    if (!summary) {
      throw new Error('Summary cannot be empty');
    }

    let corrected = summary.trim();
    
    // Remove ANY dates first
    corrected = corrected.replace(/\b(On|In)\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d+,?\s*\d{4}\b/g, '');
    corrected = corrected.replace(/\b(On|In)\s+\d{4}\b/g, '');
    corrected = corrected.replace(/\b\d{4}\b/g, '').trim();
    
    // Remove forbidden ending punctuation
    corrected = corrected.replace(/[.,:;-]+$/, '');
    
    // Remove forbidden punctuation throughout (but keep necessary ones like apostrophes)
    corrected = corrected.replace(/[;:-]/g, '');
    
    // Clean up extra spaces
    corrected = corrected.replace(/\s+/g, ' ').trim();
    
    const length = corrected.length;
    
    if (length >= 100 && length <= 110) {
      return corrected;
    }
    
    if (length < 100) {
      // Try to expand
      corrected = this.expandSummary(corrected, 105);
    } else if (length > 110) {
      // Try to trim
      corrected = this.trimSummary(corrected, 110);
    }
    
    const finalLength = corrected.length;
    
    if (finalLength < 100 || finalLength > 110) {
      console.log(`❌ Summary REJECTED - ${finalLength} chars: "${corrected}"`);
      throw new Error(`Summary length is ${finalLength} characters, must be 100-110. Text: "${corrected}"`);
    }
    
    console.log(`✅ Summary APPROVED - ${finalLength} chars: "${corrected}"`);
    
    return corrected;
  }

  /**
   * Expand summary to meet minimum length
   */
  private expandSummary(summary: string, targetLength: number): string {
    const currentLength = summary.length;
    const needed = targetLength - currentLength;
    
    if (needed <= 0) return summary;
    
    // Try to expand by adding descriptive words
    let expanded = summary
      .replace(/(\d+)%/g, '$1 percent')
      .replace(/\b(says|said)\b/g, 'announces')
      .replace(/\b(big|large)\b/g, 'significant')
      .replace(/\b(cuts|cut)\b/g, 'reduces')
      .replace(/\$(\d+)B/g, '$$$1 billion')
      .replace(/\$(\d+)M/g, '$$$1 million');
      
    // If still too short, add contextual words
    if (expanded.length < targetLength) {
      expanded = expanded
        .replace(/\b(announces)\b/g, 'officially announces')
        .replace(/\b(reports)\b/g, 'officially reports')
        .replace(/\b(policy)\b/g, 'new policy');
    }
    
    return expanded.length <= 120 ? expanded : summary;
  }

  /**
   * Trim summary to meet maximum length
   */
  private trimSummary(summary: string, maxLength: number): string {
    if (summary.length <= maxLength) return summary;
    
    // Intelligent trimming
    let trimmed = summary
      .replace(/\b(officially|reportedly|apparently)\s+/g, '')
      .replace(/\s+(that|which)\s+/g, ' ')
      .replace(/\s+in\s+order\s+to\s+/g, ' to ')
      .replace(/\s+due\s+to\s+/g, ' from ')
      .replace(/\s{2,}/g, ' ')
      .trim();
      
    // If still too long, trim from the end
    if (trimmed.length > maxLength) {
      const words = trimmed.split(' ');
      while (words.length > 0 && words.join(' ').length > maxLength) {
        words.pop();
      }
      trimmed = words.join(' ');
      
      // Clean up ending
      trimmed = trimmed.replace(/[,;:\-]?\s*\w*$/, '');
      trimmed = trimmed.replace(/[,;:\-]/g, '');
    }
    
    return trimmed.length >= 100 ? trimmed : summary;
  }

  /**
   * Get processing status for a batch
   */
  public async getBatchStatus(batchId: string, batchNumber: number): Promise<{
    total: number;
    processed: number;
    percentage: number;
  }> {
    // This would typically query the database for actual status
    // For now, returning a placeholder
    return {
      total: 10,
      processed: 0,
      percentage: 0
    };
  }
}

export const batchProcessor = new BatchProcessorService();