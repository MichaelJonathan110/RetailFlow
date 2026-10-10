-- RetailFlow: operational metadata (ETL logs, rejects, quality, reconciliation).

CREATE TABLE IF NOT EXISTS ops.ingest_batch (
    batch_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    dataset         text NOT NULL,
    source_id       integer REFERENCES app.data_source(source_id) ON DELETE SET NULL,
    file_name       text NOT NULL,
    file_size_bytes bigint NOT NULL,
    file_sha256     text NOT NULL,
    status          text NOT NULL DEFAULT 'received'
                    CHECK (status IN ('received','staged','validated','loaded','failed','duplicate')),
    row_count       integer NOT NULL DEFAULT 0,
    accepted_count  integer NOT NULL DEFAULT 0,
    rejected_count  integer NOT NULL DEFAULT 0,
    duplicate_of    uuid REFERENCES ops.ingest_batch(batch_id) ON DELETE SET NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    completed_at    timestamptz
);
CREATE INDEX IF NOT EXISTS ix_ingest_batch_dataset ON ops.ingest_batch (dataset, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_ingest_batch_sha ON ops.ingest_batch (dataset, file_sha256);
COMMENT ON COLUMN ops.ingest_batch.duplicate_of IS 'Set when the same file content (sha256) was already ingested for this dataset.';

CREATE TABLE IF NOT EXISTS ops.etl_run_log (
    run_id             bigserial PRIMARY KEY,
    run_uid            uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
    pipeline_id        integer REFERENCES app.etl_pipeline(pipeline_id) ON DELETE SET NULL,
    batch_id           uuid REFERENCES ops.ingest_batch(batch_id) ON DELETE SET NULL,
    trigger_type       text NOT NULL CHECK (trigger_type IN ('manual','scheduled','api','pentaho','seed')),
    engine             text NOT NULL DEFAULT 'retailflow-native',
    status             text NOT NULL CHECK (status IN ('queued','running','succeeded','failed','partial','unknown')),
    started_at         timestamptz NOT NULL DEFAULT now(),
    finished_at        timestamptz,
    duration_ms        integer,
    rows_read          integer NOT NULL DEFAULT 0,
    rows_inserted      integer NOT NULL DEFAULT 0,
    rows_updated       integer NOT NULL DEFAULT 0,
    rows_rejected      integer NOT NULL DEFAULT 0,
    error_summary      text,
    execution_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    CONSTRAINT ck_run_finish_after_start CHECK (finished_at IS NULL OR finished_at >= started_at),
    CONSTRAINT ck_run_duration_nonneg CHECK (duration_ms IS NULL OR duration_ms >= 0)
);
CREATE INDEX IF NOT EXISTS ix_run_started ON ops.etl_run_log (started_at DESC);
CREATE INDEX IF NOT EXISTS ix_run_pipeline ON ops.etl_run_log (pipeline_id, started_at DESC);
CREATE INDEX IF NOT EXISTS ix_run_status ON ops.etl_run_log (status);
COMMENT ON TABLE ops.etl_run_log IS 'One row per ETL execution. Status is only written by the engine that actually ran it.';

CREATE TABLE IF NOT EXISTS ops.etl_stage_log (
    stage_log_id  bigserial PRIMARY KEY,
    run_id        bigint NOT NULL REFERENCES ops.etl_run_log(run_id) ON DELETE CASCADE,
    stage_order   integer NOT NULL,
    stage_name    text NOT NULL,
    stage_kind    text NOT NULL,
    status        text NOT NULL CHECK (status IN ('succeeded','failed','skipped','running')),
    started_at    timestamptz NOT NULL DEFAULT now(),
    finished_at   timestamptz,
    duration_ms   integer,
    rows_in       integer NOT NULL DEFAULT 0,
    rows_out      integer NOT NULL DEFAULT 0,
    rows_rejected integer NOT NULL DEFAULT 0,
    message       text
);
CREATE INDEX IF NOT EXISTS ix_stage_run ON ops.etl_stage_log (run_id, stage_order);

CREATE TABLE IF NOT EXISTS ops.etl_rejects (
    reject_id     bigserial PRIMARY KEY,
    run_id        bigint REFERENCES ops.etl_run_log(run_id) ON DELETE CASCADE,
    batch_id      uuid REFERENCES ops.ingest_batch(batch_id) ON DELETE CASCADE,
    dataset       text NOT NULL,
    row_number    integer,
    business_key  text,
    reason_code   text NOT NULL,
    reason_detail text,
    raw_payload   jsonb,
    created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_rejects_run ON ops.etl_rejects (run_id);
CREATE INDEX IF NOT EXISTS ix_rejects_dataset_reason ON ops.etl_rejects (dataset, reason_code);
COMMENT ON TABLE ops.etl_rejects IS 'Every record rejected by validation, with the reason. Bad records are never silently discarded.';

CREATE TABLE IF NOT EXISTS ops.data_quality_rules (
    rule_id                serial PRIMARY KEY,
    rule_code              text NOT NULL UNIQUE,
    name                   text NOT NULL,
    dataset                text NOT NULL,
    target_table           text,
    severity               text NOT NULL CHECK (severity IN ('critical','high','medium','low')),
    description            text NOT NULL,
    expression             text NOT NULL,
    recommended_resolution text,
    is_active              boolean NOT NULL DEFAULT true
);
COMMENT ON COLUMN ops.data_quality_rules.expression IS 'Declarative predicate evaluated by the rule engine, e.g. not_null:price';

CREATE TABLE IF NOT EXISTS ops.data_quality_results (
    result_id       bigserial PRIMARY KEY,
    run_id          bigint REFERENCES ops.etl_run_log(run_id) ON DELETE CASCADE,
    rule_id         integer NOT NULL REFERENCES ops.data_quality_rules(rule_id) ON DELETE CASCADE,
    dataset         text NOT NULL,
    severity        text NOT NULL,
    passed_count    integer NOT NULL DEFAULT 0,
    failed_count    integer NOT NULL DEFAULT 0,
    failure_rate    numeric(7,6) NOT NULL DEFAULT 0,
    status          text NOT NULL CHECK (status IN ('passed','failed','warning')),
    sample_details  jsonb NOT NULL DEFAULT '[]'::jsonb,
    last_executed_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_dq_counts_nonneg CHECK (passed_count >= 0 AND failed_count >= 0)
);
CREATE INDEX IF NOT EXISTS ix_dq_results_run ON ops.data_quality_results (run_id);
CREATE INDEX IF NOT EXISTS ix_dq_results_rule ON ops.data_quality_results (rule_id, last_executed_at DESC);

CREATE TABLE IF NOT EXISTS ops.data_reconciliation_results (
    recon_id      bigserial PRIMARY KEY,
    run_id        bigint REFERENCES ops.etl_run_log(run_id) ON DELETE CASCADE,
    check_code    text NOT NULL,
    description   text NOT NULL,
    source_value  numeric(18,2),
    target_value  numeric(18,2),
    difference    numeric(18,2),
    tolerance     numeric(18,2) NOT NULL DEFAULT 0,
    status        text NOT NULL CHECK (status IN ('matched','mismatch','skipped')),
    checked_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_recon_run ON ops.data_reconciliation_results (run_id);
