import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = process.cwd();

const TARGETS = [
  "prisma/seed",
  "scripts",
  "test/e2e",
  "src/app/api/test",
  "docs/30_06_uat_release_e2e.md",
  "docs/40_03_release_process.md",
];

const BOOK4EVER_ALLOWED_FILES = new Set([
  "prisma/seed/seed-credentials.ts",
  "test/e2e/support/constants.ts",
  "test/e2e/uat/release-uat.spec.ts",
]);

const BANNED_PATTERNS = [
  /qwerty123456/g,
  /E2EPass123!/g,
  /GiftCardE2EPass123!/g,
  /StoreE2EPass123!/g,
  /UAT\.K6\.Phase4!2026/g,
  /@test\.user/g,
  /@bookmyclass-perf\.local/g,
  /@yogapilatesfitness\.local/g,
  /@bookmyclass\.local/g,
];

const ALLOWED_PASSWORD_LITERAL = "Book4Ever!";

function walk(dir: string, out: string[]) {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile()) out.push(full);
  }
}

function collectFiles(): string[] {
  const files: string[] = [];
  for (const target of TARGETS) {
    const full = resolve(ROOT, target);
    if (!existsSync(full)) continue;
    const stat = statSync(full);
    if (stat.isDirectory()) walk(full, files);
    else files.push(full);
  }
  return files.filter((file) =>
    /\.(ts|tsx|js|mjs|cjs|md|json|yml|yaml|sh)$/i.test(file),
  );
}

function main() {
  const files = collectFiles();
  const failures: string[] = [];

  for (const file of files) {
    const rel = file.replace(`${ROOT}\\`, "").replace(`${ROOT}/`, "");
    if (rel === "scripts/verify-seed-credential-policy.ts" || rel === "scripts\\verify-seed-credential-policy.ts") {
      continue;
    }
    const content = readFileSync(file, "utf8");

    for (const pattern of BANNED_PATTERNS) {
      if (pattern.test(content)) failures.push(`${rel}: banned pattern ${pattern}`);
    }

    if (content.includes("Book4Ever!") && !BOOK4EVER_ALLOWED_FILES.has(rel.replaceAll("\\", "/")) && !rel.endsWith(".md")) {
      failures.push(`${rel}: avoid hardcoding Book4Ever! outside shared seed credentials or docs`);
    }
  }

  if (failures.length > 0) {
    console.error("[verify-seed-credential-policy] FAILED");
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
  }

  console.info("[verify-seed-credential-policy] OK");
  console.info(`[verify-seed-credential-policy] password literal policy: ${ALLOWED_PASSWORD_LITERAL}`);
}

main();
