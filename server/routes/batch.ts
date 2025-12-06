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

// Utility function to parse date strings from Perplexity
// Note: All 1,025 existing Perplexity dates are already in YYYY-MM-DD format
function parsePerplexityDate(dateText: string | null): string | null {
  // Handle null/undefined input
  if (!dateText) {
    return null;
  }

  // Case 1: Already in YYYY-MM-DD format (99.9% of cases)
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateText)) {
    return dateText;
  }

  // Case 2: Try to extract YYYY-MM-DD from string
  const isoMatch = dateText.match(/\d{4}-\d{2}-\d{2}/);
  if (isoMatch) {
    return isoMatch[0];
  }

  // If all else fails, return null
  console.log(`⚠️ Could not parse date from: "${dateText}"`);
  return null;
}

// Global state to control fact-checking process
let shouldStopFactCheck = false;
let isFactCheckRunning = false;
let factCheckProcessed = 0;

// Global state to control batch tagging process
let shouldStopBatchTagging = false;
let isBatchTaggingRunning = false;
let batchTaggingProcessed = 0;
let batchTaggingTotal = 0;

const router = Router();

router.get('/api/event-cockpit/:batchId', async (req, res) => {
  try {
    const { batchId } = req.params;
    const page = parseInt(req.query.page as string) || 1;
    const limit = 50; // 50 events per page
    const offset = (page - 1) * limit;

    // Get batch info
    const batch = await storage.getEventBatch(batchId);
    if (!batch) {
      return res.status(404).json({ error: 'Batch not found' });
    }

    // Get all events for this batch
    const allEvents = await storage.getBatchEventsByBatchId(batchId);
    
    // Calculate pagination
    const totalEvents = allEvents.length;
    const totalPages = Math.ceil(totalEvents / limit);
    const events = allEvents.slice(offset, offset + limit);

    // Fetch summaries from historical_news_analyses for each event date
    const eventsWithDatabaseSummaries = await Promise.all(
      events.map(async (event) => {
        try {
          const analysis = await storage.getAnalysisByDate(event.originalDate);
          return {
            ...event,
            databaseSummary: analysis?.summary || null
          };
        } catch (error) {
          console.error(`Error fetching analysis for ${event.originalDate}:`, error);
          return {
            ...event,
            databaseSummary: null
          };
        }
      })
    );

    res.json({
      batch,
      events: eventsWithDatabaseSummaries,
      pagination: {
        currentPage: page,
        totalPages,
        totalEvents,
        eventsPerPage: limit,
        hasNext: page < totalPages,
        hasPrev: page > 1
      }
    });
  } catch (error) {
    console.error('Event cockpit error:', error);
    res.status(500).json({ error: 'Failed to fetch events' });
  }
});

router.post('/api/event-cockpit/enhance/:eventId', async (req, res) => {
  try {
    const { eventId } = req.params;
    
    // Get the event
    const event = await storage.getBatchEvent(eventId);
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    console.log(`🤖 AI re-evaluating event ${eventId} from ${event.originalDate} (forced re-enhancement)`);
    
    // Always evaluate - even if previously enhanced, user wants fresh AI assessment
    const currentSummary = event.enhancedSummary || event.originalSummary;
    const evaluation = await aiService.evaluateEventSummary(currentSummary, event.originalDate, event.originalGroup);
    
    if (!evaluation.needsEnhancement) {
      // Mark as enhanced but keep original summary
      await storage.updateBatchEvent(eventId, {
        enhancedSummary: event.originalSummary,
        enhancedReasoning: evaluation.reasoning,
        status: 'enhanced'
      });
      
      return res.json({
        eventId,
        needsEnhancement: false,
        message: 'Summary is already high quality',
        reasoning: evaluation.reasoning,
        originalSummary: event.originalSummary,
        enhancedSummary: event.originalSummary
      });
    }
    
    // Enhance the summary
    const enhanced = await aiService.enhanceEventSummary(event.originalSummary, event.originalDate, event.originalGroup);
    
    // Update the event with enhanced summary
    const updatedEvent = await storage.updateBatchEvent(eventId, {
      enhancedSummary: enhanced.summary,
      enhancedReasoning: enhanced.reasoning,
      status: 'enhanced'
    });
    
    res.json({
      eventId,
      needsEnhancement: true,
      originalSummary: event.originalSummary,
      enhancedSummary: enhanced.summary,
      reasoning: enhanced.reasoning,
      event: updatedEvent
    });
    
  } catch (error) {
    console.error('AI enhancement error:', error);
    res.status(500).json({ error: 'Failed to enhance event' });
  }
});

