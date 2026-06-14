/** One-off generator for retag-tax-policy TARGET_BY_DATE. */
import "dotenv/config";

import { storage } from "../storage";
import { rankTopicCandidatesFromSummary } from "../services/editorial-pipeline/storyline-taxonomy";

const LEAF = "Tax policy";

const CRYPTO_TAX =
  /\b(bitcoin|btc|cryptocurrency|crypto asset|crypto trading|crypto tax|crypto gains|crypto income|crypto broker|crypto staking|crypto lending|crypto transactions|digital asset|virtual (currency|digital asset)|coinbase|tezos staking|broker definition)\b/i;
const CRYPTO_TAX_PHRASE =
  /\b(irs (crypto|bitcoin|tax|summons|probe|guidance|staking|refund)|treasury (crypto|broker)|gst on bitcoin|vat on (bitcoin|crypto)|capital gains (tax )?(on )?(bitcoin|crypto|cryptocurrency)|wealth tax.*bitcoin|double taxation.*bitcoin|tax-free.*(bitcoin|crypto|holding)|tax relief.*(bitcoin|crypto)|snapcard.*irs|chainalysis.*(bitcoin|tax)|tax reporting.*(bitcoin|crypto)|tax evad.*(bitcoin|crypto)|tax rules.*(crypto|staking|lending)|tax guidance.*(crypto|fork|airdrop|staking)|tax cut.*bitcoin|exempt.*(bitcoin|crypto).*tax|classif(y|ies|ying).*bitcoin.*(asset|income|capital)|barter.*bitcoin|accounting standards.*bitcoin|pay irs.*bitcoin|sues irs.*(staking|tezos)|portugal exempts crypto|norway classifies bitcoin|canada taxes bitcoin|germany.*(bitcoin|crypto).*tax|france.*cryptocurrency gains tax|australia.*(bitcoin|crypto).*(gst|tax)|spain.*bitcoin.*vat|japan.*crypto tax|deloitte.*bitcoin.*tax)\b/i;

const FISCAL_CLIFF =
  /\b(bush[- ]era tax cuts|bush tax cuts|fiscal cliff|supercommittee|tax[- ]cut extension|middle[- ]income.*tax cuts|wealthy.*tax cuts|expiring tax cuts|higher taxes on wealthy|50p tax rate|75% (tax|millionaires)|hollande.*tax|corporation tax cut|vat.*deficit|chancellor.*budget|senate blocks.*tax[- ]cut)\b/i;

const FTT_MACRO =
  /\b(financial transaction tax|tobin tax|transaction tax on (shares|financial|trades)|ftt for \d+ eurozone|eu lawmakers back a financial transaction tax|g20 rejects.*transaction tax|sarkozy pushes a financial transaction tax)\b/i;

const GENERIC_TAX =
  /\b(tax (havens?|avoidance|dodging|evasion|collection|cuts?|rates?|relief)|offshore (finance|abuse|trillions)|corporate tax|incorporation|undeclared.*funds|marijuana taxes|mining tax.*(coal|iron ore)|google cuts overseas tax|guernsey.*corporate tax|tax justice study|wealthy hide trillions|eu leaders confront.*tax dodging|uk'?s tax haven|brazil'?s tax agency warns of fund shortages)\b/i;

const POLITICS =
  /\b(eurozone taxes|common eurozone taxes|labour|conservative government|greenspan backs|congress (debates|returns|blocks)|obama proposes|obama pushes|france and germany push|constitutional council strikes down)\b/i;

const BANKING_IRS =
  /\b(swiss (regulator|banks).*drop american clients|banks.*drop american clients.*irs pressure)\b/i;

const BLOCKCHAIN_REG =
  /\b(bans local taxes on blockchain|blockchain records serve as evidence)\b/i;

/** Date-specific editorial overrides (checked first). */
const OVERRIDES: Record<string, string | null> = {
  "2010-04-20": null,
  "2010-06-29": "Politics and elections",
  "2011-11-17": LEAF,
  "2013-04-26": LEAF,
  "2013-06-27": LEAF,
  "2013-12-15": LEAF,
  "2014-01-15": LEAF,
  "2015-04-21": LEAF,
  "2015-07-20": LEAF,
  "2015-08-03": LEAF,
  "2016-03-21": LEAF,
  "2016-11-21": LEAF,
  "2017-03-19": LEAF,
  "2017-05-09": LEAF,
  "2017-06-06": "Bitcoin regulation",
  "2017-08-23": LEAF,
  "2018-04-27": LEAF,
  "2019-06-07": LEAF,
  "2019-09-08": null,
  "2019-10-09": LEAF,
  "2019-12-05": LEAF,
  "2020-01-19": LEAF,
  "2020-03-06": LEAF,
  "2021-05-26": LEAF,
  "2021-12-25": LEAF,
  "2022-05-12": LEAF,
  "2022-07-01": LEAF,
  "2023-11-16": LEAF,
};

function classify(date: string, summary: string): string | null {
  const s = summary.trim();
  if (!s) return null;

  if (OVERRIDES[date] !== undefined) return OVERRIDES[date];

  if (CRYPTO_TAX.test(s) || CRYPTO_TAX_PHRASE.test(s)) return LEAF;

  if (BLOCKCHAIN_REG.test(s)) return "Bitcoin regulation";

  if (BANKING_IRS.test(s)) return "Banking & prudential (crypto)";

  if (FTT_MACRO.test(s)) return null;

  if (FISCAL_CLIFF.test(s) || POLITICS.test(s)) return "Politics and elections";

  if (GENERIC_TAX.test(s)) return null;

  const ranking = rankTopicCandidatesFromSummary({ summary: s }, 3);
  if (ranking.confidence === "high" && ranking.primary && ranking.primary !== LEAF) {
    return ranking.primary;
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
