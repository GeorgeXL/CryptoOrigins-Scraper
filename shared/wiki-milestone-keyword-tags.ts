/**
 * Extract 1–2 keyword tags from Bitcoin Wiki milestone text.
 * Prefers concrete named entities (exchanges, people, products) plus Bitcoin when useful.
 */
const ENTITY_RULES: Array<{ test: RegExp; tag: string }> = [
  { test: /\bmt\.?\s*gox\b/i, tag: "Mt. Gox" },
  { test: /\bbitcoin market\b/i, tag: "Bitcoin Market" },
  { test: /\bbritcoin\b/i, tag: "Britcoin" },
  { test: /\bbitmarket\.eu\b/i, tag: "BitMarket.eu" },
  { test: /\bbitcoin brazil\b/i, tag: "Bitcoin Brazil" },
  { test: /\bvirwox\b/i, tag: "VirWoX" },
  { test: /\bnew liberty standard\b/i, tag: "New Liberty Standard" },
  { test: /\bbitcoin-?central\b/i, tag: "Bitcoin-Central" },
  { test: /\bcoinbase\b/i, tag: "Coinbase" },
  { test: /\bdeepbit\b/i, tag: "DeepBit" },
  { test: /\bcoinotron\b/i, tag: "Coinotron" },
  { test: /\bp2pool\b/i, tag: "P2Pool" },
  { test: /\bslush\b/i, tag: "Slush Pool" },
  { test: /\blinode\b/i, tag: "Linode" },
  { test: /\broom77\b/i, tag: "Room77" },
  { test: /\bfincen\b/i, tag: "FinCEN" },
  { test: /\bbitcoin foundation\b/i, tag: "Bitcoin Foundation" },
  { test: /\beff\b/i, tag: "EFF" },
  { test: /\bsatoshi dice\b/i, tag: "SatoshiDice" },
  { test: /\bweusecoins\b/i, tag: "WeUseCoins" },
  { test: /\bhal finney\b/i, tag: "Hal Finney" },
  { test: /\bsatoshi nakamoto\b/i, tag: "Satoshi Nakamoto" },
  { test: /\bartforz\b/i, tag: "ArtForz" },
  { test: /\bjgarzik\b/i, tag: "jgarzik" },
  { test: /\bpuddinpop\b/i, tag: "puddinpop" },
  { test: /\bopencl\b/i, tag: "OpenCL" },
  { test: /\bcuda\b/i, tag: "CUDA" },
  { test: /\breditt\b/i, tag: "Reddit" },
  { test: /\bwikipedia\b/i, tag: "Wikipedia" },
  { test: /\bslashdot\b/i, tag: "Slashdot" },
  { test: /\bfreenode\b/i, tag: "freenode" },
  { test: /\b#bitcoin-otc\b/i, tag: "#bitcoin-otc" },
  { test: /\b#bitcoin-dev\b/i, tag: "freenode" },
  { test: /\btonal bitcoin\b/i, tag: "Tonal Bitcoin" },
  { test: /\blen sassaman\b/i, tag: "Len Sassaman" },
  { test: /\bmike hearn\b/i, tag: "Mike Hearn" },
  { test: /\bmagicaltux\b/i, tag: "MagicalTux" },
  { test: /\bjed mccaleb\b/i, tag: "Jed McCaleb" },
  { test: /\ballinvain\b/i, tag: "allinvain" },
  { test: /\btime article\b/i, tag: "TIME" },
  { test: /\bpizza\b/i, tag: "Laszlo Hanyecz" },
  { test: /\bnokia n900\b/i, tag: "Nokia N900" },
  { test: /\bbitcoin forum\b/i, tag: "Bitcoin Forum" },
  { test: /\bp2sh\b|\bbip 16\b/i, tag: "P2SH" },
  { test: /\bbloom filter\b/i, tag: "Bitcoin Core" },
  { test: /\bbitcoin core\b|\bbitcoin-qt\b|\bbitcoind\b|\bv0\.\d/i, tag: "Bitcoin Core" },
  { test: /\bgpu\b/i, tag: "GPU" },
  { test: /\bprague\b/i, tag: "Prague" },
  { test: /\blondon\b/i, tag: "London" },
  { test: /\bnyc\b|\bnew york\b/i, tag: "New York" },
  { test: /\bhalving\b/i, tag: "Bitcoin" },
  { test: /\bgenesis block\b/i, tag: "Bitcoin" },
  { test: /\bwhitepaper\b/i, tag: "Satoshi Nakamoto" },
  { test: /\bsatoshi\b/i, tag: "Satoshi Nakamoto" },
];

const BITCOIN_TAG = "Bitcoin";

function isBitcoinTag(tag: string): boolean {
  return tag.trim().toLowerCase() === BITCOIN_TAG.toLowerCase();
}

export function extractWikiMilestoneKeywordTags(
  wikiMilestone: string,
  summary = "",
): string[] {
  const tagsFromMilestone = pickEntityTags(wikiMilestone);
  if (tagsFromMilestone.length >= 2) return tagsFromMilestone.slice(0, 2);
  if (tagsFromMilestone.length === 1) {
    if (isBitcoinTag(tagsFromMilestone[0])) return tagsFromMilestone;
    return [...tagsFromMilestone, BITCOIN_TAG];
  }

  const tagsFromSummary = pickEntityTags(summary);
  if (tagsFromSummary.length >= 1) {
    const primary = tagsFromSummary[0];
    if (isBitcoinTag(primary)) return [primary];
    return tagsFromSummary.length >= 2
      ? tagsFromSummary.slice(0, 2)
      : [primary, BITCOIN_TAG];
  }

  return [BITCOIN_TAG];
}

function pickEntityTags(text: string): string[] {
  const haystack = text.trim();
  if (!haystack) return [];
  const tags: string[] = [];
  for (const rule of ENTITY_RULES) {
    if (!rule.test.test(haystack)) continue;
    if (!tags.includes(rule.tag)) tags.push(rule.tag);
    if (tags.length >= 2) break;
  }
  return tags;
}
