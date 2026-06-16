import { describe, expect, it } from "vitest";

import { getAllowedTokensForTemplate, getTokenGroupsForTemplate, inferTokenFamilyForTemplateKey } from "@/lib/email/email-template-token-registry";

describe("email-template-token-registry payment aliasing", () => {
  it("maps the legacy payment template key to the payment token family", () => {
    expect(inferTokenFamilyForTemplateKey("purchase.product.confirmation")).toBe("payment");
  });

  it("returns payment tokens for the legacy payment template key", () => {
    const allowedTokens = getAllowedTokensForTemplate("purchase.product.confirmation");
    const tokenGroups = getTokenGroupsForTemplate("purchase.product.confirmation");

    expect(allowedTokens.has("payment.amount")).toBe(true);
    expect(allowedTokens.has("order.total")).toBe(true);
    expect(tokenGroups.map((group) => group.group)).toEqual(["Common", "Payment"]);
  });
});
