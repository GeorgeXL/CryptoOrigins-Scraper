# Bitcoin News Analysis System

## Overview
This project is a full-stack Bitcoin/cryptocurrency news analysis system designed to automatically fetch, analyze, and track Bitcoin news from various sources using AI. Its primary purpose is to provide accurate, context-rich historical Bitcoin news insights, focusing on Bitcoin's operational history from January 3, 2009. The system features a dashboard for monitoring news analysis, comprehensive entity tagging, and a two-tier re-verification system for historical events. The ambition is to create a definitive platform for understanding Bitcoin's past through advanced AI analysis.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend
- **Framework**: React 18 with TypeScript
- **UI Components**: shadcn/ui with Radix UI
- **Styling**: Tailwind CSS with a custom Bitcoin-themed design system
- **State Management**: TanStack Query
- **Routing**: Wouter
- **Build Tool**: Vite

### Backend
- **Runtime**: Node.js with Express.js
- **Database**: PostgreSQL with Drizzle ORM, hosted on Neon
- **API Design**: RESTful API
- **Build System**: ESBuild

### Core Features
- **News Analysis**: Multi-source news fetching, AI-powered summarization (100-110 characters, strictly enforced), and historical period detection.
- **Historical Analysis**: Sophisticated period-aware filtering (2009-2030) and a three-tier sequential validation system (Bitcoin → Crypto/Web3 → Macroeconomics) that optimizes API usage by stopping at the first significant tier.
- **AI Integration**: Uses OpenAI ChatGPT-5 nano (latest model) for news analysis, significance validation, and summarization, with period-specific prompting.
- **Entity Tagging System**: AI-powered extraction and categorization of entities (countries, companies, people, cryptocurrencies, organizations, protocols) from news summaries. Includes a Tags Browser for management, multi-entity filtering, and bulk operations.
- **Two-Tier Re-Verification System**: Combines OpenAI coverage analysis with Perplexity fact-checking for historical event date corrections. Utilizes cached articles for efficiency and includes dual-date manual entry protection.
- **Fact-Check System**: AI-powered verification of historical event accuracy, limited to events through September 30, 2023, due to OpenAI model knowledge cutoff.
- **Data Management**: Comprehensive CRUD operations, real-time updates, and robust error handling.
- **Performance**: PostgreSQL indexes, in-memory caching, HTTP compression, virtual scrolling, and intelligent API caching.
- **User Interface**: Dashboard overview, detailed monthly and daily analysis views, and an Event Cockpit for managing historical events.
- **Data Import**: Features for URL scraping and CSV import of Bitcoin events.

### System Design Choices
- **Sequential Waterfall Architecture**: A three-tier validation system ensures uniform behavior across all dates (2009-2025) and minimizes API calls by stopping at the first significant tier. Each tier uses a single EXA API call.
- **AI-Driven Article Selection**: Replaces traditional relevance scores with AI analysis for unbiased article selection.
- **Dual-Column Date Storage**: Implemented for safe migration of Perplexity date corrections, preserving original dates for backward compatibility.

## External Dependencies

### Core Services
- **EXA API**: Primary news source aggregation, used with a simplified single-call-per-tier approach for Bitcoin, Crypto/Web3, and Macroeconomic news.
- **OpenAI API**: Utilizes ChatGPT-5 nano for intelligent news analysis, tier significance validation, and summarization.
- **Perplexity API**: Uses the "sonar" model for grounded fact-checking with citations, primarily for re-verification of contradicted events.
- **Neon Database**: Serverless PostgreSQL hosting.

### Development & Utilities
- **shadcn/ui**: Pre-built UI components.
- **Tailwind CSS**: Styling framework.
- **Drizzle Kit**: Database migration and management.
- **TypeScript**: Type safety.

### Authentication & Session Management
- **connect-pg-simple**: PostgreSQL session store.
- **Express Session**: Server-side session management.