import { promises as fs } from "node:fs";
import path from "node:path";

type Risk = "critical" | "high" | "medium" | "low";
type Area = "public" | "customer" | "admin" | "teacher" | "cross" | "store";

type MatrixItem = {
  id: string;
  area: Area;
  risk: Risk;
  description: string;
  title?: string;
};

type Matrix = {
  weightsByRisk: Record<Risk, number>;
  items: MatrixItem[];
};

type CoverageTag = {
  id: string;
  score: number;
  file: string;
  line: number;
  type: "@covers" | "@covers-partial";
};

const ROOT = process.cwd();
const MATRIX_PATH = path.resolve(ROOT, "qa", "e2e-coverage-matrix.json");
const E2E_DIR = path.resolve(ROOT, "test", "e2e");

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

async function listSpecFiles(dirPath: string): Promise<string[]> {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const results: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await listSpecFiles(fullPath)));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".spec.ts")) {
      results.push(fullPath);
    }
  }

  return results.sort();
}

function parseCoverageTags(filePath: string, content: string): { tags: CoverageTag[]; malformed: string[] } {
  const tags: CoverageTag[] = [];
  const malformed: string[] = [];
  const lines = content.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const lineNumber = index + 1;
    const partialMatch = line.match(/@covers-partial\s+([a-z0-9-]+)/i);
    const fullMatch = line.match(/@covers\s+([a-z0-9-]+)/i);

    if (line.includes("@covers-partial") && !partialMatch) {
      malformed.push(`${path.relative(ROOT, filePath)}:${lineNumber}: malformed @covers-partial tag`);
    }
    if (line.includes("@covers") && !line.includes("@covers-partial") && !fullMatch) {
      malformed.push(`${path.relative(ROOT, filePath)}:${lineNumber}: malformed @covers tag`);
    }

    if (partialMatch) {
      tags.push({
        id: partialMatch[1],
        score: 0.5,
        file: path.relative(ROOT, filePath),
        line: lineNumber,
        type: "@covers-partial",
      });
    }

    if (fullMatch) {
      tags.push({
        id: fullMatch[1],
        score: 1,
        file: path.relative(ROOT, filePath),
        line: lineNumber,
        type: "@covers",
      });
    }
  }

  return { tags, malformed };
}

async function main(): Promise<void> {
  let matrixRaw: string;
  try {
    matrixRaw = await fs.readFile(MATRIX_PATH, "utf8");
  } catch {
    console.error(`Missing required file: ${path.relative(ROOT, MATRIX_PATH)}`);
    process.exit(1);
  }

  let matrix: Matrix;
  try {
    matrix = JSON.parse(matrixRaw) as Matrix;
  } catch {
    console.error(`Invalid JSON: ${path.relative(ROOT, MATRIX_PATH)}`);
    process.exit(1);
  }

  if (!Array.isArray(matrix.items) || !matrix.weightsByRisk) {
    console.error(`Malformed matrix structure: ${path.relative(ROOT, MATRIX_PATH)}`);
    process.exit(1);
  }

  let specFiles: string[] = [];
  try {
    specFiles = await listSpecFiles(E2E_DIR);
  } catch {
    console.error(`Missing required directory: ${path.relative(ROOT, E2E_DIR)}`);
    process.exit(1);
  }

  const matrixById = new Map(matrix.items.map((item) => [item.id, item]));
  const scoreByItemId = new Map<string, number>(matrix.items.map((item) => [item.id, 0]));
  const tags: CoverageTag[] = [];
  const malformed: string[] = [];
  const unknownRefs: string[] = [];

  for (const filePath of specFiles) {
    const content = await fs.readFile(filePath, "utf8");
    const parsed = parseCoverageTags(filePath, content);
    malformed.push(...parsed.malformed);

    for (const tag of parsed.tags) {
      tags.push(tag);
      if (!matrixById.has(tag.id)) {
        unknownRefs.push(`${tag.file}:${tag.line}: unknown ${tag.type} reference "${tag.id}"`);
        continue;
      }

      const current = scoreByItemId.get(tag.id) ?? 0;
      scoreByItemId.set(tag.id, Math.min(1, Math.max(current, tag.score)));
    }
  }

  const totalItems = matrix.items.length;
  const achievedRaw = matrix.items.reduce((sum, item) => sum + (scoreByItemId.get(item.id) ?? 0), 0);
  const rawCoverage = totalItems === 0 ? 0 : achievedRaw / totalItems;

  const totalWeighted = matrix.items.reduce((sum, item) => sum + matrix.weightsByRisk[item.risk], 0);
  const achievedWeighted = matrix.items.reduce(
    (sum, item) => sum + (scoreByItemId.get(item.id) ?? 0) * matrix.weightsByRisk[item.risk],
    0,
  );
  const weightedCoverage = totalWeighted === 0 ? 0 : achievedWeighted / totalWeighted;

  const byRisk = (["critical", "high", "medium", "low"] as const).map((risk) => {
    const items = matrix.items.filter((item) => item.risk === risk);
    const max = items.reduce((sum, item) => sum + matrix.weightsByRisk[item.risk], 0);
    const got = items.reduce((sum, item) => sum + (scoreByItemId.get(item.id) ?? 0) * matrix.weightsByRisk[item.risk], 0);
    return { key: risk, coverage: max === 0 ? 0 : got / max, total: items.length };
  });

  const byArea = (["public", "customer", "admin", "teacher", "cross", "store"] as const).map((area) => {
    const items = matrix.items.filter((item) => item.area === area);
    const max = items.length;
    const got = items.reduce((sum, item) => sum + (scoreByItemId.get(item.id) ?? 0), 0);
    return { key: area, coverage: max === 0 ? 0 : got / max, total: items.length };
  });

  const partiallyCovered = matrix.items.filter((item) => {
    const score = scoreByItemId.get(item.id) ?? 0;
    return score > 0 && score < 1;
  });
  const uncovered = matrix.items.filter((item) => (scoreByItemId.get(item.id) ?? 0) === 0);

  console.log("E2E Coverage Report");
  console.log("===================");
  console.log(`Spec files scanned: ${specFiles.length}`);
  console.log(`Matrix items count: ${totalItems}`);
  console.log(`Raw coverage %: ${pct(rawCoverage)}`);
  console.log(`Weighted coverage %: ${pct(weightedCoverage)}`);
  console.log("");

  console.log("Coverage by risk:");
  for (const row of byRisk) {
    console.log(`- ${row.key}: ${pct(row.coverage)} (${row.total} items)`);
  }
  console.log("");

  console.log("Coverage by area:");
  for (const row of byArea) {
    console.log(`- ${row.key}: ${pct(row.coverage)} (${row.total} items)`);
  }
  console.log("");

  console.log(`Partially covered items (${partiallyCovered.length}):`);
  for (const item of partiallyCovered) {
    console.log(`- ${item.id} (${item.area}/${item.risk}): ${item.description ?? item.title}`);
  }
  console.log("");

  console.log(`Uncovered items (${uncovered.length}):`);
  for (const item of uncovered) {
    console.log(`- ${item.id} (${item.area}/${item.risk}): ${item.description ?? item.title}`);
  }
  console.log("");

  console.log(`Unknown tag references (${unknownRefs.length}):`);
  for (const ref of unknownRefs) {
    console.log(`- ${ref}`);
  }
  console.log("");

  if (malformed.length > 0) {
    console.error(`Malformed tags (${malformed.length}):`);
    for (const issue of malformed) {
      console.error(`- ${issue}`);
    }
  }

  if (unknownRefs.length > 0 || malformed.length > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Coverage report failed:", error);
  process.exit(1);
});
