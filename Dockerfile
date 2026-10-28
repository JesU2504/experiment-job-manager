FROM node:24-alpine AS dashboard
WORKDIR /web
COPY web/package.json web/pnpm-lock.yaml ./
RUN npm install -g pnpm@11.25.0 && pnpm install --frozen-lockfile
COPY web/ ./
RUN pnpm build

FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 EJM_WEB_DIRECTORY=/app/web-dist
WORKDIR /app
COPY pyproject.toml requirements.lock ./
COPY src ./src
RUN pip install --no-cache-dir -c requirements.lock . \
    && useradd --uid 10001 --create-home app
COPY alembic.ini ./
COPY migrations ./migrations
COPY --from=dashboard /web/dist /app/web-dist
USER app
EXPOSE 8000
CMD ["uvicorn", "job_manager.api:create_app", "--factory", "--host", "0.0.0.0", "--port", "8000"]
