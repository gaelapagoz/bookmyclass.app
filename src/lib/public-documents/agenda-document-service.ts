import { prisma } from "@/lib/db";

const AGENDA_KEY = "agenda_pdf";

export async function getActiveAgendaPdfDocument() {
  return prisma.publicDocument.findFirst({
    where: {
      key: AGENDA_KEY,
      isActive: true,
    },
    select: {
      key: true,
      fileUrl: true,
      updatedAt: true,
    },
  });
}

export async function upsertActiveAgendaPdfDocument(fileUrl: string) {
  return prisma.publicDocument.upsert({
    where: { key: AGENDA_KEY },
    create: {
      key: AGENDA_KEY,
      fileUrl,
      isActive: true,
    },
    update: {
      fileUrl,
      isActive: true,
    },
  });
}
