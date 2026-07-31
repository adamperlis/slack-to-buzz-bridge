# Multi-arch (arm64-native on OCI Ampere A1). Build context is the repo root:
#   docker build -f deploy/Dockerfile -t slack-buzz-bridge .
FROM node:22-alpine AS deps
WORKDIR /app
# better-sqlite3 compiles from source when no prebuild matches (alpine/musl).
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY package.json server.js ./
COPY src ./src
COPY bin ./bin
RUN addgroup -S bridge && adduser -S bridge -G bridge \
  && mkdir -p /app/data && chown -R bridge:bridge /app/data
USER bridge
VOLUME /app/data
EXPOSE 3000
CMD ["node", "server.js"]
