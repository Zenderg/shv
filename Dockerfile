FROM node:24-bookworm-slim AS base

WORKDIR /app
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    ffmpeg \
    fonts-liberation \
    python3 \
    python3-pip \
    tini \
  && rm -rf /var/lib/apt/lists/*
COPY requirements-python.txt ./
RUN python3 -m pip install --break-system-packages --no-cache-dir -r requirements-python.txt

COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi
RUN npx playwright install --with-deps chromium

# Keep build inputs explicit so docs/tests changes do not invalidate the image build cache.
COPY tsconfig.json tsconfig.server.json vite.config.ts vite.extension.config.ts ./
COPY src ./src
COPY extension ./extension
RUN npm run build

ENV NODE_ENV=production
EXPOSE 8080
RUN mkdir -p /data/library /data/app /work \
  && chown -R node:node /data /work /ms-playwright
VOLUME ["/data/library", "/data/app", "/work"]
ENTRYPOINT ["tini", "--"]
USER node
CMD ["npm", "run", "start"]
