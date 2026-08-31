# CryptoOrigins Editorial Pipeline

Research and editorial application that builds the historical event dataset used to prepare The Origins NFTs.

## What it does

- researches Bitcoin, crypto, and relevant macro events by date;
- ranks source articles and checks URL quality;
- generates summaries, topics, tags, and collector rarity;
- records agent steps, evidence, confidence, and handoffs;
- requires human review before approved editorial data is finalized;
- stores the canonical day records in Supabase/Postgres.

The marketplace backend later joins these records with Bitcoin dawn/dusk block data. This repository does not mint NFTs.

## Stack

React, Vite, TypeScript, Express, Drizzle ORM, PostgreSQL/Supabase, and multiple AI/search providers.

## Local development

```bash
pnpm install
pnpm dev
```

Type-check the project with:

```bash
pnpm check
```

Tests are TypeScript test files under `server/tests`, `shared`, and `client/src`. Run the relevant files with `tsx --test`.

## Configuration

Local configuration lives in `.env` and related local backups. All `.env*` files are ignored by Git and must remain local. Typical configuration includes `DATABASE_URL`, Supabase credentials, and AI/search provider credentials.

Never commit real keys. Use the deployment platform's environment settings for production.

## Main areas

| Path | Purpose |
|---|---|
| `client/src/pages` | Calendar, day review, events, and agent interfaces |
| `server/routes` | HTTP API |
| `server/services/editorial-pipeline` | Editorial orchestration and specialist agents |
| `server/services/homepage-checks` | Google and Perplexity verification |
| `shared/schema.ts` | Drizzle/Postgres data model |
| `shared` | Shared editorial rules and validation |
| `server/tests` | Pipeline and editorial regression tests |

## Deployment

The application has Vercel serverless support through `server/serverless.ts` and `vercel.json`. Confirm database migrations and environment variables before deployment.

See `AGENT_QUICKSTART.md` for the legacy autonomous-curator workflow. The current editorial pipeline in code is the authoritative implementation.
