import { Router } from "express";

import { storage } from "../storage";
import { newsAnalyzer } from "../services/news-analyzer";
import { exaService } from "../services/exa";
import { type ArticleData } from "@shared/schema";
import { periodDetector } from "../services/period-detector";
import { hierarchicalSearch } from "../services/hierarchical-search";
import { insertHistoricalNewsAnalysisSchema, insertManualNewsEntrySchema, insertEventBatchSchema, insertBatchEventSchema, type InsertHistoricalNewsAnalysis, type HistoricalNewsAnalysis, type EventBatch, type BatchEvent } from "@shared/schema";

import { cacheManager } from "../services/cache-manager";

import { healthMonitor } from "../services/health-monitor";
import { createErrorResponse } from "../utils/error-handler";
import { apiMonitor } from "../services/api-monitor";
import { qualityChecker } from "../services/quality-checker";
import { batchProcessor } from "../services/batch-processor";
import { conflictClusterer } from "../services/conflict-clusterer";
import { perplexityCleaner } from "../services/perplexity-cleaner";
import { entityExtractor } from "../services/entity-extractor";
import { sql } from "drizzle-orm";
import { aiService } from "../services/ai";
import { duplicateDetector } from "../services/duplicate-detector";

const router = Router();

router.post("/api/manual-entries", async (req, res) => {
  try {
    const validatedData = insertManualNewsEntrySchema.parse(req.body);
    
    // Check if a manual entry already exists for this date
    const existingEntries = await storage.getManualEntriesByDate(validatedData.date);
    if (existingEntries.length > 0) {
      return res.status(409).json({ error: "Manual entry already exists for this date" });
    }
    
    const entry = await storage.createManualEntry(validatedData);
    res.json(entry);
  } catch (error) {
    if ((error as any).name === 'ZodError') {
      return res.status(400).json({ error: "Invalid input data", details: (error as any).errors });
    }
    // Check for unique constraint violation
    if ((error as any).code === '23505' || (error as any).message?.includes('unique constraint')) {
      return res.status(409).json({ error: "Manual entry already exists for this date" });
    }
    res.status(500).json({ error: (error as Error).message });
  }
});

