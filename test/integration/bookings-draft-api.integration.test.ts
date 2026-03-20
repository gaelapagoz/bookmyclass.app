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
import { POST as createDraft } from "../../src/app/api/bookings/draft/route";

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
    customerName: "Guest User",
    customerEmail: "guest@example.test",
    customerPhone: "+32000000009",
    customerMessage: "Looking forward to class",
    bookingIntent: "SINGLE_BOOKING",
    consentTermsAccepted: true,
    consentPrivacyAccepted: true,
  };
}

describe("POST /api/bookings/draft", () => {
  beforeEach(async () => {
    vi.mocked(auth).mockResolvedValue(null);
    await resetDb();
  });

  it("creates a pending booking draft for guest booking", async () => {
    const fixture = await createSessionFixture();
    const response = await createDraft(buildRequest(validDraftPayload(fixture)));
    const body = (await response.json()) as {
      draft: { bookingId: string; status: string };
    };

    expect(response.status).toBe(201);
    expect(body.draft.status).toBe("PENDING");

    const booking = await prisma.booking.findUnique({ where: { id: body.draft.bookingId } });
    expect(booking?.clientId).toBeNull();
    expect(booking?.status).toBe(BookingStatus.PENDING);
  });

  it("attaches authenticated user id when available", async () => {
    const fixture = await createSessionFixture();
    const user = await prisma.user.create({
      data: {
        name: "Authenticated Client",
        email: "auth.client@example.test",
        role: Role.CLIENT,
      },
    });
    vi.mocked(auth).mockResolvedValue({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
      },
      expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });

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
    const payload = validDraftPayload(fixture);
    const invalidPayload = { ...payload };
    delete invalidPayload.sessionId;

    const response = await createDraft(buildRequest(invalidPayload));
    expect(response.status).toBe(400);
  });

  it("rejects invalid session", async () => {
    const fixture = await createSessionFixture();
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
    const response = await createDraft(buildRequest(validDraftPayload(fixture)));
    expect(response.status).toBe(400);
  });

  it("rejects full session", async () => {
    const fixture = await createSessionFixture({ full: true });
    const response = await createDraft(buildRequest(validDraftPayload(fixture)));
    expect(response.status).toBe(400);
  });

  it("rejects missing required fields", async () => {
    const fixture = await createSessionFixture();
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
    const response = await createDraft(
      buildRequest({
        ...validDraftPayload(fixture),
        consentTermsAccepted: false,
      }),
    );
    expect(response.status).toBe(400);
  });
});



