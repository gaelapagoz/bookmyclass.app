import { createHash } from "node:crypto";
import {
  ClientMessageContactStatus,
  ClientMessageStatus,
  ClientMessageType,
  Prisma,
} from "@prisma/client";
import { prisma } from "@/lib/db";

const CONTACT_MIN_MESSAGE_LENGTH = 20;
const CONTACT_MAX_LINKS = 2;
const CONTACT_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const CONTACT_RATE_LIMIT_MAX_REQUESTS = 5;

const CONTACT_SPAM_REASONS = {
  HONEYPOT_FILLED: "HONEYPOT_FILLED",
  TOO_MANY_LINKS: "TOO_MANY_LINKS",
  TOO_FEW_WORDS: "TOO_FEW_WORDS",
  CONSONANT_NOISE: "CONSONANT_NOISE",
  LOW_VOWEL_RATIO: "LOW_VOWEL_RATIO",
  REPEATED_CHAR_NOISE: "REPEATED_CHAR_NOISE",
  REPETITIVE_CONTENT: "REPETITIVE_CONTENT",
} as const;

type ContactSpamReason = (typeof CONTACT_SPAM_REASONS)[keyof typeof CONTACT_SPAM_REASONS];

export class ContactMessageError extends Error {
  constructor(
    public readonly code: "INVALID_CONTACT_MESSAGE" | "CONTACT_RATE_LIMITED",
    message: string,
  ) {
    super(message);
  }
}

export type CreateContactMessagePayload = {
  userId?: string | null;
  name: string;
  email: string;
  phone?: string | null;
  subject?: string | null;
  message: string;
  honeypot?: string | null;
  ipAddress?: string | null;
};

export type CreateBookingNoteMessagePayload = {
  bookingId: string;
  userId?: string | null;
  name: string;
  email: string;
  phone?: string | null;
  message: string;
};

