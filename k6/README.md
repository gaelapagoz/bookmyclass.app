# k6 UAT Load Suite

Production-usable k6 load testing for UAT/staging only, aligned with active runtime flows:
- browse
- login
- booking_entitlement
- booking_checkout
- subscription_checkout

## UAT-only guard

This suite fails fast if `BASE_URL` does not look like UAT/staging/demo/local (`uat`, `staging`, `demo.bookmyclass.app`, `localhost`, or `127.0.0.1`).

## Files

- `config/stages.js`: smoke, smoke_booking_safe, t50, t100
- `config/thresholds.js`: global and scenario-level thresholds
- `data/users.csv`: seeded test users
- `data/services.json`: optional service/session seed values
- `data/products.json`: optional product seed values
- `lib/*`: shared helpers
- `scenarios/*`: scenario implementations
- `main.js`: entrypoint and scenario wiring

## Required env vars

- `BASE_URL` (required)
- `STAGE_PROFILE` (required): `smoke`, `smoke_booking_safe`, `t50`, `t100`

Deprecation note:
- Legacy high-load aliases remain temporarily for one release tag.
- Do not use legacy aliases for new runs; use only `t50` and `t100`.
- Archived helper scripts live under `scripts/archive/perf-legacy/`.

## Optional env vars

- `SERVICE_SLUG`
- `SESSION_ID`
- `PRODUCT_ID`
- `PRICE_ID`

## Seed data

1. Update `k6/data/users.csv` with valid UAT client credentials.
2. Optional but recommended: set active IDs in:
   - `k6/data/services.json`
   - `k6/data/products.json`
3. One-command UAT discovery/update for those seed IDs:
   ```bash
   npm run k6:discover:server
   ```
   Optional override:
   ```bash
   BASE_URL=https://uat.bookmyclass.app npm run k6:discover:server
   ```

If `SESSION_ID` is not set, booking scenarios use the discovered seed pool from `k6/data/services.json`:
- `sessionIds` (preferred, deterministic modulo by VU/ITER)
- `sessionId` (legacy fallback)

Seed safety:
- By default, seeded session IDs are only used when they still exist in live availability for the service.
- Set `BOOKING_ALLOW_STALE_SEEDED_SESSION_IDS=1` only for explicit debugging drills.

Run note:
- Prefer `k6:discover:server` so seed data includes a real multi-session pool.
- Set explicit `SESSION_ID` only when you intentionally want a single-session run.

## Traffic split

- browse: 35%
- login: 20%
- booking_entitlement: 20%
- booking_checkout: 15%
- subscription_checkout: 10%

## Thresholds

- global `http_req_failed`: `< 1%`
- global `http_req_duration p(95)`: `< 1200ms`
- global `http_req_duration p(99)`: `< 2500ms`
- global `checks`: `> 99%`
- scenario `p95`:
  - browse `< 800ms`
  - login `< 1200ms`
  - booking_entitlement `< 1500ms`
  - booking_checkout `< 1800ms`
  - subscription_checkout `< 1800ms`

## Exact run commands

Smoke:
```bash
k6 run -e BASE_URL=https://uat.bookmyclass.app -e STAGE_PROFILE=smoke k6/main.js
```

smoke_booking_safe:
```bash
k6 run -e BASE_URL=https://uat.bookmyclass.app -e STAGE_PROFILE=smoke_booking_safe k6/main.js
```

t100:
```bash
k6 run -e BASE_URL=https://uat.bookmyclass.app -e STAGE_PROFILE=t100 k6/main.js
```

t50:
```bash
k6 run -e BASE_URL=https://uat.bookmyclass.app -e STAGE_PROFILE=t50 k6/main.js
```

## Example with explicit flow IDs

```bash
k6 run \
  -e BASE_URL=https://uat.bookmyclass.app \
  -e STAGE_PROFILE=t100 \
  -e SERVICE_SLUG=vinyasa-yoga \
  -e SESSION_ID=cm-session-id \
  -e PRODUCT_ID=cm-product-id \
  -e PRICE_ID=cm-price-id \
  k6/main.js
```


## UAT deterministic seed

This repository includes a dedicated UAT-only seed command for load testing cohorts.

### Command

```bash
UAT_K6_SEED=1 npm run db:seed:server:k6
```

### What it creates

- Total users: `1200`
- `entitlement_collective`: `400`
- `no_entitlement`: `400`
- `subscription_buyer`: `400`

Cohort usage in scenarios:
- `booking_entitlement` uses only `entitlement_collective`
- `booking_checkout` uses only `no_entitlement`
- `subscription_checkout` uses only `subscription_buyer`
- `login` can use the full pool

Naming convention:

- `k6-uat-entitlement_collective-0001@bookmyclass.app`
- `k6-uat-no_entitlement-0001@bookmyclass.app`
- `k6-uat-subscription_buyer-0001@bookmyclass.app`

Deterministic shared password:

- `Book4Ever!`

CSV export:

- Default output: `k6/data/users.csv`
- Columns: `email,password,name,phone,cohort`
- Optional override: `K6_USERS_CSV_PATH=...`

Guardrails:

- Command requires `UAT_K6_SEED=1`
- Command aborts if `DATABASE_URL` does not look like UAT/staging/local
- Only cohort users are reset/reseeded; no production runtime behavior is modified
