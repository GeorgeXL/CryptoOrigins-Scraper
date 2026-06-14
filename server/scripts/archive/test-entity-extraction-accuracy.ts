import "dotenv/config";
import { entityExtractor } from "../services/entity-extractor";

// Fixed test set of summaries that SHOULD have entities extracted
const testSummaries = [
  {
    summary: "Bitfinex halts incoming wire transfers due to banking issues raising concerns of potential exchange failure",
    expected: ["Bitfinex"], // Company/exchange
  },
  {
    summary: "Blockchain.info accounts via a MITM attack, exposing user data and prompting fixes",
    expected: ["Blockchain.info"], // Company/service
  },
  {
    summary: "NASA warns of a massive solar storm that may disrupt technology, affecting global communications and banking",
    expected: ["NASA"], // Organization
  },
  {
    summary: "BBC News reports approval for faster broadband rollout, enhancing internet access and speeds nationwide",
    expected: ["BBC"], // News organization
  },
  {
    summary: "Northwestern University researchers create a low-cost solar cell with high efficiency and reduced toxicity",
    expected: ["Northwestern University"], // University
  },
  {
    summary: "Anglo Irish Bank reveals controversial loan of 451 million euros to customers for buying its own shares",
    expected: ["Anglo Irish Bank"], // Bank
  },
  {
    summary: "Digg launches version 4 with a personalized news section but faces downtime due to overwhelming user traffic",
    expected: ["Digg"], // Company/service
  },
  {
    summary: "ShapeShift resumes operations after a recent hack and implements new security measures for user protection",
    expected: ["ShapeShift"], // Company/exchange
  },
  {
    summary: "Alpari introduces a demo version of MT5, featuring new order types and advanced reporting for traders",
    expected: ["Alpari", "MT5"], // Company and product
  },
  {
    summary: "Playboy sues Canada crypto firm for fraud and breach of contract in a legal battle over financial dealings",
    expected: ["Playboy", "Canada"], // Company and country
  },
  {
    summary: "Nick Clegg asserts that the upcoming election is not just between Labour and Conservatives presenting new options",
    expected: ["Nick Clegg", "Labour", "Conservatives"], // Person and political parties
  },
  {
    summary: "Protesters clash with police in Athens amid growing tensions around bailout loans and job cuts in Greece",
    expected: ["Athens", "Greece"], // City and country
  },
  {
    summary: "G20 finance ministers agree on new banking regulations focusing on long-term performance and risk disclosure",
    expected: ["G20"], // Organization
  },
  {
    summary: "U.S. government invites wealthy investors to join bailout efforts potentially involving nearly $1 trillion",
    expected: ["U.S."], // Country
  },
  {
    summary: "AFL-CIO survey reveals most US CEOs received pay hikes in 2008 despite economic downturn and bailouts",
    expected: ["AFL-CIO", "US"], // Organization and country
  },
  {
    summary: "FINTRAC announces administrative penalties against entities for money laundering and updates its guidance",
    expected: ["FINTRAC"], // Organization
  },
  {
    summary: "The Economist highlights the rise of print on demand technology revolutionizing the book publishing industry",
    expected: ["The Economist"], // News organization
  },
  {
    summary: "The decline of Russia's oligarchs becomes a pressing issue amid ongoing economic and political changes",
    expected: ["Russia"], // Country
  },
  {
    summary: "Simplecoin v5.0 is an open-source mining framework with features like instant cashout and worker monitoring",
    expected: ["Simplecoin"], // Product/company
  },
  {
    summary: "Kohn warns Congress that proposed audits could politicize the Fed and harm the economy and credit ratings",
    expected: ["Kohn", "Congress", "Fed"], // Person, organization, organization
  },
];

async function main() {
  console.log("🧪 Testing Entity Extraction Accuracy on Fixed Test Set\n");
  console.log("=".repeat(80));

  const results: Array<{
    summary: string;
    expected: string[];
    extracted: string[];
    success: boolean;
    missing: string[];
    extra: string[];
  }> = [];

  for (let i = 0; i < testSummaries.length; i++) {
    const test = testSummaries[i];
    console.log(`\n[${i + 1}/${testSummaries.length}] Testing...`);
    console.log(`Summary: "${test.summary.substring(0, 80)}..."`);
    console.log(`Expected: ${JSON.stringify(test.expected)}`);

    try {
      const extracted = await entityExtractor.extractEntities(test.summary);
      
      const missing = test.expected.filter(e => 
        !extracted.some(ex => ex.toLowerCase() === e.toLowerCase())
      );
      const extra = extracted.filter(e => 
        !test.expected.some(ex => ex.toLowerCase() === e.toLowerCase())
      );
      
      const success = missing.length === 0;
      
      results.push({
        summary: test.summary,
        expected: test.expected,
        extracted,
        success,
        missing,
        extra,
      });

      if (success && extra.length === 0) {
        console.log(`✅ Perfect match: ${JSON.stringify(extracted)}`);
      } else if (success) {
        console.log(`✅ All expected found: ${JSON.stringify(extracted)} (extra: ${JSON.stringify(extra)})`);
      } else {
        console.log(`⚠️  Extracted: ${JSON.stringify(extracted)}`);
        if (missing.length > 0) {
          console.log(`   Missing: ${JSON.stringify(missing)}`);
        }
        if (extra.length > 0) {
          console.log(`   Extra: ${JSON.stringify(extra)}`);
        }
      }
    } catch (error) {
      console.error(`❌ Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      results.push({
        summary: test.summary,
        expected: test.expected,
        extracted: [],
        success: false,
        missing: test.expected,
        extra: [],
      });
    }

    // Small delay
    if (i < testSummaries.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }

  console.log("\n" + "=".repeat(80));
  console.log("\n📊 ACCURACY RESULTS:\n");

  const perfect = results.filter(r => r.success && r.extra.length === 0).length;
  const allFound = results.filter(r => r.success).length;
  const totalExpected = results.reduce((sum, r) => sum + r.expected.length, 0);
  const totalExtracted = results.reduce((sum, r) => sum + r.extracted.length, 0);
  const totalMissing = results.reduce((sum, r) => sum + r.missing.length, 0);

  console.log(`   ✅ Perfect matches (all expected, no extra): ${perfect}/${testSummaries.length} (${((perfect/testSummaries.length)*100).toFixed(1)}%)`);
  console.log(`   ✅ All expected found (may have extras): ${allFound}/${testSummaries.length} (${((allFound/testSummaries.length)*100).toFixed(1)}%)`);
  console.log(`   🏷️  Total expected entities: ${totalExpected}`);
  console.log(`   🏷️  Total extracted entities: ${totalExtracted}`);
  console.log(`   ❌ Total missing entities: ${totalMissing}`);
  console.log(`   📈 Entity extraction rate: ${(((totalExpected - totalMissing) / totalExpected) * 100).toFixed(1)}%`);

  console.log("\n📋 DETAILED BREAKDOWN:\n");
  results.forEach((result, idx) => {
    if (!result.success || result.extra.length > 0) {
      console.log(`${idx + 1}. Expected: ${JSON.stringify(result.expected)}`);
      console.log(`   Extracted: ${JSON.stringify(result.extracted)}`);
      if (result.missing.length > 0) {
        console.log(`   ❌ Missing: ${JSON.stringify(result.missing)}`);
      }
      if (result.extra.length > 0) {
        console.log(`   ⚠️  Extra: ${JSON.stringify(result.extra)}`);
      }
      console.log();
    }
  });
}

main().catch(console.error);

