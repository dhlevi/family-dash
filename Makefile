# ---------------------------------------------------------------------------
# family-dash task runner
#   make            list targets
#   make up         build and start the stack
#   make dev        start with hot reload
# ---------------------------------------------------------------------------

SHELL := /bin/bash
COMPOSE := docker compose
DEV := docker compose -f docker-compose.yml -f docker-compose.dev.yml

.DEFAULT_GOAL := help
.PHONY: help env up down restart rebuild logs logs-api logs-web ps psql shell-api shell-web \
        reset backup restore prune install lint lint-fix format typecheck test test-watch check \
        build-images clean

# Where `make backup` writes to. Point this at external storage on a Pi — a
# backup sitting on the same SD card as the database does not survive the
# failure it exists for.
BACKUP_DIR ?= ./backups

help: ## Show available targets
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| sort \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'

env: ## Create .env from .env.example if it does not exist yet
	@if [ -f .env ]; then \
		echo ".env already exists — leaving it alone"; \
	else \
		cp .env.example .env; \
		echo "Created .env from .env.example — set POSTGRES_PASSWORD before starting"; \
	fi

# --- running --------------------------------------------------------------

up: ## Build and start the whole stack in the background
	$(COMPOSE) up --build -d
	@echo
	@echo "family-dash starting on http://localhost:$${WEB_PORT:-8080}"

dev: ## Start the stack with hot reload (foreground)
	$(DEV) up --build

down: ## Stop the stack, keeping the database
	$(COMPOSE) down

restart: ## Restart all services
	$(COMPOSE) restart

rebuild: ## Force a no-cache rebuild and restart
	$(COMPOSE) build --no-cache
	$(COMPOSE) up -d

reset: ## Stop the stack and DELETE the database volume
	@read -p "This deletes all family-dash data. Type 'yes' to continue: " ans; \
	if [ "$$ans" = "yes" ]; then $(COMPOSE) down -v && echo "Volumes removed"; \
	else echo "Aborted"; fi

# --- backup ---------------------------------------------------------------
# `set -o pipefail` is not optional here. Without it the exit status of
# `pg_dump | gzip` is gzip's, which happily succeeds at compressing nothing —
# so a failed dump would be reported as a good backup and leave a 4KB file
# that looks like one. The dump is then checked for content before being
# accepted, because a backup nobody has verified is not a backup. That check
# reads the whole stream on purpose: `grep -q` stops at the first match, which
# closes the pipe, which under pipefail makes a perfectly good dump look like
# a failure.
#
# The dump is written to a `.partial` file and moved into place only once it
# has passed. `date` has one-second resolution, so two runs in the same second
# produce the same filename — without the temp file, a run that failed would
# delete the good backup a successful run had just written.
#
# Everything the household has typed lives in Postgres: notes, tasks,
# recipes, meal plans, drawings, which photos are favourites. The calendar,
# news and weather all re-sync themselves, so those are not worth protecting;
# the rest is not recoverable from anywhere.
#
# Photo *files* are not in here. They live on the media volume (MEDIA_PATH),
# usually copies of what is already on somebody's phone, and a dump of a
# 15GB library every night is not a backup anyone keeps running. Back that
# folder up with whatever backs up the drive it is on.

backup: ## Dump the database to $(BACKUP_DIR) (override with BACKUP_DIR=...)
	@mkdir -p $(BACKUP_DIR)
	@set -o pipefail; \
	out="$(BACKUP_DIR)/familydash-$$(date +%Y%m%d-%H%M%S).sql.gz"; \
	tmp="$$out.partial"; \
	if ! $(COMPOSE) exec -T db pg_dump \
			-U $${POSTGRES_USER:-familydash} \
			-d $${POSTGRES_DB:-familydash} \
			--clean --if-exists --no-owner --no-privileges \
		| gzip > "$$tmp"; then \
		rm -f "$$tmp"; \
		echo "Backup failed — is the stack running? (make up)" >&2; \
		exit 1; \
	fi; \
	if ! gunzip -c "$$tmp" | grep -c 'CREATE TABLE public.setting' >/dev/null; then \
		rm -f "$$tmp"; \
		echo "Backup produced nothing usable and was discarded." >&2; \
		exit 1; \
	fi; \
	mv "$$tmp" "$$out"; \
	echo "Wrote $$out ($$(du -h "$$out" | cut -f1))"

