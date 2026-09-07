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
        reset install lint lint-fix format typecheck test test-watch check build-images clean

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
	@curl -fsS http://localhost:$${WEB_PORT:-8080}/api/healthCheck | (json_pp 2>/dev/null || cat)

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
