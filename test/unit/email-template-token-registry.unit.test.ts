import { describe, expect, it } from "vitest";

import { extractTemplateTokens, getAllowedTokensForTemplate } from "@/lib/email/email-template-token-registry";

describe("email-template-token-registry", () => {
  it("returns auth-specific and common tokens for auth template", () => {
    const tokens = getAllowedTokensForTemplate("auth.verify-email");
    expect(tokens.has("verificationUrl")).toBe(true);
    expect(tokens.has("website.name")).toBe(true);
    expect(tokens.has("booking.classTitle")).toBe(false);
  });

  it("extracts template tokens", () => {
    const extracted = extractTemplateTokens("Hello {{website.name}} {{ contact.name.first }}");
    expect(extracted).toEqual(["website.name", "contact.name.first"]);
  });
});

