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

Extract ALL proper named entities including:
- Cryptocurrencies/tokens: Bitcoin, Ethereum, Solana, NFT, Dogecoin, etc.
- People: Elon Musk, Vitalik Buterin, Obama, Richard Cordray, Nick Clegg, etc.
- Companies & Services: Tesla, Coinbase, PayPal, Bitfinex, Blockchain.info, Digg, Alpari, ShapeShift, HSN, Playboy, etc.
- Exchanges & Platforms: Binance, Kraken, Bitfinex, Blockchain.info, Einstein Exchange, etc.
- Banks & Financial Institutions: Bank of America, Anglo Irish Bank, etc.
- Organizations & Agencies: SEC, IMF, Federal Reserve, NASA, BBC, Consumer Financial Protection Bureau, AFL-CIO, FINTRAC, G20, LHC, etc.
- Universities & Institutions: Northwestern University, MIT, etc.
- Countries/Regions: Venezuela, China, EU, UK, U.S., US, Sudan, Canada, Greece, Athens, etc.
- Cities: Athens, Pensacola, etc.
- Political Parties: Labour, Conservatives, Republicans, Democrats, etc.
- Government Officials: Extract by name (e.g., "Osborne", "Kohn", "Nick Clegg")
- Specific Laws/Protocols: MiCA, Taproot, SegWit2x, etc.
- Product Names: If proper nouns (e.g., "MT5")

CRITICAL RULES:
1. Extract the exact name as it appears (preserve capitalization)
2. Extract both full names AND acronyms if both appear (e.g., "BBC" and "British Broadcasting Corporation" if both mentioned)
3. Extract company names even if they're services/platforms (e.g., "Digg", "Blockchain.info", "Alpari", "ShapeShift", "HSN")
4. Extract exchange names (e.g., "Bitfinex", "Coinbase", "Einstein Exchange")
5. Extract news organizations (e.g., "BBC", "NASA", "The Economist") - include "The" if it's part of the name
6. Extract universities and institutions (e.g., "Northwestern University")
7. Extract banks by their full proper name (e.g., "Anglo Irish Bank")
8. Extract country abbreviations (e.g., "U.S.", "US", "UK", "EU")
9. Extract cities (e.g., "Athens", "Pensacola")
10. Extract political parties (e.g., "Labour", "Conservatives", "Republicans")
11. Extract government officials by their last name or full name (e.g., "Osborne", "Kohn", "Nick Clegg")
12. Extract organizations even if abbreviated (e.g., "AFL-CIO", "FINTRAC", "G20", "LHC")
13. Extract product names if they're proper nouns (e.g., "MT5", "Simplecoin")
14. Extract countries even if mentioned in possessive form (e.g., "Russia's" → extract "Russia")
14. Do NOT extract: generic job titles (lawmakers, ministers, officials, governors, regulators), generic departments without specific names (just "Treasury"), abstract concepts (regulation, compliance, adoption), amounts, percentages, version numbers, generic terms (cryptocurrency, blockchain, market)

Return as a JSON array of strings only: ["Entity1", "Entity2"]

