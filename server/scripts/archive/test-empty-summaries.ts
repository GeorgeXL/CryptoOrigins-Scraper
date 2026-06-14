import 'dotenv/config';
import { storage } from '../storage';

async function testEmptySummaries() {
  console.log('🔍 Testing empty summaries query...\n');

  // Get all entries using storage service
  console.log('📥 Fetching all entries from database...');
  const allAnalyses = await storage.getAllAnalyses();
  const allData = allAnalyses.map(a => ({
    id: a.id,
    date: a.date,
    summary: a.summary
  }));

  console.log(`\n✅ Total entries fetched: ${allData.length}\n`);

  // Filter to only dates >= 2009-01-03
  const minValidDate = new Date('2009-01-03');
  const filteredData = allData.filter(entry => {
    if (!entry.date) return false;
    const entryDate = new Date(entry.date);
    return entryDate >= minValidDate;
  });

  console.log(`📅 Entries after date filter (>= 2009-01-03): ${filteredData.length}\n`);

  // Filter to entries with empty summary
  const emptySummaries = filteredData.filter(entry => {
    const summary = entry.summary;
    const isEmpty = !summary || summary.trim() === '';
    return isEmpty;
  });

  console.log(`📊 Empty summaries found: ${emptySummaries.length}\n`);

  if (emptySummaries.length > 0) {
    console.log('📋 Sample empty summaries:');
    emptySummaries.slice(0, 10).forEach((entry, idx) => {
      const summary = entry.summary;
      const summaryType = summary === null ? 'null' : summary === undefined ? 'undefined' : `"${summary}"`;
      console.log(`   ${idx + 1}. ${entry.date} - summary: ${summaryType} (length: ${(summary || '').length})`);
    });
  } else {
    console.log('⚠️ No empty summaries found. Checking sample entries...\n');
    console.log('📋 Sample entries (first 10):');
    filteredData.slice(0, 10).forEach((entry, idx) => {
      const summary = entry.summary;
      const summaryType = summary === null ? 'null' : summary === undefined ? 'undefined' : `"${summary.substring(0, 50)}..."`;
      console.log(`   ${idx + 1}. ${entry.date} - summary: ${summaryType} (length: ${(summary || '').length})`);
    });
  }

  // Also check for entries with very short summaries
  const veryShortSummaries = filteredData.filter(entry => {
    const summary = entry.summary;
    if (!summary) return false;
    return summary.trim().length > 0 && summary.trim().length < 10;
  });

  if (veryShortSummaries.length > 0) {
    console.log(`\n⚠️ Found ${veryShortSummaries.length} entries with very short summaries (< 10 chars):`);
    veryShortSummaries.slice(0, 5).forEach((entry, idx) => {
      console.log(`   ${idx + 1}. ${entry.date} - summary: "${entry.summary}"`);
    });
  }
}

testEmptySummaries().catch(console.error);

