FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN --mount=type=secret,id=build_ca \
    if [ -f /run/secrets/build_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/build_ca; fi; npm ci --no-audit --no-fund --fetch-timeout=30000 --fetch-retries=1 --loglevel=info
COPY . .
RUN npm run build

FROM node:24-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package*.json ./
RUN --mount=type=secret,id=build_ca \
    if [ -f /run/secrets/build_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/build_ca; fi; npm ci --omit=dev --no-audit --no-fund --fetch-timeout=30000 --fetch-retries=1 --loglevel=info && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server ./dist-server
RUN mkdir -p /var/lib/encounter-ledger/assets && chown -R node:node /var/lib/encounter-ledger
ENV ASSET_STORAGE_DIR=/var/lib/encounter-ledger/assets
VOLUME ["/var/lib/encounter-ledger/assets"]
USER node
EXPOSE 3001
CMD ["node", "dist-server/server/index.js"]
