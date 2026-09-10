# Two stages: build the React app with Node, then serve everything from Python.
# The image contains no secrets -- keys arrive as environment variables at run time.

FROM node:22-slim AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build          # emits ../static_web

FROM python:3.12-slim
WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY council/ ./council/
COPY server.py cli.py check_keys.py ./
COPY static/ ./static/
COPY --from=web /static_web ./static_web/

# Transcripts, conversations and usage counts live here. Mount a volume to keep them.
RUN mkdir -p data
ENV PORT=8000
EXPOSE 8000

CMD ["sh", "-c", "uvicorn server:app --host 0.0.0.0 --port ${PORT}"]
