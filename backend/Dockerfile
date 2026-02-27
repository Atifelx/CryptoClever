# Render (and other hosts): build asyncpg and other C extensions
FROM python:3.11-slim

# Install build deps for asyncpg (gcc, libpq)
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Render sets PORT
ENV PORT=10000
EXPOSE ${PORT}

CMD uvicorn app.main:app --host 0.0.0.0 --port ${PORT}
