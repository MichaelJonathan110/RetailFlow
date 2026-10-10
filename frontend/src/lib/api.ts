/** Typed API client for the RetailFlow backend. */
import { clearToken, getToken } from './auth';

export const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE || 'http://127.0.0.1:8020/api/v1';

export class ApiError extends Error {
  code: string;
  status: number;
  details?: unknown;

  constructor(message: string, code: string, status: number, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
        ...(init?.headers || {}),
      },
    });
  } catch {
    throw new ApiError(
      `Cannot reach the RetailFlow API at ${API_BASE}. Is the backend running?`,
      'network_error',
      0,
    );
  }

  if (!response.ok) {
    let message = `Request failed with status ${response.status}`;
    let code = `http_${response.status}`;
    let details: unknown;
    try {
      const body = await response.json();
      if (body?.error) {
        message = body.error.message ?? message;
        code = body.error.code ?? code;
        details = body.error.details;
      }
    } catch {
      /* non-JSON error body */
    }
    if (response.status === 401 && typeof window !== 'undefined'
        && !window.location.pathname.startsWith('/login')) {
      clearToken();
      window.location.href = '/login';
    }
    throw new ApiError(message, code, response.status, details);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const api = {
  get: <T,>(path: string) => request<T>(path),
  post: <T,>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }),
  patch: <T,>(path: string, body: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
};

/* ------------------------------------------------------------------ types */

export interface HealthResponse {
  status: string;
  version: string;
  environment: string;
  auth_enabled?: boolean;
  database: { connected: boolean; server_version?: string; schemas_present?: number; error?: string; detail?: string };
}

export interface OverviewResponse {
  kpis: Record<string, number>;
  recent_runs: RunSummary[];
  latest_quality: QualityResult[];
  revenue_trend: { year_month: string; total_revenue: string | number; orders: number }[];
}

export interface RunSummary {
  run_id: string;
  status: string;
  triggered_by?: string;
  started_at: string | null;
  finished_at: string | null;
  duration_ms?: number | null;
  rows_read?: number;
  rows_loaded?: number;
  rows_rejected?: number;
  pipeline_name?: string;
  pipeline_type?: string;
  error_message?: string | null;
}

export interface QualityResult {
  rule_code: string;
  dataset?: string;
  severity: string;
  status: string;
  rows_checked?: number;
  rows_failed?: number;
  pass_rate?: number | string;
  checked_at?: string;
}

export interface ListResponse<T> {
  items: T[];
  total?: number;
}

export interface DataSource {
  source_id: number;
  name: string;
  source_type: string;
  dataset: string;
  description: string | null;
  location_hint: string | null;
  status: string;
  batches: number;
}

export interface Pipeline {
  pipeline_id: number;
  name: string;
  description: string | null;
  pipeline_type: string;
  target_table: string | null;
  engine: string;
  is_executable: boolean;
  is_active: boolean;
  stages: number;
  runs: number;
  last_run_at: string | null;
}

export interface PipelineStage {
  stage_id: number;
  stage_order: number;
  stage_name: string;
  stage_kind: string;
  description: string | null;
  is_active: boolean;
}

export interface PipelineDetail extends Omit<Pipeline, 'stages' | 'runs' | 'last_run_at'> {
  created_at: string;
  stages: PipelineStage[];
}

export interface RunStage {
  stage_order: number;
  stage_name: string;
  status: string;
  rows_in: number | null;
  rows_out: number | null;
  duration_ms: number | null;
  message: string | null;
}

export interface RunDetail extends RunSummary {
  log_output?: string | null;
  stages: RunStage[];
}

export interface Batch {
  batch_id: string;
  dataset: string;
  file_name: string;
  status: string;
  row_count: number;
  valid_count: number;
  invalid_count: number;
  size_bytes: number;
  received_at: string;
  completed_at: string | null;
  source_name?: string | null;
}

export interface RejectedRecord {
  reject_id: number;
  batch_id: string;
  dataset: string;
  row_number: number;
  rule_code: string;
  severity: string;
  reason: string;
  raw_payload: Record<string, unknown>;
  created_at: string;
}

export interface WarehouseTable {
  schema: string;
  table: string;
  kind: string;
  rows: number | null;
  columns: number;
}

export interface WarehouseTableDetail {
  schema: string;
  table: string;
  comment: string | null;
  columns: { column_name: string; data_type: string; is_nullable: string; column_default: string | null }[];
  constraints: { name: string; type: string; definition: string }[];
  indexes: { indexname: string; indexdef: string }[];
  sample_rows: Record<string, unknown>[];
}
