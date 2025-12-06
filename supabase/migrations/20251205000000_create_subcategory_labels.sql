-- Create subcategory_labels table for custom display names
-- This allows renaming subcategories from the UI without modifying taxonomy.ts

CREATE TABLE IF NOT EXISTS subcategory_labels (
  path TEXT PRIMARY KEY,           -- e.g., "1.2" or "4.1.2"
  label TEXT NOT NULL,             -- Custom display name
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Add comment for documentation
COMMENT ON TABLE subcategory_labels IS 'Custom display labels for subcategories, overrides defaults from taxonomy.ts';

