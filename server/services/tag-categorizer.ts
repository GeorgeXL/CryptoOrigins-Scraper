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
TAXONOMY STRUCTURE (14 Main Categories):

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
   - 1.4 Bitcoin-Specific Services (wallets, lightning services, etc.)

2. 🔗 Blockchain Platforms (blockchain-platforms)
   - 2.1 Smart Contract Platforms
     - 2.1.1 Ethereum & EVM Chains
     - 2.1.2 Alternative Layer 1s
     - 2.1.3 Layer 2 Solutions
   - 2.2 Platform Tokens
   - 2.3 Consensus Mechanisms
   - 2.4 Interoperability & Bridges

3. 💰 Digital Assets & Tokens (digital-assets)
   - 3.1 Cryptocurrencies
     - 3.1.1 Payment Coins
     - 3.1.2 Privacy Coins
     - 3.1.3 Meme Coins
   - 3.2 Stablecoins
   - 3.3 DeFi Tokens
     - 3.3.1 DEX Tokens
     - 3.3.2 Lending Protocol Tokens
     - 3.3.3 Yield & Derivatives
   - 3.4 NFTs & Digital Collectibles
     - 3.4.1 NFT Standards
     - 3.4.2 Major Collections
     - 3.4.3 Digital Art & Metaverse Assets
   - 3.5 Gaming & Metaverse Tokens
   - 3.6 Governance Tokens

4. ⚡ Technology & Concepts (technology)
   - 4.1 Blockchain Core Concepts
     - 4.1.1 Cryptography & Security
     - 4.1.2 Distributed Systems
     - 4.1.3 Data Structures
   - 4.2 DeFi Concepts
     - 4.2.1 Automated Market Makers
     - 4.2.2 Lending & Borrowing
     - 4.2.3 Derivatives & Synthetic Assets
     - 4.2.4 Yield Farming & Staking
   - 4.3 Web3 & Decentralization
     - 4.3.1 Decentralized Storage
     - 4.3.2 Decentralized Identity
     - 4.3.3 DAOs & Governance
   - 4.4 Security & Privacy
     - 4.4.1 Cryptographic Techniques
     - 4.4.2 Privacy Technologies
     - 4.4.3 Security Best Practices
   - 4.5 Wallets & Key Management
   - 4.6 Technical Standards & Protocols

5. 🏢 Companies & Organizations (organizations)
   - 5.1 Exchanges
     - 5.1.1 Centralized Exchanges
     - 5.1.2 Decentralized Exchange Platforms
     - 5.1.3 Defunct Exchanges
   - 5.2 DeFi Protocols & Platforms
     - 5.2.1 Lending Platforms
     - 5.2.2 DEX Protocols
     - 5.2.3 Derivatives Platforms
   - 5.3 NFT & Gaming Platforms
     - 5.3.1 NFT Marketplaces
     - 5.3.2 Gaming Platforms
     - 5.3.3 Metaverse Projects
   - 5.4 Infrastructure & Services
     - 5.4.1 Payment Processors
     - 5.4.2 Custody Solutions
     - 5.4.3 Node & API Providers
     - 5.4.4 Oracles
     - 5.4.5 Stablecoin Issuers
   - 5.5 Mining & Hardware
     - 5.5.1 Public Mining Companies
     - 5.5.2 Hardware Manufacturers
     - 5.5.3 Mining Pools
   - 5.6 Financial Institutions
     - 5.6.1 Crypto-Native Financial Services
     - 5.6.2 Traditional Finance Integration
       - Investment Banks
       - Commercial Banks
       - Asset Managers
       - Stock Exchanges
     - 5.6.3 Corporate Bitcoin/Crypto Holders
   - 5.7 Technology Companies
     - 5.7.1 Big Tech & Crypto
     - 5.7.2 Social Media & Web3
     - 5.7.3 Fintech Companies
     - 5.7.4 E-commerce & Retail
   - 5.8 Development & Research
     - 5.8.1 Core Development Teams
     - 5.8.2 Research Organizations
     - 5.8.3 Venture Capital & Incubators
   - 5.9 Media & Analytics
     - 5.9.1 News & Media Outlets
     - 5.9.2 Analytics Platforms
     - 5.9.3 Data Providers
   - 5.10 Industry Associations & Advocacy

