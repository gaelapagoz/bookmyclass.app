import {
  findDisallowedE2EArtifacts,
  verifyE2EArtifactGitignoreCoverage,
} from "../src/lib/readiness/legacy-contract-guardrails";

async function main(): Promise<void> {
  await verifyE2EArtifactGitignoreCoverage();

  const disallowedArtifacts = await findDisallowedE2EArtifacts();
  if (disallowedArtifacts.length === 0) {
    console.log("[verify:e2e-artifacts] ok");
    return;
  }

  console.error("[verify:e2e-artifacts] disallowed E2E artifact files found:");
  for (const artifact of disallowedArtifacts) {
    console.error(`- ${artifact}`);
  }
  process.exit(1);
}

void main();

