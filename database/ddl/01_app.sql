-- RetailFlow: application metadata.

CREATE TABLE IF NOT EXISTS app.data_source (
    source_id         serial PRIMARY KEY,
    name              text NOT NULL UNIQUE,
    source_type       text NOT NULL CHECK (source_type IN ('csv_file','api','database','synthetic')),
    dataset           text NOT NULL,
    description       text,
    location_hint     text,
    status            text NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active','inactive','error')),
    validation_status text NOT NULL DEFAULT 'not_validated'
                      CHECK (validation_status IN ('not_validated','valid','invalid')),
    last_ingested_at  timestamptz,
    last_record_count integer,
    config            jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE app.data_source IS 'Configured retail data sources (file or API) feeding the platform';

CREATE TABLE IF NOT EXISTS app.etl_pipeline (
    pipeline_id   serial PRIMARY KEY,
    name          text NOT NULL UNIQUE,
    description   text,
    pipeline_type text NOT NULL CHECK (pipeline_type IN ('ingestion','transformation','quality','reconciliation','master')),
    source_id     integer REFERENCES app.data_source(source_id) ON DELETE SET NULL,
    target_table  text,
    engine        text NOT NULL DEFAULT 'retailflow-native'
                  CHECK (engine IN ('retailflow-native','pentaho')),
    is_executable boolean NOT NULL DEFAULT true,
    is_active     boolean NOT NULL DEFAULT true,
    created_at    timestamptz NOT NULL DEFAULT now()
);
COMMENT ON COLUMN app.etl_pipeline.engine IS 'retailflow-native = runs in-process via the API. pentaho = designed as Spoon artifacts, executed by Pentaho, NOT by the API.';

CREATE TABLE IF NOT EXISTS app.pipeline_stage (
    stage_id    serial PRIMARY KEY,
    pipeline_id integer NOT NULL REFERENCES app.etl_pipeline(pipeline_id) ON DELETE CASCADE,
    stage_order integer NOT NULL,
    stage_name  text NOT NULL,
    stage_kind  text NOT NULL CHECK (stage_kind IN ('extract','stage','validate','transform','load','reconcile')),
    description text,
    UNIQUE (pipeline_id, stage_order)
);

CREATE TABLE IF NOT EXISTS app.app_user (
    user_id       serial PRIMARY KEY,
    email         text NOT NULL UNIQUE,
    full_name     text NOT NULL,
    role          text NOT NULL CHECK (role IN ('administrator','data_engineer','business_analyst','viewer')),
    password_hash text,
    is_active     boolean NOT NULL DEFAULT true,
    created_at    timestamptz NOT NULL DEFAULT now()
);
COMMENT ON COLUMN app.app_user.password_hash IS 'Reserved for AUTH_ENABLED=true. NULL while local development mode is active.';

CREATE TABLE IF NOT EXISTS app.app_setting (
    key           text PRIMARY KEY,
    value         text,
    value_type    text NOT NULL DEFAULT 'string' CHECK (value_type IN ('string','int','bool','json')),
    is_ui_editable boolean NOT NULL DEFAULT false,
    description   text
);
COMMENT ON COLUMN app.app_setting.is_ui_editable IS 'true = changeable in the Settings page; false = must be set via environment variables.';
