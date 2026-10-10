# RetailFlow — convenience targets. Run `make help` for the list.
SHELL := /bin/bash

.PHONY: help db-up db-init seed ingest pipeline api web build test verify clean

help:
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

db-up: ## Start PostgreSQL in Docker
	docker compose up -d postgres

db-init: ## Create schemas, tables, views and reference data
	bash scripts/init_db.sh

seed: ## Generate the deterministic demo fixture into sample-data/
	cd backend && python ../scripts/seed_demo.py --out ../sample-data --orders 1500

ingest: ## Generate the fixture and ingest it through the running API
	cd backend && python ../scripts/seed_demo.py --out ../sample-data --orders 1500 --upload http://localhost:8000/api/v1

api: ## Run the API with autoreload
	cd backend && uvicorn app.main:app --reload --port 8000

web: ## Run the Next.js UI
	cd frontend && npm run dev

build: ## Production build of the frontend
	cd frontend && npm install && npm run build

test: ## Run backend and frontend tests
	cd backend && python -m pytest -v
	cd frontend && npm test

verify: ## Hit the running stack and print status codes
	@curl -s -o /dev/null -w 'api  /health      -> %%{http_code}\n' http://localhost:8000/api/v1/health
	@curl -s -o /dev/null -w 'api  /overview    -> %%{http_code}\n' http://localhost:8000/api/v1/overview
	@curl -s -o /dev/null -w 'web  /            -> %%{http_code}\n' http://localhost:3000

clean: ## Remove caches and generated files (keeps the database volume)
	rm -rf backend/.pytest_cache frontend/.next sample-data/*.csv
