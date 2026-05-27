import {
  evaluateTagConsistency,
  getDayTaxonomy,
  getEditorialDuplicateNeighborContext,
  topicLabelsFromRow,
} from "../services/editorial-pipeline/tools";

const dates = process.argv.slice(2);
const targets = dates.length ? dates : ["2020-05-23", "2013-05-24"];

function isStrongDuplicate(neighbor: {
  tokenJaccard: number;
  sharedTags: string[];
  sharedTopics: string[];
}): boolean {
  const j = neighbor.tokenJaccard;
  const st = neighbor.sharedTags.length;
  const sp = neighbor.sharedTopics.length;
  if (j >= 0.92 && st >= 1) return true;
  if (j >= 0.84 && st >= 2) return true;
  if (j >= 0.8 && st >= 2 && sp >= 1) return true;
  if (j >= 0.76 && st >= 3) return true;
  return false;
}

function preview(text: string, max = 140): string {
  const out = text.replace(/\s+/g, " ").trim();
  return out.length > max ? `${out.slice(0, max)}…` : out;
}

async function main() {
  for (const date of targets) {
    const row = await getDayTaxonomy(date);
    if (!row) {
      console.log(`${date}: no analysis row.`);
      continue;
    }

    const tags = Array.isArray(row.tagsVersion2) ? row.tagsVersion2.filter((t) => typeof t === "string") : [];
    const topics = topicLabelsFromRow(row.topicCategories);
    const tagEval = evaluateTagConsistency({ summary: row.summary ?? "", tags, topics });

    console.log(`\n${date}: ${preview(row.summary ?? "")}`);
    if (tagEval.issues.length) {
      tagEval.issues.forEach((issue) => console.log(`  tag mismatch: ${issue.message}`));
    } else {
      console.log("  tag consistency: ok");
    }

    const dup = await getEditorialDuplicateNeighborContext({ date, analysisId: row.id });
    if (!dup || dup.neighbors.length === 0) {
      console.log("  duplicate scan: no strong neighbors");
      continue;
    }
    const strong = dup.neighbors.find(isStrongDuplicate);
    if (strong) {
      console.log(
        `  duplicate scan: strong overlap with ${strong.date} (jaccard=${strong.tokenJaccard}, shared_tags=${strong.sharedTags.join(", ") || "—"})`
      );
    } else {
      console.log(`  duplicate scan: ${dup.neighbors.length} neighbors, none above strong threshold`);
    }
  }
}

main().catch((err) => {
  console.error("smoke-editorial-quality failed:", err);
  process.exitCode = 1;
});
