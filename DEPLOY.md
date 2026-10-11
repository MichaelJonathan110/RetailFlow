# Deploying RetailFlow (no credit card required)

Three moving parts, two accounts, zero cards:

| Part | Where | Why |
|---|---|---|
| PostgreSQL database | **Neon** (free plan) | Neon's free plan explicitly needs no credit card |
| FastAPI backend | **Vercel** (Hobby) | Vercel runs Python ASGI apps natively; Hobby needs no card |
| Next.js frontend | **Vercel** (Hobby) | same project or a second one |

> Render was the original plan but its free tier now asks for a card, so the
> backend moved to Vercel Functions. `render.yaml` was removed.

Order matters: **database -> backend -> frontend -> wire CORS**.

---

## 1. Database on Neon

1. Sign up at <https://neon.tech> (GitHub login works). No card asked.
2. **Create project** -> name `retailflow`, region **Singapore** (closest to Indonesia).
3. Copy the **connection string** (pooled is fine):

   ```
   postgresql://neondb_owner:***@ep-xxx-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require
   ```

4. Keep it — needed in steps 2 and 3.

## 2. Backend on Vercel

1. <https://vercel.com> -> sign up with GitHub.
2. **Add New -> Project** -> import `MichaelJonathan110/RetailFlow`.
3. **Root Directory: `backend`** (Edit it; the repo is a monorepo).
4. Vercel auto-detects the Python entrypoint at `backend/api/index.py`
   (committed already; it re-exports `app.main:app`).
5. **Environment Variables** — add:

   | Name | Value |
   |---|---|
   | `DATABASE_URL` | the Neon string from step 1 |
   | `CORS_ORIGINS` | leave empty for now, filled in step 4 |
   | `AUTH_ENABLED` | `false` |

6. **Deploy**. Then verify:

   ```
   https://<backend>.vercel.app/api/v1/health
   ```

   Expect `{"status":"ok", ...}`.

## 3. Seed the database

From your machine, load the schema + reference data into Neon:

```bash
cd C:/Users/kohja/retailflow
DATABASE_URL="<neon string>" bash scripts/init_db.sh
```

Then confirm real numbers come back:

```
https://<backend>.vercel.app/api/v1/analytics/summary
```

## 4. Frontend on Vercel

1. **Add New -> Project** -> same repo again.
2. **Root Directory: `frontend`** (otherwise Vercel reports "No Next.js detected").
3. Environment variable:

   | Name | Value |
   |---|---|
   | `NEXT_PUBLIC_API_BASE` | `https://<backend>.vercel.app/api/v1` |

4. **Deploy** -> you get `https://<app>.vercel.app`.

## 5. Wire CORS (do not skip)

Back in the **backend** project -> Settings -> Environment Variables:

```
CORS_ORIGINS = https://<app>.vercel.app
```

Save -> redeploy. Without this the dashboard loads but every panel fails in
the browser console with a CORS error.

## 6. Final checklist

- [ ] `https://<backend>.vercel.app/api/v1/health` -> ok
- [ ] `https://<backend>.vercel.app/api/v1/analytics/summary` -> real data
- [ ] `https://<app>.vercel.app` -> dashboard populated
- [ ] browser console free of CORS errors

---

## Backend environment variables

Read by `backend/app/config.py`:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string (required) |
| `CORS_ORIGINS` | comma-separated allowed browser origins |
| `AUTH_ENABLED` | `false` by default; `true` turns on the auth gate |
| `PYTHONUNBUFFERED` | `1` for live logs |

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Vercel: "No Next.js detected" | Root Directory not set | set it to `frontend` |
| Dashboard empty / panels error | wrong `NEXT_PUBLIC_API_BASE` | check `/api/v1/health` first |
| CORS error in console | `CORS_ORIGINS` unset | step 5 |
| Backend 500 on every route | bad `DATABASE_URL` or unseeded DB | step 3 |
