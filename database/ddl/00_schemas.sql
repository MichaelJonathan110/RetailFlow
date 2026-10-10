-- RetailFlow: schema creation. Idempotent.
CREATE SCHEMA IF NOT EXISTS app;
CREATE SCHEMA IF NOT EXISTS ops;
CREATE SCHEMA IF NOT EXISTS staging;
CREATE SCHEMA IF NOT EXISTS warehouse;
CREATE SCHEMA IF NOT EXISTS analytics;

COMMENT ON SCHEMA app IS 'Application metadata: sources, pipelines, stages, users, settings';
COMMENT ON SCHEMA ops IS 'Operational metadata: ETL run logs, rejects, data quality, reconciliation';
COMMENT ON SCHEMA staging IS 'Source-aligned landing tables retaining raw payloads';
COMMENT ON SCHEMA warehouse IS 'Dimensional analytics model (dimensions + facts)';
COMMENT ON SCHEMA analytics IS 'Read-only views for the API and Power BI';
