import { ClientMessageStatus, ClientMessageType } from "@prisma/client";
import { prisma } from "@/lib/db";

export type CreateContactMessagePayload = {
  userId?: string | null;
  name: string;
  email: string;
  phone?: string | null;
  subject?: string | null;
  message: string;
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
  limit?: number;
};

function toNullable(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export async function createContactMessage(payload: CreateContactMessagePayload) {
  return prisma.clientMessage.create({
    data: {
      type: ClientMessageType.CONTACT,
      userId: payload.userId ?? null,
      bookingId: null,
      name: payload.name.trim(),
      email: payload.email.trim().toLowerCase(),
      phone: toNullable(payload.phone),
      subject: toNullable(payload.subject),
      message: payload.message.trim(),
      status: ClientMessageStatus.NEW,
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
    },
  });
}

export async function listClientMessages(filters: ListClientMessagesFilters = {}) {
  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200);
  return prisma.clientMessage.findMany({
    where: {
      ...(filters.type ? { type: filters.type } : {}),
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.bookingId ? { bookingId: filters.bookingId } : {}),
    },
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
      createdAt: true,
    },
  });
}

export async function getUnreadClientMessagesCount() {
  return prisma.clientMessage.count({
    where: {
      status: ClientMessageStatus.NEW,
    },
  });
}

export async function updateClientMessageStatus(id: string, status: ClientMessageStatus) {
  return prisma.clientMessage.update({
    where: { id },
    data: { status },
  });
}
