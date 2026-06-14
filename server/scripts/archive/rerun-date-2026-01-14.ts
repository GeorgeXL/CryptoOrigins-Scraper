import "dotenv/config";
import { rerunPipelineForDate } from "../services/editorial-pipeline/approved-writer";

async function main() {
  const out = await rerunPipelineForDate({ date: "2026-01-14", reviewer: "codex" });
  console.log(out);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