router.get("/api/manual-entries/date/:date", async (req, res) => {
  try {
    const { date } = req.params;
    
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: "Invalid date format. Use YYYY-MM-DD" });
    }

    const entries = await storage.getManualEntriesByDate(date);
    res.json(entries);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.get("/api/manual-entries/all", async (req, res) => {
  try {
    const entries = await storage.getAllManualEntries();
    res.json(entries);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.put("/api/manual-entries/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;
    
    const entry = await storage.updateManualEntry(id, updateData);
    res.json(entry);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.delete("/api/manual-entries/:id", async (req, res) => {
  try {
    const { id } = req.params;
    await storage.deleteManualEntry(id);
    res.json({ message: "Manual entry deleted successfully" });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.post("/api/conflicts/test-date/:date", async (req, res) => {
  try {
    const date = req.params.date;
    
    console.log(`🔍 Testing duplicate detection for ${date}...`);

    // Analyze this date
    const similarDates = await duplicateDetector.analyzeDate(date);

    res.json({ 
      success: true,
      date,
      similarDates,
      count: similarDates.length
    });
  } catch (error) {
    console.error("❌ Error testing date:", error);
    res.status(500).json({ error: (error as Error).message });
  }
});

router.post("/api/conflicts/analyze-year/:year", async (req, res) => {
  try {
    const year = parseInt(req.params.year);
    
    if (isNaN(year) || year < 2008 || year > 2030) {
      return res.status(400).json({ error: "Invalid year" });
    }

    console.log(`🧹 Starting duplicate analysis for year ${year}...`);

    // Wait for analysis to complete
    await duplicateDetector.analyzeYear(year, (completed: number, total: number, currentDate: string) => {
      console.log(`📊 Progress: ${completed}/${total} - Currently analyzing ${currentDate}`);
    });

    console.log(`✅ Completed duplicate analysis for year ${year}`);

    // Automatically assign cluster IDs to all conflicts
    console.log(`🔗 Assigning cluster IDs...`);
    const clusterResult = await conflictClusterer.assignClusterIds();
    console.log(`✅ Assigned ${clusterResult.conflictsUpdated} conflicts to ${clusterResult.clustersFound} clusters`);

    res.json({ 
      success: true, 
      message: `Completed duplicate analysis for year ${year}`,
      clusters: clusterResult.clustersFound,
      conflictsUpdated: clusterResult.conflictsUpdated
    });
  } catch (error) {
    console.error("❌ Error in duplicate analysis:", error);
    res.status(500).json({ error: (error as Error).message });
  }
});

router.post("/api/conflicts/analyze-month/:year/:month", async (req, res) => {
  try {
    const year = parseInt(req.params.year);
    const month = parseInt(req.params.month);
    
    if (isNaN(year) || year < 2008 || year > 2030) {
      return res.status(400).json({ error: "Invalid year" });
    }
    
    if (isNaN(month) || month < 1 || month > 12) {
      return res.status(400).json({ error: "Invalid month" });
    }

    console.log(`🧹 Starting duplicate analysis for ${year}-${month.toString().padStart(2, '0')}...`);

    // Calculate date range for the month
    const startDate = `${year}-${month.toString().padStart(2, '0')}-01`;
    const lastDay = new Date(year, month, 0).getDate(); // Get last day of month
    const endDate = `${year}-${month.toString().padStart(2, '0')}-${lastDay.toString().padStart(2, '0')}`;

    // Clear existing conflicts for this month
    const allConflicts = await storage.getAllConflicts();
    const monthConflicts = allConflicts.filter(c => 
      c.sourceDate >= startDate && c.sourceDate <= endDate
    );
    
    for (const conflict of monthConflicts) {
      await storage.deleteConflict(conflict.id);
    }

    // Get all analyses for the month
    const analyses = await storage.getAnalysesByDateRange(startDate, endDate);

    console.log(`📊 Found ${analyses.length} dates to analyze in ${year}-${month.toString().padStart(2, '0')}`);

    // Analyze each date in the month
    let completed = 0;
    const total = analyses.length;

    for (const analysis of analyses) {
      const similarDates = await duplicateDetector.analyzeDate(analysis.date);

      if (similarDates.length > 0) {
        const conflicts = similarDates.map((relatedDate: any) => {
          const [first, second] = [analysis.date, relatedDate].sort();
          return {
            sourceDate: first,
            relatedDate: second,
          };
        });
        await storage.createEventConflicts(conflicts);
        console.log(`💾 Stored ${conflicts.length} conflicts for ${analysis.date}`);
      }

      completed++;
      console.log(`📊 Progress: ${completed}/${total} - Analyzed ${analysis.date}`);

      await new Promise(resolve => setTimeout(resolve, 100));
    }

    console.log(`✅ Completed duplicate analysis for ${year}-${month.toString().padStart(2, '0')}`);

    // Automatically assign cluster IDs to all conflicts
    console.log(`🔗 Assigning cluster IDs...`);
    const clusterResult = await conflictClusterer.assignClusterIds();
    console.log(`✅ Assigned ${clusterResult.conflictsUpdated} conflicts to ${clusterResult.clustersFound} clusters`);

    res.json({ 
      success: true, 
      message: `Completed duplicate analysis for ${year}-${month.toString().padStart(2, '0')}`,
      analyzed: total,
      clusters: clusterResult.clustersFound,
      conflictsUpdated: clusterResult.conflictsUpdated
    });
  } catch (error) {
    console.error("❌ Error starting duplicate analysis:", error);
    res.status(500).json({ error: (error as Error).message });
  }
});

router.get("/api/conflicts/year/:year", async (req, res) => {
  try {
    const year = parseInt(req.params.year);
    
    if (isNaN(year) || year < 2008 || year > 2030) {
      return res.status(400).json({ error: "Invalid year" });
    }

    const conflicts = await storage.getConflictsByYear(year);

    // Group conflicts by clusterId (skip conflicts without cluster ID)
    const clusters = new Map<string, { clusterId: string; dateSet: Set<string>; conflictIds: number[] }>();
    
    for (const conflict of conflicts) {
      const clusterId = conflict.clusterId;
      
      // Skip conflicts without cluster ID
      if (!clusterId) continue;
      
      if (!clusters.has(clusterId)) {
        clusters.set(clusterId, {
          clusterId,
          dateSet: new Set<string>(),
          conflictIds: [],
        });
      }
      
      const cluster = clusters.get(clusterId)!;
      
      // Add both source and related dates to the cluster
      cluster.dateSet.add(conflict.sourceDate);
      cluster.dateSet.add(conflict.relatedDate);
      cluster.conflictIds.push(conflict.id);
    }
    
    // Convert to final cluster format (no summaries for performance)
    const clustersArray = [];
    
    for (const cluster of clusters.values()) {
      const dates = Array.from(cluster.dateSet).sort();
      
      clustersArray.push({
        clusterId: cluster.clusterId,
        dates,
        conflictIds: cluster.conflictIds,
      });
    }
    
    const result = clustersArray.sort((a, b) => 
      b.clusterId.localeCompare(a.clusterId)
    );

    res.json(result);
  } catch (error) {
    console.error("❌ Error fetching conflicts:", error);
    res.status(500).json({ error: (error as Error).message });
  }
});

router.get("/api/conflicts/all", async (req, res) => {
  try {
    const conflicts = await storage.getAllConflicts();
    res.json(conflicts);
  } catch (error) {
    console.error("❌ Error fetching all conflicts:", error);
    res.status(500).json({ error: (error as Error).message });
  }
});

router.get("/api/conflicts/all-grouped", async (req, res) => {
  try {
    const clusteredConflicts = await conflictClusterer.getClusteredConflicts();
    res.json(clusteredConflicts);
  } catch (error) {
    console.error("❌ Error fetching clustered conflicts:", error);
    res.status(500).json({ error: (error as Error).message });
  }
});

router.delete("/api/conflicts/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    
    if (isNaN(id)) {
      return res.status(400).json({ error: "Invalid conflict ID" });
    }

    await storage.deleteConflict(id);
    res.json({ success: true });
  } catch (error) {
    console.error("❌ Error deleting conflict:", error);
    res.status(500).json({ error: (error as Error).message });
  }
});

router.delete("/api/conflicts/resolve/:clusterId", async (req, res) => {
  try {
    const clusterId = req.params.clusterId;
    
    console.log(`✅ Resolving conflict cluster: ${clusterId}`);
    
    await conflictClusterer.deleteCluster(clusterId);
    res.json({ success: true, message: `Conflict cluster resolved for ${clusterId}` });
  } catch (error) {
    console.error("❌ Error resolving conflict:", error);
    res.status(500).json({ error: (error as Error).message });
  }
});

router.get("/api/conflicts/cluster/:date", async (req, res) => {
  try {
    const date = req.params.date;
    const cluster = await conflictClusterer.getClusterByDate(date);
    
    if (!cluster) {
      return res.status(404).json({ error: "Cluster not found" });
    }
    
    res.json(cluster);
  } catch (error) {
    console.error("❌ Error fetching cluster:", error);
    res.status(500).json({ error: (error as Error).message });
  }
});

router.post("/api/conflicts/ai-recommendations", async (req, res) => {
  try {
    const { sourceDate, duplicateDates } = req.body;
    
    if (!sourceDate || !duplicateDates || !Array.isArray(duplicateDates)) {
      return res.status(400).json({ error: "Invalid request body" });
    }

    console.log(`🤖 Getting holistic AI recommendations for cluster with ${duplicateDates.length + 1} dates`);

    // Fetch all analyses and their cached news
    const allDates = [sourceDate, ...duplicateDates];
    const allDatesData = await Promise.all(
      allDates.map(async (date) => {
        const analysis = await storage.getAnalysisByDate(date);
        const tieredArticles = analysis?.tieredArticles as any || { bitcoin: [], crypto: [], macro: [] };
        
        // Get all available articles with full details
        const allArticles = [
          ...(tieredArticles.bitcoin || []).map((a: any) => ({ ...a, tier: 'bitcoin' })),
          ...(tieredArticles.crypto || []).map((a: any) => ({ ...a, tier: 'crypto' })),
          ...(tieredArticles.macro || []).map((a: any) => ({ ...a, tier: 'macro' }))
        ];
        
        return {
          date,
          summary: analysis?.summary || '',
          topArticleId: analysis?.topArticleId || '',
          allArticles
        };
      })
    );

    // Build comprehensive prompt for holistic analysis
    const prompt = `You are a Bitcoin news analyst performing STRATEGIC CLUSTER ANALYSIS for duplicate detection.

CLUSTER DATES WITH SUMMARIES:
${allDatesData.map((d, i) => `${i + 1}. ${d.date}: "${d.summary}"`).join('\n')}

AVAILABLE ARTICLES FOR EACH DATE:
${allDatesData.map((d, i) => {
return `
${d.date}:
${d.allArticles.map((article: any, j: number) => `  ${j + 1}. [${article.tier.toUpperCase()}] ID: ${article.id}
   Title: ${article.title}
   Summary: ${article.summary || article.text || ''}`).join('\n')}
`;
}).join('\n')}

TASK - HOLISTIC CLUSTER ANALYSIS:
1. **Group dates by theme/topic**: Identify which dates discuss the same event (e.g., "halving buildup", "Ethereum fork", "mining difficulty")
2. **For each group**: 
 - Decide which dates should KEEP their current article (represent the theme best)
 - Decide which dates need to SWITCH to a different article (to avoid overlap)
3. **For dates that need to switch**: Recommend a specific article ID from their available articles that covers a DIFFERENT topic
4. **Provide strategic reasoning**: Explain the overall cluster structure and why this resolution strategy makes sense

Return a comprehensive analysis with:
- Theme-based groupings
- Keep/switch recommendations for each date
- Specific article IDs for switches
- Strategic reasoning about the cluster`;

    // Call OpenAI with structured output for holistic analysis
    const openaiResponse = await aiService.openai.chat.completions.create({
      messages: [
        { role: 'system', content: 'You are a Bitcoin news analyst performing strategic cluster analysis. Provide holistic recommendations.' },
        { role: 'user', content: prompt }
      ],
      model: 'gpt-4o-mini',
      temperature: 0.3,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'holistic_cluster_analysis',
          strict: true,
          schema: {
            type: 'object',
            properties: {
              groups: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    theme: { type: 'string' },
                    dates: { 
                      type: 'array',
                      items: { type: 'string' }
                    },
                    action: { type: 'string' },
                    reasoning: { type: 'string' }
                  },
                  required: ['theme', 'dates', 'action', 'reasoning'],
                  additionalProperties: false
                }
              },
              recommendations: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    date: { type: 'string' },
                    action: { 
                      type: 'string',
                      enum: ['keep', 'switch']
                    },
                    articleId: { type: 'string' },
                    newTopic: { type: 'string' },
                    reasoning: { type: 'string' }
                  },
                  required: ['date', 'action', 'reasoning'],
                  additionalProperties: false
                }
              },
              overallStrategy: { type: 'string' }
            },
            required: ['groups', 'recommendations', 'overallStrategy'],
            additionalProperties: false
          }
        }
      }
    });

    const analysis = JSON.parse(openaiResponse.choices[0].message.content || '{"groups":[],"recommendations":[],"overallStrategy":""}');
    console.log(`✅ Holistic cluster analysis complete: ${analysis.groups.length} groups, ${analysis.recommendations.length} recommendations`);
    
    res.json(analysis);
  } catch (error) {
    console.error("❌ Error getting AI recommendations:", error);
    res.status(500).json({ error: (error as Error).message });
  }
});

