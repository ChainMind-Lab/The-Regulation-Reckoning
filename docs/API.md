# API Reference

Base URL: `http://localhost:3001` (override with `VITE_API_URL` on the frontend).

All responses are JSON. Errors follow the shape:

```json
{ "error": "human-readable message", "code": "MACHINE_CODE" }
```

HTTP status codes: `400` bad input, `401` unauthorized, `404` not found,
`429` rate limited, `502` upstream (Horizon/RPC) failure, `500` internal.

---

## Network

### `GET /api/network`
Live Stellar network status from Horizon.
```json
{
  "network": "Test SDF Network ; September 2015",
  "horizon": "https://horizon-testnet.stellar.org",
  "protocolVersion": "22",
  "latestLedger": "19695405",
  "closedAt": "2026-09-09T11:07:38Z"
}
```

### `GET /api/payments?limit=10`
Recent Stellar payments (limit 1–50, default 10).

---

## Application data (read-model)

### `GET /api/issues`
Open ingested issues, ordered by points desc. Tags are arrays.

### `GET /api/policies`
Validated regulatory dataset, newest first.
```json
[
  {
    "id": "eu-mica-2025-07-01",
    "title": "EU MiCA stablecoin rules apply",
    "jurisdiction": "EU",
    "category": "stablecoin-regulation",
    "eventDate": "2025-07-01",
    "severity": 4,
    "summary": "…",
    "sourceName": "European Commission",
    "sourceUrl": "https://…",
    "source": "curated"
  }
]
```

### `GET /api/analytics`
Deterministic aggregates over the policy dataset:
```json
{
  "generatedAt": "2026-…Z",
  "totals": { "events": 20, "jurisdictions": 8, "categories": 6, "averageSeverity": 3.1 },
  "riskIndex": 42.5,
  "byJurisdiction": { "EU": 5 },
  "byCategory": { "stablecoin-regulation": 4 },
  "bySeverity": { "4": 3 },
  "byYear": { "2025": 20 }
}
```
See `docs/DATA.md` for the risk-index formula.

---

## Contract state (from Stellar)

### `GET /api/contract`
Deployed contract metadata and initialisation status:
```json
{
  "configured": true,
  "contractId": "CB4OI57YRKLAIX2RGFS7DX3GIGEST4MSI447VAJPRCBCNFUHWLWLQLWT",
  "tokenId": "CB7NFW2WD3FXKBYANZX7J3FO6PBST2H3IE6SPHXHSWIQESII2P2A6Y6P",
  "registryId": "CC53MJDM5M76GMZONKC56ONW4MM74MX3KF4LSXMWTRE7W66RASDP4W7Q",
  "admin": "GB2OVPTEO2BYRRRRWNRPZZOC3VW77IQDXJPBY2WYV2MXSU7C5HQDZ6E6",
  "network": "Test SDF Network ; September 2015",
  "rpcUrl": "https://soroban-testnet.stellar.org",
  "horizonUrl": "https://horizon-testnet.stellar.org",
  "initialised": true
}
```

### `GET /api/contributors/:address`
Live on-chain stats from the contributors registry (inter-contract contract):
```json
{
  "contributor": "G…FRQI",
  "count": 1,
  "total": "250",
  "verified": true,
  "source": "stellar"
}
```
Reads the registry contract directly via Soroban RPC — proof that the bounty
contract recorded the payout on-chain.

### `GET /api/bounties`
Bounty state derived from indexed contract events, newest first:
```json
[
  {
    "issueId": "repo#42",
    "funder": "G…",
    "contributor": "G…",
    "token": "CCOAF5D…",
    "amount": "250",
    "released": false,
    "createdTx": "88e97e17…",
    "releasedTx": null,
    "updatedAt": "2026-…Z",
    "createdUrl": "https://stellar.expert/explorer/testnet/tx/88e97e17…",
    "releasedUrl": null
  }
]
```

### `GET /api/bounties/:issueId`
**Live on-chain verification** — reads the bounty directly from the contract via RPC:
```json
{ "issueId": "repo#42", "funder": "G…", "contributor": null, "token": "CCOAF5D…",
  "amount": "250", "released": false, "verified": true, "source": "stellar" }
```
`404` when the bounty does not exist on chain.

### `GET /api/events?limit=50`
Indexed Soroban contract events (limit 1–200):
```json
[
  {
    "id": 1,
    "txHash": "88e97e17…",
    "ledger": 19695405,
    "contractId": "CC2YEX6U…",
    "topic": "bounty_created",
    "issueId": "repo#42",
    "payload": { "amount": "250", "funder": "G…" },
    "createdAt": "2026-…Z",
    "explorerUrl": "https://stellar.expert/explorer/testnet/tx/88e97e17…"
  }
]
```
Topics: `admin_initialised`, `bounty_created`, `bounty_released`, `bounty_reclaimed`.

---

## Transaction relay

The backend builds and simulates transactions; the wallet signs; the backend submits.

### `POST /api/tx/build`
Body (create):
```json
{ "action": "create", "source": "G…", "issueId": "repo#42", "amount": "250" }
```
Body (release):
```json
{ "action": "release", "source": "G…", "issueId": "repo#42", "contributor": "G…" }
```
Body (reclaim):
```json
{ "action": "reclaim", "source": "G…", "issueId": "repo#42" }
```
Response:
```json
{
  "txXdr": "AAAA…",
  "action": "create",
  "networkPassphrase": "Test SDF Network ; September 2015"
}
```
`400 BAD_SOURCE` for invalid `source`; `400 BAD_ACTION` for unknown actions;
`502` if simulation fails (e.g. insufficient balance, missing trustline).

### `POST /api/tx/submit`
Body: `{ "signedXdr": "AAAA…" }` — the XDR returned by Freighter's `signTransaction`.

Response:
```json
{
  "status": "SUCCESS",
  "hash": "88e97e17…",
  "explorerUrl": "https://stellar.expert/explorer/testnet/tx/88e97e17…"
}
```
`400 BAD_XDR` for empty/malformed XDR; `502` on submission failure. A successful
submit triggers an immediate indexer pass so the dashboard reflects the change.

---

## Ops

### `POST /api/ingest/run`
Manually re-runs the ingestion pipelines. Requires `Authorization: Bearer <ADMIN_TOKEN>`
when `ADMIN_TOKEN` is configured. Response: `{ "policies": {...}, "issues": {...} }`.

---

## Observability

### `GET /health`
Liveness — `{ "status": "ok", "uptime": 123.4 }` (used by the Docker healthcheck).

### `GET /health/ready`
Readiness — checks the DB, Horizon reachability, and (when configured) Soroban
contract initialisation. Returns `200` when DB + Horizon are healthy:
```json
{ "status": "ready", "db": true, "horizon": true, "soroban": true }
```
`503` with `status: "degraded"` otherwise.

### `GET /metrics`
Prometheus-format text metrics (requests, ingest runs, indexed events, tx relay
results). Example:
```
http_requests_total{method="GET",path="/api/bounties",status="200"} 42
```