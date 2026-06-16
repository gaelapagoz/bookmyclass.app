export type TokenGroup =
  | "Common"
  | "Auth"
  | "Booking"
  | "Waitlist"
  | "Payment"
  | "Store"
  | "Gift card"
  | "Subscription"
  | "Marketing";

export type TokenFamily =
  | "common"
  | "auth"
  | "booking"
  | "waitlist"
  | "payment"
  | "store"
  | "gift-card"
  | "subscription"
  | "marketing";

type TokenGroupDefinition = {
  group: TokenGroup;
  tokens: readonly string[];
};

const TOKEN_GROUPS: readonly TokenGroupDefinition[] = [
  {
    group: "Common",
    tokens: [
      "website.name",
      "website.url",
      "website.logoUrl",
      "website.address",
      "contact.name.first",
      "contact.name.last",
      "contact.email",
      "contact.fullName",
      "firstName",
      "lastName",
      "name",
    ],
  },
  {
    group: "Auth",
    tokens: ["verificationUrl", "resetPasswordUrl", "emailChangeVerificationUrl", "token.expiresAt"],
  },
  {
    group: "Booking",
    tokens: [
      "booking.classTitle",
      "booking.startAt",
      "booking.endAt",
      "booking.teacherName",
      "booking.location",
      "booking.cancelUrl",
      "booking.manageUrl",
    ],
  },
  {
    group: "Waitlist",
    tokens: ["waitlist.classTitle", "waitlist.position", "waitlist.promotionExpiresAt", "waitlist.manageUrl"],
  },
  {
    group: "Payment",
    tokens: [
      "payment.amount",
      "payment.currency",
      "payment.receiptUrl",
      "order.number",
      "order.total",
      "order.subtotal",
      "order.discount",
    ],
  },
  {
    group: "Store",
    tokens: ["order.number", "order.items", "order.total", "product.name", "product.quantity"],
  },
  {
    group: "Gift card",
    tokens: [
      "giftCard.code",
      "giftCard.amount",
      "giftCard.currency",
      "giftCard.recipientName",
      "giftCard.senderName",
      "giftCard.redeemUrl",
      "giftCard.expiresAt",
    ],
  },
  {
    group: "Subscription",
    tokens: [
      "subscription.planName",
      "subscription.renewalDate",
      "subscription.cancelUrl",
      "subscription.amount",
      "subscription.interval",
    ],
  },
  {
    group: "Marketing",
    tokens: ["unsubscribeUrl", "managePreferencesUrl", "tracking.openPixelUrl", "tracking.clickUrl"],
  },
] as const;

const FAMILY_GROUPS: Record<TokenFamily, readonly TokenGroup[]> = {
  common: ["Common"],
  auth: ["Common", "Auth"],
  booking: ["Common", "Booking"],
  waitlist: ["Common", "Waitlist"],
  payment: ["Common", "Payment"],
  store: ["Common", "Store"],
  "gift-card": ["Common", "Gift card"],
  subscription: ["Common", "Subscription"],
  marketing: ["Common", "Marketing"],
};

const TEMPLATE_KEY_ALIASES: Record<string, string> = {
  "purchase.product.confirmation": "payment.purchase.confirmation",
};

const TEMPLATE_KEY_FAMILY: Record<string, TokenFamily> = {
  "auth.verify-email": "auth",
  "auth.password-reset": "auth",
  "auth.verify-email-change": "auth",
  "booking.welcome": "common",
  "booking.class-booked": "booking",
  "booking.class-cancelled": "booking",
  "booking.class-reminder": "booking",
  "waitlist.on-list": "waitlist",
  "waitlist.promoted": "waitlist",
  "waitlist.not-promoted": "waitlist",
  "payment.purchase.confirmation": "payment",
  "store.purchase.confirmation": "store",
  "gift-card.issuance": "gift-card",
  "subscription.cancelled": "subscription",
  "subscription.renewal": "subscription",
};

export function inferTokenFamilyForTemplateKey(templateKey: string): TokenFamily {
  const canonicalTemplateKey = TEMPLATE_KEY_ALIASES[templateKey] ?? templateKey;
  const exact = TEMPLATE_KEY_FAMILY[canonicalTemplateKey];
  if (exact) return exact;
  if (canonicalTemplateKey.startsWith("auth.")) return "auth";
  if (canonicalTemplateKey.startsWith("booking.")) return "booking";
  if (canonicalTemplateKey.startsWith("waitlist.")) return "waitlist";
  if (canonicalTemplateKey.startsWith("payment.")) return "payment";
  if (canonicalTemplateKey.startsWith("store.")) return "store";
  if (canonicalTemplateKey.startsWith("gift-card.")) return "gift-card";
  if (canonicalTemplateKey.startsWith("subscription.")) return "subscription";
  if (canonicalTemplateKey.startsWith("marketing.")) return "marketing";
  return "common";
}

export function getTokenGroupsForFamily(family: TokenFamily): readonly TokenGroupDefinition[] {
  const allowedGroups = new Set(FAMILY_GROUPS[family]);
  return TOKEN_GROUPS.filter((entry) => allowedGroups.has(entry.group));
}

export function getAllowedTokensForTemplate(templateKey: string): Set<string> {
  const family = inferTokenFamilyForTemplateKey(templateKey);
  const tokens = getTokenGroupsForFamily(family).flatMap((entry) => entry.tokens);
  return new Set(tokens);
}

export function getTokenGroupsForTemplate(templateKey: string): readonly TokenGroupDefinition[] {
  const family = inferTokenFamilyForTemplateKey(templateKey);
  return getTokenGroupsForFamily(family);
}

export function extractTemplateTokens(input: string): string[] {
  const matches = input.match(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g) ?? [];
  return matches.map((item) => item.replace(/\{\{|\}\}/g, "").trim());
}