export type ListClientMessagesFilters = {
  bookingId?: string;
  status?: ClientMessageStatus;
  type?: ClientMessageType;
  mailbox?: "INBOX" | "SPAM";
  limit?: number;
};

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function toNullable(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function getNormalizedIpAddress(value: string | null | undefined): string {
  const normalized = value?.trim().toLowerCase();
  return normalized && normalized.length > 0 ? normalized : "unknown";
}

function hashContactRateLimitIp(ipAddress: string): string {
  return createHash("sha256")
    .update(`contact-rate-limit:${ipAddress}`)
    .digest("hex");
}

function countMessageLinks(message: string): number {
  return message.match(/(?:https?:\/\/|www\.)\S+/gi)?.length ?? 0;
}

function detectContactSpamReasons(input: { message: string; honeypot?: string | null }): ContactSpamReason[] {
  const reasons: ContactSpamReason[] = [];
  const honeypot = input.honeypot?.trim();
  if (honeypot) {
    reasons.push(CONTACT_SPAM_REASONS.HONEYPOT_FILLED);
  }

  const message = input.message.trim();
  const linksCount = countMessageLinks(message);
  if (linksCount > CONTACT_MAX_LINKS) {
    reasons.push(CONTACT_SPAM_REASONS.TOO_MANY_LINKS);
  }

  const words = message
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map((word) => word.trim())
    .filter(Boolean);

  if (words.length > 0 && words.length < 3) {
    reasons.push(CONTACT_SPAM_REASONS.TOO_FEW_WORDS);
  }

  if (/[bcdfghjklmnpqrstvwxyz]{12,}/i.test(message)) {
    reasons.push(CONTACT_SPAM_REASONS.CONSONANT_NOISE);
  }

  if (/(.)\1{5,}/i.test(message)) {
    reasons.push(CONTACT_SPAM_REASONS.REPEATED_CHAR_NOISE);
  }

  const lettersOnly = message.replace(/[^a-z]/gi, "");
  if (lettersOnly.length >= 12) {
    const vowelCount = (lettersOnly.match(/[aeiou]/gi) ?? []).length;
    const vowelRatio = vowelCount / lettersOnly.length;
    if (vowelRatio < 0.18) {
      reasons.push(CONTACT_SPAM_REASONS.LOW_VOWEL_RATIO);
    }
  }

  if (words.length >= 6) {
    const uniqueWords = new Set(words);
    const uniqueWordRatio = uniqueWords.size / words.length;
    if (uniqueWordRatio < 0.45) {
      reasons.push(CONTACT_SPAM_REASONS.REPETITIVE_CONTENT);
    }
  }

  return reasons;
}

async function assertContactRateLimit(ipAddress: string, now: Date): Promise<void> {
  const ipHash = hashContactRateLimitIp(ipAddress);
  const isRateLimited = await prisma.$transaction(async (tx) => {
    const existing = await tx.contactMessageRateLimit.findUnique({
      where: { ipHash },
      select: { id: true, requestCount: true, windowStartedAt: true },
    });

    if (!existing) {
      await tx.contactMessageRateLimit.create({
        data: {
          ipHash,
          windowStartedAt: now,
          requestCount: 1,
        },
      });
      return false;
    }

    const windowAge = now.getTime() - existing.windowStartedAt.getTime();
    if (windowAge >= CONTACT_RATE_LIMIT_WINDOW_MS) {
      await tx.contactMessageRateLimit.update({
        where: { id: existing.id },
        data: {
          windowStartedAt: now,
          requestCount: 1,
        },
      });
      return false;
    }

    if (existing.requestCount >= CONTACT_RATE_LIMIT_MAX_REQUESTS) {
      return true;
    }

    await tx.contactMessageRateLimit.update({
      where: { id: existing.id },
      data: {
        requestCount: { increment: 1 },
      },
    });
    return false;
  });

  if (isRateLimited) {
    throw new ContactMessageError("CONTACT_RATE_LIMITED", "Too many contact submissions from this IP.");
  }
}

export async function createContactMessage(payload: CreateContactMessagePayload) {
  const name = payload.name.trim();
  const email = normalizeEmail(payload.email);
  const message = payload.message.trim();
  const subject = toNullable(payload.subject);
  const phone = toNullable(payload.phone);
  const ipAddress = getNormalizedIpAddress(payload.ipAddress);

  if (!name || !email || !message) {
    throw new ContactMessageError("INVALID_CONTACT_MESSAGE", "Name, email, and message are required.");
  }

  if (message.length < CONTACT_MIN_MESSAGE_LENGTH) {
    throw new ContactMessageError(
      "INVALID_CONTACT_MESSAGE",
      `Message must be at least ${CONTACT_MIN_MESSAGE_LENGTH} characters.`,
    );
  }

  const now = new Date();
  await assertContactRateLimit(ipAddress, now);

  const spamReasons = detectContactSpamReasons({
    message,
    honeypot: payload.honeypot,
  });
  const isSpam = spamReasons.length > 0;

  return prisma.clientMessage.create({
    data: {
      type: ClientMessageType.CONTACT,
      userId: payload.userId ?? null,
      bookingId: null,
      name,
      email,
      phone,
      subject,
      message,
      status: ClientMessageStatus.NEW,
      contactStatus: isSpam ? ClientMessageContactStatus.SPAM : ClientMessageContactStatus.INBOX,
      spamReason: isSpam ? spamReasons.join(",") : null,
    },
  });
}

export async function createBookingNoteMessage(payload: CreateBookingNoteMessagePayload) {
  return prisma.clientMessage.create({
    data: {
      type: ClientMessageType.BOOKING_NOTE,
      userId: payload.userId ?? null,
      bookingId: payload.bookingId,
      name: payload.name.trim(),
      email: payload.email.trim().toLowerCase(),
      phone: toNullable(payload.phone),
      subject: null,
      message: payload.message.trim(),
      status: ClientMessageStatus.NEW,
      contactStatus: ClientMessageContactStatus.INBOX,
      spamReason: null,
    },
  });
}

export async function listClientMessages(filters: ListClientMessagesFilters = {}) {
  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200);
  const where: Prisma.ClientMessageWhereInput = {
    ...(filters.type ? { type: filters.type } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.bookingId ? { bookingId: filters.bookingId } : {}),
  };

  if (filters.mailbox === "SPAM") {
    where.AND = [{ type: ClientMessageType.CONTACT }, { contactStatus: ClientMessageContactStatus.SPAM }];
  } else if (filters.mailbox === "INBOX") {
    where.AND = [
      {
        OR: [
          { type: ClientMessageType.BOOKING_NOTE },
          { type: ClientMessageType.CONTACT, contactStatus: ClientMessageContactStatus.INBOX },
        ],
      },
    ];
  }

  return prisma.clientMessage.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      type: true,
      userId: true,
      bookingId: true,
      name: true,
      email: true,
      phone: true,
      subject: true,
      message: true,
      status: true,
      contactStatus: true,
      spamReason: true,
      createdAt: true,
    },
  });
}

export async function getUnreadClientMessagesCount() {
  return prisma.clientMessage.count({
    where: {
      status: ClientMessageStatus.NEW,
      OR: [
        { type: ClientMessageType.BOOKING_NOTE },
        { type: ClientMessageType.CONTACT, contactStatus: ClientMessageContactStatus.INBOX },
      ],
    },
  });
}

export async function updateClientMessageStatus(id: string, status: ClientMessageStatus) {
  return prisma.clientMessage.update({
    where: { id },
    data: { status },
  });
}
