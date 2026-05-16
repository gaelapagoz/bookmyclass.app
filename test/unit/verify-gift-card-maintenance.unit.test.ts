import { describe, expect, it, vi } from "vitest";

import { verifyGiftCardMaintenance } from "../../scripts/giftcard-server-verify-maintenance";

function response(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("verifyGiftCardMaintenance", () => {
  it("rejects invalid or missing secret configuration before probing the route", async () => {
    const fetchMock = vi.fn<typeof fetch>();

    const result = await verifyGiftCardMaintenance(
      {
        APP_URL: "http://127.0.0.1:3100",
        CRON_SECRET: "",
      },
      fetchMock,
    );

    expect(result.ok).toBe(false);
    expect(result.failures.join("\n")).toContain("CRON_SECRET");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("succeeds when invalid secret is rejected and valid secret returns ok", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(401, { error: "Unauthorized" }))
      .mockResolvedValueOnce(response(200, { ok: true, releasedCount: 0, failedCount: 0 }));

    const result = await verifyGiftCardMaintenance(
      {
        APP_URL: "http://127.0.0.1:3100",
        CRON_SECRET: "cron-secret",
      },
      fetchMock,
    );

    expect(result).toEqual({ ok: true, baseUrl: "http://127.0.0.1:3100", failures: [] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
