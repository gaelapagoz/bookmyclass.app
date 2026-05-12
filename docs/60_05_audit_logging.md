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
- Gift-card reconciliation alert/resolution events write `AuditLog` rows with operational metadata.

## Scope Notes
- Audit logging is present, but coverage is not universal for every mutation path.
- This document reflects technical implementation, not a full compliance attestation.
- Gift-card reconciliation notes are non-financial operational notes. They do not adjust wallet balance, ledger entries, payment state, or order state.
- Gift-card resolution responses must include: `Operational note only. This does not adjust wallet balance or payment state.`

## Canonical References
- `prisma/schema.prisma`
- `src/lib/admin/admin-service.ts`
