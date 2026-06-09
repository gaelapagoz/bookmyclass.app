import "./helpers/setup-env";
import { BookingIntent, BookingStatus, ClientMessageContactStatus, ClientMessageType, Role, StudioSessionStatus } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";
import {
  createContactMessage,
  listClientMessages,
} from "../../src/lib/client-messages/client-message-service";
import { prisma } from "./helpers/db";
import { createClassCategory, createClassType } from "./helpers/factories";
import { resetDb } from "./helpers/reset-db";

async function createBookingNoteFixture() {
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const category = await createClassCategory(prisma, {
    name: "Inbox Yoga",
    slug: `inbox-yoga-${unique}`,
    sortOrder: 1,
    isActive: true,
  });
  const classType = await createClassType(prisma, {
    categoryId: category.id,
    name: "Inbox Flow",
    slug: `inbox-flow-${unique}`,
    sortOrder: 1,
    isActive: true,
    isVisible: true,
  });
  const teacher = await prisma.user.create({
    data: {
      name: "Inbox Teacher",
      email: `teacher.${unique}@example.test`,
      role: Role.TEACHER,
    },
  });
  const template = await prisma.classTemplate.create({
    data: {
      classTypeId: classType.id,
      defaultTeacherId: teacher.id,
      title: "Inbox Template",
      slug: `inbox-template-${unique}`,
      defaultCapacity: 8,
      defaultDurationMinutes: 60,
      isActive: true,
      isPublished: true,
    },
  });
  const startsAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
  const session = await prisma.studioSession.create({
    data: {
      classTemplateId: template.id,
      classTypeId: classType.id,
      teacherId: teacher.id,
      title: "Inbox Session",
      startsAt,
      endsAt: new Date(startsAt.getTime() + 60 * 60 * 1000),
      capacity: 8,
      status: StudioSessionStatus.SCHEDULED,
      isPublished: true,
    },
  });
  const client = await prisma.user.create({
    data: {
      name: "Booking Client",
      email: `booking.${unique}@example.test`,
      role: Role.CLIENT,
    },
  });
  const booking = await prisma.booking.create({
    data: {
      clientId: client.id,
      studioSessionId: session.id,
      status: BookingStatus.PENDING,
      bookingIntent: BookingIntent.SINGLE_BOOKING,
      customerName: client.name,
      customerEmail: client.email,
      customerPhone: "+32000000001",
      consentTermsAccepted: true,
      consentPrivacyAccepted: true,
      consentAcceptedAt: new Date(),
    },
  });

  return prisma.clientMessage.create({
    data: {
      type: ClientMessageType.BOOKING_NOTE,
      userId: client.id,
      bookingId: booking.id,
      name: client.name,
      email: client.email,
      message: "Please adjust my booking to next Tuesday afternoon.",
    },
  });
}

describe("client-message-service contact anti-spam", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("accepts a valid contact message into inbox", async () => {
    const created = await createContactMessage({
      name: "Alice Example",
      email: `alice.${Date.now()}@example.test`,
      phone: "+32000000001",
      subject: "Contact form",
      message: "Hello team, I would like more details about your private class booking options.",
      ipAddress: "203.0.113.1",
    });

    expect(created.type).toBe(ClientMessageType.CONTACT);
    expect(created.contactStatus).toBe(ClientMessageContactStatus.INBOX);
    expect(created.spamReason).toBeNull();
  });

  it("flags honeypot-filled submissions as spam", async () => {
    const created = await createContactMessage({
      name: "Bot Example",
      email: `bot.${Date.now()}@example.test`,
      message: "I need more information about class subscriptions and availability this month.",
      honeypot: "https://spam.example",
      ipAddress: "203.0.113.2",
    });

    expect(created.contactStatus).toBe(ClientMessageContactStatus.SPAM);
    expect(created.spamReason).toContain("HONEYPOT_FILLED");
  });

  it("flags gibberish messages as spam", async () => {
    const created = await createContactMessage({
      name: "Noise Example",
      email: `noise.${Date.now()}@example.test`,
      message: "xqtrplmnz xqtrplmnz xqtrplmnz xqtrplmnz xqtrplmnz",
      ipAddress: "203.0.113.3",
    });

    expect(created.contactStatus).toBe(ClientMessageContactStatus.SPAM);
    expect(created.spamReason).toMatch(/CONSONANT_NOISE|LOW_VOWEL_RATIO|REPETITIVE_CONTENT/);
  });

  it("keeps spam out of default admin inbox view", async () => {
    const bookingNote = await createBookingNoteFixture();

    const inboxContact = await createContactMessage({
      name: "Inbox Contact",
      email: `inbox.${Date.now()}@example.test`,
      message: "Hi, I want to confirm if beginner pilates classes are available on weekends.",
      ipAddress: "203.0.113.10",
    });

    const spamContact = await createContactMessage({
      name: "Spam Contact",
      email: `spam.${Date.now()}@example.test`,
      message: "xqtrplmnz xqtrplmnz xqtrplmnz xqtrplmnz xqtrplmnz",
      ipAddress: "203.0.113.11",
    });

    const inboxMessages = await listClientMessages({ mailbox: "INBOX" });

    const ids = inboxMessages.map((message) => message.id);
    expect(ids).toContain(bookingNote.id);
    expect(ids).toContain(inboxContact.id);
    expect(ids).not.toContain(spamContact.id);
  });
});
