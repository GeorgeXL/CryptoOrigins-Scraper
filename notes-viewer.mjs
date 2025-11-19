import "dotenv/config";
import express from "express";
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';

// This is a standalone file to replicate the Next.js example.
// It does not use the main application's code.

async function main() {
  const app = express();
  const port = 8080; // Use a different port to be completely isolated

  // --- Database Connection ---
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("🔴 FATAL: DATABASE_URL is not set. Please check your .env file.");
    process.exit(1);
  }
  
  // Clean the connection string provided by Supabase
  let cleanConnectionString = databaseUrl.replace(/[?&]supa=[^&]*/g, '');
  cleanConnectionString = cleanConnectionString.replace(/\?&/, '?');
  if (!cleanConnectionString.includes('sslmode=')) {
    const separator = cleanConnectionString.includes('?') ? '&' : '?';
    cleanConnectionString += `${separator}sslmode=require`;
  }

  const { Pool } = pg;
  const pool = new Pool({
    connectionString: cleanConnectionString,
    ssl: { rejectUnauthorized: false }
  });
  const db = drizzle(pool);

  console.log("✅ Database client configured for isolated viewer.");
  
  // --- The Route ---
  // This route mimics the Next.js server component behavior
  app.get("/notes", async (req, res) => {
    try {
      console.log("🚀 Querying 'notes' table...");
      
      // Directly query the database, just like in the Next.js example
      const { rows: notes } = await db.execute("SELECT * FROM notes;");
      
      console.log(`✅ Found ${notes.length} notes.`);

      // Format the data as a JSON string
      const jsonData = JSON.stringify(notes, null, 2);

      // Respond with a minimal HTML page containing the data
      const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <title>Raw Notes Data</title>
          <style>body { font-family: monospace; white-space: pre; }</style>
        </head>
        <body>${jsonData}</body>
        </html>
      `;
      
      res.setHeader('Content-Type', 'text/html');
      res.send(html);

    } catch (error) {
      console.error("❌ Error fetching notes:", error);
      const errorMessage = error instanceof Error ? error.message : "An unknown error occurred";
      res.status(500).send(`<pre>Error: ${errorMessage}</pre>`);
    }
  });

  // --- Start the Server ---
  app.listen(port, () => {
    console.log(`\n🎉 Isolated Notes Viewer is running!`);
    console.log(`🔗 Open this URL in your browser: http://localhost:${port}/notes`);
    console.log(`\nThis is a separate server and is not connected to your main application.`);
  });
}

main();
