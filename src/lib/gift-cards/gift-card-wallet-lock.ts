import type { Prisma } from "@prisma/client";

export async function lockGiftCardWallet(tx: Prisma.TransactionClient, walletId: string): Promise<void> {
  await tx.$queryRaw`SELECT "id" FROM "GiftCardWallet" WHERE "id" = ${walletId} FOR UPDATE`;
}
