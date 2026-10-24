FROM python:3.11-slim-bookworm

WORKDIR /app

# Prevents Python from writing .pyc files and buffering stdout/err
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV PYTHONPATH=/app
ARG APP_ENV=stage
ENV APP_ENV=${APP_ENV}

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Bake the NLTK corpora the video pipeline needs INTO the image. Downloading
# them at runtime is a blocking network call on a request path, and NLTK's
# servers rate-limit (429/503) — which stalled content generation past the
# client timeout. Build-time failure here is non-fatal: the app still starts
# and falls back to a one-shot background fetch.
ENV NLTK_DATA=/usr/local/share/nltk_data
RUN python -m nltk.downloader -d /usr/local/share/nltk_data \
        averaged_perceptron_tagger cmudict || true
# Install system dependencies for Playwright (Chromium) manually
# Install system dependencies for Playwright (Chromium) manually
# Using libgtk-3-0 to pull in most GUI dependencies including atk/atspi
RUN apt-get update && apt-get install -y \
    ffmpeg \
    libnss3 \
    libnspr4 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libpango-1.0-0 \
    libcairo2 \
    libasound2 \
    libxshmfence1 \
    libglu1-mesa \
    fonts-liberation \
    fonts-noto \
    libgtk-3-0 \
    && rm -rf /var/lib/apt/lists/*

RUN playwright install chromium

# Bake the local embedding model (fastembed / ONNX) into the image so a pod
# never downloads from Hugging Face at request time. ~440 MB.
ENV FASTEMBED_CACHE_PATH=/opt/fastembed
RUN python -c "from fastembed import TextEmbedding; TextEmbedding('BAAI/bge-base-en-v1.5', cache_dir='/opt/fastembed')"

COPY . /app/ai_service

EXPOSE 8077

CMD ["uvicorn", "ai_service.main:app", "--host", "0.0.0.0", "--port", "8077", "--timeout-keep-alive", "1200"]


