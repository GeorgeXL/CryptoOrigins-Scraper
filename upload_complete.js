const https = require('http');

// Complete event data extracted from the CSV
const allEvents = [
  {"date":"2008-08-18","summary":"The domain bitcoin.org is registered, marking the first known online presence of the Bitcoin project.","group":"#OfficialBitcoin"},
  {"date":"2008-08-20","summary":"Satoshi emails Adam Back about Hashcash; Back points him to Wei Dai's b-money, inspiring Bitcoin's design.","group":"Satoshi Nakamoto - Emails"},
  {"date":"2008-10-31","summary":"Satoshi Nakamoto publishes the Bitcoin white paper, introducing peer-to-peer electronic cash to the world.","group":"#OfficialBitcoin"},
  {"date":"2009-01-03","summary":"The Bitcoin genesis block is mined by Satoshi, embedding a UK bank bailout headline as a timestamp.","group":"#OfficialBitcoin"},
  {"date":"2009-01-08","summary":"Announces Bitcoin v0.1 release on SourceForge, inviting others to run nodes and test the new network.","group":"Satoshi Nakamoto - Emails"},
  {"date":"2009-01-09","summary":"Bitcoin v0.1 released by Satoshi Nakamoto, the first open-source client launching the Bitcoin network.","group":"Bitcoin software variants"},
  {"date":"2009-01-12","summary":"Satoshi sends 10 BTC to Hal Finney in the first Bitcoin transaction ever recorded on the blockchain.","group":"#OfficialBitcoin"},
  {"date":"2009-02-04","summary":"Bitcoin v0.1.5 released, a bugfix patch addressing issues found after the initial launch.","group":"Bitcoin software variants"},
  {"date":"2009-02-11","summary":"Tells mailing list Bitcoin is based on cryptographic proof, not trust, solving the double-spend problem.","group":"Satoshi Nakamoto - Emails"},
  {"date":"2009-02-12","summary":"Bitcoin v0.1.6 released, an urgent patch to fix a critical bug shortly after v0.1.5.","group":"Bitcoin software variants"},
  {"date":"2009-05-02","summary":"Emails Martti Malmi (\"Sirius\"), asking for help writing FAQ text and running a node to support Bitcoin.","group":"Satoshi Nakamoto - Emails"},
  {"date":"2009-10-05","summary":"NewLibertyStandard posts first BTC/USD rate: $1 = 1,309.03 BTC, establishing initial valuation.","group":"#OfficialBitcoin"},
  {"date":"2009-10-12","summary":"First Bitcoin sale: 5,050 BTC traded for $5.02 via PayPal; earliest OTC valuation signal.","group":"#OfficialBitcoin"},
  {"date":"2009-12-16","summary":"Bitcoin v0.2.0 released, adding Linux support and multi-core mining improvements.","group":"Bitcoin software variants"},
  {"date":"2010-01-05","summary":"First Windows GUI miner released by Satoshi, easing entry for early home miners.","group":"Bitcoin software variants"},
  {"date":"2010-03-11","summary":"Bitcoin v0.2.1 released, maintenance patch with bugfixes after 0.2.0.","group":"Bitcoin software variants"},
  {"date":"2010-03-17","summary":"BitcoinMarket.com launches, becoming the first crypto exchange and enabling BTC price discovery.","group":"#OfficialBitcoin"},
  {"date":"2010-04-01","summary":"Bitcoin v0.2.2 released, further bug fixes and minor improvements.","group":"Bitcoin software variants"},
  {"date":"2010-05-17","summary":"Laszlo Hanyecz posts interest in buying food with Bitcoin, seeking real-world utility test.","group":"#OfficialBitcoin"},
  {"date":"2010-05-18","summary":"Laszlo makes specific offer on Bitcointalk: 10,000 BTC for two large pizzas delivered.","group":"#OfficialBitcoin"},
  {"date":"2010-05-20","summary":"Community discusses the economics of the trade, debating Bitcoin's real-world value.","group":"#OfficialBitcoin"},
  {"date":"2010-05-22","summary":"Laszlo Hanyecz buys two pizzas for 10,000 BTC, marking the first real-world Bitcoin commercial purchase.","group":"#OfficialBitcoin"},
  {"date":"2010-05-24","summary":"Community celebrates milestone; Jeremy Sturdivant accepts payment, annual Pizza Day tradition begins.","group":"#OfficialBitcoin"}
];

async function uploadToAPI() {
  const payload = {
    filename: 'bitcoin_events_all_quoted.csv',
    events: allEvents
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
    const req = https.request(options, (res) => {
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

// Run the upload
console.log(`Starting upload of ${allEvents.length} events...`);
uploadToAPI()
  .then(result => {
    console.log('Upload completed!');
    console.log('Status:', result.status);
    console.log('Response:', JSON.stringify(result.data, null, 2));
  })
  .catch(error => {
    console.error('Upload failed:', error);
  });