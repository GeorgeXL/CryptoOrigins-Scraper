import "dotenv/config";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import { historicalNewsAnalyses, pagesAndTags, tags } from "@shared/schema";

const CLEANUPS = [
  { date: "2020-01-04", remove: ["Adoption"] },
  { date: "2009-01-03", remove: ["Mining"] },
];

async function main() {
  for (const cleanup of CLEANUPS) {
    const [row] = await db
      .select({
        id: historicalNewsAnalyses.id,
        tagsVersion2: historicalNewsAnalyses.tagsVersion2,
      })
      .from(historicalNewsAnalyses)
      .where(eq(historicalNewsAnalyses.date, cleanup.date))
      .limit(1);

    if (!row) {
      console.log(`${cleanup.date}: no row`);
      continue;
    }

    const removeLower = new Set(cleanup.remove.map((tag) => tag.toLowerCase()));
    const nextTags = Array.isArray(row.tagsVersion2)
      ? row.tagsVersion2.filter((tag) => !removeLower.has(tag.toLowerCase()))
      : [];

    await db
      .update(historicalNewsAnalyses)
      .set({ tagsVersion2: nextTags, lastAnalyzed: new Date() })
      .where(eq(historicalNewsAnalyses.date, cleanup.date));

    const tagRows = await db
      .select({ id: tags.id })
      .from(tags)
      .where(inArray(tags.name, cleanup.remove));

    if (tagRows.length > 0) {
      await db
        .delete(pagesAndTags)
        .where(
          and(
            eq(pagesAndTags.analysisId, row.id),
            inArray(
              pagesAndTags.tagId,
              tagRows.map((tag) => tag.id),
            ),
          ),
        );
    }

    await db.execute(sql.raw("select 1"));
    console.log(`${cleanup.date}: ${JSON.stringify(row.tagsVersion2)} -> ${JSON.stringify(nextTags)}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

