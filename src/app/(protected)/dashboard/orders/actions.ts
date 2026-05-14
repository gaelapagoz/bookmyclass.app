"use server";

import { requireAuth } from "@/lib/auth/require-auth";
import {
  requestGiftCardCodeResend,
  GiftCardCodeResendError,
} from "@/lib/gift-cards/gift-card-code-service";

export type ResendGiftCardCodeActionResult =
  | { success: true; message: string }
  | { success: false; message: string };

export async function resendGiftCardCodeAction(
  orderItemId: string,
): Promise<ResendGiftCardCodeActionResult> {
  const session = await requireAuth();

  try {
    const result = await requestGiftCardCodeResend({
      orderItemId,
      requestedById: session.user.id,
    });

    switch (result.outcome) {
      case "sent":
        return { success: true, message: "Gift card code sent to your email address." };
      case "already_redeemed":
        return { success: false, message: "This gift card has already been redeemed." };
      case "not_resendable":
        return {
          success: false,
          message:
            result.reason === "voided"
              ? "This gift card has been voided and cannot be resent."
              : "This gift card has expired.",
        };
    }
  } catch (error) {
    if (error instanceof GiftCardCodeResendError) {
      if (error.errorCode === "OWNERSHIP_DENIED") {
        return { success: false, message: "You do not have permission to access this gift card." };
      }
      if (error.errorCode === "NOT_FOUND") {
        return { success: false, message: "Gift card code not found." };
      }
      if (error.errorCode === "EMAIL_MISSING") {
        return { success: false, message: "No email address on file. Please update your account." };
      }
    }
    console.error("[resend-gift-card-code] unexpected error", error instanceof Error ? error.message : String(error));
    return { success: false, message: "Something went wrong. Please try again." };
  }
}
