FROM node:22-alpine AS builder

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/
COPY database/ ./database/
RUN npm run build

FROM node:22-alpine

RUN addgroup -g 1001 appgroup && \
    adduser -u 1001 -G appgroup -s /bin/sh -D appuser

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --only=production

COPY --from=builder /app/dist ./dist
COPY database/ ./database/

RUN chown -R appuser:appgroup /app
USER appuser

EXPOSE 3000

# NOTE: use 127.0.0.1, not localhost — /etc/hosts maps localhost to both 127.0.0.1
# and ::1, busybox wget tries ::1 first, and node binds 0.0.0.0 (IPv4 only).
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health || exit 1

CMD ["node", "dist/src/server.js"]