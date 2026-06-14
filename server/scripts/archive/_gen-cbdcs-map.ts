/** One-off generator for retag-cbdcs TARGET_BY_DATE. */
import "dotenv/config";

import { storage } from "../storage";
import { rankTopicCandidatesFromSummary } from "../services/editorial-pipeline/storyline-taxonomy";

const LEAF = "CBDCs";

const STRONG_CBDC =
  /\b(cbdc[s]?|central bank digital|digital (yuan|euro|dollar|peso|shekel|rupee|rand|real|lira|franc)|e[- ]?naira|sand dollar|jam[- ]?dex|mintchip|em[cC]ash|rscoin|sovereign digital currency|state[- ]backed digital currency|digital currency.*central bank|central bank.*digital currency|central bank.*(pilot[s]?|launch(es|ed|ing)?|rollout|tests?|explores?|develops?|issues?)|bank of (israel|jamaica|england|canada|korea|thailand|indonesia|mexico|brazil|france|sweden|norway|singapore|australia|new zealand|china|japan).*digital|pboc.*digital|ecb.*digital euro|fed.*digital dollar|digital finance strategy|digital euro|digital shekel|digital peso|bitt inc.*cbdc|cbdc pilot|cbdc rollout|cbdc launch|public consultation.*digital finance|bsn.*digital yuan|digital yuan|muFG coin is not cbdc)\b/i;

const CBDC_PILOT_LAUNCH =
  /\b(pilot[s]? (the )?sand dollar|launches (the )?e[- ]?naira|launches (its )?cbdc|officially launches.*cbdc|cbdc.*nationwide|joins.*cbdc pilot|explores a digital currency|explore[s]? rscoin|weighing blockchain.*digital currency|digital currency to (cut|modernize|streamline)|no fad.*cbdc|logical next step for money)\b/i;

const BITCOIN_HEADLINE =
  /\b(bitcoin law|el salvador|legal tender|retirees protest bitcoin|twitter adds tipping|worldcoin launches|maker foundation.*class[- ]action|microstrategy|bitcoin climbs|btc\b.*surge)\b/i;

const COMMERCIAL_BANK_COIN =
  /\b(mufg coin|jpm coin|bank[- ]issued.*digital currency|commercial bank.*digital currency)\b/i;

const GENERAL_BLOCKCHAIN_POLICY =
  /\b(blockchain adoption to modernize|crypto[- ]asset framework|digital resilience rules|digital finance strategy with crypto)\b/i;

const GOVERNMENT_ADOPTION =
  /\b(legal tender|nation[- ]state|government adoption|el salvador|official currency|accept(s)? bitcoin.*tax)\b/i;

const STABLECOIN =
  /\b(stablecoin|usdt|tether|usdc|depeg)\b/i;

const DEFI =
  /\b(defi|maker foundation|uniswap|aave|compound)\b/i;

const REGULATION =
  /\b(crypto bills|regulation|regulatory framework|sec charges|fca rules)\b/i;

/** Date-specific editorial overrides (checked first). */
const OVERRIDES: Record<string, string | null> = {
  "2012-04-04": null,
  "2014-07-25": "Government adoption",
  "2014-07-26": "Government adoption",
  "2015-03-17": null,
  "2016-02-01": null,
  "2016-02-15": LEAF,
  "2016-03-13": LEAF,
  "2017-10-05": "Government adoption",
  "2017-10-06": "Government adoption",
  "2019-10-11": null,
  "2019-12-21": "Government adoption",
  "2019-12-26": LEAF,
  "2020-04-03": LEAF,
  "2020-04-15": LEAF,
  "2020-09-20": null,
  "2020-09-24": "Bitcoin regulation",
  "2020-11-02": null,
  "2021-01-16": LEAF,
  "2021-03-25": "Cross-chain and bridges",
  "2021-09-04": LEAF,
  "2021-10-25": LEAF,
  "2022-07-11": LEAF,
  "2023-01-07": LEAF,
  "2023-06-24": LEAF,
  "2023-07-29": null,
};

function cbdcIsHeadline(summary: string): boolean {
  const s = summary.trim();
  if (STRONG_CBDC.test(s) || CBDC_PILOT_LAUNCH.test(s)) return true;
  const cbdcIdx = s.search(/\b(cbdc|central bank digital|digital yuan|digital euro|e[- ]?naira|sand dollar|jam[- ]?dex|digital shekel|digital peso|rscoin)\b/i);
  if (cbdcIdx < 0) return false;
  const bitcoinIdx = s.search(/\b(bitcoin|btc|worldcoin|maker foundation|twitter adds tipping)\b/i);
  return bitcoinIdx < 0 || cbdcIdx <= bitcoinIdx;
}

function classify(date: string, summary: string): string | null {
  const s = summary.trim();
  if (!s) return null;

  if (OVERRIDES[date] !== undefined) return OVERRIDES[date];

  if (COMMERCIAL_BANK_COIN.test(s) && !/\bcentral bank\b/i.test(s)) return null;

  if (cbdcIsHeadline(s)) return LEAF;

  if (GENERAL_BLOCKCHAIN_POLICY.test(s) && !STRONG_CBDC.test(s)) {
    if (REGULATION.test(s)) return "Bitcoin regulation";
    return null;
  }

  if (BITCOIN_HEADLINE.test(s) && !STRONG_CBDC.test(s) && !CBDC_PILOT_LAUNCH.test(s)) {
    if (GOVERNMENT_ADOPTION.test(s)) return "Government adoption";
    if (DEFI.test(s)) return "DeFi";
    if (REGULATION.test(s)) return "Bitcoin regulation";
    return null;
  }

  if (STABLECOIN.test(s)) return "Stablecoins";

  const ranking = rankTopicCandidatesFromSummary({ summary: s }, 5);
  if (ranking.primary && ranking.primary !== LEAF && ranking.confidence === "high") return ranking.primary;
  if (ranking.candidates[0] && ranking.candidates[0].leaf !== LEAF && ranking.candidates[0].score >= 12) {
    return ranking.candidates[0].leaf;
  }

  return null;
}

async function main() {
  const rows = await storage.getAnalysesForStorylineLeaf(LEAF);
  const map: Record<string, string | null> = {};
  const stats = { keep: 0, moved: 0, cleared: 0 };
  const byTarget: Record<string, number> = {};

  for (const row of rows) {
    const target = classify(row.date, row.summary ?? "");
    map[row.date] = target;
    const key = target ?? "(clear)";
    byTarget[key] = (byTarget[key] ?? 0) + 1;
    if (target === LEAF) stats.keep += 1;
    else if (target === null) stats.cleared += 1;
    else stats.moved += 1;
    console.error(JSON.stringify({ date: row.date, target, summary: row.summary?.slice(0, 100) }));
  }

  console.error(JSON.stringify({ total: rows.length, stats, byTarget }, null, 2));

  const lines = Object.entries(map)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, target]) => {
      const val = target === null ? "null" : `"${target}"`;
      return `  "${date}": ${val},`;
    });

  console.log("const TARGET_BY_DATE: Record<string, string | null> = {");
  console.log(lines.join("\n"));
  console.log("};");
}

main().catch(console.error);
