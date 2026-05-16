/**
 * Deploy server smoke check
 *
 * Purpose:
 * - Operational script for this repository's server/local workflows.
 *
 * Safety:
 * - Mutating operation. Review target variables before running.
 *
 * Variables:
 * - TARGET_ENV (optional), BASE_URL (default https://demo.bookmyclass.app), APP_DIR (default /var/www/bookmyclass), APP_NAME (default bookmyclass-app).
 *
 * Usage:
 *   tsx scripts/deploy-server-smoke-check.ts
 */
const DEFAULT_BASE_URL = "https://demo.bookmyclass.app";
const BASE_URL = (process.env.BASE_URL ?? process.env.STAGING_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
const REQUEST_TIMEOUT_MS = Number(process.env.UAT_SMOKE_TIMEOUT_MS ?? 8000);
const STORE_ACTIVE = (process.env.STORE_ACTIVE ?? "auto").toLowerCase();

type SmokeCheck = {
  id: string;
  path: string;
  allowedStatuses: number[];
  containsText?: string;
};

function normalizeUrl(input: string): string {
  return input.replace(/\/+$/, "");
}

function isProductionSplitTopology(baseUrl: string): boolean {
  try {
    const hostname = new URL(baseUrl).hostname.toLowerCase();
    return hostname === "bookmyclass.app" || hostname === "www.bookmyclass.app";
  } catch {
    return false;
  }
}

function baseChecks(): SmokeCheck[] {
  return [
    { id: "health-endpoint", path: "/api/health", allowedStatuses: [200], containsText: '"ok":true' },
    { id: "home-page", path: "/", allowedStatuses: [200] },
    { id: "admin-page", path: "/admin", allowedStatuses: [200, 301, 302, 307, 308] },
    { id: "sign-in-page", path: "/sign-in", allowedStatuses: [200, 301, 302, 307, 308] },
    { id: "subscription-page", path: "/subscription", allowedStatuses: [200, 301, 302, 307, 308] },
    { id: "book-a-class-page", path: "/book-a-class", allowedStatuses: [200, 301, 302, 307, 308] },
    { id: "store-page", path: "/store", allowedStatuses: [200, 301, 302, 307, 308, 404] },
  ];
}

async function runCheck(baseUrl: string, check: SmokeCheck): Promise<{ pass: boolean; message: string; status?: number }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const url = `${baseUrl}${check.path}`;

  try {
    const response = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      redirect: "follow",
      cache: "no-store",
    });
    clearTimeout(timeout);

    if (response.status >= 500) {
      return {
        pass: false,
        status: response.status,
        message: `${check.id} FAILED: ${url} returned ${response.status} (5xx is not allowed).`,
      };
    }

    if (!check.allowedStatuses.includes(response.status)) {
      return {
        pass: false,
        status: response.status,
        message: `${check.id} FAILED: ${url} returned ${response.status} (allowed: ${check.allowedStatuses.join(", ")}).`,
      };
    }

    if (!check.containsText) {
      return {
        pass: true,
        status: response.status,
        message: `${check.id} PASSED: ${url} returned ${response.status}.`,
      };
    }

    const bodyText = await response.text();
    if (!bodyText.includes(check.containsText)) {
      return {
        pass: false,
        status: response.status,
        message: `${check.id} FAILED: ${url} did not contain expected marker "${check.containsText}".`,
      };
    }

    return {
      pass: true,
      status: response.status,
      message: `${check.id} PASSED: ${url} returned ${response.status} with expected marker.`,
    };
  } catch (error) {
    clearTimeout(timeout);
    const reason = error instanceof Error ? error.message : String(error);
    return {
      pass: false,
      message: `${check.id} FAILED: ${url} request error: ${reason}`,
    };
  }
}

async function main() {
  console.log(`# Release smoke checks`);
  console.log(`BASE_URL=${BASE_URL}`);
  console.log(`TIMEOUT_MS=${REQUEST_TIMEOUT_MS}`);

  if (isProductionSplitTopology(BASE_URL)) {
    const marketingBaseUrl = normalizeUrl(process.env.MARKETING_BASE_URL ?? "https://bookmyclass.app");
    const wwwBaseUrl = normalizeUrl(process.env.WWW_BASE_URL ?? "https://www.bookmyclass.app");
    const demoBaseUrl = normalizeUrl(process.env.DEMO_BASE_URL ?? "https://demo.bookmyclass.app");

    const splitTargets: Array<{ id: string; url: string; allowedStatuses: number[]; containsText?: string }> = [
      {
        id: "marketing-home",
        url: `${marketingBaseUrl}/`,
        allowedStatuses: [200],
        containsText: "BookMyClass | The operating system for boutique fitness studios",
      },
      {
        id: "marketing-home-www",
        url: `${wwwBaseUrl}/`,
        allowedStatuses: [200],
        containsText: "BookMyClass | The operating system for boutique fitness studios",
      },
      {
        id: "demo-home",
        url: `${demoBaseUrl}/`,
        allowedStatuses: [200],
      },
      {
        id: "demo-health",
        url: `${demoBaseUrl}/api/health`,
        allowedStatuses: [200],
        containsText: '"ok":true',
      },
      {
        id: "demo-admin",
        url: `${demoBaseUrl}/admin`,
        allowedStatuses: [200, 301, 302, 307, 308],
      },
      {
        id: "demo-sign-in",
        url: `${demoBaseUrl}/sign-in`,
        allowedStatuses: [200, 301, 302, 307, 308],
      },
      {
        id: "demo-subscription",
        url: `${demoBaseUrl}/subscription`,
        allowedStatuses: [200, 301, 302, 307, 308],
      },
      {
        id: "demo-book-a-class",
        url: `${demoBaseUrl}/book-a-class`,
        allowedStatuses: [200, 301, 302, 307, 308],
      },
      {
        id: "demo-store",
        url: `${demoBaseUrl}/store`,
        allowedStatuses: [200, 301, 302, 307, 308, 404],
      },
    ];

    let hasFailure = false;
    for (const check of splitTargets) {
      const result = await runCheck("", {
        id: check.id,
        path: check.url,
        allowedStatuses: check.allowedStatuses,
        containsText: check.containsText,
      });

      const isStore404 = check.id.includes("store") && result.status === 404;
      if (isStore404 && STORE_ACTIVE === "auto") {
        console.log(`SKIP ${check.id}: ${check.url} returned 404; store appears inactive.`);
        continue;
      }

      if (result.pass) {
        console.log(`PASS ${result.message}`);
      } else {
        hasFailure = true;
        console.error(`FAIL ${result.message}`);
      }
    }

    if (hasFailure) {
      console.error("Release smoke checks failed.");
      process.exit(1);
    }

    console.log("Release smoke checks passed.");
    return;
  }

  const checks = baseChecks();
  let hasFailure = false;

  for (const check of checks) {
    const result = await runCheck(BASE_URL, check);

    const isStore404 = check.id === "store-page" && result.status === 404;
    if (isStore404 && STORE_ACTIVE === "auto") {
      console.log(`SKIP ${check.id}: ${BASE_URL}${check.path} returned 404; store appears inactive.`);
      continue;
    }

    if (result.pass) {
      console.log(`PASS ${result.message}`);
    } else {
      hasFailure = true;
      console.error(`FAIL ${result.message}`);
    }
  }

  if (hasFailure) {
    console.error("Release smoke checks failed.");
    process.exit(1);
  }

  console.log("Release smoke checks passed.");
}

main().catch((error) => {
  const reason = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(`Release smoke checks crashed: ${reason}`);
  process.exit(1);
});
