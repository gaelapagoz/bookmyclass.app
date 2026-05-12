# Access Control

Purpose: summarize role and route access controls currently enforced in code.

## Role Model
- Roles: `MASTER_ADMIN`, `ADMIN`, `TEACHER`, `CLIENT`.

## Access Enforcement
- Customer protected routes use `requireVerifiedUser`.
- Admin private routes and admin mutations use `requireAdminSession` and admin access assertions.
- Admin access currently accepts both `ADMIN` and `MASTER_ADMIN` via shared admin-role check.

## AuthZ Notes
- Unauthenticated users are redirected to sign-in.
- Inactive/unverified users are blocked from verified customer flows.
- Admin unauthorized users are redirected to admin unauthorized state.
- Gift-card admin visibility accepts `ADMIN` and `MASTER_ADMIN` for read-only wallet, ledger, redemption, and reconciliation lookup.
- Gift-card reconciliation resolution is restricted to `MASTER_ADMIN`; `ADMIN` note handling is non-financial and cannot resolve manual-review cases.

## Known Gaps (Current)
- Fine-grained split between `ADMIN` and `MASTER_ADMIN` is partial:
  - `MASTER_ADMIN` assignment/management is enforced server-side.
  - Broader admin area access still uses shared admin-role checks.
  - Gift-card manual-review resolution now enforces a narrow `MASTER_ADMIN` boundary server-side.
- Teacher route group is explicitly enforced via `requireTeacherSession` in `src/app/teacher/layout.tsx`; keep UI/E2E guard coverage active.

## Canonical References
- `prisma/schema.prisma`
- `src/lib/auth/require-auth.ts`
- `src/lib/auth/admin-access.ts`
- `src/app/admin/(private)/layout.tsx`
- `docs/00_03_known_non_goals.md`
