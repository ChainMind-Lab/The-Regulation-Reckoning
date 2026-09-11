# Monitoring

The backend exposes Prometheus-format metrics at `GET /metrics` (text format
`0.0.4`). A ready-to-run Prometheus + Grafana stack is included under
`monitoring/` and wired into `docker-compose.yml`, so `docker compose up`
starts the whole platform **and** the observability stack together.

## Metrics exposed (`GET /metrics`)

| Metric | Type | Meaning |
|---|---|---|
| `soroban_up` | gauge | 1 when the last Soroban RPC request succeeded |
| `horizon_up` | gauge | 1 when the last Horizon request succeeded |
| `indexer_up` | gauge | 1 when the last indexer pass succeeded |
| `bounties_tracked` | gauge | number of bounties in the read-model |
| `soroban_request_duration_ms` | histogram | Soroban RPC latency (buckets 5 ms–10 s) |
| `horizon_request_duration_ms` | histogram | Horizon latency |
| `events_indexed_total` | counter | contract events persisted by the indexer |
| `indexer_ledger_gaps_total` | counter | missed-ledger gaps detected |
| `ingest_records_total{pipeline}` | counter | records ingested per pipeline |
| `http_requests_total{method,status}` | counter | API responses by HTTP status |

Metrics register lazily: a family appears in `/metrics` once the code path that
touches it has run (e.g. `horizon_up` after the first `/api/network` call).

`http_requests_total{method,status}` is incremented for **every** response (success or
failure) by a single middleware in `app.ts`. Histogram buckets are cumulative and always
include an `+Inf` bucket, so `histogram_quantile()` (used by the p95 panel) is valid.

## Quick start

```bash
docker compose up --build
# platform:  frontend http://localhost:8080, API proxied to backend
# prometheus: http://localhost:9090
# grafana:    http://localhost:3000  (admin / GRAFANA_ADMIN_PASSWORD or "admin")
```

Grafana is **provisioned automatically**: the Prometheus datasource and the
dashboard "Regulation Reckoning — Stellar Testnet" are loaded from
`monitoring/grafana/provisioning` on startup. No manual setup.

The dashboard includes:

- Upstream health stat panels: Soroban RPC, Horizon, indexer (UP/DOWN).
- `bounties_tracked` and `indexer_ledger_gaps_total` stats.
- Time series: indexed events/sec, Soroban RPC latency p95, HTTP requests/sec
  by status, ingested records/sec by pipeline.

Change the admin password with `GRAFANA_ADMIN_PASSWORD` (do **not** commit a
real password).

## Scraping externally

Point any Prometheus at the backend directly:

```yaml
scrape_configs:
  - job_name: regulation-reckoning
    metrics_path: /metrics
    static_configs:
      - targets: ['<backend-host>:3001']
```

If the backend is behind auth/TLS, add the usual `bearer_token` /
`scheme: https` / `tls_config` options to the scrape job.