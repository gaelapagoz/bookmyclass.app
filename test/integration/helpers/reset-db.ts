import { prisma } from "./db";

export async function resetDb() {
  await prisma.$transaction([
    prisma.attendanceRecord.deleteMany(),
    prisma.waitlistEntry.deleteMany(),
    prisma.booking.deleteMany(),
    prisma.studioSession.deleteMany(),
    prisma.recurringRule.deleteMany(),
    prisma.classTemplate.deleteMany(),
    prisma.classType.deleteMany(),
    prisma.classCategory.deleteMany(),
    prisma.loyaltyLedgerEntry.deleteMany(),
    prisma.creditLedgerEntry.deleteMany(),
    prisma.clientEntitlement.deleteMany(),
    prisma.payment.deleteMany(),
    prisma.orderItem.deleteMany(),
    prisma.adminNote.deleteMany(),
    prisma.auditLog.deleteMany(),
    prisma.contactMessage.deleteMany(),
    prisma.order.deleteMany(),
    prisma.subscriptionContract.deleteMany(),
    prisma.entitlementRule.deleteMany(),
    prisma.price.deleteMany(),
    prisma.product.deleteMany(),
    prisma.clientProfile.deleteMany(),
    prisma.teacherProfile.deleteMany(),
    prisma.account.deleteMany(),
    prisma.session.deleteMany(),
    prisma.verificationToken.deleteMany(),
    prisma.user.deleteMany(),
  ]);
}
