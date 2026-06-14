-- Drop redundant join tables and dead configuration tables.
-- Source of truth: topic_categories on historical_news_analyses, tags_version2 for entity tags.

DROP TABLE IF EXISTS tag_topics CASCADE;
DROP TABLE IF EXISTS page_topics CASCADE;
DROP TABLE IF EXISTS pages_and_tags CASCADE;
DROP TABLE IF EXISTS source_credibility CASCADE;
DROP TABLE IF EXISTS spam_domains CASCADE;
DROP TABLE IF EXISTS ai_prompts CASCADE;
DROP TABLE IF EXISTS users CASCADE;

-- Remove storyline topics not in the v2 hierarchy (groups + leaves only).
DELETE FROM topics
WHERE lower(trim(name)) NOT IN (
  lower('Bitcoin'),
  lower('Markets'),
  lower('Macroeconomy'),
  lower('Crypto policy & regulation'),
  lower('Web3 & other crypto'),
  lower('Early Bitcoin history'),
  lower('Satoshi identity'),
  lower('Halving events'),
  lower('Protocol & upgrades'),
  lower('Bitcoin mining'),
  lower('Wallets & self-custody'),
  lower('Bitcoin adoption'),
  lower('Scaling and Layer 2'),
  lower('Bitcoin price & cycles'),
  lower('Exchanges'),
  lower('Institutional Bitcoin & flows'),
  lower('Derivatives'),
  lower('ETFs and investment products'),
  lower('Inflation'),
  lower('Monetary policy & rates'),
  lower('Banking stress'),
  lower('Debt crises'),
  lower('Labor market'),
  lower('Housing'),
  lower('Bailouts and stimulus'),
  lower('Global growth and recession'),
  lower('Politics and elections'),
  lower('Bitcoin regulation'),
  lower('Securities regulation'),
  lower('Tax policy'),
  lower('Banking & prudential (crypto)'),
  lower('Sanctions and enforcement'),
  lower('Legal cases'),
  lower('Government adoption'),
  lower('CBDCs'),
  lower('Enforcement & crime'),
  lower('Smart contracts & L1s'),
  lower('Stablecoins'),
  lower('DeFi'),
  lower('NFTs and gaming'),
  lower('Cross-chain and bridges'),
  lower('Web3 industry and funding')
);
