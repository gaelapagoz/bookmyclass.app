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

## Known Gaps (Current)
- Fine-grained split between `ADMIN` and `MASTER_ADMIN` is partial:
  - `MASTER_ADMIN` assignment/management is enforced server-side.
  - Broader admin area access still uses shared admin-role checks.
- Teacher route group is explicitly enforced via `requireTeacherSession` in `src/app/teacher/layout.tsx`; keep UI/E2E guard coverage active.

## Canonical References
- `prisma/schema.prisma`
- `src/lib/auth/require-auth.ts`
- `src/lib/auth/admin-access.ts`
- `src/app/admin/(private)/layout.tsx`
- `docs/00_03_known_non_goals.md`
