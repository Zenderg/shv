FROM node:24-bookworm-slim AS base

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    ffmpeg \
    fonts-liberation \
    python3 \
    python3-pip \
    tini \
  && rm -rf /var/lib/apt/lists/*
RUN python3 -m pip install --break-system-packages --no-cache-dir --upgrade "yt-dlp[default]"

COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi
RUN npx playwright install --with-deps chromium

COPY . .
RUN npm run build

ENV NODE_ENV=production
EXPOSE 8080
VOLUME ["/data/library", "/data/app", "/work"]
ENTRYPOINT ["tini", "--"]
CMD ["npm", "run", "start"]
