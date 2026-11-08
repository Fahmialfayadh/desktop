FROM python:3.11-slim

# Install ffmpeg, curl, and Node.js for stream transcoding, healthcheck, and PO tokens
RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg curl ca-certificates gnupg && \
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && \
    apt-get install -y --no-install-recommends nodejs && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install uv for fast dependency management
COPY --from=ghcr.io/astral-sh/uv:latest /uv /bin/uv

# Copy project source files (supports both backend/ and repository root build contexts)
COPY . .

# If built with repository root as context, move backend files into /app
RUN if [ -d "backend" ]; then cp -rn backend/* . ; fi && \
    uv pip install --system --no-cache -e .

# Install the BotGuard PO token minter dependencies
RUN cd potoken && npm install --omit=dev --no-audit --no-fund && \
    npm cache clean --force

# Create temporary streaming cache directory
RUN mkdir -p /tmp/liner-stream-cache && chmod 777 /tmp/liner-stream-cache

ENV PORT=8787
ENV HOST=0.0.0.0
ENV TMP_STREAM_DIR=/tmp/liner-stream-cache
ENV FFMPEG_PATH=/usr/bin/ffmpeg

EXPOSE 8787

CMD ["sh", "-c", "node potoken/server.mjs & uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8787}"]
