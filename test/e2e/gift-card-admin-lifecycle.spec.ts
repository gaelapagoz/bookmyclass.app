import { expect, test } from "@playwright/test";
import { GiftCardCodeSource, GiftCardCodeStatus, Role, UserActivationStatus, UserCreatedVia } from "@prisma/client";
import { hash } from "bcryptjs";

import prisma from "../../src/lib/db";
import { signInAdmin, signInClient } from "./support/auth";
import { clearCapturedEmailsForTest, getCapturedEmailsForTest } from "./support/e2e-api";
import { E2E_PASSWORD } from "./support/constants";

const password = E2E_PASSWORD;

function unique(prefix: string) {
  return `${prefix}.${Date.now()}.${Math.random().toString(36).slice(2)}`;
}

async function createAdmin() {
  const email = `${unique("admin.gc")}@bookmyclass.app`;
  const passwordHash = await hash(password, 12);
  const now = new Date();
  const user = await prisma.user.create({
    data: {
      name: "Gift Card Admin E2E",
      email,
      passwordHash,
      role: Role.ADMIN,
      isActive: true,
      isInactive: false,
      activationStatus: UserActivationStatus.ACTIVE,
      createdVia: UserCreatedVia.IMPORT,
      emailVerified: now,
      emailVerifiedAt: now,
    },
  });

  return { user, credentials: { email, password } };
}

async function createClient() {
  const email = `${unique("client.gc")}@bookmyclass.app`;
  const passwordHash = await hash(password, 12);
  const now = new Date();
  const user = await prisma.user.create({
    data: {
      name: "Gift Card Recipient E2E",
      email,
      passwordHash,
      role: Role.CLIENT,
      isActive: true,
      isInactive: false,
      activationStatus: UserActivationStatus.ACTIVE,
      createdVia: UserCreatedVia.IMPORT,
      emailVerified: now,
      emailVerifiedAt: now,
    },
  });

  return { user, credentials: { email, password } };
}

