# Single-image deploy for Sigunu: builds the web app + server and serves both from
# one Node process (the server also serves the built web app — one origin, no CORS).
FROM node:22-bookworm-slim AS build
WORKDIR /app

# openssl is needed by Prisma's query engine.
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*

# Install all workspace deps (dev deps included — needed to build).
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN npm ci --no-audit --no-fund

# Copy the rest of the source.
COPY . .

# Production uses Postgres: derive a Postgres schema from the (SQLite) dev schema by
# swapping only the datasource provider. Models are portable (JSON stored as TEXT).
RUN sed 's/provider = "sqlite"/provider = "postgresql"/' apps/server/prisma/schema.prisma > apps/server/prisma/schema.prod.prisma

# Build shared types, the web app, and the server; generate the Prisma client.
RUN npm run build -w @sigunu/shared \
 && npm run build -w @sigunu/web \
 && npm run build -w @sigunu/server \
 && npx prisma generate --schema apps/server/prisma/schema.prod.prisma

ENV NODE_ENV=production
ENV WEB_DIST=/app/apps/web/dist

# Apply the schema to the database, then start the server.
CMD ["sh", "-c", "npx prisma db push --schema apps/server/prisma/schema.prod.prisma --skip-generate --accept-data-loss && node apps/server/dist/index.js"]
