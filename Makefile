# Developer entry point. Every target wraps a pnpm script or a pinned container,
# so local runs and CI run the same commands. Run `make` to list targets.
# Works with GNU make 3.81+ (the macOS default).

SHELL := /bin/bash
.DEFAULT_GOAL := help

# `docker compose` (plugin) or the standalone `docker-compose`, whichever exists.
COMPOSE ?= $(shell docker compose version >/dev/null 2>&1 && echo "docker compose" || echo "docker-compose")

# Tool images are pinned by digest in ONE place: the env block of the CI workflow.
ci_env = $(shell sed -n 's/^  $(1): //p' .github/workflows/ci.yml)
HADOLINT_IMAGE  := $(call ci_env,HADOLINT_IMAGE)
TRIVY_IMAGE     := $(call ci_env,TRIVY_IMAGE)
GITLEAKS_IMAGE  := $(call ci_env,GITLEAKS_IMAGE)
# Only used locally (CI does not run actionlint); pinned here.
ACTIONLINT_IMAGE := rhysd/actionlint@sha256:b1934ee5f1c509618f2508e6eb47ee0d3520686341fec936f3b79331f9315667

DOCKERFILES := apps/api/Dockerfile apps/web/Dockerfile gateway/Dockerfile
IMAGES      := api web gateway
SCAN_DIR    := $(CURDIR)/.cache/scan

# Fail with a clear message if a pinned image could not be read from the workflow.
need = $(if $($(1)),,$(error $(1) is empty: could not read it from .github/workflows/ci.yml))

.PHONY: help install hooks dev check typecheck lint lint-fix stylelint format format-check \
        test test-watch coverage build clean distclean \
        up down restart logs ps images smoke \
        hadolint trivy secrets actionlint ci-local

help: ## List the available targets
	@awk 'BEGIN {FS = ":.*## "} /^[a-zA-Z0-9_-]+:.*## / {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

## ---- Setup ------------------------------------------------------------------
install: ## Install dependencies (frozen lockfile) and git hooks
	pnpm install --frozen-lockfile

hooks: ## (Re)install the Husky git hooks
	pnpm exec husky

## ---- Develop ----------------------------------------------------------------
dev: ## Run web and api in watch mode (Ctrl-C to stop)
	pnpm --parallel --filter "./apps/*" dev

## ---- Quality gates (same as CI) ---------------------------------------------
check: typecheck lint stylelint format-check test build ## Run every quality gate

typecheck: ## tsc --noEmit in every workspace
	pnpm typecheck

lint: ## oxlint (type-aware)
	pnpm lint

lint-fix: ## oxlint with autofix
	pnpm lint:fix

stylelint: ## Stylelint for CSS
	pnpm stylelint

format: ## Format everything with oxfmt
	pnpm format

format-check: ## Check formatting without writing
	pnpm format:check

test: ## Vitest, all projects
	pnpm test

test-watch: ## Vitest in watch mode
	pnpm test:watch

coverage: ## Vitest with coverage
	pnpm test:coverage

build: ## Build web (Next) and api (tsup)
	pnpm build

clean: ## Remove build output and caches
	rm -rf apps/web/.next apps/api/dist coverage .cache

distclean: clean ## Also remove node_modules
	rm -rf node_modules apps/*/node_modules packages/*/node_modules

## ---- Containers -------------------------------------------------------------
up: ## Build and start the stack in the background (http://localhost:8080)
	$(COMPOSE) up --build --detach --wait

down: ## Stop the stack and remove its volumes
	$(COMPOSE) down -v

restart: down up ## Recreate the stack from scratch

logs: ## Follow service logs
	$(COMPOSE) logs -f --tail=100

ps: ## Show service status and published ports
	$(COMPOSE) ps

images: ## Build the three images
	$(COMPOSE) build

smoke: ## Build, start and test the stack through the gateway, then tear down
	scripts/compose-smoke.sh

## ---- Security and CI parity (run in pinned containers) -----------------------
hadolint: ## Lint the Dockerfiles
	$(call need,HADOLINT_IMAGE)
	@for f in $(DOCKERFILES); do \
	  printf 'hadolint %-26s' $$f; \
	  out=$$(docker run --rm -i $(HADOLINT_IMAGE) hadolint - < $$f 2>&1) \
	    && echo clean || { echo; echo "$$out"; exit 1; }; \
	done

trivy: images ## Scan the built images (fixed HIGH/CRITICAL fail the build)
	$(call need,TRIVY_IMAGE)
	@mkdir -p $(SCAN_DIR)
	@for i in $(IMAGES); do \
	  docker save dpt-$$i:local -o $(SCAN_DIR)/$$i.tar || exit 1; \
	  printf 'trivy %-10s' $$i; \
	  out=$$(docker run --rm -v $(SCAN_DIR):/scan:ro -v $(CURDIR)/.trivyignore.yaml:/ignore.yaml:ro \
	    -v trivy-cache:/root/.cache $(TRIVY_IMAGE) image --input /scan/$$i.tar \
	    --severity HIGH,CRITICAL --ignore-unfixed --ignorefile /ignore.yaml --quiet --exit-code 1 2>&1) \
	    && echo clean || { echo; echo "$$out"; exit 1; }; \
	done

secrets: ## Scan git history for secrets
	$(call need,GITLEAKS_IMAGE)
	docker run --rm -v $(CURDIR):/repo $(GITLEAKS_IMAGE) git /repo --redact

actionlint: ## Lint the GitHub Actions workflows
	docker run --rm -v $(CURDIR):/repo -w /repo $(ACTIONLINT_IMAGE) -color=false

ci-local: check hadolint actionlint secrets smoke trivy ## Everything CI runs, locally