async function cleanupUsers(userIds: string[]) {
  await prisma.giftCardCode.deleteMany({
    where: {
      OR: [
        { purchasedById: { in: userIds } },
        { generatedById: { in: userIds } },
        { redeemedById: { in: userIds } },
      ],
    },
  });
  await prisma.giftCardLedgerEntry.deleteMany({ where: { clientId: { in: userIds } } });
  await prisma.giftCardRedemption.deleteMany({ where: { clientId: { in: userIds } } });
  await prisma.giftCardWallet.deleteMany({ where: { clientId: { in: userIds } } });
  await prisma.auditLog.deleteMany({ where: { actorId: { in: userIds } } });
  await prisma.orderItem.deleteMany({ where: { order: { clientId: { in: userIds } } } });
  await prisma.payment.deleteMany({ where: { order: { clientId: { in: userIds } } } });
  await prisma.order.deleteMany({ where: { clientId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

test.describe("Admin-generated gift card lifecycle", () => {
  test.setTimeout(120_000);
  // @covers store-gift-card-redeem-code
  // @covers store-gift-card-redeem-invalid-code
  // @covers admin-gift-card-wallet-readonly
  // @covers admin-gift-card-resolve-admin-denied
  test("admin generates code, recipient redeems once, admin sees redeemer, sensitive fields remain hidden", async ({
    browser,
    request,
  }) => {
    const admin = await createAdmin();
    const recipient = await createClient();

    await clearCapturedEmailsForTest(request);

    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    const recipientContext = await browser.newContext();
    const recipientPage = await recipientContext.newPage();

    try {
      await signInAdmin(adminPage, admin.credentials);
      await adminPage.goto("/admin/gift-cards/generate");
      await adminPage.getByLabel("Amount (EUR)").fill("25");
      await adminPage.getByLabel("Recipient email").fill(recipient.credentials.email);
      await adminPage.getByLabel("Recipient name (optional)").fill("Recipient Name");
      await adminPage.getByLabel("Message (optional)").fill("Enjoy your classes.");
      await adminPage.getByLabel("Internal reason (required)").fill("Retention goodwill credit");
      await adminPage.getByRole("button", { name: "Review" }).click();
      await adminPage.getByRole("button", { name: "Generate and Send" }).click();
      await expect(adminPage.getByText("Gift card generated")).toBeVisible({ timeout: 10_000 });
      await expect(adminPage.getByText("No plaintext code is available after submit.")).toBeVisible();

      const emails = await getCapturedEmailsForTest(request);
      const issuedEmail = emails.find(
        (email) => email.context === "gift-card-issuance" && email.to.includes(recipient.credentials.email),
      );
      expect(issuedEmail).toBeDefined();
      expect(issuedEmail!.html).not.toContain("Retention goodwill credit");
      const plaintextCode = issuedEmail!.html.match(/[0-9A-F]{8}(?:-[0-9A-F]{8}){3}/)?.[0];
      expect(plaintextCode).toBeTruthy();

      await signInClient(recipientPage, recipient.credentials);
      await recipientPage.goto("/dashboard/wallet");
      await recipientPage.getByTestId("gift-card-code-input").fill(plaintextCode!);
      await recipientPage.getByTestId("redeem-submit").click();
      await expect(recipientPage.getByTestId("redeem-success")).toBeVisible({ timeout: 10_000 });

      const duplicateRedeemResponse = await recipientPage.request.post("/api/gift-cards/redeem", {
        headers: {
          origin: "http://127.0.0.1:3100",
          referer: "http://127.0.0.1:3100/dashboard/wallet",
          "content-type": "application/json",
        },
        data: { code: plaintextCode },
      });
      expect(duplicateRedeemResponse.status()).toBe(422);
      const duplicateBody = await duplicateRedeemResponse.json();
      expect(JSON.stringify(duplicateBody)).not.toContain("codeHash");

      const walletLookupResponse = await adminPage.request.get(
        `/api/admin/gift-cards/wallets?clientId=${encodeURIComponent(recipient.user.id)}`,
      );
      expect(walletLookupResponse.status()).toBe(200);
      const walletLookupBody = await walletLookupResponse.json();
      expect(JSON.stringify(walletLookupBody)).toContain(`"status":"REDEEMED"`);
      expect(JSON.stringify(walletLookupBody)).toContain(recipient.user.id);
      expect(JSON.stringify(walletLookupBody)).not.toContain("codeHash");
      expect(JSON.stringify(walletLookupBody)).not.toContain("adminReason");
      expect(JSON.stringify(walletLookupBody)).not.toContain(plaintextCode!);
    } finally {
      await Promise.allSettled([adminContext.close(), recipientContext.close()]);
      await cleanupUsers([admin.user.id, recipient.user.id]);
    }
  });

  // @covers store-gift-card-redeem-invalid-code
  test("voided admin-generated code cannot be redeemed", async ({ browser, request }) => {
    const admin = await createAdmin();
    const recipient = await createClient();

    await clearCapturedEmailsForTest(request);

    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    const recipientContext = await browser.newContext();
    const recipientPage = await recipientContext.newPage();

    try {
      await signInAdmin(adminPage, admin.credentials);
      await adminPage.goto("/admin/gift-cards/generate");
      await adminPage.getByLabel("Amount (EUR)").fill("15");
      await adminPage.getByLabel("Recipient email").fill(recipient.credentials.email);
      await adminPage.getByLabel("Internal reason (required)").fill("Void-path regression");
      await adminPage.getByRole("button", { name: "Review" }).click();
      await adminPage.getByRole("button", { name: "Generate and Send" }).click();
      await expect(adminPage.getByText("Gift card generated")).toBeVisible({ timeout: 10_000 });

      const code = await prisma.giftCardCode.findFirst({
        where: {
          source: GiftCardCodeSource.ADMIN_GENERATED,
          recipientEmail: recipient.credentials.email,
          generatedById: admin.user.id,
        },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });
      expect(code).not.toBeNull();

      const voidResponse = await adminPage.request.post(
        `/api/admin/gift-cards/codes/${encodeURIComponent(code!.id)}/void`,
        {
          headers: {
            origin: "http://127.0.0.1:3100",
            referer: "http://127.0.0.1:3100/admin/gift-cards",
            "content-type": "application/json",
          },
          data: { reason: "User requested cancellation" },
        },
      );
      expect(voidResponse.status()).toBe(200);
      await expect(voidResponse.json()).resolves.toMatchObject({ status: GiftCardCodeStatus.VOIDED });

      const emails = await getCapturedEmailsForTest(request);
      const issuedEmail = emails.find(
        (email) => email.context === "gift-card-issuance" && email.to.includes(recipient.credentials.email),
      );
      expect(issuedEmail).toBeDefined();
      const plaintextCode = issuedEmail!.html.match(/[0-9A-F]{8}(?:-[0-9A-F]{8}){3}/)?.[0];
      expect(plaintextCode).toBeTruthy();

      await signInClient(recipientPage, recipient.credentials);
      await recipientPage.goto("/dashboard/wallet");
      await recipientPage.getByTestId("gift-card-code-input").fill(plaintextCode!);
      await recipientPage.getByTestId("redeem-submit").click();
      await expect(recipientPage.getByTestId("redeem-error")).toBeVisible({ timeout: 10_000 });
    } finally {
      await Promise.allSettled([adminContext.close(), recipientContext.close()]);
      await cleanupUsers([admin.user.id, recipient.user.id]);
    }
  });
});

