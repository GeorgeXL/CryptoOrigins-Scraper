import { aiService } from './ai';
import { apiMonitor } from './api-monitor';

class EntityExtractorService {
  /**
   * Extract tag names from a summary text (simple array of tag names)
   * @param summary The news summary to analyze
   * @returns Array of tag names: ["Elon Musk", "Obama", "NFT", "Bitcoin"]
   */
  async extractEntities(summary: string): Promise<string[]> {
    const prompt = `Extract all named entities from this news summary as a JSON array.

Summary: "${summary}"

Extract ONLY proper names of:
- Cryptocurrencies/tokens: Bitcoin, Ethereum, Solana, NFT, etc.
- People: Elon Musk, Vitalik Buterin, Obama, etc.
- Companies: Tesla, Coinbase, PayPal, Bank of America, etc.
- Organizations: SEC, IMF, Federal Reserve, G20, etc.
- Countries/regions: Venezuela, China, EU, UK, etc.
- Specific laws/protocols: MiCA, Taproot, etc.

Rules:
1. Extract the exact name as it appears
2. Extract both full names and acronyms if present
3. Do NOT extract: generic job titles (lawmakers, ministers), generic departments (Treasury alone), abstract concepts (regulation, compliance), amounts, percentages, version numbers
4. Return as JSON array: ["Bitcoin", "Venezuela"]

Examples:
"Venezuela approves bitcoin" → ["Venezuela", "Bitcoin"]
"SEC sues Coinbase" → ["SEC", "Coinbase"]
"Elon Musk tweets about Dogecoin" → ["Elon Musk", "Dogecoin"]
"UK lawmakers debate crypto" → ["UK"]
"Obama cautions about economy" → ["Obama"]`;

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

      const openai = aiService.getProvider('openai');
      const result = await openai.generateCompletion({
        prompt,
        systemPrompt: 'You are an expert at entity extraction. Extract all proper named entities you find - specific people, companies, countries, organizations, cryptocurrencies, etc. Do NOT extract generic terms, job titles, or abstract concepts. Always return valid JSON arrays only.',
        model: 'gpt-4o-mini',
        temperature: 0.15,
      });

      apiMonitor.updateRequest(monitorId, {
        status: 'success'
      });

      let tagNames: string[] = [];
      
      try {
        // Clean the response text - OpenAI sometimes returns markdown code blocks
        let cleanedText = result.text.trim();
        
        // Remove markdown code blocks (```json ... ``` or ``` ... ```)
        if (cleanedText.startsWith('```')) {
          // Find the closing ```
          const closingIndex = cleanedText.indexOf('```', 3);
          if (closingIndex > 0) {
            cleanedText = cleanedText.substring(3, closingIndex).trim();
            // Remove "json" if it's the first word
            if (cleanedText.toLowerCase().startsWith('json')) {
              cleanedText = cleanedText.substring(4).trim();
            }
          } else {
            // No closing ```, try to extract JSON from the content
            cleanedText = cleanedText.substring(3).trim();
            if (cleanedText.toLowerCase().startsWith('json')) {
              cleanedText = cleanedText.substring(4).trim();
            }
          }
        }
        
        const parsed = JSON.parse(cleanedText);
        
        // Handle different response formats
        if (Array.isArray(parsed)) {
          // Check if it's an array of strings (new format) or objects (old format)
          if (parsed.length > 0 && typeof parsed[0] === 'string') {
            tagNames = parsed;
          } else if (parsed.length > 0 && typeof parsed[0] === 'object') {
            // Old format with objects - extract names
            tagNames = parsed
              .filter((tag: any) => tag && typeof tag === 'object' && typeof tag.name === 'string')
              .map((tag: any) => tag.name.trim());
          }
        } else if (parsed.entities && Array.isArray(parsed.entities)) {
          if (typeof parsed.entities[0] === 'string') {
            tagNames = parsed.entities;
          } else {
            tagNames = parsed.entities
              .filter((tag: any) => tag && typeof tag === 'object' && typeof tag.name === 'string')
              .map((tag: any) => tag.name.trim());
          }
        } else if (parsed.tags && Array.isArray(parsed.tags)) {
          if (typeof parsed.tags[0] === 'string') {
            tagNames = parsed.tags;
          } else {
            tagNames = parsed.tags
              .filter((tag: any) => tag && typeof tag === 'object' && typeof tag.name === 'string')
              .map((tag: any) => tag.name.trim());
          }
        }

        // Validate and clean tag names
        tagNames = tagNames
          .filter((name: any) => typeof name === 'string' && name.trim().length > 0)
          .map((name: string) => name.trim());

        // Filter out garbage tags and irrelevant entities
        tagNames = tagNames.filter((name: string) => {
          const nameLower = name.toLowerCase();
          
          // Reject pure numbers
          if (/^\d+$/.test(name)) return false;
          
          // Reject prices and dollar amounts (but keep ticker symbols like $ERG)
          if (/^\$[\d,]+/.test(name)) return false;
          
          // Reject currency amounts with words (e.g., "100 million dollars", "100 millions dollars")
          if (/\d+[,\d]*\s*(million|billion|thousand|trillion)\s*(dollars?|usd|eur|gbp|yen)/i.test(name)) return false;
          if (/\d+[,\d]*\s*(dollars?|usd|eur|gbp|yen)/i.test(name)) return false;
          
          // Reject version numbers (e.g., 0.12.0, 1.2.4)
          if (/^\d+\.\d+\.?\d*/.test(name)) return false;
          
          // Reject block references
          if (/^block \d/.test(name) || name === 'block size' || name === 'block size limit') return false;
          
          // Reject percentages
          if (/^\d+\.?\d*%$/.test(name)) return false;
          
          // Reject bitcoin amounts (e.g., "25,000 BTC", "0.01 BTC")
          if (/\d+[,\d]*\s*(BTC|Bitcoin|LTC|ETH|mBTC)/i.test(name)) return false;
          
          // Reject "X million/billion" patterns (even without currency)
          if (/^\d+[,\d]*\s*(million|billion|thousand|trillion)/i.test(name)) return false;
          
          // Reject generic job titles and roles
          const genericJobTitles = [
            'lawmakers', 'lawmaker', 'minister', 'ministers', 'official', 'officials',
            'pensions minister', 'treasury secretary', 'secretary', 'regulator', 'regulators',
            'investor', 'investors', 'trader', 'traders', 'analyst', 'analysts',
            'ceo', 'cto', 'cfo', 'executive', 'executives', 'director', 'directors',
            'spokesperson', 'spokesman', 'spokeswoman', 'representative', 'representatives'
          ];
          if (genericJobTitles.includes(nameLower)) return false;
          
          // Reject generic government departments (unless they're specific named entities)
          const genericDepartments = [
            'treasury', 'ministry', 'department', 'agency', 'bureau', 'office',
            'government', 'administration', 'authority', 'commission'
          ];
          // Only reject if it's just the generic word without a specific name
          if (genericDepartments.includes(nameLower) && name.length < 20) {
            // Allow if it's a specific named entity (e.g., "U.S. Treasury", "HM Treasury")
            if (!/^(u\.?s\.?|uk|hm|united states|united kingdom)/i.test(name)) {
              return false;
            }
          }
          
          // Reject abstract concepts and processes (unless they're named protocols)
          const abstractConcepts = [
            'ring-fencing', 'ring fencing', 'regulation', 'regulations', 'adoption',
            'compliance', 'enforcement', 'oversight', 'supervision', 'governance',
            'policy', 'policies', 'framework', 'frameworks', 'initiative', 'initiatives',
            'reform', 'reforms', 'legislation', 'legislative', 'jurisdiction', 'jurisdictions'
          ];
          if (abstractConcepts.includes(nameLower)) return false;
          
          // Reject too-generic terms
          const tooGeneric = [
            'market cap', 'trading engines', 'market', 'markets', 'economy', 'economies',
            'cryptocurrency', 'cryptocurrencies', 'digital asset', 'digital assets',
            'blockchain', 'blockchains', 'technology', 'technologies'
          ];
          if (tooGeneric.includes(nameLower)) return false;
          
          // Reject too-specific malware/CVE identifiers
          if (/^CVE-\d+/.test(name) || nameLower.includes('infostealer')) return false;
          
          // Reject very short names (< 2 chars) unless they're well-known abbreviations
          const knownShort = ['eu', 'us', 'un', 'cz', 'ai', 'g7', 'g8', 'l2', 'r3', 'uk', 'imf', 'sec', 'fed'];
          if (name.length < 2 || (name.length === 2 && !knownShort.includes(nameLower))) return false;
          
          // Reject if it's just a number with a word (e.g., "100 million", "3 percent")
          if (/^\d+[,\d]*\s+\w+$/.test(name) && !/^(house bill|senate bill|act \d+|law \d+)/i.test(name)) {
            return false;
          }
          
          return true;
        });

        // Remove duplicates (case-insensitive)
        const uniqueTags = new Set<string>();
        for (const tag of tagNames) {
          const lowerTag = tag.toLowerCase();
          if (!uniqueTags.has(lowerTag)) {
            uniqueTags.add(lowerTag);
            // Keep the first occurrence's original casing
          }
        }
        
        // Convert back to array, preserving original casing
        const finalTags: string[] = [];
        const seen = new Set<string>();
        for (const tag of tagNames) {
          const lowerTag = tag.toLowerCase();
          if (!seen.has(lowerTag)) {
            seen.add(lowerTag);
            finalTags.push(tag);
          }
        }
        
        // If no tags found, return empty array (no special marker needed)
        return finalTags;
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
   * Extract tag names from multiple summaries in batch
   * @param summaries Array of summaries to process
   * @param onProgress Optional progress callback (current, total)
   * @returns Array of tag name arrays (one per summary)
   */
  async extractEntitiesBatch(
    summaries: string[],
    onProgress?: (current: number, total: number) => void
  ): Promise<string[][]> {
    const results: string[][] = [];

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
