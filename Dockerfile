FROM node:24.14.0-bookworm-slim AS production-dependencies

WORKDIR /app
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    ffmpeg \
    fonts-liberation \
    gosu \
    python3 \
    python3-pip \
    tini \
  && rm -rf /var/lib/apt/lists/*
COPY requirements-python.txt ./
RUN python3 -m pip install --break-system-packages --no-cache-dir -r requirements-python.txt

COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi
RUN npx playwright install --with-deps chromium

FROM production-dependencies AS build

RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi
# Keep build inputs explicit so docs/tests changes do not invalidate the image build cache.
COPY tsconfig.json tsconfig.server.json vite.config.ts vite.extension.config.ts ./
COPY src ./src
COPY extension ./extension
RUN npm run build

FROM production-dependencies AS runtime

COPY --from=build /app/dist ./dist
COPY --from=build /app/extension ./extension
COPY --chmod=755 docker-entrypoint.sh /usr/local/bin/shv-entrypoint

ENV NODE_ENV=production
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5m --retries=3 CMD ["gosu", "node", "node", "-e", "fetch('http://127.0.0.1:8080/api/health').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"]
RUN mkdir -p /data/library /data/app /work \
  && chown -R node:node /data /work /ms-playwright
VOLUME ["/data/library", "/data/app", "/work"]
USER root
ENTRYPOINT ["shv-entrypoint"]
CMD ["npm", "run", "start"]
