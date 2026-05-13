-- Narrative topics layer (tags remain the entity layer; see product spec).
-- Safe to run if objects already exist (e.g. created in dashboard first).

CREATE TABLE IF NOT EXISTS topics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text UNIQUE,
  parent_topic_id uuid REFERENCES topics (id) ON DELETE SET NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_topics_parent_topic_id ON topics (parent_topic_id);

CREATE TABLE IF NOT EXISTS tag_topics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tag_id uuid NOT NULL REFERENCES tags (id) ON DELETE CASCADE,
  topic_id uuid NOT NULL REFERENCES topics (id) ON DELETE CASCADE,
  CONSTRAINT idx_tag_topics_unique UNIQUE (tag_id, topic_id)
);

CREATE INDEX IF NOT EXISTS idx_tag_topics_topic_id ON tag_topics (topic_id);

CREATE TABLE IF NOT EXISTS page_topics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_id uuid NOT NULL REFERENCES historical_news_analyses (id) ON DELETE CASCADE,
  topic_id uuid NOT NULL REFERENCES topics (id) ON DELETE CASCADE,
  is_primary boolean NOT NULL DEFAULT false,
  CONSTRAINT idx_page_topics_unique UNIQUE (analysis_id, topic_id)
);

CREATE INDEX IF NOT EXISTS idx_page_topics_topic_id ON page_topics (topic_id);
CREATE INDEX IF NOT EXISTS idx_page_topics_analysis_id ON page_topics (analysis_id);
