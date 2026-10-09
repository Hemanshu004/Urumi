FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json drizzle.config.ts ./
COPY src/ ./src/
COPY drizzle/ ./drizzle/

RUN npm run build

FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/drizzle ./drizzle

EXPOSE 3000

# The migration command should be run in an init container, but we can also just run it before starting
# Since the pod waits for db, we can run migrations and then start the server.
CMD ["sh", "-c", "node dist/db/migrate.js && node dist/index.js"]

USER node
