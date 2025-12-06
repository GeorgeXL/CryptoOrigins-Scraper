/**
 * Restore Deleted Tags
 * 
 * This script restores tags that were incorrectly deleted by the Validator module.
 * Many of these tags ARE relevant to Bitcoin/crypto history.
 */

import { db } from '../db';
import { sql } from 'drizzle-orm';

interface TagToRestore {
  name: string;
  category: string;
  reason: string;
}

// Tags that should be restored - these ARE relevant to Bitcoin/crypto
const tagsToRestore: TagToRestore[] = [
  // Countries/Cities - Many have significant crypto history
  { name: 'Cyprus', category: 'markets-geography', reason: '2013 banking crisis that boosted Bitcoin adoption' },
  { name: 'Miami', category: 'markets-geography', reason: 'Bitcoin Miami conference - major crypto hub' },
  { name: 'Iceland', category: 'markets-geography', reason: 'Major Bitcoin mining location due to cheap energy' },
  { name: 'Taiwan', category: 'markets-geography', reason: 'Chip manufacturing hub, ASIC production' },
  { name: 'Thailand', category: 'markets-geography', reason: 'Early crypto regulation country' },
  { name: 'Norway', category: 'markets-geography', reason: 'Early Bitcoin adoption, sovereign wealth fund' },
  { name: 'Belgium', category: 'markets-geography', reason: 'EU regulatory hub' },
  { name: 'Estonia', category: 'markets-geography', reason: 'E-residency program, early blockchain adoption' },
  { name: 'Saudi Arabia', category: 'markets-geography', reason: 'Petrodollar system, macro relevance' },
  { name: 'Florida', category: 'markets-geography', reason: 'Crypto-friendly state regulation' },
  { name: 'North Carolina', category: 'markets-geography', reason: 'State crypto legislation' },
  { name: 'Ohio', category: 'markets-geography', reason: 'First US state to accept Bitcoin for taxes' },
  { name: 'Wisconsin', category: 'markets-geography', reason: 'State pension fund Bitcoin ETF purchase' },
  { name: 'Egypt', category: 'markets-geography', reason: 'Bitcoin adoption during political instability' },
  { name: 'Libya', category: 'markets-geography', reason: 'Capital controls, Bitcoin adoption' },
  { name: 'Romania', category: 'markets-geography', reason: 'Crypto mining activity' },
  { name: 'Kosovo', category: 'markets-geography', reason: 'Bitcoin mining controversy' },
  { name: 'Scotland', category: 'markets-geography', reason: 'Independence movement, alternative currencies' },
  { name: 'Middle East', category: 'markets-geography', reason: 'Regional crypto adoption' },
  { name: 'North Africa', category: 'markets-geography', reason: 'Regional crypto adoption' },
  { name: 'European', category: 'markets-geography', reason: 'EU crypto regulation context' },
  { name: 'Brussels', category: 'markets-geography', reason: 'EU regulatory decisions' },
  { name: 'Amsterdam', category: 'markets-geography', reason: 'Early Bitcoin conferences' },
  { name: 'Prague', category: 'markets-geography', reason: 'Paralelni Polis, Bitcoin-only venues' },
  { name: 'Vancouver', category: 'markets-geography', reason: 'First Bitcoin ATM location' },
  { name: 'Las Vegas', category: 'markets-geography', reason: 'Early Bitcoin adoption, casinos' },
  { name: 'Washington', category: 'markets-geography', reason: 'US regulatory decisions' },
  { name: 'Arnhem', category: 'markets-geography', reason: 'Bitcoin-friendly city in Netherlands' },
  
  // Tech Companies - Many have blockchain initiatives
  { name: 'Facebook', category: 'organizations', reason: 'Libra/Diem cryptocurrency project' },
  { name: 'IBM', category: 'organizations', reason: 'Major blockchain enterprise projects (Hyperledger)' },
  { name: 'Samsung', category: 'organizations', reason: 'Blockchain phone, crypto wallet integration' },
  { name: 'Apple', category: 'organizations', reason: 'App Store crypto app policies, Apple Pay' },
  { name: 'Intel', category: 'organizations', reason: 'Mining chip development' },
  { name: 'Meta', category: 'organizations', reason: 'Diem stablecoin project' },
  { name: 'Baidu', category: 'organizations', reason: 'Chinese Bitcoin acceptance/ban history' },
  { name: 'Netflix', category: 'organizations', reason: 'Bitcoin documentaries, crypto content' },
  
  // Financial Institutions - Many engaged with crypto
  { name: 'RBS', category: 'organizations', reason: 'Banking crisis context, institutional crypto' },
  { name: 'AIG', category: 'organizations', reason: '2008 crisis context, macro relevance' },
  { name: 'Citigroup', category: 'organizations', reason: 'Institutional crypto engagement' },
  { name: 'Merrill Lynch', category: 'organizations', reason: 'Institutional crypto reports' },
  { name: 'FXCM', category: 'organizations', reason: 'Early crypto trading integration' },
  { name: 'Index Ventures', category: 'organizations', reason: 'Major crypto VC investor' },
  
  // Key Crypto Figures
  { name: 'Chef Nomi', category: 'people', reason: 'SushiSwap founder - major DeFi figure' },
  { name: 'Kim Dotcom', category: 'people', reason: 'Early Bitcoin adopter and promoter' },
  { name: 'Trendon Shavers', category: 'people', reason: 'First Bitcoin Ponzi scheme - historical significance' },
  { name: 'Richard Branson', category: 'people', reason: 'Virgin Galactic Bitcoin acceptance' },
  { name: 'Jim Cramer', category: 'people', reason: 'Financial commentator on crypto' },
  
  // Politicians - Crypto policy context
  { name: 'Barack Obama', category: 'people', reason: 'Administration era crypto emergence' },
  { name: 'Nancy Pelosi', category: 'people', reason: 'Crypto regulation discussions' },
  { name: 'Mitt Romney', category: 'people', reason: 'Political campaign Bitcoin donations' },
  { name: 'Obama administration', category: 'people', reason: 'Era of early Bitcoin regulation' },
  { name: 'George Osborne', category: 'people', reason: 'UK Bitcoin regulation era' },
  { name: 'Gordon Brown', category: 'people', reason: '2008 crisis context' },
  { name: 'Chancellor Darling', category: 'people', reason: '2008 crisis - Genesis block reference' },
  { name: 'Lawrence Summers', category: 'people', reason: 'Macro economist, digital currency views' },
  { name: 'Sarkozy', category: 'people', reason: 'EU economic policy context' },
  
  // Regulatory/Legal
  { name: 'Regulators', category: 'regulation-law', reason: 'General crypto regulation context' },
  { name: 'VAT', category: 'regulation-law', reason: 'EU VAT exemption for Bitcoin was major news' },
  { name: 'UN', category: 'regulation-law', reason: 'International crypto policy discussions' },
  
  // Technology Terms
  { name: 'Android', category: 'technology', reason: 'Crypto wallet apps platform' },
  { name: 'iOS', category: 'technology', reason: 'Crypto wallet apps platform' },
  { name: 'Security', category: 'technology', reason: 'Crypto security context' },
  { name: 'OpenSSL', category: 'technology', reason: 'Heartbleed vulnerability affected Bitcoin' },
  { name: 'IPv6', category: 'technology', reason: 'Bitcoin network protocol discussions' },
  { name: 'NFC', category: 'technology', reason: 'Contactless Bitcoin payments' },
  
  // Crypto-Specific
  { name: 'BitX', category: 'organizations', reason: 'Early Bitcoin exchange (became Luno)' },
  { name: 'TeraExchange', category: 'organizations', reason: 'CFTC-regulated Bitcoin swap platform' },
  { name: 'MyCoin', category: 'organizations', reason: 'Hong Kong Bitcoin Ponzi scheme - historical' },
  { name: 'CoinWallet', category: 'organizations', reason: 'Bitcoin wallet service' },
  { name: 'Simplecoin', category: 'organizations', reason: 'Mining pool service' },
  
  // Media/Other
  { name: 'Chicago Sun-Times', category: 'organizations', reason: 'First major newspaper to accept Bitcoin' },
  { name: 'Dish Network', category: 'organizations', reason: 'Major company to accept Bitcoin' },
  { name: 'Hacker News', category: 'organizations', reason: 'Tech community Bitcoin discussions' },
  { name: 'HBO', category: 'organizations', reason: 'Bitcoin documentaries' },
  { name: 'Taringa', category: 'organizations', reason: 'Social platform with Bitcoin integration' },
  { name: 'QuickBooks Online', category: 'organizations', reason: 'Crypto accounting integration' },
  { name: 'Intuit', category: 'organizations', reason: 'QuickBooks crypto features' },
  
  // Historical/Other
  { name: 'BP', category: 'organizations', reason: 'Energy cost context for mining' },
  { name: 'GM', category: 'organizations', reason: 'Bailout context vs Bitcoin' },
  { name: 'Chrysler', category: 'organizations', reason: 'Bailout context vs Bitcoin' },
  { name: "McDonald's", category: 'organizations', reason: 'Bitcoin payment trials' },
  { name: 'KFC', category: 'organizations', reason: 'Bitcoin Bucket promotion' },
  { name: 'PRQ', category: 'organizations', reason: 'Hosted early Bitcoin sites' },
  { name: 'FreeNode', category: 'organizations', reason: 'Bitcoin IRC community' },
  { name: 'Mega', category: 'organizations', reason: 'Kim Dotcom Bitcoin integration' },
  { name: 'East Midlands Airport', category: 'organizations', reason: 'Bitcoin ATM location' },
  { name: 'Ruxum', category: 'organizations', reason: 'Bitcoin exchange' },
  
  // Miscellaneous
  { name: 'Investors', category: 'miscellaneous', reason: 'General crypto investment context' },
  { name: 'Labour', category: 'miscellaneous', reason: 'UK political party - policy context' },
  { name: '2MB', category: 'technology', reason: 'Bitcoin block size debate' },
  { name: 'Mike Tyson', category: 'people', reason: 'Bitcoin ATM venture' },
];

