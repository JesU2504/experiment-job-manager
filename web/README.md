# Dashboard

React and TypeScript dashboard for Experiment Job Manager. It has two explicit modes:

- **Browser demo:** a Web Worker performs a seeded Monte Carlo calculation in the
  visitor's tab. Jobs and events use session storage; reloading cancels unfinished
  demo work. No API key or shared backend is involved. Wall time includes small
  pauses so progress and cancellation are observable.
- **Connected API:** requests go to the FastAPI service and its separate Python
  worker. The API key is held in memory for the current connection, never in
  browser storage or URLs. Results and state transitions come from the backend.

The two implementations use different seeded PRNGs. Results are reproducible
within each mode; they are not expected to be identical across modes. Only the
browser worker provides an intermediate convergence trace. API mode shows the
actual final result from Python.

## Develop

Use Node 24 and pnpm 11.25.0.

```bash
pnpm install --frozen-lockfile
pnpm dev
pnpm test
pnpm build
```

The development server runs at `http://127.0.0.1:5173`. The production build is
written to `dist/`.

## Connect to FastAPI

Build the frontend in this directory. The API serves `web/dist` at `/` when it
exists, and keeps `/docs` and `/v1` routes available. Docker Compose builds and
serves the dashboard automatically.

For the development server, configure the backend with:

```bash
export EJM_CORS_ORIGINS=http://127.0.0.1:5173
```

Use **Connect API** in the dashboard and enter the backend URL and its
`EJM_API_KEY`. For a separately hosted HTTPS dashboard, the backend needs a
reachable HTTPS URL and that dashboard's exact origin in `EJM_CORS_ORIGINS`.
The default CORS allowlist is empty, and API authentication remains required.

## Verification

Vitest covers seeded computation, batch invariance, validation, queue order,
cancellation, retries, stale-result rejection, reload recovery, corrupt storage,
API authentication errors and request cancellation. Backend tests cover static
serving, API route precedence and allowed/denied CORS origins. The container
smoke test verifies the dashboard is served and completes a real API job.
