/**
 * AI-powered tag categorization service
 * Uses OpenAI to categorize tags into the new taxonomy structure
 */

import { aiService } from './ai';
import type { EntityTag } from '@shared/schema';
import { z } from 'zod';
import { apiMonitor } from './api-monitor';

export interface CategorizationResult {
  category: string;
  subcategoryPath: string[]; // e.g., ["2.1", "2.1.1"] for nested subcategories
  confidence: number;
  reasoning?: string;
}

/**
 * Get the taxonomy structure as a formatted string for the AI prompt
 * This will be used to help OpenAI understand the categorization structure
 */
function getTaxonomyStructure(): string {
  return `
TAXONOMY STRUCTURE (11 Main Categories):

1. 🪙 Bitcoin (bitcoin)
   - 1.1 Bitcoin (BTC) - The Currency
   - 1.2 Bitcoin Technology
     - 1.2.1 Core Implementations
     - 1.2.2 Major Upgrades
     - 1.2.3 Bitcoin Improvement Proposals (BIPs)
     - 1.2.4 Transaction Features
     - 1.2.5 Layer 2 & Scaling
     - 1.2.6 Mining & Consensus
   - 1.3 Bitcoin Forks
   - 1.4 Bitcoin Companies & Services

2. 💰 Money & Economics (money-economics)
   - 2.1 Other Cryptocurrencies (altcoins, payment coins, privacy coins, meme coins)
   - 2.2 Stablecoins (USDT, USDC, DAI, etc.)
   - 2.3 DeFi Tokens (Uniswap, Aave, Compound, etc.)
   - 2.4 Metaverse & Gaming (NFT projects, gaming tokens)
   - 2.5 Fiat Currencies (USD, EUR, CNY, etc.)
   - 2.6 Commodities (Gold, oil, etc.)
   - 2.7 Central Banks (Federal Reserve, ECB, etc.)
   - 2.8 Prices & Values

3. ⚡ Technology Concepts (technology)
   - 3.1 Blockchain & Core Concepts
   - 3.2 DeFi & Web3 Concepts
   - 3.3 Security & Privacy
   - 3.4 Wallets & Storage
   - 3.5 Technical Standards

4. 🏢 Organizations & Companies (organizations)
   - 4.1 Exchanges
     - 4.1.1 Major Centralized Exchanges
     - 4.1.2 Decentralized Exchanges (DEX)
     - 4.1.3 Defunct Exchanges
   - 4.2 Financial Institutions
     - 4.2.1 Investment Banks
     - 4.2.2 Commercial Banks
     - 4.2.3 Asset Managers
     - 4.2.4 Stock Exchanges
   - 4.3 Mining Operations
     - 4.3.1 Public Mining Companies
     - 4.3.2 Mining Hardware Manufacturers
     - 4.3.3 Mining Pools
   - 4.4 Payment & Infrastructure
     - 4.4.1 Payment Processors
     - 4.4.2 Custody & Wallets
     - 4.4.3 Blockchain Infrastructure
     - 4.4.4 Stablecoin Issuers
   - 4.5 DeFi Platforms
   - 4.6 NFT Marketplaces
   - 4.7 Technology Companies
     - 4.7.1 Big Tech
     - 4.7.2 Social Media & Communication
     - 4.7.3 Fintech & Payments
     - 4.7.4 E-commerce & Retail
     - 4.7.5 Corporate Bitcoin Holders
   - 4.8 Media & Analytics
   - 4.9 Development & Research
   - 4.10 Other Organizations

5. 👥 People (people)
   - 5.1 Crypto & Tech Figures
   - 5.2 Government Officials
   - 5.3 Investors & Analysts
   - 5.4 Controversial & Famous Figures

6. ⚖️ Regulation & Government (regulation-law)
   - 6.1 Regulatory Bodies
   - 6.2 Laws & Frameworks
   - 6.3 Government Initiatives

7. 🌍 Geography & Markets (markets-geography)
   - 7.1 Countries & Regions
   - 7.2 Cities & Special Locations

8. 🎓 Education & Community (education-community)
   - 8.1 Development Organizations
   - 8.2 Community Forums & Platforms
   - 8.3 Research & Academia

9. 🔒 Crime & Security (crime-security)
   - 9.1 Dark Web & Criminal Marketplaces
   - 9.2 Major Crimes & Scams
     - 9.2.1 Ponzi Schemes
     - 9.2.2 Major Hacks
     - 9.2.3 Fraud Cases
   - 9.3 Law Enforcement Actions
   - 9.4 Security Concepts

10. 🏷️ Topics & Themes (topics)
    - 10.1 Market Topics
      - 10.1.1 Price & Valuation
      - 10.1.2 Market Cycles
      - 10.1.3 Trading Activity
    - 10.2 Regulatory Topics
    - 10.3 Adoption & Integration
      - 10.3.1 Institutional Adoption
      - 10.3.2 Retail Adoption
      - 10.3.3 Government Adoption
    - 10.4 Technology Topics
    - 10.5 Mining Topics
    - 10.6 Macroeconomic Topics

11. 📝 Miscellaneous (miscellaneous)
    - 11.1 Uncategorized

IMPORTANT CATEGORIZATION GUIDELINES:

**People:**
- Government officials, politicians → people (5.2)
- CEOs, tech founders, crypto figures → people (5.1 or 5.3)
- Always categorize PEOPLE as "people" category, NOT as organizations or geography!

**Organizations & Companies:**
- Exchanges (Binance, Coinbase) → organizations (4.1)
- Banks, investment firms (JPMorgan, Goldman Sachs, Berkshire Hathaway) → organizations (4.2)
- Payment companies (PayPal, Visa) → organizations (4.4.1)
- Tech companies (Apple, Microsoft, Amazon) → organizations (4.7)
- Media companies (HBO, CNN) → organizations (4.8)
- Sports teams (Liverpool, NFL) → organizations (4.10)

**Cryptocurrencies & Tokens:**
- Ethereum, Litecoin, Ripple, Cardano, etc. → money-economics (2.1)
- Stablecoins (USDT, USDC, DAI) → money-economics (2.2)
- DeFi tokens (UNI, AAVE, COMP) → money-economics (2.3)
- NFT projects, gaming tokens → money-economics (2.4)

**Technology & Standards:**
- Technical standards (BEP-2, ERC-20, SegWit) → technology (3.5)
- DeFi concepts (liquidity pools, AMMs) → technology (3.2)
- Blockchain concepts → technology (3.1)

**Geography:**
- Countries, regions, cities → markets-geography (7.1 or 7.2)
- NOT for people or organizations!

**Topics (themes, not entities):**
- "Bitcoin Price", "Regulation", "Adoption" → topics (10.x)

CRITICAL RULES:
1. The category key is "markets-geography" (NOT "geography-markets")
2. People names → people category (5.x)
3. Company names → organizations category (4.x)
4. Technical terms → technology category (3.x)
5. Countries/cities → markets-geography category (7.x)

INSTRUCTIONS:
- Choose the most specific subcategory that accurately describes the tag
- Use the EXACT category key: "markets-geography" (never "geography-markets")
- Provide the full subcategory path as an array (e.g., ["2.1"] or ["4.2", "4.2.1"])
- The path should ONLY contain subcategories within ONE main category
- Never mix paths from different categories (e.g., ["1.2.6", "4.3.2"] is INVALID)
- If unsure, use "miscellaneous" with path ["11.1"]
- Be precise with subcategory keys - they must match the structure exactly
`;
}

