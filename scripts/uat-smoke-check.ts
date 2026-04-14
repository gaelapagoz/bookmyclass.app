const DEFAULT_BASE_URL = "https://uat.bookmyclass.app";
const BASE_URL = (process.env.BASE_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
const REQUEST_TIMEOUT_MS = Number(process.env.UAT_SMOKE_TIMEOUT_MS ?? 8000);

type SmokeCheck = {
  id: string;
  path: string;
  expectedStatus: number;
  containsText?: string;
};

const checks: SmokeCheck[] = [
  {
    id: "health-endpoint",
    path: "/api/health",
    expectedStatus: 200,
  },
  {
    id: "home-page",
    path: "/",
    expectedStatus: 200,
    containsText: "href=\"/book-a-class\"",
  },
  {
    id: "sign-in-page",
    path: "/sign-in",
    expectedStatus: 200,
  },
  {
    id: "book-a-class-page",
    path: "/book-a-class",
    expectedStatus: 200,
  },
  {
    id: "subscription-page",
    path: "/subscription",
    expectedStatus: 200,
  },
  {
    id: "public-catalogue-api",
    path: "/api/categories",
    expectedStatus: 200,
  },
];

async function runCheck(check: SmokeCheck): Promise<{ pass: boolean; message: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const url = `${BASE_URL}${check.path}`;

  try {
    const response = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      redirect: "follow",
      cache: "no-store",
    });
    clearTimeout(timeout);

    if (response.status !== check.expectedStatus) {
      return {
        pass: false,
        message: `${check.id} FAILED: ${url} returned ${response.status} (expected ${check.expectedStatus}).`,
      };
    }

    if (!check.containsText) {
      return {
        pass: true,
        message: `${check.id} PASSED: ${url} returned ${response.status}.`,
      };
    }

    const bodyText = await response.text();
    if (!bodyText.includes(check.containsText)) {
      return {
        pass: false,
        message: `${check.id} FAILED: ${url} did not contain expected marker "${check.containsText}".`,
      };
    }

    return {
      pass: true,
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
  console.log(`# UAT smoke checks`);
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
    console.error("UAT smoke checks failed.");
    process.exit(1);
  }

  console.log("UAT smoke checks passed.");
}

main().catch((error) => {
  const reason = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(`UAT smoke checks crashed: ${reason}`);
  process.exit(1);
});
