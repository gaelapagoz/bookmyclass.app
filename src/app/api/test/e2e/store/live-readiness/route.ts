import { PriceType, StripeSyncStatus } from "@prisma/client";
import { z } from "zod";

import { assertE2ETestRequest } from "@/lib/e2e/e2e-test-guard";
import { isCatalogPriceCheckoutReady, isStripePriceIdAllowedForRuntime } from "@/lib/catalog/checkout-readiness";

const payloadSchema = z.object({
  stripePriceId: z.string().trim().min(1).nullable(),
  stripeSyncStatus: z.nativeEnum(StripeSyncStatus).default(StripeSyncStatus.SYNCED),
  currencyCode: z.string().trim().length(3).default("EUR"),
  unitAmountMinor: z.number().int().positive().default(2_500),
  priceType: z.nativeEnum(PriceType).default(PriceType.ONE_TIME),
});

export async function POST(request: Request) {
  const denied = assertE2ETestRequest(request);
  if (denied) {
    return denied;
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  const parsed = payloadSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json({ error: "Invalid payload." }, { status: 400 });
  }

  const input = parsed.data;
  const allowedForLiveRuntime = input.stripePriceId
    ? isStripePriceIdAllowedForRuntime(input.stripePriceId, "live")
    : false;
  const checkoutReadyForLiveRuntime = isCatalogPriceCheckoutReady(
    {
      priceType: input.priceType,
      currencyCode: input.currencyCode.toUpperCase(),
      unitAmountMinor: input.unitAmountMinor,
      billingInterval: null,
      billingIntervalCount: null,
      stripePriceId: input.stripePriceId,
      stripeSyncStatus: input.stripeSyncStatus,
    },
    { stripeRuntimeMode: "live" },
  );

  return Response.json(
    {
      allowedForLiveRuntime,
      checkoutReadyForLiveRuntime,
    },
    { status: 200 },
  );
}

