import { GiftCardReconciliationStatus, Role } from "@prisma/client";

import { requireAdminSession } from "@/lib/auth/require-auth";
import {
  getAdminGiftCardWalletLookup,
  listAdminGiftCardReconciliationCases,
} from "@/lib/gift-cards/gift-card-admin-service";

function parsePositiveInt(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function parseStatus(value: string | null): GiftCardReconciliationStatus | "ALL" | undefined {
  if (!value) {
    return undefined;
  }
  if (value === "ALL") {
    return "ALL";
  }
  return Object.values(GiftCardReconciliationStatus).includes(value as GiftCardReconciliationStatus)
    ? value as GiftCardReconciliationStatus
    : undefined;
}

export async function GET(request: Request) {
  let session: Awaited<ReturnType<typeof requireAdminSession>>;
  try {
    session = await requireAdminSession({ throwOnFailure: true });
  } catch (error) {
    const code = error instanceof Error ? error.message : "UNAUTHENTICATED";
    return Response.json(
      { code },
      { status: code === "FORBIDDEN" ? 403 : 401 },
    );
  }

  const url = new URL(request.url);
  const page = parsePositiveInt(url.searchParams.get("page"));
  const pageSize = parsePositiveInt(url.searchParams.get("pageSize"));
  const actor = { userId: session.user.id, role: session.user.role as Role };
  const clientId = url.searchParams.get("clientId")?.trim();

  try {
    if (clientId) {
      return Response.json(
        await getAdminGiftCardWalletLookup({ actor, clientId, page, pageSize }),
      );
    }

    return Response.json(
      await listAdminGiftCardReconciliationCases({
        actor,
        status: parseStatus(url.searchParams.get("status")),
        page,
        pageSize,
      }),
    );
  } catch (error) {
    const code = error instanceof Error ? error.message : "GIFT_CARD_ADMIN_LOOKUP_FAILED";
    return Response.json({ code }, { status: code === "GIFT_CARD_CLIENT_NOT_FOUND" ? 404 : 400 });
  }
}
