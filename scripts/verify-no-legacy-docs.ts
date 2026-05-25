import {
  findLegacyDocFindings,
  PHASE0_BANNED_LEGACY_TOKENS,
} from "../src/lib/readiness/legacy-contract-guardrails";

async function main(): Promise<void> {
  const findings = await findLegacyDocFindings();
  if (findings.length === 0) {
    console.log("[verify:no-legacy-docs] ok");
    return;
  }

  console.error("[verify:no-legacy-docs] stale legacy docs references found:");
  for (const finding of findings) {
    console.error(`- ${finding.filePath}:${finding.line} token=${finding.token}`);
  }
  console.error(`[verify:no-legacy-docs] blocked tokens: ${PHASE0_BANNED_LEGACY_TOKENS.join(", ")}`);
  process.exit(1);
}

void main();