/**
 * Categorize a single tag using AI (without context - for backward compatibility)
 * Uses Gemini by default
 */
export async function categorizeTag(tagName: string, existingCategory?: string): Promise<CategorizationResult> {
  return categorizeTagWithContext(tagName, [], existingCategory, 'gemini');
}

/**
 * Categorize a single tag using AI with context from summaries
 */
export async function categorizeTagWithContext(
  tagName: string,
  summaries: string[],
  existingCategory?: string,
  providerName: 'openai' | 'gemini' = 'gemini'
): Promise<CategorizationResult> {
  const taxonomyStructure = getTaxonomyStructure();
  
  // Use up to 3 summaries for context (to avoid token limits)
  const contextSummaries = summaries.slice(0, 3);
  const contextText = contextSummaries
    .map((summary, idx) => `Summary ${idx + 1}:\n${summary}`)
    .join('\n\n---\n\n');
  
  const contextSection = summaries.length > 0 
    ? `\n\nCONTEXT - Here are news summaries where this tag appears:\n${contextText}\n\nUse the context above to understand how this tag is being used in the news summaries. This will help you categorize it accurately.`
    : '';
  
  const prompt = `You are an expert at categorizing cryptocurrency and blockchain-related tags into a hierarchical taxonomy.

${taxonomyStructure}

Tag to categorize: "${tagName}"
${existingCategory ? `Current category: "${existingCategory}"` : ''}${contextSection}

Analyze this tag and determine:
1. The most appropriate main category (use the category key, e.g., "bitcoin", "blockchain-platforms")
2. The full subcategory path (array of subcategory keys, e.g., ["2.1", "2.1.1"] for nested subcategories)
3. Your confidence level (0.0 to 1.0)

CRITICAL RULES FOR CATEGORIZATION:

1. **Category Keys - USE EXACT KEYS:**
   - markets-geography (✅ CORRECT - for countries, cities, regions)
   - NEVER use "geography-markets" (❌ WRONG)
   - Use only these 11 exact category keys: bitcoin, money-economics, technology, organizations, people, regulation-law, markets-geography, education-community, crime-security, topics, miscellaneous

2. **People vs Organizations:**
   - PEOPLE (names of individuals) → people (5.x)
     * Examples: "Bernanke", "Satoshi Nakamoto", "Elon Musk", "Janet Yellen"
   - ORGANIZATIONS (companies, institutions) → organizations (4.x)
     * Examples: "Amazon", "Berkshire Hathaway", "Federal Reserve", "JPMorgan"
   - Never categorize people as organizations or geography!

3. **Technology & Standards:**
   - Technical standards (BEP-2, ERC-20, SegWit, BIP) → technology (3.5)
   - Blockchain concepts → technology (3.1)
   - DeFi concepts → technology (3.2)
   - NOT for numbers or currency amounts

4. **Numbers and Currency Values:**
   - Pure numbers or currency amounts (e.g., "$902", "$60 billion") → topics (10.1.1) for price-related
   - Or miscellaneous (11.1) if unclear

5. **Subcategory Paths:**
   - Paths must be within ONE category only
   - VALID: ["4.2", "4.2.3"] (within organizations)
   - INVALID: ["1.2.6", "4.3.2"] (mixing bitcoin and organizations)
   - If unsure, use just the top-level subcategory (e.g., ["4.2"] not ["4.2", "4.2.3"])

6. **Examples:**
   - "BEP-2" → "technology" ["3.5"] (technical standard)
   - "Berkshire Hathaway" → "organizations" ["4.2", "4.2.3"] (asset manager)
   - "Bernanke" → "people" ["5.2"] (government official)
   - "United States" → "markets-geography" ["7.1"] (country)
   - "Lightning Network" → "technology" ["3.1"] (blockchain concept)
   - "Bitcoin" → "bitcoin" ["1.1"] (the currency)

Return ONLY a JSON object in this exact format:
{
  "category": "category-key",
  "subcategoryPath": ["subcategory-key-1", "subcategory-key-2"],
  "confidence": 0.95,
  "reasoning": "Brief explanation of why this categorization fits"
}`;

  // Determine model name based on provider
  const modelName = providerName === 'gemini' ? 'gemini-2.0-flash' : 'gpt-4o-mini';
  const endpoint = providerName === 'gemini' ? '/models/generateContent' : '/chat/completions';
  
  // Log to API monitor
  const monitorId = apiMonitor.logRequest({
    service: providerName,
    endpoint,
    method: 'POST',
    status: 'pending',
    context: 'tag-categorization',
    purpose: `Categorizing tag: "${tagName}"`,
    requestData: { 
      model: modelName,
      tagName,
      existingCategory,
      hasContext: summaries.length > 0
    },
    tagName,
    tagCategory: existingCategory
  });

  try {
    const provider = aiService.getProvider(providerName);
    
    // Define Zod schema for validation
    const categorizationSchema = z.object({
      category: z.string(),
      subcategoryPath: z.array(z.string()),
      confidence: z.number().min(0).max(1),
      reasoning: z.string().optional(),
    });

    const startTime = Date.now();
    const result = await provider.generateJson<CategorizationResult>({
      prompt,
      systemPrompt: 'You are a precise categorization assistant. Always return valid JSON. CRITICAL: Use "markets-geography" NOT "geography-markets". Categorize people as "people", organizations as "organizations", technical standards as "technology".',
      schema: categorizationSchema,
      temperature: 0.3, // Lower temperature for more consistent categorization
      monitorId, // Pass existing monitor ID so provider updates instead of creating new
      context: 'tag-categorization',
      purpose: `Categorizing tag: "${tagName}"`
    });

    const duration = Date.now() - startTime;

    // Validate the result
    if (!result.category || !Array.isArray(result.subcategoryPath)) {
      throw new Error('Invalid categorization result structure');
    }

    // Ensure confidence is within bounds
    result.confidence = Math.max(0, Math.min(1, result.confidence || 0.5));

    // Update API monitor with result
    apiMonitor.updateRequest(monitorId, {
      status: 'success',
      duration,
      tagCategory: result.category,
      tagSubcategoryPath: result.subcategoryPath,
      tagConfidence: result.confidence,
      tagReasoning: result.reasoning,
      responseSize: result.subcategoryPath.length
    });

    return result;
  } catch (error) {
    console.error(`Error categorizing tag "${tagName}":`, error);
    
    // Fallback to miscellaneous if categorization fails
    const fallbackResult = {
      category: 'miscellaneous',
      subcategoryPath: ['11.1'],
      confidence: 0.1,
      reasoning: `Categorization failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
    
    // Update monitor with error and fallback result
    apiMonitor.updateRequest(monitorId, {
      status: 'error',
      error: error instanceof Error ? error.message : 'Unknown error',
      errorCategory: 'other',
      tagCategory: fallbackResult.category,
      tagSubcategoryPath: fallbackResult.subcategoryPath,
      tagConfidence: fallbackResult.confidence,
      tagReasoning: fallbackResult.reasoning
    });
    
    return fallbackResult;
  }
}

/**
 * Batch categorize multiple tags
 * Returns a map of tagName -> CategorizationResult
 */
export async function categorizeTags(
  tags: Array<{ name: string; category?: string }>,
  onProgress?: (processed: number, total: number, currentTag: string) => void
): Promise<Map<string, CategorizationResult>> {
  const results = new Map<string, CategorizationResult>();
  const total = tags.length;

  for (let i = 0; i < tags.length; i++) {
    const tag = tags[i];
    
    if (onProgress) {
      onProgress(i + 1, total, tag.name);
    }

    try {
      const result = await categorizeTag(tag.name, tag.category);
      results.set(tag.name, result);
      
      // Rate limiting: wait 1-2 seconds between requests
      if (i < tags.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1500));
      }
    } catch (error) {
      console.error(`Failed to categorize tag "${tag.name}":`, error);
      // Add fallback result
      results.set(tag.name, {
        category: 'miscellaneous',
        subcategoryPath: ['14.1'],
        confidence: 0.1,
        reasoning: `Categorization failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      });
    }
  }

  return results;
}

