import { prisma } from "./db";

export async function resetDb() {
  await prisma.marketingCampaignGenerationUsage.deleteMany();
  await prisma.marketingCampaignLinkClick.deleteMany();
  await prisma.marketingCampaignLink.deleteMany();
  await prisma.marketingCampaignRecipient.deleteMany();
  await prisma.marketingCampaign.deleteMany();
  await prisma.marketingUnsubscribe.deleteMany();
  await prisma.marketingUserSegment.deleteMany();
  await prisma.marketingSegment.deleteMany();
  await prisma.marketingCategory.deleteMany();

  await prisma.attendanceRecord.deleteMany();
  await prisma.waitlistEntry.deleteMany();
  await prisma.booking.deleteMany();
  await prisma.siteWeeklyScheduleEntry.deleteMany();
  await prisma.studioSession.deleteMany();
  await prisma.recurringRule.deleteMany();
  await prisma.classTemplate.deleteMany();
  await prisma.classType.deleteMany();
  await prisma.classCategory.deleteMany();

  await prisma.learningCourse.deleteMany();
  await prisma.learningProgram.deleteMany();

  await prisma.loyaltyLedgerEntry.deleteMany();
  await prisma.giftCardReconciliationCase.deleteMany();
  await prisma.giftCardLedgerEntry.deleteMany();
  await prisma.giftCardRedemption.deleteMany();
  await prisma.giftCardWallet.deleteMany();
  await prisma.creditLedgerEntry.deleteMany();
  await prisma.clientEntitlement.deleteMany();
  await prisma.cartCheckoutIdempotency.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.giftCardCode.deleteMany();
  await prisma.orderItem.deleteMany();
  await prisma.adminNote.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.contactMessage.deleteMany();
  await prisma.clientMessage.deleteMany();
  await prisma.contactMessageRateLimit.deleteMany();
  await prisma.rateLimitCounter.deleteMany();
  await prisma.order.deleteMany();
  await prisma.subscriptionContract.deleteMany();
  await prisma.entitlementRule.deleteMany();
  await prisma.price.deleteMany();
  await prisma.product.deleteMany();
  await prisma.clientProfile.deleteMany();
  await prisma.teacherProfile.deleteMany();
  await prisma.account.deleteMany();
  await prisma.session.deleteMany();
  await prisma.passwordResetToken.deleteMany();
  await prisma.passwordResetRateLimit.deleteMany();
  await prisma.publicAuthRateLimit.deleteMany();
  await prisma.adminLoginAbuseCounter.deleteMany();
  await prisma.bookingPolicy.deleteMany();
  await prisma.siteSettings.deleteMany();
  await prisma.publicDocument.deleteMany();
  await prisma.pendingUserRegistration.deleteMany();
  await prisma.verificationToken.deleteMany();
  await prisma.user.deleteMany();
}
