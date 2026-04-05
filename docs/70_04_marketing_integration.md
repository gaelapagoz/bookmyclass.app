# Marketing Integration

Purpose: document the current marketing delivery/tracking integration boundaries.

## Core Components
- Campaign orchestration and send flow: `src/lib/marketing/marketing-delivery.ts`.
- Audience resolution/filtering: `src/lib/marketing/marketing-audience.ts`.
- HTML rendering/tracking-link extraction: `src/lib/marketing/marketing-renderer.ts`.
- Tracking token helpers: `src/lib/marketing/marketing-tracking.ts`.

## Delivery Path
- Marketing email delivery delegates to central email delivery module (`sendEmailViaResend`).
- Recipient status is updated per send outcome (`PENDING` -> `SENT` or `FAILED`).

## Tracking/Unsubscribe Path
- Open and click events are recorded with recipient/token linkage.
- Unsubscribe token flow updates recipient status and upserts unsubscribe records.

## Data Models
- `MarketingCampaign`, `MarketingCampaignRecipient`, `MarketingCampaignLink`, `MarketingCampaignLinkClick`, `MarketingUnsubscribe`.

## Canonical References
- `src/lib/marketing/marketing-delivery.ts`
- `src/lib/marketing/marketing-tracking.ts`
- `prisma/schema.prisma`
