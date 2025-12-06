#!/usr/bin/env tsx

import 'dotenv/config';
import { Command } from 'commander';
import { CuratorAgent } from '../services/curator-agent';
import { AgentConfig } from '@shared/agent-types';

const program = new Command();

/**
 * Auto-Curator CLI
 * Main entry point for running the Autonomous Curator Agent
 */

program
  .name('auto-curator')
  .description('Autonomous Curator Agent for Bitcoin News Database')
  .version('1.0.0');

program
  .command('run')
  .description('Run the curator agent')
  .option('--hours <number>', 'Maximum runtime in hours', '4')
  .option('--budget <number>', 'Maximum budget in USD', '35')
  .option('--passes <number>', 'Maximum number of passes', '10')
  .option('--parallel <number>', 'Number of parallel workers', '5')
  .option('--batch-size <number>', 'Batch size for AI calls', '100')
  .option('--test', 'Run in test mode (dry run)')
  .option('--test-limit <number>', 'Limit issues in test mode', '50')
  .option('--no-verification', 'Skip full database verification (Phase 0)')
  .option('--auto-approve', 'Auto-approve all high-confidence decisions')
  .action(async (options) => {
    console.log('🚀 Starting Autonomous Curator Agent...\n');
    
    const config: Partial<AgentConfig> = {
      maxRuntimeHours: parseFloat(options.hours),
      maxBudget: parseFloat(options.budget),
      maxPasses: parseInt(options.passes),
      parallelWorkers: parseInt(options.parallel),
      batchSize: parseInt(options.batchSize),
      testMode: options.test || false,
      testLimit: options.testLimit ? parseInt(options.testLimit) : undefined,
      autoApproveThreshold: options.autoApprove ? 70 : 90,
    };
    
    if (options.test) {
      console.log('🧪 TEST MODE: No changes will be made\n');
    }
    
    if (options.noVerification) {
      console.log('⏭️  Skipping Phase 0 verification\n');
    }
    
    try {
      const agent = new CuratorAgent(config);
      await agent.run();
      
      console.log('\n✅ Agent completed successfully!');
      process.exit(0);
    } catch (error) {
      console.error('\n❌ Agent failed:', error);
      process.exit(1);
    }
  });

program
  .command('resume <sessionId>')
  .description('Resume an interrupted agent session')
  .action(async (sessionId) => {
    console.log(`📂 Resuming session: ${sessionId}...\n`);
    
    try {
      const agent = await CuratorAgent.resume(sessionId);
      await agent.run();
      
      console.log('\n✅ Agent completed successfully!');
      process.exit(0);
    } catch (error) {
      console.error('\n❌ Failed to resume:', error);
      process.exit(1);
    }
  });

program
  .command('verify-only')
  .description('Run only Phase 0 (database verification)')
  .option('--batch-size <number>', 'Batch size', '100')
  .action(async (options) => {
    console.log('🔍 Running database verification only...\n');
    
    const config: Partial<AgentConfig> = {
      maxPasses: 0, // Skip cleanup passes
      batchSize: parseInt(options.batchSize),
    };
    
    try {
      const agent = new CuratorAgent(config);
      await agent.run();
      
      console.log('\n✅ Verification completed!');
      process.exit(0);
    } catch (error) {
      console.error('\n❌ Verification failed:', error);
      process.exit(1);
    }
  });

program
  .command('test')
  .description('Run in test mode with limited scope')
  .option('--limit <number>', 'Number of issues to process', '50')
  .action(async (options) => {
    console.log('🧪 Running in TEST MODE...\n');
    
    const config: Partial<AgentConfig> = {
      testMode: true,
      testLimit: parseInt(options.limit),
      maxPasses: 2, // Only 2 passes in test
    };
    
    try {
      const agent = new CuratorAgent(config);
      await agent.run();
      
      console.log('\n✅ Test completed!');
      process.exit(0);
    } catch (error) {
      console.error('\n❌ Test failed:', error);
      process.exit(1);
    }
  });

// Parse command line arguments
program.parse(process.argv);

// If no command provided, show help
if (!process.argv.slice(2).length) {
  program.outputHelp();
}

