import "dotenv/config";
import { db } from "../db";
import { tags } from "@shared/schema";
import { sql } from "drizzle-orm";

async function main() {
  const summary = await db.execute(sql`
    SELECT 
      COUNT(*)::integer AS total,
      COUNT(*) FILTER (WHERE subcategory_path IS NOT NULL)::integer AS with_path
    FROM tags
  `);
  
  const { total, with_path } = summary.rows[0] as any;
  console.log(`Tags with subcategory_path: ${with_path}/${total}`);

  const samples = await db.select({
    id: tags.id,
    name: tags.name,
    category: tags.category,
    subcategoryPath: tags.subcategoryPath,
  })
    .from(tags)
    .where(sql`subcategory_path IS NOT NULL`)
    .limit(10);

  console.log("Sample tags with paths:");
  for (const row of samples) {
    console.log(`- ${row.name} (${row.category}) -> ${row.subcategoryPath?.join(" > ")}`);
  }
}

main().then(() => process.exit(0)).catch((err) => {
  console.error("Error checking paths:", err);
  process.exit(1);
});





