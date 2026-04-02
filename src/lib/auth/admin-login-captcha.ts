export async function verifyAdminLoginCaptcha(input: { token: string | null; ip: string }): Promise<boolean> {
  const secret = process.env.ADMIN_LOGIN_CAPTCHA_SECRET_KEY;
  if (!secret) {
    return true;
  }

  const token = input.token?.trim();
  if (!token) {
    return false;
  }

  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      secret,
      response: token,
      remoteip: input.ip,
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    return false;
  }

  const payload = (await response.json()) as { success?: boolean };
  return payload.success === true;
}

export function getAdminLoginCaptchaSiteKey(): string | null {
  const siteKey = process.env.ADMIN_LOGIN_CAPTCHA_SITE_KEY;
  if (!siteKey) {
    return null;
  }

  return siteKey;
}
