# Build stage
FROM node:22-alpine AS builder

# Install build dependencies and enable pnpm via corepack.
# The "packageManager" field in package.json pins the exact pnpm version.
RUN apk add --no-cache python3 make g++ git && \
    corepack enable && \
    corepack prepare pnpm@10.33.0 --activate

WORKDIR /app

# Copy package files, lockfile, and .npmrc (honors strict-ssl,
# ignore-scripts, min-release-age, shamefully-hoist).
COPY package.json pnpm-lock.yaml .npmrc ./

# Install all dependencies (dev + prod). --frozen-lockfile refuses to
# modify the lockfile; fails the build if pnpm-lock.yaml is out of sync.
# Cache mount on the pnpm store: persists across podman builds so the
# ~946 tarballs are downloaded once per machine, not once per deploy.
# A rebuild after a lockfile-only change drops from ~6m to ~30s.
# `sharing=locked` serializes concurrent builds against the same cache.
RUN --mount=type=cache,target=/root/.local/share/pnpm/store,sharing=locked \
    pnpm install --frozen-lockfile --shamefully-hoist

# Copy source code
COPY . .

# Capture git information at build time and save to file
RUN if command -v git > /dev/null && [ -d .git ]; then \
        git rev-parse --short HEAD > /tmp/git_commit_hash 2>/dev/null || echo "unknown" > /tmp/git_commit_hash; \
        git rev-parse --abbrev-ref HEAD > /tmp/git_branch 2>/dev/null || echo "unknown" > /tmp/git_branch; \
    else \
        echo "unknown" > /tmp/git_commit_hash; \
        echo "unknown" > /tmp/git_branch; \
    fi

# Build the application
RUN pnpm build

# Production stage
FROM node:22-alpine

WORKDIR /app

# Enable pnpm via corepack (same version as builder)
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

# Copy package files, lockfile, and .npmrc
COPY package.json pnpm-lock.yaml .npmrc ./

# Install production dependencies only. Same cache mount as the builder
# stage — both stages share the pnpm store so prod-only resolution
# benefits from the dev install's already-fetched tarballs.
RUN --mount=type=cache,target=/root/.local/share/pnpm/store,sharing=locked \
    pnpm install --frozen-lockfile --shamefully-hoist --prod

# Copy built files from builder stage
COPY --from=builder /app/dist ./dist

# Copy git info files from builder stage (will be read at runtime if env vars not set)
COPY --from=builder /tmp/git_commit_hash /tmp/git_commit_hash
COPY --from=builder /tmp/git_branch /tmp/git_branch

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3011

# Expose API port
EXPOSE 3011

# Start the application
CMD ["node", "dist/server.js"]
