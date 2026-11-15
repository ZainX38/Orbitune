FROM node:22-bookworm-slim

# Python + audio libraries for librosa
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 python3-venv ffmpeg libsndfile1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Python dependencies in their own environment
COPY server/requirements.txt server/requirements.txt
RUN python3 -m venv /opt/venv && /opt/venv/bin/pip install --no-cache-dir -r server/requirements.txt
ENV ORBITUNE_PYTHON=/opt/venv/bin/python

# Node dependencies (copied first so rebuilds are faster)
COPY server/package*.json server/
RUN cd server && npm ci --omit=dev
COPY client/package*.json client/
RUN cd client && npm ci

# The code, then build the website
COPY . .
RUN cd client && npm run build && mkdir -p /app/server/cache

ENV NODE_ENV=production
WORKDIR /app/server
CMD ["node", "index.js"]