Examples:
"Venezuela approves bitcoin" → ["Venezuela", "Bitcoin"]
"SEC sues Coinbase" → ["SEC", "Coinbase"]
"Elon Musk tweets about Dogecoin" → ["Elon Musk", "Dogecoin"]
"UK lawmakers debate crypto" → ["UK"]
"Obama cautions about economy" → ["Obama"]
"Bitfinex halts wire transfers" → ["Bitfinex"]
"Blockchain.info accounts hacked" → ["Blockchain.info"]
"NASA warns of solar storm" → ["NASA"]
"BBC News reports approval" → ["BBC"]
"Northwestern University researchers" → ["Northwestern University"]
"Anglo Irish Bank reveals loan" → ["Anglo Irish Bank"]
"Digg launches version 4" → ["Digg"]
"Republicans block Richard Cordray nomination" → ["Republicans", "Richard Cordray", "Consumer Financial Protection Bureau"]
"ShapeShift resumes operations" → ["ShapeShift"]
"Alpari introduces MT5" → ["Alpari", "MT5"]
"Playboy sues Canada crypto firm" → ["Playboy", "Canada"]
"Nick Clegg asserts election" → ["Nick Clegg"]
"Protesters clash in Athens" → ["Athens", "Greece"]
"G20 finance ministers agree" → ["G20"]
"U.S. government invites investors" → ["U.S."]
"AFL-CIO survey reveals" → ["AFL-CIO"]
"FINTRAC announces penalties" → ["FINTRAC"]
"The Economist highlights rise" → ["The Economist"]
"Russia's oligarchs decline" → ["Russia"]
"Simplecoin v5.0 framework" → ["Simplecoin"]`;

    try {
      const openai = aiService.getProvider('openai');
      const result = await openai.generateCompletion({
        prompt,
        systemPrompt: 'You are an expert at entity extraction. Extract ALL proper named entities including: people, companies, exchanges, services, platforms, banks, organizations, agencies, universities, countries, cryptocurrencies, and specific protocols/laws. Be thorough but precise - extract specific named entities, not generic terms. Always return valid JSON arrays only.',
        model: 'gpt-4o-mini',
        temperature: 0.15,
        context: 'entity-extraction',
        purpose: 'Extract entities from summary'
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
        // Throw the error so caller knows extraction failed (not just "no entities found")
        throw new Error(`Failed to parse OpenAI response: ${parseError instanceof Error ? parseError.message : 'Invalid JSON'}`);
      }
    } catch (error) {
      console.error('[EntityExtractor] Error extracting entities:', error);
      // Propagate error so caller can handle it appropriately
      throw error;
    }
  }

  /**
   * Extract tag names from a summary with full article context
   * @param summary The news summary to analyze
   * @param articleContent The full article content that the summary was generated from
   * @returns Array of tag names: ["Elon Musk", "Obama", "NFT", "Bitcoin"]
   */
  async extractEntitiesWithContext(summary: string, articleContent: string): Promise<string[]> {
    const prompt = `Extract all named entities from this news summary and its source article as a JSON array.

Summary: "${summary}"

Full Article Content:
"${articleContent}"

You have access to both the summary AND the full article content. Use the article content to extract entities that might not be fully mentioned in the summary but are important in the article.

Extract ALL proper named entities including:
- Cryptocurrencies/tokens: Bitcoin, Ethereum, Solana, NFT, Dogecoin, etc.
- People: Elon Musk, Vitalik Buterin, Obama, Richard Cordray, Nick Clegg, etc.
- Companies & Services: Tesla, Coinbase, PayPal, Bitfinex, Blockchain.info, Digg, Alpari, ShapeShift, HSN, Playboy, etc.
- Exchanges & Platforms: Binance, Kraken, Bitfinex, Blockchain.info, Einstein Exchange, etc.
- Banks & Financial Institutions: Bank of America, Anglo Irish Bank, etc.
- Organizations & Agencies: SEC, IMF, Federal Reserve, NASA, BBC, Consumer Financial Protection Bureau, AFL-CIO, FINTRAC, G20, LHC, etc.
- Universities & Institutions: Northwestern University, MIT, etc.
- Countries/Regions: Venezuela, China, EU, UK, U.S., US, Sudan, Canada, Greece, Athens, etc.
- Cities: Athens, Pensacola, etc.
- Political Parties: Labour, Conservatives, Republicans, Democrats, etc.
- Government Officials: Extract by name (e.g., "Osborne", "Kohn", "Nick Clegg")
- Specific Laws/Protocols: MiCA, Taproot, SegWit2x, etc.
- Product Names: If proper nouns (e.g., "MT5", "Simplecoin")