6. 👥 People (people)
   - 6.1 Founders & Developers
     - 6.1.1 Bitcoin Contributors
     - 6.1.2 Platform Founders
     - 6.1.3 Protocol Developers
   - 6.2 Business Leaders & Executives
   - 6.3 Investors & Traders
     - 6.3.1 Institutional Investors
     - 6.3.2 Retail Influencers
     - 6.3.3 Analysts & Researchers
   - 6.4 Government & Regulators
   - 6.5 Academics & Researchers
   - 6.6 Media & Influencers
   - 6.7 Controversial Figures

7. ⚖️ Regulation & Law (regulation-law)
   - 7.1 Regulatory Bodies
     - 7.1.1 US Regulators
     - 7.1.2 International Regulators
     - 7.1.3 Self-Regulatory Organizations
   - 7.2 Laws & Legal Frameworks
     - 7.2.1 Securities Law
     - 7.2.2 Tax Law
     - 7.2.3 AML/KYC Regulations
     - 7.2.4 Consumer Protection
   - 7.3 Government Initiatives
     - 7.3.1 CBDCs
     - 7.3.2 National Crypto Strategies
     - 7.3.3 Blockchain Adoption
   - 7.4 Legal Cases & Precedents

8. 🌍 Markets & Geography (markets-geography)
   - 8.1 Countries & Regions
     - 8.1.1 Crypto-Friendly Jurisdictions
     - 8.1.2 Major Markets
     - 8.1.3 Banned/Restricted Regions
   - 8.2 Cities & Crypto Hubs
   - 8.3 Special Economic Zones

9. 💵 Traditional Finance & Economics (traditional-finance)
   - 9.1 Fiat Currencies
   - 9.2 Central Banks
   - 9.3 Commodities & Traditional Assets
   - 9.4 Financial Instruments
     - 9.4.1 ETFs & Investment Products
     - 9.4.2 Futures & Options
     - 9.4.3 Derivatives
   - 9.5 Economic Concepts & Theory

10. 📊 Markets & Trading (markets-trading)
    - 10.1 Market Concepts
      - 10.1.1 Price Discovery
      - 10.1.2 Market Cycles
      - 10.1.3 Trading Strategies
    - 10.2 Market Events
      - 10.2.1 Bull Markets
      - 10.2.2 Bear Markets & Crashes
      - 10.2.3 Halvings & Major Events
    - 10.3 Market Data & Metrics

11. 🔒 Security & Crime (security-crime)
    - 11.1 Security Incidents
      - 11.1.1 Exchange Hacks
      - 11.1.2 Protocol Exploits
      - 11.1.3 Bridge Attacks
    - 11.2 Fraud & Scams
      - 11.2.1 Ponzi Schemes
      - 11.2.2 Rug Pulls
      - 11.2.3 ICO Scams
      - 11.2.4 Social Engineering
    - 11.3 Dark Web & Criminal Use
      - 11.3.1 Dark Markets
      - 11.3.2 Ransomware
      - 11.3.3 Money Laundering
    - 11.4 Law Enforcement & Investigations
    - 11.5 Security Tools & Practices

12. 🎓 Education & Community (education-community)
    - 12.1 Educational Resources
      - 12.1.1 Online Courses & Certifications
      - 12.1.2 Documentation & Wikis
      - 12.1.3 Books & Publications
    - 12.2 Community & Forums
      - 12.2.1 Social Platforms
      - 12.2.2 Developer Communities
      - 12.2.3 Regional Communities
    - 12.3 Events & Conferences
    - 12.4 Academic Research & Institutions

13. 📜 History & Culture (history-culture)
    - 13.1 Historical Milestones
      - 13.1.1 Pre-Bitcoin History
      - 13.1.2 Bitcoin Era (2009-2015)
      - 13.1.3 ICO Era (2016-2018)
      - 13.1.4 DeFi Summer (2020)
      - 13.1.5 NFT Boom (2021)
      - 13.1.6 Recent Developments
    - 13.2 Cultural Phenomena
      - 13.2.1 Memes & Culture
      - 13.2.2 Crypto Art & Expression
      - 13.2.3 Community Movements
    - 13.3 Philosophical & Social Aspects

