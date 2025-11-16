--
-- PostgreSQL database dump
--

-- Dumped from database version 16.9 (415ebe8)
-- Dumped by pg_dump version 16.9

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: ai_prompts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_prompts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    prompt text NOT NULL,
    purpose text,
    is_active boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: batch_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.batch_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    batch_id uuid NOT NULL,
    batch_number integer NOT NULL,
    original_date date NOT NULL,
    original_summary text NOT NULL,
    original_group text NOT NULL,
    enhanced_summary text,
    enhanced_reasoning text,
    status text DEFAULT 'pending'::text NOT NULL,
    ai_provider text DEFAULT 'openai'::text,
    processed_at timestamp without time zone,
    reviewed_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: event_batches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.event_batches (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    original_filename text NOT NULL,
    status text DEFAULT 'uploaded'::text NOT NULL,
    total_events integer DEFAULT 0 NOT NULL,
    processed_events integer DEFAULT 0 NOT NULL,
    approved_events integer DEFAULT 0 NOT NULL,
    rejected_events integer DEFAULT 0 NOT NULL,
    current_batch_number integer DEFAULT 1 NOT NULL,
    total_batches integer DEFAULT 1 NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    completed_at timestamp without time zone
);


--
-- Name: event_conflicts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.event_conflicts (
    id integer NOT NULL,
    source_date date NOT NULL,
    related_date date NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    cluster_id date
);


--
-- Name: event_conflicts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.event_conflicts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: event_conflicts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.event_conflicts_id_seq OWNED BY public.event_conflicts.id;


--
-- Name: historical_news_analyses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.historical_news_analyses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    date date NOT NULL,
    summary text NOT NULL,
    top_article_id text,
    last_analyzed timestamp without time zone DEFAULT now(),
    is_manual_override boolean DEFAULT false,
    ai_provider text DEFAULT 'openai'::text,
    reasoning text,
    article_tags jsonb,
    confidence_score numeric(5,2),
    sentiment_score numeric(3,2),
    sentiment_label text,
    topic_categories jsonb,
    duplicate_article_ids jsonb,
    total_articles_fetched integer DEFAULT 0,
    unique_articles_analyzed integer DEFAULT 0,
    is_flagged boolean DEFAULT false,
    flag_reason text,
    flagged_at timestamp without time zone,
    tier_used text,
    analyzed_articles jsonb,
    winning_tier text,
    tiered_articles jsonb,
    fact_check_verdict text,
    fact_check_confidence numeric(5,2),
    fact_check_reasoning text,
    fact_checked_at timestamp without time zone,
    perplexity_verdict text,
    perplexity_confidence numeric(5,2),
    perplexity_reasoning text,
    perplexity_correct_date date,
    perplexity_citations jsonb,
    perplexity_checked_at timestamp without time zone,
    perplexity_correct_date_text text,
    re_verified boolean DEFAULT false,
    re_verified_at timestamp without time zone,
    re_verification_date text,
    re_verification_summary text,
    re_verification_tier text,
    re_verification_articles jsonb,
    re_verification_reasoning text,
    re_verification_status text,
    re_verification_winner text,
    tags jsonb
);


--
-- Name: manual_news_entries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.manual_news_entries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    date date NOT NULL,
    title text NOT NULL,
    summary text NOT NULL,
    description text,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    is_flagged boolean DEFAULT false,
    flag_reason text,
    flagged_at timestamp without time zone
);


--
-- Name: source_credibility; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.source_credibility (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    domain text NOT NULL,
    credibility_score numeric(3,2) NOT NULL,
    category text,
    specialties jsonb,
    authority numeric(3,2)
);


--
-- Name: spam_domains; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.spam_domains (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    domain text NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id integer NOT NULL,
    username text NOT NULL,
    password text NOT NULL
);


--
-- Name: users_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.users_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: users_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.users_id_seq OWNED BY public.users.id;


--
-- Name: event_conflicts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_conflicts ALTER COLUMN id SET DEFAULT nextval('public.event_conflicts_id_seq'::regclass);


--
-- Name: users id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users ALTER COLUMN id SET DEFAULT nextval('public.users_id_seq'::regclass);


