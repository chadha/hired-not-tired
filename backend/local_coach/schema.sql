CREATE SCHEMA IF NOT EXISTS hnt_pm;
CREATE TABLE IF NOT EXISTS hnt_pm.inventory (
    singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    digest text NOT NULL,
    metadata jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS hnt_pm.company (
    organization_key text PRIMARY KEY,
    record jsonb NOT NULL,
    search_text tsvector NOT NULL
);
CREATE TABLE IF NOT EXISTS hnt_pm.job (
    source_id text PRIMARY KEY,
    organization_key text NOT NULL REFERENCES hnt_pm.company,
    listed_on date,
    record jsonb NOT NULL,
    search_text tsvector NOT NULL
);
CREATE INDEX IF NOT EXISTS job_search ON hnt_pm.job USING gin(search_text);
CREATE INDEX IF NOT EXISTS company_search ON hnt_pm.company USING gin(search_text);
CREATE INDEX IF NOT EXISTS job_company ON hnt_pm.job(organization_key);
CREATE INDEX IF NOT EXISTS job_date ON hnt_pm.job(listed_on DESC NULLS LAST);
CREATE TABLE IF NOT EXISTS hnt_pm.company_source (
    organization_key text NOT NULL REFERENCES hnt_pm.company ON DELETE CASCADE,
    section text NOT NULL, url text NOT NULL, revision text, content text NOT NULL,
    PRIMARY KEY(organization_key,section)
);
CREATE TABLE IF NOT EXISTS hnt_pm.cv (
    singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    filename text NOT NULL, format text NOT NULL, content text NOT NULL
);
CREATE TABLE IF NOT EXISTS hnt_pm.chat (
    id uuid PRIMARY KEY, title text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS hnt_pm.turn (
    id uuid PRIMARY KEY, chat_id uuid NOT NULL REFERENCES hnt_pm.chat,
    question text NOT NULL, answer text NOT NULL, sources jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS turn_chat ON hnt_pm.turn(chat_id, created_at);
CREATE TABLE IF NOT EXISTS hnt_pm.chat_focus (
    chat_id uuid PRIMARY KEY REFERENCES hnt_pm.chat ON DELETE CASCADE,
    job_ids text[] NOT NULL CHECK (cardinality(job_ids) BETWEEN 0 AND 3)
);
