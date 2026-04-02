import "./helpers/setup-env";
import { ClientMessageContactStatus, ClientMessageType, Role } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";
import {
  createContactMessage,
  listClientMessages,
} from "../../src/lib/client-messages/client-message-service";
import { prisma } from "./helpers/db";
import { resetDb } from "./helpers/reset-db";

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
    const client = await prisma.user.create({
      data: {
        name: "Booking Client",
        email: `booking.${Date.now()}@example.test`,
        role: Role.CLIENT,
      },
    });

    const bookingNote = await prisma.clientMessage.create({
      data: {
        type: ClientMessageType.BOOKING_NOTE,
        userId: client.id,
        bookingId: null,
        name: "Booking Client",
        email: client.email,
        message: "Please adjust my booking to next Tuesday afternoon.",
      },
    });

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
