# Build stage
FROM node:20-alpine AS builder

# Install build dependencies, yarn 1.x, and git
RUN apk add --no-cache python3 make g++ git && \
    (rm -f /usr/local/bin/yarn /usr/local/bin/yarnpkg || true) && \
    npm install -g yarn@1.22.22

WORKDIR /app

# Copy package files and lockfile
COPY package*.json yarn.lock* ./

# Install dependencies using yarn (more reliable than npm)
RUN if [ -f yarn.lock ]; then \
        yarn install --frozen-lockfile; \
    else \
        yarn install; \
    fi

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
RUN yarn build

# Production stage
FROM node:20-alpine

WORKDIR /app

# Install yarn 1.x
RUN (rm -f /usr/local/bin/yarn /usr/local/bin/yarnpkg || true) && \
    npm install -g yarn@1.22.22

# Copy package files and lockfile
COPY package*.json yarn.lock* ./

# Install production dependencies only
RUN if [ -f yarn.lock ]; then \
        yarn install --frozen-lockfile --production; \
    else \
        yarn install --production; \
    fi

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
