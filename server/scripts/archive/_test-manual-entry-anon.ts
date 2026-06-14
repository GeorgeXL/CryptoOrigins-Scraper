import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { saveManualDayEntryWithSupabase } from "../../shared/manual-day-entry-save";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_ANON_KEY;
if (!url || !key) {
  console.error("Missing SUPABASE_URL or SUPABASE_ANON_KEY");
  process.exit(1);
}

const client = createClient(url, key);

try {
  const result = await saveManualDayEntryWithSupabase(client, {
    date: "2009-02-17",
    summary: "Test manual entry from repro script",
    sourceUrl: "https://example.com/test",
    topic: "Early Bitcoin history",
  });
  console.log("SUCCESS:", JSON.stringify(result, null, 2));
} catch (e) {
  console.error("ERROR:", e instanceof Error ? e.message : String(e));
  process.exit(1);
}
