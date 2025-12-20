# Build stage
FROM node:20-alpine AS builder

# Install build dependencies and yarn 1.x
RUN apk add --no-cache python3 make g++ && \
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

# Expose API port
EXPOSE 3011

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3011

# Start the application
CMD ["node", "dist/server.js"]