/**
 * Fix subcategory path for a tag that already has the correct category
 * This is used when category is correct but path is wrong (e.g., category="people" but path=["14.1"])
 */
export async function fixSubcategoryPath(
  tagName: string,
  lockedCategory: string,
  currentPath: string[],
  providerName: 'openai' | 'gemini' = 'gemini'
): Promise<string[]> {
  const taxonomyStructure = getTaxonomyStructure();
  
  // Get the category number from the category key
  const categoryToNumber: Record<string, string> = {
    "bitcoin": "1",
    "money-economics": "2",
    "technology": "3",
    "organizations": "4",
    "people": "5",
    "regulation-law": "6",
    "markets-geography": "7",
    "education-community": "8",
    "crime-security": "9",
    "topics": "10",
    "miscellaneous": "11",
  };
  
  const categoryNumber = categoryToNumber[lockedCategory] || "14";
  
  const prompt = `You are an expert at categorizing cryptocurrency and blockchain-related tags into a hierarchical taxonomy.

${taxonomyStructure}

Tag to categorize: "${tagName}"
IMPORTANT: This tag is ALREADY correctly categorized in the "${lockedCategory}" category (Category ${categoryNumber}).
Your task is ONLY to determine the correct subcategory path WITHIN this category.

CRITICAL RULES:
1. The category is LOCKED to "${lockedCategory}" - DO NOT change it
2. The subcategory path MUST start with "${categoryNumber}." (e.g., ["${categoryNumber}.1"] or ["${categoryNumber}.1", "${categoryNumber}.1.1"])
3. Choose the most specific subcategory that accurately describes the tag
4. If unsure, use the most general subcategory for this category (e.g., "${categoryNumber}.1" if it exists)
5. Be precise with subcategory keys - they must match the taxonomy structure exactly

Return ONLY a JSON object in this exact format:
{
  "subcategoryPath": ["${categoryNumber}.X", "${categoryNumber}.X.Y"],
  "confidence": 0.95,
  "reasoning": "Brief explanation of why this subcategory path fits"
}`;

  const modelName = providerName === 'gemini' ? 'gemini-2.0-flash' : 'gpt-4o-mini';
  const endpoint = providerName === 'gemini' ? '/models/generateContent' : '/chat/completions';
  
  const monitorId = apiMonitor.logRequest({
    service: providerName,
    endpoint,
    method: 'POST',
    status: 'pending',
    context: 'tag-path-fix',
    purpose: `Fixing path for tag: "${tagName}" in category "${lockedCategory}"`,
    requestData: { 
      model: modelName,
      tagName,
      lockedCategory 
    },
    tagName,
    tagCategory: lockedCategory
  });

  try {
    const provider = aiService.getProvider(providerName);
    
    const pathFixSchema = z.object({
      subcategoryPath: z.array(z.string()),
      confidence: z.number().min(0).max(1),
      reasoning: z.string().optional(),
    });

    const startTime = Date.now();
    const result = await provider.generateJson<{ subcategoryPath: string[]; confidence: number; reasoning?: string }>({
      prompt,
      systemPrompt: 'You are a precise categorization assistant. Always return valid JSON. The category is locked - only fix the path.',
      schema: pathFixSchema,
      temperature: 0.3,
    });

    const duration = Date.now() - startTime;

    // Validate the path starts with the correct category number
    if (!result.subcategoryPath || result.subcategoryPath.length === 0) {
      throw new Error('Invalid path result');
    }

    const firstPathSegment = result.subcategoryPath[0];
    if (!firstPathSegment.startsWith(categoryNumber + '.')) {
      console.warn(`⚠️  Path "${result.subcategoryPath.join(' > ')}" doesn't start with "${categoryNumber}." for category "${lockedCategory}". Using fallback.`);
      // Fallback to most general subcategory
      return [`${categoryNumber}.1`];
    }

    apiMonitor.updateRequest(monitorId, {
      status: 'success',
      duration,
      tagSubcategoryPath: result.subcategoryPath,
      tagConfidence: result.confidence,
      tagReasoning: result.reasoning,
    });

    return result.subcategoryPath;
  } catch (error) {
    console.error(`Error fixing path for tag "${tagName}":`, error);
    
    // Fallback to most general subcategory for the category
    const fallbackPath = [`${categoryNumber}.1`];
    
    apiMonitor.updateRequest(monitorId, {
      status: 'error',
      error: error instanceof Error ? error.message : 'Unknown error',
      errorCategory: 'other',
      tagSubcategoryPath: fallbackPath,
    });
    
    return fallbackPath;
  }
}

