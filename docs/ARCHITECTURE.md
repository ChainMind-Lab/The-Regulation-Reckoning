# Architecture

The Regulation Reckoning is a Soroban bounty platform where **Stellar Testnet is the
source of truth** for bounty and event data. The backend maintains a SQLite read-model
built from on-chain events plus a documented data-ingestion pipeline; the React
dashboard is a thin client over the backend API.

## System diagram

```
                        ┌────────────────────────────────────────────┐
                        │              Stellar Testnet               │
                        │                                            │
  Freighter wallet ─────┤  Soroban RPC (soroban-testnet.stellar.org) │
  (browser, signs XDR)  │  · bounty contract CCVDE7Q…LCH7            │
                        │  · contributors registry CBIA55M…ES3CS     │
                        │  · RRD token CCOAF5D…2NB4                  │
                        │  Horizon (network status, payments)        │
                        │  (bounty → registry: env.invoke_contract  │
                        │   records payouts on release)              │
                        └──────┬────────────────────────┬────────────┘
                               │                        │
        POST /api/tx/build     │                        │ getEvents() (ledger cursor)
        POST /api/tx/submit    │                        ▼
                        ┌──────▼──────────────┐  ┌──────────────────┐
                        │  Express API        │  │  Event indexer   │
                        │  (backend/src)      │  │  (services/      │
                        └──────┬──────────────┘  │   indexer.ts)    │
                               │                 └────────┬─────────┘
                               │                          │ upsert
                               ▼                          ▼
                        ┌───────────────────────────────────────────┐
                        │  SQLite read-model (node:sqlite)          │
                        │  · bounties (derived from events)         │
                        │  · soroban_events (raw indexed events)    │
                        │  · regulatory_events + issues (ingested)  │
                        └───────────────────┬───────────────────────┘
                                            │
    GET /api/bounties, /api/events,         ▼
    /api/policies, /api/analytics   ┌────────────────┐
    ───────────────────────────────▶│  React dashboard │
                                    │  (src/)          │
                                    └────────────────┘
```

## Components

### Soroban contracts

#### Bounty escrow (`contracts/bounty`)

- `create(funder, token, amount, issue_id)` — locks `amount` of `token` in escrow
  for an issue. Emits `bounty_created`.
- `release(issue_id, contributor)` — admin-only; transfers escrowed tokens to the
  contributor **and invokes `record` on the contributors registry** (inter-contract
  call). Emits `bounty_released`.
- `reclaim(issue_id)` — funder-only; returns unclaimed funds. Emits `bounty_reclaimed`.
- `get_bounty(issue_id)` — on-chain read used for verification.
- `init(admin, registry)` — one-time bootstrap: admin + registry contract ID.
  Emits `admin_initialised`.

All state changes emit typed events (Soroban `#[contractevent]`), which the indexer
consumes. The contract has 21 tests covering authorization, validation, idempotency
(re-creating/releasing/reclaiming is a no-op error, never a double spend), events,
and the inter-contract registry write.

#### Contributors registry (`contracts/contributors`)

- `init(allowed)` — one-time bootstrap: the only caller allowed to write.
- `record(contributor, issue_id, amount)` — requires the allowed caller's auth
  (the bounty contract). Emits `contributor_recorded`.
- `stats(address)` — `{ count, total }`; anyone can read.

The registry gives the payout history an on-chain home outside the bounty contract
itself and is read live by the backend (`GET /api/contributors/:address`). It has 7
tests covering authorization (direct callers rejected), validation, math, and events.

### Backend (`backend/`)

- **`services/soroban.ts`** — RPC client. Builds and simulates Soroban transactions
  (`buildContractTransaction`), submits wallet-signed XDR and waits for inclusion
  (`submitSignedTransaction`), reads bounty state (`readBounty`), and fetches contract
  events with a ledger cursor (`fetchContractEvents`). Uses raw JSON-RPC for
  `getTransaction` polling to stay XDR-version independent.
- **`services/indexer.ts`** — polls the contract for new events and upserts them into
  `soroban_events`, then derives `bounties` rows. Cursor-based; idempotent per tx hash.
- **`services/ingest/`** — the regulatory data pipeline (see `docs/DATA.md`):
  validates, classifies, and idempotently upserts `regulatory_events` and `issues`.
- **`services/analytics.ts`** — deterministic aggregates over the ingested dataset
  (jurisdiction/category/severity/year distributions, a documented risk index).
- **`middleware/rateLimit.ts`** — per-IP sliding-window rate limiting.
- **`middleware/error.ts`** — central error handler mapping `ApiError` to JSON
  `{ error, code }` responses.
- **`db.ts`** — `node:sqlite` schema and prepared statements.

### Frontend (`src/`)

- **`lib/api.ts`** — typed client for the backend REST API.
- **`lib/wallet.ts`** — Freighter integration: connect, detect availability, and sign
  transaction XDR. The frontend never holds a secret key.
- **`components/BountyForm.tsx`** — the wallet flow: `POST /api/tx/build` →
  `signTransactionXdr` in Freighter → `POST /api/tx/submit` → refresh.
- **`components/EventsFeed.tsx`** — indexed on-chain events with explorer links.
- **`components/PolicyPanel.tsx`** — ingested regulatory data + analytics tiles.

## Transaction flow (fund a bounty)

1. User connects Freighter → backend learns the `G…` address.
2. User submits the form → `POST /api/tx/build` with `{ action: 'create', source, issueId, amount }`.
3. Backend builds + simulates the Soroban call via RPC, returns the unsigned XDR.
4. Freighter signs the XDR in the browser (`signTransaction(xdr, { networkPassphrase })`).
5. `POST /api/tx/submit` relays the signed XDR; backend submits to Soroban RPC and
   waits for `SUCCESS`.
6. The indexer picks up the `bounty_created` event; `GET /api/bounties` reflects it.

## Data flow (regulatory dataset)

1. Curated dataset in `backend/data/policy-regulations.json` (citable sources).
2. `ingestPolicies()` validates shape, classifies category/jurisdiction/severity, and
   upserts rows (idempotent, deterministic).
3. `computeAnalytics()` derives aggregates — pure functions over persisted rows.
4. `GET /api/policies` and `GET /api/analytics` serve the read-model.

## Non-goals / boundaries

- The dashboard never talks to Horizon/Soroban directly — the backend is the only
  client of Stellar, which keeps signing, rate limiting, and indexing in one place.
- No mainnet deployment is configured; everything targets Stellar Testnet.
- Secrets (`BOUNTY_ADMIN_SECRET`, `ADMIN_TOKEN`) are environment-only, never committed,
  and never returned by the API.