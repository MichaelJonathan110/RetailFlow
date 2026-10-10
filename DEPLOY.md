# Deployment Guide - RetailFlow

This is the exact, ordered procedure to publish this repo on GitHub and get a
live demo on Vercel. Read the whole thing once before you start; the order
matters.

---

## 0. The one architectural fact that decides everything

**Vercel hosts the Next.js frontend only.** It cannot run the FastAPI backend or
PostgreSQL. So the demo is split in two:

| Piece | Where it runs | Why |
|-------|---------------|-----|
| `frontend/` (Next.js) | **Vercel** | static/SSR, what Vercel is for |
| `backend/` (FastAPI) | **Render / Railway / Fly.io** | needs a long-running Python process |
| PostgreSQL 16 | **Neon / Supabase / Railway** | needs a real DB |

The frontend already reads its API address from an env var
(`NEXT_PUBLIC_API_BASE`, see `frontend/next.config.mjs`), so **no code change is
needed** - you only set that variable to your backend URL.

---

## 1. Push to GitHub

```bash
cd C:/Users/kohja/retailflow

# 1.1 one-time repo init
git init -b main
git add .
git status            # REVIEW: make sure _scratch/, logs/, .env are NOT staged
git commit -m "RetailFlow: analytics + data-quality platform"

# 1.2 create the empty repo on GitHub first (web UI), then:
git remote add origin https://github.com/OWNER/REPO.git
git push -u origin main
```

After the push, edit `README.md` and replace `OWNER/REPO` in the CI badge URL
with your real `user/repo`.

**What must NOT be committed** (already in `.gitignore`): `.env`, `_scratch/`,
`logs/`, `tmp/`, `*.log`, `frontend/.env.local`, `node_modules/`, `.venv/`.
Verify with `git status` before committing.

---

## 2. Backend + database (do this FIRST)

Vercel needs a backend URL that already works, so host the backend before the
frontend.

### 2a. Create the database (Neon - free tier is fine)
1. Sign up at https://neon.tech, create a project.
2. Copy the connection string. It looks like:
   `postgresql://USER:PASSWORD@ep-xxx.aws.neon.tech/retailflow?sslmode=require`

### 2b. Deploy the backend (Render example)
1. New -> Web Service -> connect your GitHub repo.
2. Settings:
   - **Root directory:** `backend`
   - **Runtime:** Docker (it will use `backend/Dockerfile`)
   - **Health check path:** `/health`
3. Environment variables:
   ```
   DATABASE_URL = <the Neon string from 2a>
   AUTH_ENABLED = false
   PYTHONUNBUFFERED = 1
   ```
   (Render injects `PORT`; the Dockerfile already honours it.)
4. Deploy. When it is live, open `https://<your-service>.onrender.com/health` -
it must return `{"status":"ok"}`.

### 2c. Seed the remote database
Run the schema + seed against the Neon DB from your machine:
```bash
cd C:/Users/kohja/retailflow
DATABASE_URL="<neon string>" bash scripts/init_db.sh
```
Then reload `https://<your-service>.onrender.com/api/v1/analytics/summary` -
it should return real numbers.

---

## 3. Frontend on Vercel

1. Sign up at https://vercel.com with GitHub, **Add New -> Project**, import the
   repo.
2. **Root Directory:** `frontend`  (important - the repo root is not the app)
3. Framework preset: Next.js (auto-detected).
4. Environment variable:
   ```
   NEXT_PUBLIC_API_BASE = https://<your-service>.onrender.com/api/v1
   ```
5. Deploy. Open the URL - the dashboard must load with live data.

`frontend/vercel.json` is already present so the build settings are pinned.

---

## 4. Turn the CI badge green

`.github/workflows/ci.yml` runs on every push: it starts a PostgreSQL service,
installs deps, runs all 56 tests (with `REQUIRE_DB=1`, so a missing DB FAILS the
build instead of silently skipping), then builds the frontend.

Just push - the badge goes green (or tells you exactly what broke).

---

## 5. Definition of done (checklist)

- [ ] `git status` clean of secrets before the first push
- [ ] GitHub repo public, CI badge green
- [ ] `https://<backend>/health` returns ok
- [ ] `https://<backend>/api/v1/analytics/summary` returns real data
- [ ] Vercel URL shows the dashboard with live data (not a network error)
- [ ] README has screenshots + working CI badge

---

## 6. Common pitfalls

| Symptom | Cause | Fix |
|---------|-------|-----|
| Vercel build "No Next.js detected" | Root Directory not set to `frontend` | set it in project settings |
| Dashboard loads but every panel errors | `NEXT_PUBLIC_API_BASE` wrong or backend down | check `/health`, then the env var |
| CORS error in browser console | backend `CORS_ORIGINS` missing the Vercel domain | add it to the backend env |
| Backend 502 on Render | app not binding `$PORT` | Dockerfile already handles it |
| CI red on `REQUIRE_DB` | the Postgres service step failed | read the workflow logs |