router.post('/api/event-cockpit/enhance-batch', async (req, res) => {
  try {
    const { eventIds } = req.body;
    
    if (!Array.isArray(eventIds) || eventIds.length === 0) {
      return res.status(400).json({ error: 'eventIds must be a non-empty array' });
    }
    
    console.log(`🎆 Starting batch enhancement of ${eventIds.length} events`);
    let enhanced = 0;
    let alreadyGood = 0;
    
    // Process events sequentially to avoid overwhelming OpenAI API
    for (const eventId of eventIds) {
      try {
        const event = await storage.getBatchEvent(eventId);
        if (!event) {
          console.log(`⚠️ Event ${eventId} not found, skipping`);
          continue;
        }
        
        // Skip if already enhanced
        if (event.enhancedSummary) {
          alreadyGood++;
          console.log(`✅ Event ${eventId} already enhanced, skipping`);
          continue;
        }
        
        console.log(`🤖 Evaluating event ${eventId} from ${event.originalDate}`);
        
        // Evaluate and enhance the event
        const evaluation = await aiService.evaluateEventSummary(event.originalSummary, event.originalDate, event.originalGroup);
        
        if (!evaluation.needsEnhancement) {
          // Mark as enhanced but keep original
          await storage.updateBatchEvent(eventId, {
            enhancedSummary: event.originalSummary,
            enhancedReasoning: evaluation.reasoning,
            status: 'enhanced'
          });
          alreadyGood++;
          console.log(`✅ Event ${eventId} already perfect`);
        } else {
          // Enhance the summary
          const enhanced_result = await aiService.enhanceEventSummary(event.originalSummary, event.originalDate, event.originalGroup);
          
          await storage.updateBatchEvent(eventId, {
            enhancedSummary: enhanced_result.summary,
            enhancedReasoning: enhanced_result.reasoning,
            status: 'enhanced'
          });
          enhanced++;
          console.log(`✨ Enhanced event ${eventId}: "${enhanced_result.summary}"`);
        }
        
      } catch (eventError) {
        console.error(`❌ Error enhancing event ${eventId}:`, eventError);
        alreadyGood++; // Count as processed to avoid confusion
      }
    }
    
    console.log(`🎉 Batch complete: ${enhanced} enhanced, ${alreadyGood} already good`);
    res.json({ enhanced, alreadyGood, total: enhanced + alreadyGood });
    
  } catch (error) {
    console.error('Error in batch enhancement:', error);
    res.status(500).json({ error: 'Failed to enhance events batch' });
  }
});

router.post('/api/event-cockpit/approve', async (req, res) => {
  try {
    const { eventIds } = req.body;
    
    if (!Array.isArray(eventIds) || eventIds.length === 0) {
      return res.status(400).json({ error: 'Event IDs required' });
    }

    const approvedEvents = await storage.approveBatchEvents(eventIds);
    res.json({ approved: approvedEvents.length, events: approvedEvents });
  } catch (error) {
    console.error('Approve events error:', error);
    res.status(500).json({ error: 'Failed to approve events' });
  }
});

