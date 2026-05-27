alter table public.historical_news_analyses
add column if not exists suppressed_tag_suggestions text[];