--
-- Name: ai_prompts ai_prompts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_prompts
    ADD CONSTRAINT ai_prompts_pkey PRIMARY KEY (id);


--
-- Name: batch_events batch_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.batch_events
    ADD CONSTRAINT batch_events_pkey PRIMARY KEY (id);


--
-- Name: event_batches event_batches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_batches
    ADD CONSTRAINT event_batches_pkey PRIMARY KEY (id);


--
-- Name: event_conflicts event_conflicts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_conflicts
    ADD CONSTRAINT event_conflicts_pkey PRIMARY KEY (id);


--
-- Name: historical_news_analyses historical_news_analyses_date_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.historical_news_analyses
    ADD CONSTRAINT historical_news_analyses_date_unique UNIQUE (date);


--
-- Name: historical_news_analyses historical_news_analyses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.historical_news_analyses
    ADD CONSTRAINT historical_news_analyses_pkey PRIMARY KEY (id);


--
-- Name: manual_news_entries manual_news_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.manual_news_entries
    ADD CONSTRAINT manual_news_entries_pkey PRIMARY KEY (id);


--
-- Name: source_credibility source_credibility_domain_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.source_credibility
    ADD CONSTRAINT source_credibility_domain_unique UNIQUE (domain);


--
-- Name: source_credibility source_credibility_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.source_credibility
    ADD CONSTRAINT source_credibility_pkey PRIMARY KEY (id);


--
-- Name: spam_domains spam_domains_domain_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.spam_domains
    ADD CONSTRAINT spam_domains_domain_unique UNIQUE (domain);


--
-- Name: spam_domains spam_domains_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.spam_domains
    ADD CONSTRAINT spam_domains_pkey PRIMARY KEY (id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: users users_username_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_username_unique UNIQUE (username);


--
-- Name: idx_batch_events_batch_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_batch_events_batch_id ON public.batch_events USING btree (batch_id);


--
-- Name: idx_batch_events_batch_number; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_batch_events_batch_number ON public.batch_events USING btree (batch_number);


--
-- Name: idx_batch_events_original_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_batch_events_original_date ON public.batch_events USING btree (original_date);


--
-- Name: idx_batch_events_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_batch_events_status ON public.batch_events USING btree (status);


--
-- Name: idx_event_batches_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_event_batches_created_at ON public.event_batches USING btree (created_at);


--
-- Name: idx_event_batches_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_event_batches_status ON public.event_batches USING btree (status);


--
-- Name: idx_event_conflicts_cluster_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_event_conflicts_cluster_id ON public.event_conflicts USING btree (cluster_id);


--
-- Name: idx_event_conflicts_related_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_event_conflicts_related_date ON public.event_conflicts USING btree (related_date);


--
-- Name: idx_event_conflicts_source_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_event_conflicts_source_date ON public.event_conflicts USING btree (source_date);


--
-- Name: idx_event_conflicts_unique_pair; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_event_conflicts_unique_pair ON public.event_conflicts USING btree (source_date, related_date);


--
-- Name: idx_historical_news_confidence; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_historical_news_confidence ON public.historical_news_analyses USING btree (confidence_score);


--
-- Name: idx_historical_news_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_historical_news_date ON public.historical_news_analyses USING btree (date);


--
-- Name: idx_historical_news_fact_check_verdict; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_historical_news_fact_check_verdict ON public.historical_news_analyses USING btree (fact_check_verdict);


--
-- Name: idx_historical_news_last_analyzed; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_historical_news_last_analyzed ON public.historical_news_analyses USING btree (last_analyzed);


--
-- Name: idx_historical_news_sentiment; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_historical_news_sentiment ON public.historical_news_analyses USING btree (sentiment_score);


--
-- Name: idx_manual_news_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_manual_news_created_at ON public.manual_news_entries USING btree (created_at);


--
-- Name: idx_manual_news_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_manual_news_date ON public.manual_news_entries USING btree (date);


--
-- Name: batch_events batch_events_batch_id_event_batches_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.batch_events
    ADD CONSTRAINT batch_events_batch_id_event_batches_id_fk FOREIGN KEY (batch_id) REFERENCES public.event_batches(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

