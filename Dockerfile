# ─── Stage 1: build ──────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY . .
RUN npm run build

# Remove dev dependencies after the build so the prune step below is clean
RUN npm prune --omit=dev

# ─── Stage 2: runtime ────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000

WORKDIR /app

# Copy only what the SvelteKit node adapter needs at runtime
COPY --from=builder /app/build        ./build
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/static       ./static

# storage/ holds local GLB/semantic-manifest files used in dev.
# In production the app reads from S3 (ASSET_REGISTRY_PUBLIC_BASE_URL /
# SEMANTIC_MANIFEST_LOCAL_DIR pointing to a mounted volume or presigned URLs).
# We still include a stub directory so the path resolver doesn't error on cold start.
RUN mkdir -p storage

RUN chown -R node:node /app
USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/', r => process.exit(r.statusCode < 500 ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["node", "build"]
