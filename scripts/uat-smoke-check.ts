const DEFAULT_BASE_URL = "https://uat.bookmyclass.app";
const BASE_URL = (process.env.BASE_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
const REQUEST_TIMEOUT_MS = Number(process.env.UAT_SMOKE_TIMEOUT_MS ?? 8000);

type SmokeCheck = {
  id: string;
  url: string;
  expectedStatus: number;
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

function buildChecks(): { mode: "uat-app" | "prod-split"; checks: SmokeCheck[] } {
  if (isProductionSplitTopology(BASE_URL)) {
    const marketingBaseUrl = normalizeUrl(process.env.MARKETING_BASE_URL ?? "https://bookmyclass.app");
    const wwwBaseUrl = normalizeUrl(process.env.WWW_BASE_URL ?? "https://www.bookmyclass.app");
    const demoBaseUrl = normalizeUrl(process.env.DEMO_BASE_URL ?? "https://demo.bookmyclass.app");

    return {
      mode: "prod-split",
      checks: [
        {
          id: "marketing-home",
          url: `${marketingBaseUrl}/`,
          expectedStatus: 200,
          containsText: "BookMyClass | The operating system for boutique fitness studios",
        },
        {
          id: "marketing-home-www",
          url: `${wwwBaseUrl}/`,
          expectedStatus: 200,
          containsText: "BookMyClass | The operating system for boutique fitness studios",
        },
        {
          id: "demo-home",
          url: `${demoBaseUrl}/`,
          expectedStatus: 200,
          containsText: "Yoga Pilates Fitness Studio",
        },
        {
          id: "demo-health",
          url: `${demoBaseUrl}/api/health`,
          expectedStatus: 200,
          containsText: "\"ok\":true",
        },
      ],
    };
  }

  return {
    mode: "uat-app",
    checks: [
      {
        id: "health-endpoint",
        url: `${BASE_URL}/api/health`,
        expectedStatus: 200,
      },
      {
        id: "home-page",
        url: `${BASE_URL}/`,
        expectedStatus: 200,
        containsText: "href=\"/book-a-class\"",
      },
      {
        id: "sign-in-page",
        url: `${BASE_URL}/sign-in`,
        expectedStatus: 200,
      },
      {
        id: "book-a-class-page",
        url: `${BASE_URL}/book-a-class`,
        expectedStatus: 200,
      },
      {
        id: "subscription-page",
        url: `${BASE_URL}/subscription`,
        expectedStatus: 200,
      },
      {
        id: "public-catalogue-api",
        url: `${BASE_URL}/api/categories`,
        expectedStatus: 200,
      },
    ],
  };
}

async function runCheck(check: SmokeCheck): Promise<{ pass: boolean; message: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(check.url, {
      method: "GET",
      signal: controller.signal,
      redirect: "follow",
      cache: "no-store",
    });
    clearTimeout(timeout);

    if (response.status !== check.expectedStatus) {
      return {
        pass: false,
        message: `${check.id} FAILED: ${check.url} returned ${response.status} (expected ${check.expectedStatus}).`,
      };
    }

    if (!check.containsText) {
      return {
        pass: true,
        message: `${check.id} PASSED: ${check.url} returned ${response.status}.`,
      };
    }

    const bodyText = await response.text();
    if (!bodyText.includes(check.containsText)) {
      return {
        pass: false,
        message: `${check.id} FAILED: ${check.url} did not contain expected marker "${check.containsText}".`,
      };
    }

    return {
      pass: true,
      message: `${check.id} PASSED: ${check.url} returned ${response.status} with expected marker.`,
    };
  } catch (error) {
    clearTimeout(timeout);
    const reason = error instanceof Error ? error.message : String(error);
    return {
      pass: false,
      message: `${check.id} FAILED: ${check.url} request error: ${reason}`,
    };
  }
}

async function main() {
  const { mode, checks } = buildChecks();

  console.log(`# Release smoke checks`);
  console.log(`MODE=${mode}`);
  console.log(`BASE_URL=${BASE_URL}`);
  console.log(`TIMEOUT_MS=${REQUEST_TIMEOUT_MS}`);

  let hasFailure = false;
  for (const check of checks) {
    const result = await runCheck(check);
    if (result.pass) {
      console.log(`PASS ${result.message}`);
      continue;
    }

    hasFailure = true;
    console.error(`FAIL ${result.message}`);
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
