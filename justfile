set shell := ["zsh", "-cu"]

setup:
    pnpm install

backend-up:
    docker compose up --build -d local-api

backend-down:
    docker compose down

dev:
    pnpm dev

test:
    pnpm test

test-e2e:
    pnpm --filter @milujufilmy/extension build
    pnpm --filter @milujufilmy/extension test:e2e

typecheck:
    pnpm typecheck

build:
    pnpm build

package:
    pnpm package