async function restoreTags() {
  console.log('🔧 Restoring deleted tags...\n');
  
  let restored = 0;
  let skipped = 0;
  let errors = 0;
  
  for (const tag of tagsToRestore) {
    try {
      // Check if tag already exists
      const existing = await db.execute(sql`
        SELECT id FROM tags WHERE LOWER(name) = LOWER(${tag.name})
      `);
      
      if (existing.rows && existing.rows.length > 0) {
        console.log(`⏭️  Skipped: "${tag.name}" (already exists)`);
        skipped++;
        continue;
      }
      
      // Insert the tag
      await db.execute(sql`
        INSERT INTO tags (name, category, created_at, updated_at)
        VALUES (${tag.name}, ${tag.category}, NOW(), NOW())
      `);
      
      console.log(`✅ Restored: "${tag.name}" → ${tag.category}`);
      console.log(`   Reason: ${tag.reason}`);
      restored++;
    } catch (error) {
      console.error(`❌ Error restoring "${tag.name}":`, error);
      errors++;
    }
  }
  
  console.log('\n📊 Restoration Summary:');
  console.log(`   ✅ Restored: ${restored}`);
  console.log(`   ⏭️  Skipped: ${skipped}`);
  console.log(`   ❌ Errors: ${errors}`);
  console.log(`   Total: ${tagsToRestore.length}`);
  
  // Get new count
  const result = await db.execute(sql`SELECT COUNT(*) as count FROM tags`);
  console.log(`\n📈 Current tag count: ${result.rows[0]?.count}`);
}

// Run the restoration
restoreTags()
  .then(() => {
    console.log('\n✨ Tag restoration complete!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });

