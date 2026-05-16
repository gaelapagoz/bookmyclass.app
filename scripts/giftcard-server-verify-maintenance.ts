/**
 * Giftcard server verify maintenance
 *
 * Purpose:
 * - Operational script for this repository's server/local workflows.
 *
 * Safety:
 * - Read-only checks by default.
 *
 * Variables:
 * - TARGET_ENV (optional), BASE_URL (default https://demo.bookmyclass.app), APP_DIR (default /var/www/bookmyclass), APP_NAME (default bookmyclass-app).
 *
 * Usage:
 *   tsx scripts/giftcard-server-verify-maintenance.ts
 */
import "dotenv/config";
import { pathToFileURL } from "node:url";

export type GiftCardMaintenanceVerifyEnv = {
  CRON_SECRET?: string;
  APP_URL?: string;
  GIFT_CARD_MAINTENANCE_BASE_URL?: string;
};

export type GiftCardMaintenanceFetch = typeof fetch;

export type GiftCardMaintenanceVerificationResult = {
  ok: boolean;
  baseUrl: string | null;
  failures: string[];
};

function resolveBaseUrl(env: GiftCardMaintenanceVerifyEnv): string | null {
  const raw = env.GIFT_CARD_MAINTENANCE_BASE_URL?.trim() || env.APP_URL?.trim();
  if (!raw) return null;

  try {
    const url = new URL(raw);
    return url.origin;
  } catch {
    return null;
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export async function verifyGiftCardMaintenance(
  env: GiftCardMaintenanceVerifyEnv = process.env,
  fetchImpl: GiftCardMaintenanceFetch = fetch,
): Promise<GiftCardMaintenanceVerificationResult> {
  const failures: string[] = [];
  const cronSecret = env.CRON_SECRET?.trim();
  const baseUrl = resolveBaseUrl(env);

  if (!cronSecret) {
    failures.push("CRON_SECRET is missing or empty.");
  }

  if (!baseUrl) {
    failures.push("APP_URL or GIFT_CARD_MAINTENANCE_BASE_URL must be a valid absolute URL.");
  }

  if (failures.length > 0 || !cronSecret || !baseUrl) {
    return { ok: false, baseUrl, failures };
  }

  const endpoint = `${baseUrl}/api/cron/gift-cards/maintenance`;
  const invalidResponse = await fetchImpl(endpoint, {
    method: "GET",
    headers: { authorization: "Bearer invalid-gift-card-maintenance-secret" },
  });

  if (invalidResponse.status !== 401) {
    failures.push(`Invalid secret probe returned HTTP ${invalidResponse.status}; expected 401.`);
  }

  const validResponse = await fetchImpl(endpoint, {
    method: "GET",
    headers: { authorization: `Bearer ${cronSecret}` },
  });
  const validPayload = await readJson(validResponse);

  if (!validResponse.ok) {
    failures.push(`Valid secret probe returned HTTP ${validResponse.status}; expected 2xx.`);
  }

  if (
    !validPayload ||
    typeof validPayload !== "object" ||
    !("ok" in validPayload) ||
    (validPayload as { ok?: unknown }).ok !== true
  ) {
    failures.push("Valid secret probe did not return an { ok: true } JSON payload.");
  }

  return { ok: failures.length === 0, baseUrl, failures };
}

async function main(): Promise<void> {
  const result = await verifyGiftCardMaintenance();
  console.log("[verify-gift-card-maintenance] Gift-card maintenance verification");
  console.log(`Target: ${result.baseUrl ?? "<missing>"}`);

  if (result.ok) {
    console.log("Status: READY");
    return;
  }

  console.error("Status: BLOCKED");
  for (const failure of result.failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error("[verify-gift-card-maintenance] Verification failed.");
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