14. 📝 Miscellaneous (miscellaneous)
    - 14.1 Uncategorized

INSTRUCTIONS:
- Choose the most specific subcategory that accurately describes the tag
- Use the exact category key (e.g., "bitcoin", "blockchain-platforms")
- Provide the full subcategory path as an array (e.g., ["2.1", "2.1.1"] for nested subcategories)
- If unsure, use "miscellaneous" with path ["14.1"]
- Be precise with subcategory keys - they must match the structure exactly
`;
}

/**
 * Categorize a single tag using AI
 */
export async function categorizeTag(tagName: string, existingCategory?: string): Promise<CategorizationResult> {
  const taxonomyStructure = getTaxonomyStructure();
  
  const prompt = `You are an expert at categorizing cryptocurrency and blockchain-related tags into a hierarchical taxonomy.

${taxonomyStructure}

Tag to categorize: "${tagName}"
${existingCategory ? `Current category: "${existingCategory}"` : ''}

Analyze this tag and determine:
1. The most appropriate main category (use the category key, e.g., "bitcoin", "blockchain-platforms")
2. The full subcategory path (array of subcategory keys, e.g., ["2.1", "2.1.1"] for nested subcategories)
3. Your confidence level (0.0 to 1.0)

CRITICAL RULES FOR CATEGORIZATION:

1. **Numbers and Currency Values:**
   - Tags that are pure numbers, currency amounts (e.g., "$902", "$7,450", "$60 billion", "$3,000"), or price values should be categorized as:
     * "markets-trading" with subcategory path ["10.3"] (Market Data & Metrics) if they represent market data, prices, or trading metrics
     * "miscellaneous" with subcategory path ["14.1"] if the value is unclear or doesn't fit market data
   - DO NOT categorize numbers or currency amounts as "technology" - they are NOT technology concepts

2. **Technology Category:**
   - The "technology" category (4. ⚡ Technology & Concepts) is ONLY for:
     * Technical concepts (cryptography, consensus mechanisms, protocols)
     * DeFi concepts (AMMs, lending, staking)
     * Web3 concepts (decentralized storage, DAOs)
     * Security/privacy technologies
     * Wallets and key management
     * Technical standards and protocols
   - Numbers, prices, amounts, or currency values are NEVER technology

3. **General Rules:**
   - Choose the most specific subcategory that accurately describes the tag
   - If the tag doesn't clearly fit any category, use "miscellaneous" with subcategory path ["14.1"]
   - Be precise with subcategory paths - they must match the taxonomy structure exactly
   - Confidence should reflect how certain you are about the categorization

4. **Examples:**
   - "$902" → "markets-trading" ["10.3"] (market data/metric)
   - "$60 billion" → "markets-trading" ["10.3"] (market data/metric)
   - "$3,000" → "markets-trading" ["10.3"] (likely a price)
   - "Lightning Network" → "technology" ["4.1.2"] (distributed systems)
   - "Proof of Stake" → "technology" ["4.1.2"] (consensus mechanism)
   - "Bitcoin" → "bitcoin" ["1.1"] (the currency)

Return ONLY a JSON object in this exact format:
{
  "category": "category-key",
  "subcategoryPath": ["subcategory-key-1", "subcategory-key-2"],
  "confidence": 0.95,
  "reasoning": "Brief explanation of why this categorization fits"
}`;

  // Log to API monitor
  const monitorId = apiMonitor.logRequest({
    service: 'openai',
    endpoint: '/chat/completions',
    method: 'POST',
    status: 'pending',
    context: 'tag-categorization',
    purpose: `Categorizing tag: "${tagName}"`,
    requestData: { 
      model: 'gpt-4o-mini',
      tagName,
      existingCategory 
    },
    tagName,
    tagCategory: existingCategory
  });

  try {
    const provider = aiService.getProvider('openai');
    
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
      systemPrompt: 'You are a precise categorization assistant. Always return valid JSON.',
      schema: categorizationSchema,
      temperature: 0.3, // Lower temperature for more consistent categorization
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
      subcategoryPath: ['14.1'],
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

