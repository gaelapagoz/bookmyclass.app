# k6 UAT Load Suite

Production-usable k6 load testing for UAT/staging only, aligned with active runtime flows:
- browse
- login
- booking_entitlement
- booking_checkout
- subscription_checkout

## UAT-only guard

This suite fails fast if `BASE_URL` does not look like UAT/staging/local (`uat`, `staging`, `localhost`, or `127.0.0.1`).

## Files

- `config/stages.js`: smoke, smoke_booking_safe, t100, t250, t500, t750, t1000, soak1000
- `config/thresholds.js`: global and scenario-level thresholds
- `data/users.csv`: seeded test users
- `data/services.json`: optional service/session seed values
- `data/products.json`: optional product seed values
- `lib/*`: shared helpers
- `scenarios/*`: scenario implementations
- `main.js`: entrypoint and scenario wiring

## Required env vars

- `BASE_URL` (required)
- `STAGE_PROFILE` (required): `smoke`, `smoke_booking_safe`, `t100`, `t250`, `t500`, `t750`, `t1000`, `soak1000`

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

If `SESSION_ID` is not set, booking scenarios try to discover one from:
- `/api/services/{serviceSlug}/next-availability`
- `/api/services/{serviceSlug}/slots`

Run note:
- Prefer setting an explicit dedicated `SESSION_ID` for booking scenarios in UAT load runs.
- Fallback discovery works, but shared/discovered sessions can trigger capacity or uniqueness-related false failures under high concurrency.

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
k6 run -e BASE_URL=https://uat.example.com -e STAGE_PROFILE=smoke k6/main.js
```

smoke_booking_safe:
```bash
k6 run -e BASE_URL=https://uat.example.com -e STAGE_PROFILE=smoke_booking_safe k6/main.js
```

t100:
```bash
k6 run -e BASE_URL=https://uat.example.com -e STAGE_PROFILE=t100 k6/main.js
```

t250:
```bash
k6 run -e BASE_URL=https://uat.example.com -e STAGE_PROFILE=t250 k6/main.js
```

t500:
```bash
k6 run -e BASE_URL=https://uat.example.com -e STAGE_PROFILE=t500 k6/main.js
```

t750:
```bash
k6 run -e BASE_URL=https://uat.example.com -e STAGE_PROFILE=t750 k6/main.js
```

t1000:
```bash
k6 run -e BASE_URL=https://uat.example.com -e STAGE_PROFILE=t1000 k6/main.js
```

soak1000:
```bash
k6 run -e BASE_URL=https://uat.example.com -e STAGE_PROFILE=soak1000 k6/main.js
```

## Example with explicit flow IDs

```bash
k6 run \
  -e BASE_URL=https://uat.example.com \
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
UAT_K6_SEED=1 npm run db:seed:uat:k6
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

- `k6-uat-entitlement_collective-0001@k6-uat.bookmyclass.local`
- `k6-uat-no_entitlement-0001@k6-uat.bookmyclass.local`
- `k6-uat-subscription_buyer-0001@k6-uat.bookmyclass.local`

Deterministic shared password:

- `UAT.K6.Phase4!2026`

CSV export:

- Default output: `k6/data/users.csv`
- Columns: `email,password,name,phone,cohort`
- Optional override: `K6_USERS_CSV_PATH=...`

Guardrails:

- Command requires `UAT_K6_SEED=1`
- Command aborts if `DATABASE_URL` does not look like UAT/staging/local
- Only cohort users are reset/reseeded; no production runtime behavior is modified
