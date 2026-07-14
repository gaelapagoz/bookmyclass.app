import { readFileSync } from "node:fs";
import { join } from "node:path";

const scannedPaths = [
  "src/app/(public)/page.tsx",
  "src/lib/site-config.ts",
  "src/lib/public-content/about-content.ts",
  "src/lib/public-content/loyalty-content.ts",
  "src/components/NavbarClient.tsx",
  "src/components/Footer.tsx",
  "src/components/dashboard/DashboardNav.tsx",
  "src/components/teacher/TeacherSidebar.tsx",
  "src/components/admin/AdminSidebar.tsx",
  "src/lib/navigation/admin-nav.ts",
  "prisma/seed/modes/demo.ts",
  "prisma/seed/data/demo-studio.ts",
] as const;

const bannedTerms = [
  "Yoga Pilates Fitness Studio",
  "yogapilatesfitnessstudio.com",
  "Brussels",
  "Merode",
  "Ixelles",
  "Etterbeek",
  "Avenue de Tervueren",
  "Test Client",
  "Production launch test client",
  "BookMyClass is live!",
  "redemption is not part",
  "Read-only loyalty balance",
] as const;

const failures: string[] = [];

for (const relativePath of scannedPaths) {
  const content = readFileSync(join(process.cwd(), relativePath), "utf8");
  for (const term of bannedTerms) {
    if (content.includes(term)) {
      failures.push(`${relativePath}: contains "${term}"`);
    }
  }
}

if (failures.length > 0) {
  throw new Error(`Demo content verification failed:\n${failures.join("\n")}`);
}

console.info(`Demo content verification passed across ${scannedPaths.length} files.`);