router.post('/api/event-cockpit/replace-real-summaries', async (req, res) => {
  try {
    const { eventIds } = req.body;
    
    if (!Array.isArray(eventIds) || eventIds.length === 0) {
      return res.status(400).json({ error: 'Event IDs required' });
    }

    console.log(`🔄 Replacing real summaries for ${eventIds.length} events...`);
    
    let updated = 0;
    const skipped: string[] = [];
    const errors: string[] = [];

    for (const eventId of eventIds) {
      try {
        // Get the event from batch_events
        const event = await storage.getBatchEvent(eventId);
        if (!event) {
          console.warn(`⚠️ Event ${eventId} not found, skipping`);
          skipped.push(eventId);
          continue;
        }

        // Check if event has enhancedSummary
        if (!event.enhancedSummary) {
          console.warn(`⚠️ Event ${eventId} (${event.originalDate}) has no enhancedSummary, skipping`);
          skipped.push(eventId);
          continue;
        }

        // Check if analysis exists for this date
        const analysis = await storage.getAnalysisByDate(event.originalDate);
        if (!analysis) {
          console.warn(`⚠️ No analysis found for date ${event.originalDate}, skipping`);
          skipped.push(eventId);
          continue;
        }

        // Update the real summary in historical_news_analyses
        await storage.updateAnalysis(event.originalDate, {
          summary: event.enhancedSummary
        });

        console.log(`✅ Replaced real summary for ${event.originalDate} (${event.enhancedSummary.length} chars)`);
        updated++;
      } catch (error) {
        console.error(`❌ Error replacing summary for event ${eventId}:`, error);
        errors.push(eventId);
      }
    }

    console.log(`✅ Replace real summaries completed: ${updated} updated, ${skipped.length} skipped, ${errors.length} errors`);

    res.json({
      success: true,
      updated,
      skipped: skipped.length,
      errors: errors.length > 0 ? errors : undefined,
      total: eventIds.length
    });
  } catch (error) {
    console.error('Replace real summaries error:', error);
    res.status(500).json({ error: 'Failed to replace real summaries' });
  }
});

