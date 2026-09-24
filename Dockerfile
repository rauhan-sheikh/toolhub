# Multi-arch: builds natively on Oracle's Ampere A1 (arm64).
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# NEXT_PUBLIC_* values would be inlined here, but this app has none — every
# secret is read at runtime on the server, so the image stays environment-free.
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
# Caps the V8 heap well under the container's mem_limit. Without it V8 sizes
# the heap from the host's 12 GB and collects lazily, so RSS drifts upwards.
ENV NODE_OPTIONS=--max-old-space-size=256

RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001

# `output: 'standalone'` emits a self-contained server plus a minimal
# node_modules; public/ and .next/static are not copied automatically.
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000

# Informational only: `restart: unless-stopped` acts on exits, not on health.
# busybox wget rather than `node -e`, which started a whole Node process (~40
# MB) every 30 s. Frequent checks only while starting, then every 5 minutes.
HEALTHCHECK --interval=5m --timeout=5s --start-period=30s --start-interval=2s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "server.js"]
