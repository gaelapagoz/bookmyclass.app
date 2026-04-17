import "./helpers/setup-env";
import { BookingStatus, Role, StudioSessionStatus, WaitlistStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "./helpers/db";
import { createClassCategory, createClassType } from "./helpers/factories";
import { resetDb } from "./helpers/reset-db";

vi.mock("../../src/auth", () => ({
  auth: vi.fn(async () => null),
}));

import { auth } from "../../src/auth";
import { POST as joinWaitlist } from "../../src/app/api/waitlist/join/route";
import { POST as cancelWaitlist } from "../../src/app/api/waitlist/cancel/route";

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

async function createAuthenticatedClient(label = "waitlist-api") {
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const user = await prisma.user.create({
    data: {
      name: `${label}-${unique}`,
      email: `${label}-${unique}@example.test`,
      role: Role.CLIENT,
    },
  });

  vi.mocked(auth).mockResolvedValue(authSessionForUser(user));
  return user;
}

async function createFullCollectiveSession() {
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const category = await createClassCategory(prisma, {
    name: "Collective",
    slug: `collective-${unique}`,
    sortOrder: 1,
    isActive: true,
  });
  const classType = await createClassType(prisma, {
    categoryId: category.id,
    name: "Yoga",
    slug: `yoga-${unique}`,
    sortOrder: 1,
    isActive: true,
    isVisible: true,
  });
  const teacher = await prisma.user.create({
    data: {
      name: "Teacher",
      email: `teacher-${unique}@example.test`,
      role: Role.TEACHER,
    },
  });
  const template = await prisma.classTemplate.create({
    data: {
      classTypeId: classType.id,
      defaultTeacherId: teacher.id,
      title: "Yoga Template",
      slug: `template-${unique}`,
      defaultCapacity: 2,
      defaultDurationMinutes: 60,
      isActive: true,
      isPublished: true,
    },
  });

  const startsAt = new Date(Date.now() + 72 * 60 * 60 * 1000);
  const session = await prisma.studioSession.create({
    data: {
      classTemplateId: template.id,
      classTypeId: classType.id,
      teacherId: teacher.id,
      title: "Yoga Session",
      startsAt,
      endsAt: new Date(startsAt.getTime() + 60 * 60 * 1000),
      capacity: 2,
      status: StudioSessionStatus.SCHEDULED,
      isPublished: true,
    },
  });

  const fillerOne = await prisma.user.create({
    data: {
      name: "Filler One",
      email: `filler1-${unique}@example.test`,
      role: Role.CLIENT,
    },
  });
  const fillerTwo = await prisma.user.create({
    data: {
      name: "Filler Two",
      email: `filler2-${unique}@example.test`,
      role: Role.CLIENT,
    },
  });

  await prisma.booking.createMany({
    data: [
      {
        clientId: fillerOne.id,
        studioSessionId: session.id,
        status: BookingStatus.CONFIRMED,
        customerName: fillerOne.name,
        customerEmail: fillerOne.email,
      },
      {
        clientId: fillerTwo.id,
        studioSessionId: session.id,
        status: BookingStatus.CONFIRMED,
        customerName: fillerTwo.name,
        customerEmail: fillerTwo.email,
      },
    ],
  });

  return session;
}

function buildRequest(url: string, body: object) {
  return new Request(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost:3000",
      referer: "http://localhost:3000/test",
      "x-forwarded-host": "localhost:3000",
      "x-forwarded-proto": "http",
    },
    body: JSON.stringify(body),
  });
}

describe("waitlist API routes", () => {
  beforeEach(async () => {
    await resetDb();
    vi.mocked(auth).mockResolvedValue(null);
  });

  it("requires authentication for waitlist join", async () => {
    const response = await joinWaitlist(
      buildRequest("http://localhost:3000/api/waitlist/join", { sessionId: "session_1" }),
    );
    expect(response.status).toBe(401);
  });

  it("validates waitlist join payload", async () => {
    await createAuthenticatedClient();
    const response = await joinWaitlist(
      buildRequest("http://localhost:3000/api/waitlist/join", { sessionId: "" }),
    );
    expect(response.status).toBe(400);
  });

  it("joins and cancels a waitlist entry through API", async () => {
    const client = await createAuthenticatedClient("join-cancel");
    const session = await createFullCollectiveSession();

    const joinResponse = await joinWaitlist(
      buildRequest("http://localhost:3000/api/waitlist/join", { sessionId: session.id }),
    );
    expect(joinResponse.status).toBe(201);
    const joinPayload = await joinResponse.json();
    const waitlistEntryId = (joinPayload as { waitlist?: { waitlistEntryId?: string } }).waitlist?.waitlistEntryId;
    expect(waitlistEntryId).toBeTruthy();

    const cancelResponse = await cancelWaitlist(
      buildRequest("http://localhost:3000/api/waitlist/cancel", { waitlistEntryId }),
    );
    expect(cancelResponse.status).toBe(200);

    const cancelledEntry = await prisma.waitlistEntry.findUnique({
      where: { id: waitlistEntryId },
      select: { clientId: true, status: true },
    });
    expect(cancelledEntry?.clientId).toBe(client.id);
    expect(cancelledEntry?.status).toBe(WaitlistStatus.CANCELLED);
  });

  it("forbids cancel when waitlist entry belongs to a different user", async () => {
    const owner = await createAuthenticatedClient("owner");
    const session = await createFullCollectiveSession();
    const joinResponse = await joinWaitlist(
      buildRequest("http://localhost:3000/api/waitlist/join", { sessionId: session.id }),
    );
    const joinPayload = await joinResponse.json();
    const waitlistEntryId = (joinPayload as { waitlist?: { waitlistEntryId?: string } }).waitlist?.waitlistEntryId;
    expect(waitlistEntryId).toBeTruthy();

    const other = await prisma.user.create({
      data: {
        name: "Other User",
        email: `other-${Date.now()}@example.test`,
        role: Role.CLIENT,
      },
    });
    vi.mocked(auth).mockResolvedValue(authSessionForUser(other));

    const cancelResponse = await cancelWaitlist(
      buildRequest("http://localhost:3000/api/waitlist/cancel", { waitlistEntryId }),
    );
    expect(cancelResponse.status).toBe(403);

    const entry = await prisma.waitlistEntry.findUnique({
      where: { id: waitlistEntryId },
      select: { clientId: true, status: true },
    });
    expect(entry?.clientId).toBe(owner.id);
    expect(entry?.status).toBe(WaitlistStatus.ACTIVE);
  });
});
