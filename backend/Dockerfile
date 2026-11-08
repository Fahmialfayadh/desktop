FROM python:3.11-slim

# Install ffmpeg and curl for stream transcoding and healthcheck
RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg curl ca-certificates xz-utils && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy project source files (supports both backend/ and repository root build contexts)
COPY . .

# Flatten backend into /app so uvicorn can import app.main directly
RUN if [ -d "backend" ]; then cp -rn backend/* . ; fi

# Install Python runtime dependencies into a venv (avoids externally-managed Python issues)
RUN python -m venv /opt/venv && \
    /opt/venv/bin/pip install --no-cache-dir --upgrade pip && \
    /opt/venv/bin/pip install --no-cache-dir \
        fastapi uvicorn yt-dlp httpx pydantic python-dotenv

# Install Node.js tarball for the BotGuard PO token minter (isolated from apt)
ARG NODE_VERSION=22.23.4
RUN curl -fsSL https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz | tar -xJ -C /usr/local --strip-components=1

# Install the BotGuard PO token minter dependencies
RUN cd potoken && npm install --omit=dev --no-audit --no-fund && \
    npm cache clean --force

# Create temporary streaming cache directory
RUN mkdir -p /tmp/liner-stream-cache && chmod 777 /tmp/liner-stream-cache

ENV PORT=8787
ENV HOST=0.0.0.0
ENV TMP_STREAM_DIR=/tmp/liner-stream-cache
ENV FFMPEG_PATH=/usr/bin/ffmpeg
ENV PATH="/opt/venv/bin:$PATH"

EXPOSE 8787

CMD ["sh", "-c", "node potoken/server.mjs & uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8787}"]
