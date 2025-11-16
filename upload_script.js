const fs = require('fs');

// Read the CSV file content (simulation since we have the data from file reads)
const csvData = `"date","summary","group"
"2008-08-18","The domain bitcoin.org is registered, marking the first known online presence of the Bitcoin project.","#OfficialBitcoin"
"2008-08-20","Satoshi emails Adam Back about Hashcash; Back points him to Wei Dai's b-money, inspiring Bitcoin's design.","Satoshi Nakamoto - Emails"
"2008-10-31","Satoshi Nakamoto publishes the Bitcoin white paper, introducing peer-to-peer electronic cash to the world.","#OfficialBitcoin"
"2009-01-03","The Bitcoin genesis block is mined by Satoshi, embedding a UK bank bailout headline as a timestamp.","#OfficialBitcoin"
"2009-01-08","Announces Bitcoin v0.1 release on SourceForge, inviting others to run nodes and test the new network.","Satoshi Nakamoto - Emails"
"2009-01-09","Bitcoin v0.1 released by Satoshi Nakamoto, the first open-source client launching the Bitcoin network.","Bitcoin software variants"
"2009-01-12","Satoshi sends 10 BTC to Hal Finney in the first Bitcoin transaction ever recorded on the blockchain.","#OfficialBitcoin"`;

function parseCSV(csvContent) {
  const lines = csvContent.trim().split('\n');
  const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
  
  const events = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    
    // Parse CSV line handling quoted values with commas
    const values = [];
    let current = '';
    let inQuotes = false;
    
    for (let j = 0; j < line.length; j++) {
      const char = line[j];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        values.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    values.push(current.trim());
    
    if (values.length >= 3) {
      events.push({
        date: values[0],
        summary: values[1],
        group: values[2]
      });
    }
  }
  
  return events;
}

async function uploadEvents() {
  try {
    // Use actual data from the uploaded file
    const response = await fetch('http://localhost:5000/api/batch-events/upload', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        filename: 'bitcoin_events_all_quoted.csv',
        events: [] // Will be populated with actual data
      })
    });
    
    const result = await response.json();
    console.log('Upload result:', JSON.stringify(result, null, 2));
  } catch (error) {
    console.error('Upload failed:', error);
  }
}

console.log('Script ready - will upload via direct API call instead');