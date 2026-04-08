import { beforeEach, describe, expect, it, vi } from "vitest";

const getMock = vi.fn();
const postJsonMock = vi.fn();

vi.mock("../../k6/lib/http.js", () => ({
  get: (...args: unknown[]) => getMock(...args),
  postJson: (...args: unknown[]) => postJsonMock(...args),
}));

function mockResponse(status: number, body: unknown) {
  return {
    status,
    json: () => body,
  };
}

describe("k6 booking candidates helpers", () => {
  beforeEach(() => {
    vi.resetModules();
    getMock.mockReset();
    postJsonMock.mockReset();
    (globalThis as unknown as { __VU: number }).__VU = 1;
    (globalThis as unknown as { __ITER: number }).__ITER = 0;
  });

  it("prioritizes nearest availability candidates ahead of seeded sessions", async () => {
    getMock
      .mockReturnValueOnce(mockResponse(200, { next: { date: "2026-05-01" } }))
      .mockReturnValueOnce(
        mockResponse(200, {
          slots: [
            { id: "slot-nearest-1", isAvailable: true },
            { id: "slot-nearest-2", isAvailable: true },
          ],
        }),
      );

    const { resolveBookingSessionCandidates } = await import("../../k6/lib/booking-candidates.js");
    const candidates = resolveBookingSessionCandidates({
      serviceSlug: "vinyasa-yoga",
      seed: { sessionIds: ["seed-1", "seed-2", "slot-nearest-1"] },
      maxCandidates: 5,
    });

    expect(candidates).toEqual(["slot-nearest-1", "slot-nearest-2", "seed-1", "seed-2"]);
  });

  it("retries draft creation on FULL_SESSION and DUPLICATE_BOOKING collisions", async () => {
    postJsonMock
      .mockReturnValueOnce(mockResponse(400, { code: "FULL_SESSION", error: "This session is full." }))
      .mockReturnValueOnce(
        mockResponse(409, {
          code: "DUPLICATE_BOOKING",
          error: "You already have an active booking draft or booking for this session.",
        }),
      )
      .mockReturnValueOnce(mockResponse(201, { draft: { bookingId: "booking-123" } }));

    const { createDraftWithSessionFallback } = await import("../../k6/lib/booking-candidates.js");
    const result = createDraftWithSessionFallback({
      flowTag: "booking_checkout",
      serviceSlug: "vinyasa-yoga",
      sessionCandidates: ["s-1", "s-2", "s-3"],
      draftPayload: {
        customerName: "K6 User",
        customerEmail: "k6@example.test",
        customerPhone: "+32000000000",
        bookingIntent: "SINGLE_BOOKING",
        consentTermsAccepted: true,
        consentPrivacyAccepted: true,
      },
    });

    expect(result.bookingId).toBe("booking-123");
    expect(result.sessionId).toBe("s-3");
    expect(result.attemptedSessionCount).toBe(3);
    expect(postJsonMock).toHaveBeenCalledTimes(3);
  });
});
