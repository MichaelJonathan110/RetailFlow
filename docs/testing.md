# RetailFlow — Testing

## 1. Test layers

| Layer | File | What it proves |
| --- | --- | --- |
| Unit — rule engine | `backend/tests/test_rules.py` | Each check type passes/fails correctly; unknown checks fail loudly |
| Unit — ingestion | `backend/tests/test_ingestion.py` | Header aliases resolve; encoding/delimiter detection; idempotent replay |
| Unit — generator | `backend/tests/test_seed.py` | The fixture is deterministic and actually injects defects |
| API | `backend/tests/test_api.py` | Health, overview, pipelines, quality, analytics, settings; error envelope shape |
| Database | `backend/tests/test_database.py` | Schemas/tables/views exist; SCD2 uniqueness; fact grains |
| End-to-end | `backend/tests/test_e2e_acceptance.py` | Upload → validate → load → reconcile, asserting real numbers |
| Frontend | `frontend/src/lib/format.test.ts` | Formatters and status→tone mapping |

## 2. How to run

```bash
# Backend (requires the database to be up: docker compose up -d postgres)
cd backend
python -m pytest -v

# Frontend
cd frontend
npm test
```

Tests that need a database read `DATABASE_URL` and are skipped automatically when it is unreachable,
so a clean checkout without Docker still gives a meaningful (partial) green rather than a wall of errors.

## 3. The acceptance scenario (the important one)

`test_e2e_acceptance.py` walks the whole platform as a user would:

1. Generate a small deterministic fixture with `scripts/seed_demo.py`.
2. Upload every dataset through `POST /api/v1/ingestion/upload`.
3. Assert the batch reports `rows_invalid > 0` — the fixture injects defects on purpose.
4. Assert the rejected records carry a rule code and a human reason.
5. Run the **master pipeline** through `POST /api/v1/pipelines/{id}/run`.
6. Assert `fact_order_items` is populated and that a second run loads **0** additional rows (idempotency).
7. Run reconciliation and assert a verdict is recorded with a tolerance.
8. Assert `GET /overview` returns non-zero revenue consistent with the fact table.

If this test passes, the pipeline genuinely works end to end — it is not asserting on mocks.

## 4. Evidence to capture for a portfolio

```bash
cd backend && python -m pytest -v          # save the output
cd frontend && npm run build               # TypeScript + production build must be clean
curl -s http://localhost:8020/api/v1/health | python -m json.tool
curl -s http://localhost:3000 -o /dev/null -w '%{http_code}
'   # expect 200
```

## 5. Known limitations of the test suite

- The E2E test mutates the shared demo database. It is written to be re-runnable (idempotent loads), but
  for a strictly isolated run, point `DATABASE_URL` at a throwaway database first.
- No browser automation (Playwright) is included; the frontend is covered by unit tests and by the build,
  not by a real browser session.
- No load/performance testing. Volumes here are demo-scale.
