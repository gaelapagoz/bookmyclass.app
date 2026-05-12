# Service Boundaries

Purpose: document the current service-first boundaries and where logic belongs.

## Boundary Rules (Current)
- Frontend components should not contain business logic.
- Mutations must validate input before write operations.
- Domain logic belongs in `src/lib/*` services.
- API routes and server actions orchestrate services; they should not duplicate rules.

## Boundary Map
- Auth and identity: `src/lib/auth/*`.
- Booking and checkout domain: `src/lib/public-booking/*`.
- Attendance and check-in domain: `src/lib/attendance/*`.
- Subscription domain: `src/lib/subscription/*`.
- Gift-card wallet foundation: `src/lib/gift-cards/*`.
- Gift-card admin visibility, reconciliation note handling, and manual-review resolution checks: `src/lib/gift-cards/gift-card-admin-service.ts`.
- Store catalog setup, read models, fulfillment wording, and wallet cap pre-check: `src/lib/store/*`.
- Dashboard domain: `src/lib/dashboard/*`.
- Admin domain: `src/lib/admin/*`.
- Marketing domain: `src/lib/marketing/*`.
- Learning/inbox/public docs domains: `src/lib/learning/*`, `src/lib/client-messages/*`, `src/lib/public-documents/*`.

## Entry Points Using These Services
- API handlers: `src/app/api/*`.
- Admin server actions: `src/app/admin/(private)/actions.ts`.
- Protected/public pages call service helpers for read models and mutations.

## Guardrails
- Keep Stripe, Resend, and Sentry integration boundaries centralized under `src/lib/*` integration modules.
- Reuse shared validators/utilities rather than re-implementing per route.
- Attendance transition rules are owned by `attendance-service`; pages/actions must call the service instead of duplicating transition checks.
- Gift-card activation, reserve, capture, release, wallet locking, and invariant checks are owned by `gift-cards/*`.
- Gift-card admin routes and pages must call `gift-card-admin-service`; they must not duplicate reconciliation consistency checks or wallet calculations.
- Store Product + Price readiness and setup rules are owned by `store/*`.
- Store UI, checkout routes, webhooks, and admin behavior must not duplicate gift-card wallet rules.

## Canonical References
- `docs/10_01_business_rules.md`
- `docs/10_02_domain_rules.md`
- `docs/10_03_subscription_domain_rules.md`
- `docs/90_01_codex_rulebook.md`