CRITICAL RULES:
1. Extract the exact name as it appears (preserve capitalization)
2. Extract both full names AND acronyms if both appear (e.g., "BBC" and "British Broadcasting Corporation" if both mentioned)
3. Extract company names even if they're services/platforms (e.g., "Digg", "Blockchain.info", "Alpari", "ShapeShift", "HSN")
4. Extract exchange names (e.g., "Bitfinex", "Coinbase", "Einstein Exchange")
5. Extract news organizations (e.g., "BBC", "NASA", "The Economist") - include "The" if it's part of the name
6. Extract universities and institutions (e.g., "Northwestern University")
7. Extract banks by their full proper name (e.g., "Anglo Irish Bank")
8. Extract country abbreviations (e.g., "U.S.", "US", "UK", "EU")
9. Extract cities (e.g., "Athens", "Pensacola")
10. Extract political parties (e.g., "Labour", "Conservatives", "Republicans")
11. Extract government officials by their last name or full name (e.g., "Osborne", "Kohn", "Nick Clegg")
12. Extract organizations even if abbreviated (e.g., "AFL-CIO", "FINTRAC", "G20", "LHC")
13. Extract product names if they're proper nouns (e.g., "MT5", "Simplecoin")
14. Extract countries even if mentioned in possessive form (e.g., "Russia's" → extract "Russia")
15. Use the full article content to find entities that may be mentioned there but not explicitly in the summary
16. Do NOT extract: generic job titles (lawmakers, ministers, officials, governors, regulators), generic departments without specific names (just "Treasury"), abstract concepts (regulation, compliance, adoption), amounts, percentages, version numbers, generic terms (cryptocurrency, blockchain, market)

Return as a JSON array of strings only: ["Entity1", "Entity2"]

