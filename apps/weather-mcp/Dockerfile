FROM node:20-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist

# Create a non-root user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser

EXPOSE 3001
CMD ["npm", "start"]

USER node