router.post("/api/conflicts/smart-dedup", async (req, res) => {
  try {
    const { sourceDate, duplicateDates } = req.body;
    
    if (!sourceDate || !duplicateDates || !Array.isArray(duplicateDates)) {
      return res.status(400).json({ error: "Invalid request body" });
    }

    console.log(`🧠 Starting smart deduplication for cluster with ${duplicateDates.length + 1} dates`);

    // Step 1: Fetch all analyses
    const allDates = [sourceDate, ...duplicateDates];
    const allDatesData = await Promise.all(
      allDates.map(async (date) => {
        const analysis = await storage.getAnalysisByDate(date);
        const tieredArticles = analysis?.tieredArticles as any || { bitcoin: [], crypto: [], macro: [] };
        return {
          date,
          summary: analysis?.summary || '',
          tieredArticles,
          topArticleId: analysis?.topArticleId || '',
        };
      })
    );

    // Step 2: Detect overlaps using OpenAI
    console.log(`🔍 Step 1: Detecting overlaps among ${allDates.length} summaries`);
    const overlapPrompt = `You are analyzing Bitcoin news summaries to detect duplicates.

SUMMARIES TO ANALYZE:
${allDatesData.map((d, i) => `${i + 1}. ${d.date}: "${d.summary}"`).join('\n')}

TASK: Identify groups of summaries that discuss the SAME SPECIFIC EVENT or ISSUE.

For example:
- "Mt Gox trustee sells 400 BTC" and "Mt Gox liquidation continues with BTC sales" = SAME EVENT
- "Bitcoin reaches $10k" and "BTC price hits new high" = SAME EVENT  
- "Lightning Network update" and "Mt Gox sale" = DIFFERENT EVENTS

Return groups of dates that overlap. Keep the first date in each group, mark others as duplicates.`;

    const overlapResponse = await aiService.openai.chat.completions.create({
      messages: [
        { role: 'system', content: 'You are a Bitcoin news analyst detecting duplicate coverage.' },
        { role: 'user', content: overlapPrompt }
      ],
      model: 'gpt-4o-mini',
      temperature: 0.2,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'overlap_detection',
          strict: true,
          schema: {
            type: 'object',
            properties: {
              overlapGroups: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    keepDate: { type: 'string' },
                    duplicateDates: {
                      type: 'array',
                      items: { type: 'string' }
                    },
                    topic: { type: 'string' }
                  },
                  required: ['keepDate', 'duplicateDates', 'topic'],
                  additionalProperties: false
                }
              }
            },
            required: ['overlapGroups'],
            additionalProperties: false
          }
        }
      }
    });

    const overlapResult = JSON.parse(overlapResponse.choices[0].message.content || '{"overlapGroups":[]}');
    console.log(`✅ Detected ${overlapResult.overlapGroups.length} overlap groups`);

    // Step 3: For each duplicate, ensure all tiers are cached
    const duplicatesToFix = new Set<string>();
    overlapResult.overlapGroups.forEach((group: any) => {
      group.duplicateDates.forEach((date: string) => duplicatesToFix.add(date));
    });

    console.log(`📰 Step 2: Ensuring full news coverage for ${duplicatesToFix.size} duplicates`);
    
    // Re-fetch all tiers if needed
    for (const date of Array.from(duplicatesToFix)) {
      const dateData = allDatesData.find(d => d.date === date);
      if (!dateData) continue;

      const hasBitcoin = (dateData.tieredArticles.bitcoin?.length || 0) > 0;
      const hasCrypto = (dateData.tieredArticles.crypto?.length || 0) > 0;
      const hasMacro = (dateData.tieredArticles.macro?.length || 0) > 0;

      if (!hasBitcoin || !hasCrypto || !hasMacro) {
        console.log(`🔄 Re-fetching all tiers for ${date} (Bitcoin: ${hasBitcoin}, Crypto: ${hasCrypto}, Macro: ${hasMacro})`);
        
        try {
          const requestContext = {
            requestId: `smart-dedup-${date}-${Date.now()}`,
            source: 'SMART_DEDUP',
            referer: 'smart-dedup',
            userAgent: 'smart-dedup'
          };

          // Fetch all three tiers
          const [bitcoinResults, cryptoResults, macroResults] = await Promise.all([
            hierarchicalSearch.searchBitcoinTier(date, requestContext),
            hierarchicalSearch.searchCryptoTier(date, requestContext),
            hierarchicalSearch.searchMacroTier(date, requestContext)
          ]);

          // Update the tiered articles in memory and database
          dateData.tieredArticles = {
            bitcoin: bitcoinResults,
            crypto: cryptoResults,
            macro: macroResults
          };

          // Update database
          const analysis = await storage.getAnalysisByDate(date);
          if (analysis) {
            await storage.updateAnalysis(analysis.id, {
              tieredArticles: dateData.tieredArticles
            });
          }

          console.log(`✅ Fetched all tiers for ${date}: Bitcoin=${bitcoinResults.length}, Crypto=${cryptoResults.length}, Macro=${macroResults.length}`);
        } catch (error) {
          console.error(`❌ Error fetching tiers for ${date}:`, error);
        }
      }
    }

    // Step 4: Get AI suggestions for alternatives
    console.log(`💡 Step 3: Getting AI suggestions for ${duplicatesToFix.size} duplicates`);
    
    const suggestions = [];
    
    for (const group of overlapResult.overlapGroups) {
      for (const dupDate of group.duplicateDates) {
        const dateData = allDatesData.find(d => d.date === dupDate);
        if (!dateData) continue;

        // Get all existing summaries to avoid overlaps
        const existingSummaries = allDatesData
          .filter(d => d.date !== dupDate)
          .map(d => d.summary);

        // Get all available articles
        const allArticles = [
          ...(dateData.tieredArticles.bitcoin || []),
          ...(dateData.tieredArticles.crypto || []),
          ...(dateData.tieredArticles.macro || [])
        ];

        if (allArticles.length === 0) {
          console.log(`⚠️ No articles available for ${dupDate}, skipping`);
          continue;
        }

        // Ask AI for alternative
        const suggestionPrompt = `You are analyzing news for ${dupDate}.

CURRENT SUMMARY (discussing ${group.topic}):
"${dateData.summary}"

THIS DATE MUST AVOID THESE TOPICS (already covered by other dates):
${existingSummaries.map((s, i) => `${i + 1}. "${s}"`).join('\n')}

AVAILABLE ARTICLES for ${dupDate}:
${allArticles.map((article, i) => `${i + 1}. ID: ${article.id}
 Title: ${article.title}
 Summary: ${article.summary || article.text || ''}`).join('\n\n')}

TASK: Select the BEST article that:
1. Discusses a COMPLETELY DIFFERENT event/topic from all existing summaries above
2. Is newsworthy and represents ${dupDate} accurately
3. Would create NO OVERLAP with any existing summary

Return the article ID and explain why it doesn't overlap.`;

        try {
          const suggestionResponse = await aiService.openai.chat.completions.create({
            messages: [
              { role: 'system', content: 'You are a Bitcoin news analyst selecting non-overlapping coverage.' },
              { role: 'user', content: suggestionPrompt }
            ],
            model: 'gpt-4o-mini',
            temperature: 0.3,
            response_format: {
              type: 'json_schema',
              json_schema: {
                name: 'article_suggestion',
                strict: true,
                schema: {
                  type: 'object',
                  properties: {
                    articleId: { type: 'string' },
                    reasoning: { type: 'string' },
                    newTopic: { type: 'string' }
                  },
                  required: ['articleId', 'reasoning', 'newTopic'],
                  additionalProperties: false
                }
              }
            }
          });

          const suggestion = JSON.parse(suggestionResponse.choices[0].message.content || '{}');
          
          if (suggestion.articleId) {
            suggestions.push({
              date: dupDate,
              currentSummary: dateData.summary,
              currentTopic: group.topic,
              suggestedArticleId: suggestion.articleId,
              newTopic: suggestion.newTopic,
              reasoning: suggestion.reasoning
            });

            // Update existing summaries to include this new suggestion
            existingSummaries.push(suggestion.newTopic);
          }
        } catch (error) {
          console.error(`❌ Error getting suggestion for ${dupDate}:`, error);
        }
      }
    }

    console.log(`✅ Smart deduplication complete: ${suggestions.length} suggestions generated`);
    
    res.json({ 
      suggestions,
      overlapGroups: overlapResult.overlapGroups
    });
  } catch (error) {
    console.error("❌ Error in smart deduplication:", error);
    res.status(500).json({ error: (error as Error).message });
  }
});

export default router;
