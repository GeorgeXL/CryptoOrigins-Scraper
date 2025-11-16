import fs from 'fs';
import http from 'http';

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

function parseCSV(csvContent) {
  const lines = csvContent.trim().split('\n');
  const headers = parseCSVLine(lines[0]);
  const events = [];
  
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
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

async function uploadEvents(events) {
  const payload = {
    filename: 'bitcoin_events_all_quoted.csv',
    events: events
  };

  const data = JSON.stringify(payload);

  const options = {
    hostname: 'localhost',
    port: 5000,
    path: '/api/batch-events/upload',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(data)
    }
  };

  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let responseData = '';
      
      res.on('data', (chunk) => {
        responseData += chunk;
      });
      
      res.on('end', () => {
        try {
          const response = JSON.parse(responseData);
          resolve({ status: res.statusCode, data: response });
        } catch (error) {
          resolve({ status: res.statusCode, data: responseData });
        }
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    req.write(data);
    req.end();
  });
}

async function main() {
  try {
    console.log('Reading CSV file...');
    const csvContent = fs.readFileSync('attached_assets/bitcoin_events_all_quoted_1758820875859.csv', 'utf8');
    
    console.log('Parsing CSV data...');
    const events = parseCSV(csvContent);
    
    console.log(`Found ${events.length} events to upload`);
    console.log('First few events:');
    events.slice(0, 3).forEach((event, i) => {
      console.log(`${i+1}. ${event.date}: ${event.summary.substring(0, 60)}...`);
    });
    
    console.log('\nUploading to API...');
    const result = await uploadEvents(events);
    
    console.log('\n✅ Upload completed!');
    console.log('Status:', result.status);
    console.log('Response:', JSON.stringify(result.data, null, 2));
    
  } catch (error) {
    console.error('❌ Upload failed:', error);
  }
}

main();