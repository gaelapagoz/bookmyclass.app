# Audit Logging

Purpose: document audit/provenance mechanisms currently present.

## Structured Audit Model
- `AuditLog` model exists in Prisma with:
  - `actorId`
  - `actionType`
  - `entityType`
  - `entityId`
  - `metadata` (JSON)
  - `createdAt`

## Current Usage (Confirmed)
- Admin service writes to `auditLog` for specific admin/security-relevant mutations.
- Financial/ledger models also include provenance-oriented fields (for example `createdById`, idempotency keys where relevant).

## Scope Notes
- Audit logging is present, but coverage is not universal for every mutation path.
- This document reflects technical implementation, not a full compliance attestation.

## Canonical References
- `prisma/schema.prisma`
- `src/lib/admin/admin-service.ts`