router.post('/api/batch-events/upload', async (req, res) => {
  try {
    const { filename, events } = req.body;
    
    if (!filename || !events || !Array.isArray(events)) {
      return res.status(400).json({ error: 'Invalid upload data' });
    }

    // Calculate batch structure
    const totalEvents = events.length;
    const totalBatches = Math.ceil(totalEvents / 10);

    // Create batch record
    const batch = await storage.createEventBatch({
      originalFilename: filename,
      totalEvents,
      totalBatches,
      status: 'uploaded'
    });

    // Create individual event records
    const batchEvents = events.map((event: any, index: number) => ({
      batchId: batch.id,
      batchNumber: Math.floor(index / 10) + 1,
      originalDate: event.date,
      originalSummary: event.summary,
      originalGroup: event.group || 'General',
      status: 'pending' as const
    }));

    await storage.createBatchEvents(batchEvents);

    res.json({ success: true, batchId: batch.id, batch });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.get('/api/batch-events/batches', async (req, res) => {
  try {
    const batches = await storage.getAllEventBatches();
    res.json(batches);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.get('/api/batch-events/batch/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const batch = await storage.getEventBatch(id);
    
    if (!batch) {
      return res.status(404).json({ error: 'Batch not found' });
    }

    const events = await storage.getBatchEventsByBatchId(id);
    res.json({ batch, events });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.get('/api/batch-events/batch/:id/events/:batchNumber', async (req, res) => {
  try {
    const { id, batchNumber } = req.params;
    const batchNum = parseInt(batchNumber);
    
    if (isNaN(batchNum)) {
      return res.status(400).json({ error: 'Invalid batch number' });
    }

    const events = await storage.getBatchEventsByBatchNumber(id, batchNum);
    res.json(events);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.post('/api/batch-events/process/:id/:batchNumber', async (req, res) => {
  try {
    const { id, batchNumber } = req.params;
    const batchNum = parseInt(batchNumber);
    
    if (isNaN(batchNum)) {
      return res.status(400).json({ error: 'Invalid batch number' });
    }

    // Get events for this batch
    const events = await storage.getBatchEventsByBatchNumber(id, batchNum);
    
    if (events.length === 0) {
      return res.status(404).json({ error: 'No events found for this batch' });
    }

    // Process batch with OpenAI
    const batchContext = {
      batchId: id,
      batchNumber: batchNum,
      events,
      groupContext: `Batch ${batchNum} processing`
    };

    const enhancementResult = await batchProcessor.enhanceBatch(batchContext);
    
    if (!enhancementResult.success) {
      return res.status(500).json({ 
        error: 'Batch processing failed', 
        details: enhancementResult.errors 
      });
    }

    // Update events with enhanced summaries
    const enhancedEvents = await Promise.all(
      enhancementResult.enhancedEvents?.map(async (enhanced) => {
        return await storage.updateBatchEvent(enhanced.id, {
          status: 'enhanced',
          enhancedSummary: enhanced.enhancedSummary,
          enhancedReasoning: enhanced.enhancedReasoning,
          aiProvider: 'openai'
        });
      }) || []
    );

    // Update batch progress
    await storage.updateEventBatch(id, {
      processedEvents: (await storage.getBatchEventsByBatchId(id)).filter(e => e.status === 'enhanced' || e.status === 'approved' || e.status === 'rejected').length,
      currentBatchNumber: batchNum,
      status: 'processing'
    });

    res.json({ success: true, events: enhancedEvents });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.get('/api/batch-events/review/:id/:batchNumber', async (req, res) => {
  try {
    const { id, batchNumber } = req.params;
    const batchNum = parseInt(batchNumber);
    
    if (isNaN(batchNum)) {
      return res.status(400).json({ error: 'Invalid batch number' });
    }

    const events = await storage.getBatchEventsForReview(id, batchNum);
    res.json(events);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.post('/api/batch-events/approve/:id/:batchNumber', async (req, res) => {
  try {
    const { id, batchNumber } = req.params;
    const { eventIds } = req.body;
    
    if (!Array.isArray(eventIds)) {
      return res.status(400).json({ error: 'Event IDs must be an array' });
    }

    const approvedEvents = await storage.approveBatchEvents(eventIds);
    
    // Update batch progress
    const allEvents = await storage.getBatchEventsByBatchId(id);
    const approvedCount = allEvents.filter(e => e.status === 'approved').length;
    
    await storage.updateEventBatch(id, {
      approvedEvents: approvedCount
    });

    res.json({ success: true, events: approvedEvents });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.post('/api/batch-events/reject/:id/:batchNumber', async (req, res) => {
  try {
    const { id, batchNumber } = req.params;
    const { eventIds } = req.body;
    
    if (!Array.isArray(eventIds)) {
      return res.status(400).json({ error: 'Event IDs must be an array' });
    }

    const rejectedEvents = await storage.rejectBatchEvents(eventIds);
    
    // Update batch progress
    const allEvents = await storage.getBatchEventsByBatchId(id);
    const rejectedCount = allEvents.filter(e => e.status === 'rejected').length;
    
    await storage.updateEventBatch(id, {
      rejectedEvents: rejectedCount
    });

    res.json({ success: true, events: rejectedEvents });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.post('/api/batch-events/finalize/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Get all approved events
    const allEvents = await storage.getBatchEventsByBatchId(id);
    const approvedEvents = allEvents.filter(e => e.status === 'approved');
    
    if (approvedEvents.length === 0) {
      return res.status(400).json({ error: 'No approved events to finalize' });
    }

    // Convert approved events to manual entries
    const manualEntries = await Promise.all(approvedEvents.map(async (event) => {
      return await storage.createManualEntry({
        date: event.originalDate,
        title: `Batch Import: ${event.originalGroup}`,
        summary: event.enhancedSummary || event.originalSummary,
        description: `Enhanced from batch upload: ${event.enhancedReasoning || 'No reasoning provided'}`
      });
    }));

    // Mark batch as completed
    await storage.updateEventBatch(id, {
      status: 'completed',
      completedAt: new Date()
    });

    res.json({ 
      success: true, 
      message: `Successfully imported ${manualEntries.length} events`,
      entries: manualEntries 
    });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

export default router;
