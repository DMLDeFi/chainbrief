# Merchants of NEAR — single-container production image (game server + Next.js).
# The game server listens on $PORT (8080), serves /api and /ws, and proxies every
# other request to the Next.js app on 127.0.0.1:3000 inside the same container.
ARG NODE_IMAGE=node:22-slim
FROM ${NODE_IMAGE}
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# Install dependencies first for better layer caching.
COPY package.json package-lock.json ./
COPY packages/engine/package.json packages/engine/
COPY apps/server/package.json apps/server/prisma.config.ts apps/server/
COPY apps/server/prisma apps/server/prisma
COPY apps/web/package.json apps/web/
RUN npm ci --no-audit --no-fund

COPY . .
RUN npm run build -w @mon/web

ENV NODE_ENV=production PORT=8080 DATA_DIR=/data
EXPOSE 8080
CMD ["bash", "scripts/start-prod.sh"]