Examples:
"Venezuela approves bitcoin" → ["Venezuela", "Bitcoin"]
"SEC sues Coinbase" → ["SEC", "Coinbase"]
"Elon Musk tweets about Dogecoin" → ["Elon Musk", "Dogecoin"]
"UK lawmakers debate crypto" → ["UK"]
"Obama cautions about economy" → ["Obama"]
"Bitfinex halts wire transfers" → ["Bitfinex"]
"Blockchain.info accounts hacked" → ["Blockchain.info"]
"NASA warns of solar storm" → ["NASA"]
"BBC News reports approval" → ["BBC"]
"Northwestern University researchers" → ["Northwestern University"]
"Anglo Irish Bank reveals loan" → ["Anglo Irish Bank"]
"Digg launches version 4" → ["Digg"]
"Republicans block Richard Cordray nomination" → ["Republicans", "Richard Cordray", "Consumer Financial Protection Bureau"]
"ShapeShift resumes operations" → ["ShapeShift"]
"Alpari introduces MT5" → ["Alpari", "MT5"]
"Playboy sues Canada crypto firm" → ["Playboy", "Canada"]
"Nick Clegg asserts election" → ["Nick Clegg"]
"Protesters clash in Athens" → ["Athens", "Greece"]
"G20 finance ministers agree" → ["G20"]
"U.S. government invites investors" → ["U.S."]
"AFL-CIO survey reveals" → ["AFL-CIO"]
"FINTRAC announces penalties" → ["FINTRAC"]
"The Economist highlights rise" → ["The Economist"]
"Russia's oligarchs decline" → ["Russia"]
"Simplecoin v5.0 framework" → ["Simplecoin"]`;

    try {
      const openai = aiService.getProvider('openai');
      const result = await openai.generateCompletion({
        prompt,
        systemPrompt: 'You are an expert at entity extraction. Extract ALL proper named entities including: people, companies, exchanges, services, platforms, banks, organizations, agencies, universities, countries, cryptocurrencies, and specific protocols/laws. Use the full article content to find entities that may not be explicitly mentioned in the summary. Be thorough but precise - extract specific named entities, not generic terms. Always return valid JSON arrays only.',
        model: 'gpt-4o-mini',
        temperature: 0.15,
        context: 'entity-extraction-with-context',
        purpose: 'Extract entities from summary with article context'
      });

      let tagNames: string[] = [];
      
      try {
        // Clean the response text - OpenAI sometimes returns markdown code blocks
        let cleanedText = result.text.trim();
        
        // Remove markdown code blocks (```json ... ``` or ``` ... ```)
        if (cleanedText.startsWith('```')) {
          const closingIndex = cleanedText.indexOf('```', 3);
          if (closingIndex > 0) {
            cleanedText = cleanedText.substring(3, closingIndex).trim();
            if (cleanedText.toLowerCase().startsWith('json')) {
              cleanedText = cleanedText.substring(4).trim();
            }
          } else {
            cleanedText = cleanedText.substring(3).trim();
            if (cleanedText.toLowerCase().startsWith('json')) {
              cleanedText = cleanedText.substring(4).trim();
            }
          }
        }
        
        const parsed = JSON.parse(cleanedText);
        
        // Handle different response formats
        if (Array.isArray(parsed)) {
          if (parsed.length > 0 && typeof parsed[0] === 'string') {
            tagNames = parsed;
          } else if (parsed.length > 0 && typeof parsed[0] === 'object') {
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

        // Validate and clean tag names (same as extractEntities)
        tagNames = tagNames
          .filter((name: any) => typeof name === 'string' && name.trim().length > 0)
          .map((name: string) => name.trim());

        // Apply same filtering logic as extractEntities
        tagNames = tagNames.filter((name: string) => {
          const nameLower = name.toLowerCase();
          
          if (/^\d+$/.test(name)) return false;
          if (/^\$[\d,]+/.test(name)) return false;
          if (/\d+[,\d]*\s*(million|billion|thousand|trillion)\s*(dollars?|usd|eur|gbp|yen)/i.test(name)) return false;
          if (/\d+[,\d]*\s*(dollars?|usd|eur|gbp|yen)/i.test(name)) return false;
          if (/^\d+\.\d+\.?\d*/.test(name)) return false;
          if (/^block \d/.test(name) || name === 'block size' || name === 'block size limit') return false;
          if (/^\d+\.?\d*%$/.test(name)) return false;
          if (/\d+[,\d]*\s*(BTC|Bitcoin|LTC|ETH|mBTC)/i.test(name)) return false;
          if (/^\d+[,\d]*\s*(million|billion|thousand|trillion)/i.test(name)) return false;
          
          const genericJobTitles = [
            'lawmakers', 'lawmaker', 'minister', 'ministers', 'official', 'officials',
            'pensions minister', 'treasury secretary', 'secretary', 'regulator', 'regulators',
            'investor', 'investors', 'trader', 'traders', 'analyst', 'analysts',
            'ceo', 'cto', 'cfo', 'executive', 'executives', 'director', 'directors',
            'spokesperson', 'spokesman', 'spokeswoman', 'representative', 'representatives'
          ];
          if (genericJobTitles.includes(nameLower)) return false;
          
          const genericDepartments = [
            'treasury', 'ministry', 'department', 'agency', 'bureau', 'office',
            'government', 'administration', 'authority', 'commission'
          ];
          if (genericDepartments.includes(nameLower) && name.length < 20) {
            if (!/^(u\.?s\.?|uk|hm|united states|united kingdom)/i.test(name)) {
              return false;
            }
          }
          
          const abstractConcepts = [
            'ring-fencing', 'ring fencing', 'regulation', 'regulations', 'adoption',
            'compliance', 'enforcement', 'oversight', 'supervision', 'governance',
            'policy', 'policies', 'framework', 'frameworks', 'initiative', 'initiatives',
            'reform', 'reforms', 'legislation', 'legislative', 'jurisdiction', 'jurisdictions'
          ];
          if (abstractConcepts.includes(nameLower)) return false;
          
          const tooGeneric = [
            'market cap', 'trading engines', 'market', 'markets', 'economy', 'economies',
            'cryptocurrency', 'cryptocurrencies', 'digital asset', 'digital assets',
            'blockchain', 'blockchains', 'technology', 'technologies'
          ];
          if (tooGeneric.includes(nameLower)) return false;
          
          if (/^CVE-\d+/.test(name) || nameLower.includes('infostealer')) return false;
          
          const knownShort = ['eu', 'us', 'un', 'cz', 'ai', 'g7', 'g8', 'l2', 'r3', 'uk', 'imf', 'sec', 'fed'];
          if (name.length < 2 || (name.length === 2 && !knownShort.includes(nameLower))) return false;
          
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
          }
        }
        
        const finalTags: string[] = [];
        const seen = new Set<string>();
        for (const tag of tagNames) {
          const lowerTag = tag.toLowerCase();
          if (!seen.has(lowerTag)) {
            seen.add(lowerTag);
            finalTags.push(tag);
          }
        }
        
        return finalTags;
      } catch (parseError) {
        console.error('[EntityExtractor] Failed to parse OpenAI response:', result);
        throw new Error(`Failed to parse OpenAI response: ${parseError instanceof Error ? parseError.message : 'Invalid JSON'}`);
      }
    } catch (error) {
      console.error('[EntityExtractor] Error extracting entities with context:', error);
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
