import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

const AGENDA_KEY = "agenda_pdf";

export async function getActiveAgendaPdfDocument() {
  try {
    return await prisma.publicDocument.findFirst({
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
  } catch (error) {
    // In local/dev, transient DB socket closures should not take down the public homepage.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P1017") {
      return null;
    }
    throw error;
  }
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
