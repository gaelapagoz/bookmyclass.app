import {
  findLegacyContractFindings,
  PHASE0_BANNED_LEGACY_TOKENS,
} from "../src/lib/readiness/legacy-contract-guardrails";

async function main(): Promise<void> {
  const findings = await findLegacyContractFindings();
  if (findings.length === 0) {
    console.log("[verify:no-legacy-contract] ok");
    return;
  }

  console.error("[verify:no-legacy-contract] banned legacy contract references found:");
  for (const finding of findings) {
    console.error(`- ${finding.filePath}:${finding.line} token=${finding.token}`);
  }
  console.error(`[verify:no-legacy-contract] blocked tokens: ${PHASE0_BANNED_LEGACY_TOKENS.join(", ")}`);
  process.exit(1);
}

void main();

