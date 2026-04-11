import "./helpers/setup-env";
import { BookingStatus, Role, StudioSessionStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "./helpers/db";
import { createClassCategory, createClassType } from "./helpers/factories";
import { resetDb } from "./helpers/reset-db";

vi.mock("../../src/auth", () => ({
  auth: vi.fn(async () => null),
}));

import { auth } from "../../src/auth";
import * as BookingDraftService from "../../src/lib/public-booking/booking-draft-service";
import {
  POST as createDraft,
  resolveBookingDraftIpRateLimitConfig,
  resolveBookingDraftUserRateLimitConfig,
} from "../../src/app/api/bookings/draft/route";

function buildRequest(body: object) {
  return new Request("http://localhost:3000/api/bookings/draft", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function createSessionFixture(params: { full?: boolean; inPast?: boolean } = {}) {
  const category = await createClassCategory(prisma, {
    name: "Yoga",
    slug: "yoga",
    sortOrder: 1,
    isActive: true,
  });
  const classType = await createClassType(prisma, {
    categoryId: category.id,
    name: "Vinyasa Yoga",
    slug: "vinyasa-yoga",
    sortOrder: 1,
    isActive: true,
    isVisible: true,
  });

  const teacher = await prisma.user.create({
    data: {
      name: "Teacher",
      email: `teacher.${Date.now()}@example.test`,
      role: Role.TEACHER,
    },
  });

  const template = await prisma.classTemplate.create({
    data: {
      classTypeId: classType.id,
      defaultTeacherId: teacher.id,
      title: "Vinyasa Template",
      slug: `vinyasa-template-${Date.now()}`,
      defaultCapacity: 2,
      defaultDurationMinutes: 60,
      isActive: true,
      isPublished: true,
    },
  });

  const start = new Date();
  start.setUTCMinutes(0, 0, 0);
  start.setUTCHours(17, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() + (params.inPast ? -2 : 2));
  const end = new Date(start.getTime() + 60 * 60 * 1000);

  const studioSession = await prisma.studioSession.create({
    data: {
      classTemplateId: template.id,
      classTypeId: classType.id,
      teacherId: teacher.id,
      title: "Vinyasa Session",
      startsAt: start,
      endsAt: end,
      capacity: 2,
      status: StudioSessionStatus.SCHEDULED,
      isPublished: true,
    },
  });

  if (params.full) {
    const clientOne = await prisma.user.create({
      data: {
        name: "Client 1",
        email: `client1.${Date.now()}@example.test`,
        role: Role.CLIENT,
      },
    });
    const clientTwo = await prisma.user.create({
      data: {
        name: "Client 2",
        email: `client2.${Date.now()}@example.test`,
        role: Role.CLIENT,
      },
    });

    await prisma.booking.createMany({
      data: [
        {
          clientId: clientOne.id,
          studioSessionId: studioSession.id,
          status: BookingStatus.CONFIRMED,
          customerName: clientOne.name,
          customerEmail: clientOne.email,
          customerPhone: "+32000000001",
          consentTermsAccepted: true,
          consentPrivacyAccepted: true,
          consentAcceptedAt: new Date(),
        },
        {
          clientId: clientTwo.id,
          studioSessionId: studioSession.id,
          status: BookingStatus.CONFIRMED,
          customerName: clientTwo.name,
          customerEmail: clientTwo.email,
          customerPhone: "+32000000002",
          consentTermsAccepted: true,
          consentPrivacyAccepted: true,
          consentAcceptedAt: new Date(),
        },
      ],
    });
  }

  return {
    serviceSlug: classType.slug,
    sessionId: studioSession.id,
  };
}

function validDraftPayload(session: { serviceSlug: string; sessionId: string }) {
  return {
    serviceSlug: session.serviceSlug,
    sessionId: session.sessionId,
    customerName: "Client User",
    customerEmail: "client@example.test",
    customerPhone: "+32000000009",
    customerMessage: "Looking forward to class",
    bookingIntent: "SINGLE_BOOKING",
    consentTermsAccepted: true,
    consentPrivacyAccepted: true,
  };
}

function authSessionForUser(user: { id: string; name: string; email: string }) {
  return {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
    },
    expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  };
}

async function createAuthenticatedUser(email: string) {
  const user = await prisma.user.create({
    data: {
      name: "Authenticated Client",
      email,
      role: Role.CLIENT,
    },
  });

  vi.mocked(auth).mockResolvedValue(authSessionForUser(user));

  return user;
}

describe("POST /api/bookings/draft", () => {
  beforeEach(async () => {
    delete process.env.BOOKING_DRAFT_RATE_LIMIT_MODE;
    vi.mocked(auth).mockResolvedValue(null);
    delete process.env.BOOKING_DRAFT_IP_MAX_ATTEMPTS;
    delete process.env.BOOKING_DRAFT_IP_WINDOW_MS;
    delete process.env.BOOKING_DRAFT_IP_BLOCK_DURATION_MS;
    delete process.env.BOOKING_DRAFT_IP_MAX_ATTEMPTS_LOAD;
    delete process.env.BOOKING_DRAFT_IP_WINDOW_MS_LOAD;
    delete process.env.BOOKING_DRAFT_IP_BLOCK_DURATION_MS_LOAD;
    delete process.env.BOOKING_DRAFT_USER_MAX_ATTEMPTS;
    delete process.env.BOOKING_DRAFT_USER_WINDOW_MS;
    delete process.env.BOOKING_DRAFT_USER_BLOCK_DURATION_MS;
    delete process.env.BOOKING_DRAFT_USER_MAX_ATTEMPTS_LOAD;
    delete process.env.BOOKING_DRAFT_USER_WINDOW_MS_LOAD;
    delete process.env.BOOKING_DRAFT_USER_BLOCK_DURATION_MS_LOAD;
    await resetDb();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses strict default IP rate-limit config when env overrides are not set", () => {
    expect(resolveBookingDraftIpRateLimitConfig()).toEqual({
      maxAttempts: 20,
      windowMs: 60_000,
      blockDurationMs: 300_000,
    });
  });

  it("uses strict default user rate-limit config when env overrides are not set", () => {
    expect(resolveBookingDraftUserRateLimitConfig()).toEqual({
      maxAttempts: 8,
      windowMs: 60_000,
      blockDurationMs: 300_000,
    });
  });

  it("accepts UAT IP rate-limit env overrides", () => {
    process.env.BOOKING_DRAFT_IP_MAX_ATTEMPTS = "400";
    process.env.BOOKING_DRAFT_IP_WINDOW_MS = "60000";
    process.env.BOOKING_DRAFT_IP_BLOCK_DURATION_MS = "30000";

    expect(resolveBookingDraftIpRateLimitConfig()).toEqual({
      maxAttempts: 400,
      windowMs: 60_000,
      blockDurationMs: 30_000,
    });
  });

  it("accepts UAT user rate-limit env overrides", () => {
    process.env.BOOKING_DRAFT_USER_MAX_ATTEMPTS = "200";
    process.env.BOOKING_DRAFT_USER_WINDOW_MS = "60000";
    process.env.BOOKING_DRAFT_USER_BLOCK_DURATION_MS = "30000";

    expect(resolveBookingDraftUserRateLimitConfig()).toEqual({
      maxAttempts: 200,
      windowMs: 60_000,
      blockDurationMs: 30_000,
    });
  });


  it("uses load-window-safe defaults when BOOKING_DRAFT_RATE_LIMIT_MODE=load", () => {
    process.env.BOOKING_DRAFT_RATE_LIMIT_MODE = "load";

    expect(resolveBookingDraftIpRateLimitConfig()).toEqual({
      maxAttempts: 400,
      windowMs: 60_000,
      blockDurationMs: 30_000,
    });

    expect(resolveBookingDraftUserRateLimitConfig()).toEqual({
      maxAttempts: 200,
      windowMs: 60_000,
      blockDurationMs: 30_000,
    });
  });

  it("accepts explicit load-window env overrides when BOOKING_DRAFT_RATE_LIMIT_MODE=load", () => {
    process.env.BOOKING_DRAFT_RATE_LIMIT_MODE = "load";
    process.env.BOOKING_DRAFT_IP_MAX_ATTEMPTS_LOAD = "500";
    process.env.BOOKING_DRAFT_IP_WINDOW_MS_LOAD = "65000";
    process.env.BOOKING_DRAFT_IP_BLOCK_DURATION_MS_LOAD = "45000";
    process.env.BOOKING_DRAFT_USER_MAX_ATTEMPTS_LOAD = "250";
    process.env.BOOKING_DRAFT_USER_WINDOW_MS_LOAD = "65000";
    process.env.BOOKING_DRAFT_USER_BLOCK_DURATION_MS_LOAD = "45000";

    expect(resolveBookingDraftIpRateLimitConfig()).toEqual({
      maxAttempts: 500,
      windowMs: 65_000,
      blockDurationMs: 45_000,
    });

    expect(resolveBookingDraftUserRateLimitConfig()).toEqual({
      maxAttempts: 250,
      windowMs: 65_000,
      blockDurationMs: 45_000,
    });
  });
  it("requires authentication", async () => {
    const fixture = await createSessionFixture();
    vi.mocked(auth).mockResolvedValue(null);

    const response = await createDraft(buildRequest(validDraftPayload(fixture)));

    expect(response.status).toBe(401);
  });

  it("creates a pending booking draft for signed-in user", async () => {
    const fixture = await createSessionFixture();
    const user = await createAuthenticatedUser("auth.client@example.test");

    const response = await createDraft(buildRequest(validDraftPayload(fixture)));
    const body = (await response.json()) as {
      draft: { bookingId: string; status: string };
    };

    expect(response.status).toBe(201);
    expect(body.draft.status).toBe("PENDING");

    const booking = await prisma.booking.findUnique({ where: { id: body.draft.bookingId } });
    expect(booking?.clientId).toBe(user.id);
    expect(booking?.status).toBe(BookingStatus.PENDING);
  });

  it("attaches authenticated user id when available", async () => {
    const fixture = await createSessionFixture();
    const user = await createAuthenticatedUser("auth.client.2@example.test");

    const response = await createDraft(buildRequest(validDraftPayload(fixture)));
    const body = (await response.json()) as {
      draft: { bookingId: string };
    };
    const booking = await prisma.booking.findUnique({ where: { id: body.draft.bookingId } });

    expect(response.status).toBe(201);
    expect(booking?.clientId).toBe(user.id);
  });

  it("rejects missing sessionId", async () => {
    const fixture = await createSessionFixture();
    await createAuthenticatedUser("auth.client.3@example.test");

    const payload = validDraftPayload(fixture);
    const invalidPayload = { ...payload } as Partial<typeof payload>;
    delete invalidPayload.sessionId;

    const response = await createDraft(buildRequest(invalidPayload));
    expect(response.status).toBe(400);
  });

  it("rejects invalid session", async () => {
    const fixture = await createSessionFixture();
    await createAuthenticatedUser("auth.client.4@example.test");

    const response = await createDraft(
      buildRequest({
        ...validDraftPayload(fixture),
        sessionId: "missing-session-id",
      }),
    );
    expect(response.status).toBe(404);
  });

  it("rejects past session", async () => {
    const fixture = await createSessionFixture({ inPast: true });
    await createAuthenticatedUser("auth.client.5@example.test");

    const response = await createDraft(buildRequest(validDraftPayload(fixture)));
    expect(response.status).toBe(400);
  });

  it("rejects full session", async () => {
    const fixture = await createSessionFixture({ full: true });
    await createAuthenticatedUser("auth.client.6@example.test");

    const response = await createDraft(buildRequest(validDraftPayload(fixture)));
    expect(response.status).toBe(400);
  });

  it("rejects missing required fields", async () => {
    const fixture = await createSessionFixture();
    await createAuthenticatedUser("auth.client.7@example.test");

    const response = await createDraft(
      buildRequest({
        ...validDraftPayload(fixture),
        customerEmail: "",
      }),
    );
    expect(response.status).toBe(400);
  });

  it("rejects missing required consents", async () => {
    const fixture = await createSessionFixture();
    await createAuthenticatedUser("auth.client.8@example.test");

    const response = await createDraft(
      buildRequest({
        ...validDraftPayload(fixture),
        consentTermsAccepted: false,
      }),
    );
    expect(response.status).toBe(400);
  });

  it("maps transient contention errors to 503", async () => {
    const fixture = await createSessionFixture();
    await createAuthenticatedUser("auth.client.9@example.test");

    const createDraftMock = vi
      .spyOn(BookingDraftService, "createPendingBookingDraft")
      .mockRejectedValue(
        new BookingDraftService.BookingDraftError(
          "BOOKING_CONTENTION",
          "Booking creation temporarily failed due to concurrent activity. Please try again.",
        ),
      );

    const response = await createDraft(buildRequest(validDraftPayload(fixture)));
    const body = (await response.json()) as { error: string; code: string };

    expect(response.status).toBe(503);
    expect(body.code).toBe("BOOKING_CONTENTION");
    expect(body.error).toContain("temporarily failed");
    createDraftMock.mockRestore();
  });
  it("maps retryable prisma technical failures to 503 BOOKING_CONTENTION", async () => {
    const fixture = await createSessionFixture();
    await createAuthenticatedUser("auth.client.retryable@example.test");

    const createDraftMock = vi
      .spyOn(BookingDraftService, "createPendingBookingDraft")
      .mockRejectedValue(Object.assign(new Error("Transaction API error"), { code: "P2024" }));

    const response = await createDraft(buildRequest(validDraftPayload(fixture)));
    const body = (await response.json()) as { error: string; code: string };

    expect(response.status).toBe(503);
    expect(body.code).toBe("BOOKING_CONTENTION");
    createDraftMock.mockRestore();
  });

  it("maps transient prisma connection-pool exhaustion to 503 BOOKING_CONTENTION", async () => {
    const fixture = await createSessionFixture();
    await createAuthenticatedUser("auth.client.pool-exhaustion@example.test");

    const createDraftMock = vi
      .spyOn(BookingDraftService, "createPendingBookingDraft")
      .mockRejectedValue(
        Object.assign(new Error("Too many database connections opened"), {
          code: "P2037",
        }),
      );

    const response = await createDraft(buildRequest(validDraftPayload(fixture)));
    const body = (await response.json()) as { error: string; code: string };

    expect(response.status).toBe(503);
    expect(body.code).toBe("BOOKING_CONTENTION");
    createDraftMock.mockRestore();
  });
  it("maps overlapping client.query technical failures to 503 BOOKING_CONTENTION", async () => {
    const fixture = await createSessionFixture();
    await createAuthenticatedUser("auth.client.query-overlap@example.test");

    const createDraftMock = vi
      .spyOn(BookingDraftService, "createPendingBookingDraft")
      .mockRejectedValue(
        new Error("Calling client.query() when the client is already executing a query is deprecated"),
      );

    const response = await createDraft(buildRequest(validDraftPayload(fixture)));
    const body = (await response.json()) as { error: string; code: string };

    expect(response.status).toBe(503);
    expect(body.code).toBe("BOOKING_CONTENTION");
    createDraftMock.mockRestore();
  });
  it("keeps unknown technical failures as 500 with stable technical code", async () => {
    const fixture = await createSessionFixture();
    await createAuthenticatedUser("auth.client.unknown500@example.test");

    const createDraftMock = vi
      .spyOn(BookingDraftService, "createPendingBookingDraft")
      .mockRejectedValue(new Error("Unexpected adapter failure"));

    const response = await createDraft(buildRequest(validDraftPayload(fixture)));
    const body = (await response.json()) as { error: string; code: string };

    expect(response.status).toBe(500);
    expect(body.code).toBe("BOOKING_DRAFT_TECHNICAL_FAILURE");
    createDraftMock.mockRestore();
  });

  it("returns existing pending draft idempotently for duplicate create attempts", async () => {
    const fixture = await createSessionFixture();
    await createAuthenticatedUser("auth.client.10@example.test");

    const first = await createDraft(buildRequest(validDraftPayload(fixture)));
    const firstBody = (await first.json()) as { draft: { bookingId: string } };

    const second = await createDraft(buildRequest(validDraftPayload(fixture)));
    const secondBody = (await second.json()) as { draft: { bookingId: string; created: boolean } };

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(secondBody.draft.created).toBe(false);
    expect(secondBody.draft.bookingId).toBe(firstBody.draft.bookingId);
  });
});
