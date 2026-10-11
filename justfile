# Cross-OS shell configuration
set shell := ["sh", "-cu"]

[windows]
set shell := ["powershell.exe", "-NoLogo", "-Command"]

# List available commands
default:
    @just --list

# Check development prerequisites across operating systems
doctor:
    node scripts/doctor.mjs

# Install dependencies
setup:
    pnpm install

# Build and start local API backend container
backend-up:
    docker compose up --build -d local-api

# Stop local API backend container
backend-down:
    docker compose down

# Run extension development server
dev:
    pnpm dev

# Run unit tests across all packages
test:
    pnpm test

# Run Playwright E2E browser tests
test-e2e:
    pnpm --filter @milujufilmy/extension build
    pnpm --filter @milujufilmy/extension test:e2e

# Run TypeScript typechecks across all packages
typecheck:
    pnpm typecheck

# Build contracts, local API, and extension
build:
    pnpm build

# Package extension into zip archive for distribution
package:
    pnpm package
