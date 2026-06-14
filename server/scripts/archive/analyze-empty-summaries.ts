import "dotenv/config";
import { db } from "../db";
import { historicalNewsAnalyses } from "@shared/schema";
import { sql } from "drizzle-orm";

async function main() {
  // Get the last 20 untagged summaries
  const analyses = await db
    .select({
      date: historicalNewsAnalyses.date,
      summary: historicalNewsAnalyses.summary,
    })
    .from(historicalNewsAnalyses)
    .where(
      sql`summary IS NOT NULL 
        AND summary != '' 
        AND (tags_version2 IS NULL 
          OR array_length(tags_version2, 1) IS NULL 
          OR array_length(tags_version2, 1) = 0)`
    )
    .orderBy(sql`RANDOM()`)
    .limit(20);

  console.log("🔍 Analyzing summaries that returned empty arrays:\n");
  console.log("=".repeat(80));

  analyses.forEach((analysis, idx) => {
    console.log(`\n${idx + 1}. ${analysis.date}`);
    console.log(`   "${analysis.summary}"`);
    
    // Check for entities that SHOULD be extracted
    const summary = analysis.summary;
    const entities: string[] = [];
    
    // Check for people (capitalized names)
    const personMatch = summary.match(/\b([A-Z][a-z]+ [A-Z][a-z]+)\b/);
    if (personMatch) {
      entities.push(`👤 Person: ${personMatch[1]}`);
    }
    
    // Check for companies/services (capitalized words, possibly with .)
    const companyMatch = summary.match(/\b([A-Z][a-zA-Z0-9]+(?:\.[a-zA-Z]+)?)\b/g);
    if (companyMatch) {
      const companies = companyMatch.filter(c => 
        !['The', 'US', 'UK', 'EU', 'SEC', 'IMF', 'Fed', 'LHC', 'G20'].includes(c) &&
        c.length > 2
      );
      if (companies.length > 0) {
        entities.push(`🏢 Company/Service: ${companies.slice(0, 3).join(', ')}`);
      }
    }
    
    // Check for countries/regions
    const countries = ['US', 'U.S.', 'UK', 'EU', 'China', 'Greece', 'Athens', 'Venezuela', 'Sudan'];
    const foundCountries = countries.filter(c => 
      summary.includes(c) || summary.includes(c.toLowerCase())
    );
    if (foundCountries.length > 0) {
      entities.push(`🌍 Country/Region: ${foundCountries.join(', ')}`);
    }
    
    // Check for organizations
    const orgs = ['SEC', 'IMF', 'Fed', 'Federal Reserve', 'Congress', 'Supreme Court', 'G20', 'LHC', 'NASA', 'BBC'];
    const foundOrgs = orgs.filter(org => 
      summary.includes(org) || summary.includes(org.toLowerCase())
    );
    if (foundOrgs.length > 0) {
      entities.push(`🏛️ Organization: ${foundOrgs.join(', ')}`);
    }
    
    // Check for political parties
    const parties = ['Labour', 'Conservatives', 'Republicans', 'Democrats'];
    const foundParties = parties.filter(p => summary.includes(p));
    if (foundParties.length > 0) {
      entities.push(`🗳️ Political Party: ${foundParties.join(', ')}`);
    }
    
    if (entities.length > 0) {
      console.log(`   ⚠️  MISSED ENTITIES:`);
      entities.forEach(e => console.log(`      ${e}`));
    } else {
      console.log(`   ✅ Genuinely empty (no extractable entities)`);
    }
  });
}

main().catch(console.error);

