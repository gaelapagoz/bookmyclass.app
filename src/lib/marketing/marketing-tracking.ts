import { createHmac, randomUUID } from "node:crypto";

const DEFAULT_SECRET = "dev-marketing-secret";

function getSecret() {
  return process.env.MARKETING_TRACKING_SECRET?.trim() || process.env.NEXTAUTH_SECRET?.trim() || DEFAULT_SECRET;
}

export function createRecipientTrackingToken(recipientId: string): string {
  const signature = createHmac("sha256", getSecret()).update(recipientId).digest("hex");
  return Buffer.from(`${recipientId}:${signature}`, "utf8").toString("base64url");
}

export function parseRecipientTrackingToken(token: string): string | null {
  try {
    const decoded = Buffer.from(token, "base64url").toString("utf8");
    const [recipientId, signature] = decoded.split(":");
    if (!recipientId || !signature) {
      return null;
    }
    const expected = createHmac("sha256", getSecret()).update(recipientId).digest("hex");
    return expected === signature ? recipientId : null;
  } catch {
    return null;
  }
}

export function buildTrackingToken(): string {
  return randomUUID();
}
