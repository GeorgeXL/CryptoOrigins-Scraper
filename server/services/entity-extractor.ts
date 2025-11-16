import { openaiService } from './openai';
import { apiMonitor } from './api-monitor';
import type { EntityTag } from '@shared/schema';

class EntityExtractorService {
  /**
   * Extract entities from a summary text
   * @param summary The news summary to analyze
   * @returns Array of extracted entities with name and category
   */
  async extractEntities(summary: string): Promise<EntityTag[]> {
    const prompt = `You are an expert at extracting entities and topics from Bitcoin and cryptocurrency news summaries.

Extract ALL relevant entities AND the primary topic from the following news summary:

Summary: "${summary}"

Extract entities in these categories:
- country: Countries mentioned (e.g., "United States", "China", "Israel")
- company: Companies mentioned (e.g., "Tesla", "Microsoft", "Binance", "Coinbase")
- organization: Organizations (e.g., "SEC", "Federal Reserve", "IMF")
- crypto: Cryptocurrencies, tokens, NFT projects (e.g., "Bitcoin", "Ethereum", "BTC", "ETH", "Bored Ape", "Uniswap")
- person: People mentioned (e.g., "Elon Musk", "Satoshi Nakamoto", "Vitalik Buterin")
- protocol: Protocols or technologies (e.g., "Lightning Network", "Taproot", "Proof of Stake")
- topic: The PRIMARY theme of the summary (choose ONE):
  * "Bitcoin Price" - Price movements, trading, market valuation
  * "Regulation" - Legal, regulatory, policy, government actions
  * "Adoption" - Companies adopting Bitcoin, institutional investment, mainstream acceptance
  * "Mining" - Mining difficulty, hashrate, mining companies, energy consumption
  * "Technology" - Protocol upgrades, technical developments, network improvements
  * "Macroeconomics" - Economic events, inflation, interest rates, global economy

Entity Rules:
1. Extract the EXACT name as it appears (don't convert "BTC" to "Bitcoin")
2. Only extract entities that are CLEARLY mentioned in the summary
3. Don't infer or guess entities that aren't explicitly stated
4. Keep entity names concise (use common names, not full legal names)
5. Remove duplicates

Topic Rules:
1. Choose the ONE topic that best describes the summary's main theme
2. Every summary should have exactly ONE topic tag
3. If multiple themes apply, choose the most dominant one

Return ONLY a JSON array in this format:
[{"name": "Bitcoin", "category": "crypto"}, {"name": "Tesla", "category": "company"}, {"name": "Bitcoin Price", "category": "topic"}]`;

    let monitorId: string | null = null;
    
    try {
      monitorId = apiMonitor.logRequest({
        service: 'openai',
        method: 'POST',
        endpoint: '/chat/completions',
        status: 'pending',
        context: 'entity-extraction',
        purpose: 'Extract entities from summary'
      });

      const result = await openaiService.createCompletion([
        {
          role: 'system',
          content: 'You are an expert at entity extraction. Always return valid JSON arrays only.'
        },
        {
          role: 'user',
          content: prompt
        }
      ]);

      apiMonitor.updateRequest(monitorId, {
        status: 'success'
      });

      let entities: EntityTag[] = [];
      
      try {
        const parsed = JSON.parse(result);
        
        // Handle different response formats
        if (Array.isArray(parsed)) {
          entities = parsed;
        } else if (parsed.entities && Array.isArray(parsed.entities)) {
          entities = parsed.entities;
        } else if (parsed.tags && Array.isArray(parsed.tags)) {
          entities = parsed.tags;
        }

        // Validate and clean entities
        entities = entities
          .filter((tag: any) => 
            tag && 
            typeof tag === 'object' && 
            typeof tag.name === 'string' && 
            typeof tag.category === 'string' &&
            tag.name.trim().length > 0
          )
          .map((tag: any) => ({
            name: tag.name.trim(),
            category: tag.category.toLowerCase().trim()
          }));

        // Remove duplicates
        const uniqueEntities = new Map<string, EntityTag>();
        for (const entity of entities) {
          const key = `${entity.name.toLowerCase()}:${entity.category}`;
          if (!uniqueEntities.has(key)) {
            uniqueEntities.set(key, entity);
          }
        }

        const finalEntities = Array.from(uniqueEntities.values());
        
        // If no entities found, add a special "NO TAG" marker to indicate processing completed
        if (finalEntities.length === 0) {
          return [{
            name: 'NO TAG',
            category: 'system'
          }];
        }

        return finalEntities;
      } catch (parseError) {
        console.error('[EntityExtractor] Failed to parse OpenAI response:', result);
        apiMonitor.updateRequest(monitorId, {
          status: 'error',
          error: 'JSON parse error'
        });
        // Throw the error so caller knows extraction failed (not just "no entities found")
        throw new Error(`Failed to parse OpenAI response: ${parseError instanceof Error ? parseError.message : 'Invalid JSON'}`);
      }
    } catch (error) {
      console.error('[EntityExtractor] Error extracting entities:', error);
      
      // Update API monitor if we have a monitorId
      if (monitorId) {
        apiMonitor.updateRequest(monitorId, {
          status: 'error',
          error: error instanceof Error ? error.message : 'Unknown error during entity extraction'
        });
      }
      
      // Propagate error so caller can handle it appropriately
      throw error;
    }
  }

  /**
   * Extract entities from multiple summaries in batch
   * @param summaries Array of summaries to process
   * @param onProgress Optional progress callback (current, total)
   * @returns Array of tag arrays (one per summary)
   */
  async extractEntitiesBatch(
    summaries: string[],
    onProgress?: (current: number, total: number) => void
  ): Promise<EntityTag[][]> {
    const results: EntityTag[][] = [];

    for (let i = 0; i < summaries.length; i++) {
      const tags = await this.extractEntities(summaries[i]);
      results.push(tags);
      
      if (onProgress) {
        onProgress(i + 1, summaries.length);
      }

      // Small delay to avoid rate limits
      if (i < summaries.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    return results;
  }
}

export const entityExtractor = new EntityExtractorService();
