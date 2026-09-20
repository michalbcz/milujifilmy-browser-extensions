FROM node:22-bookworm-slim
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-workspace.yaml tsconfig.base.json pnpm-lock.yaml* ./
COPY apps/local-api/package.json apps/local-api/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN pnpm install --frozen-lockfile=false --filter @milujufilmy/local-api...
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN pnpm --filter @milujufilmy/local-api exec playwright install --with-deps chromium
COPY apps/local-api apps/local-api
COPY packages/contracts packages/contracts
RUN pnpm --filter @milujufilmy/contracts build && pnpm --filter @milujufilmy/local-api build
EXPOSE 47321
CMD ["node", "apps/local-api/dist/server.js"]