restore: ## Restore a dump: make restore FILE=backups/familydash-....sql.gz
	@if [ -z "$(FILE)" ]; then \
		echo "Usage: make restore FILE=backups/familydash-YYYYmmdd-HHMMSS.sql.gz" >&2; \
		echo; ls -1t $(BACKUP_DIR)/*.sql.gz 2>/dev/null | head -5 || true; \
		exit 1; \
	fi
	@if [ ! -f "$(FILE)" ]; then echo "No such file: $(FILE)" >&2; exit 1; fi
	@echo "This replaces the current database with $(FILE)."
	@read -p "Type 'yes' to continue: " ans; \
	if [ "$$ans" != "yes" ]; then echo "Aborted"; exit 1; fi; \
	gunzip -c "$(FILE)" \
		| $(COMPOSE) exec -T db psql -q -o /dev/null \
			-U $${POSTGRES_USER:-familydash} \
			-d $${POSTGRES_DB:-familydash} \
			-v ON_ERROR_STOP=1 \
	&& echo "Restored. Restarting the API so it re-reads settings..." \
	&& $(COMPOSE) restart api

# --- inspection -----------------------------------------------------------

ps: ## Show container status
	$(COMPOSE) ps

logs: ## Tail logs for all services
	$(COMPOSE) logs -f --tail=100

logs-api: ## Tail API logs
	$(COMPOSE) logs -f --tail=100 api

logs-web: ## Tail web logs
	$(COMPOSE) logs -f --tail=100 web

psql: ## Open a psql shell on the database
	$(COMPOSE) exec db psql -U $${POSTGRES_USER:-familydash} -d $${POSTGRES_DB:-familydash}

shell-api: ## Open a shell in the API container
	$(COMPOSE) exec api sh

shell-web: ## Open a shell in the web container
	$(COMPOSE) exec web sh

health: ## Print the API health check
	@# /healthCheck, not /api/healthCheck: the probe sits outside the API's
	@# route prefix, and nginx proxies it on its own location block.
	@curl -fsS http://localhost:$${WEB_PORT:-8080}/healthCheck | (json_pp 2>/dev/null || cat)

# --- local development (outside docker) -----------------------------------

install: ## Install dependencies for api and web
	cd api && npm install
	cd web && npm install

lint: ## Lint api and web
	cd api && npm run lint
	cd web && npm run lint

lint-fix: ## Lint and autofix
	cd api && npm run lint:fix
	cd web && npm run lint:fix

format: ## Format with prettier
	cd api && npm run format
	cd web && npm run format

typecheck: ## Typecheck api and web
	cd api && npm run typecheck
	cd web && npm run typecheck

test: ## Run unit tests
	cd api && npm test
	cd web && npm test

test-watch: ## Run API tests in watch mode
	cd api && npm run test:watch

check: lint typecheck test ## Lint, typecheck and test everything

# --- release --------------------------------------------------------------

build-images: ## Build multi-arch images for amd64 and arm64 (Raspberry Pi)
	docker buildx build --platform linux/amd64,linux/arm64 -t family-dash-api:latest ./api
	docker buildx build --platform linux/amd64,linux/arm64 -t family-dash-web:latest ./web

clean: ## Remove build output and node_modules
	rm -rf api/build api/node_modules web/dist web/node_modules

prune: ## Reclaim disk from old image layers and build cache
	@echo "Removing untagged images and build cache. Running containers are untouched."
	docker image prune -f
	docker builder prune -f
