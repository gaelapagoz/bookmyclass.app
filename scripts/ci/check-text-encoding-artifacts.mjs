import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const forbidden = [
  [0x00C3, 0x00A2, 0x201A, 0x00AC, 0x00E2, 0x201A, 0x00AC, 0x201D],
  [0x00C3, 0x00A2, 0x201A, 0x00AC, 0x00E2, 0x201A, 0x00AC, 0x201C],
  [0x00C3, 0x00A2, 0x201A, 0x00AC, 0x00E2, 0x20AC, 0x0153],
  [0x00C3, 0x00A2, 0x201A, 0x00AC, 0x00E2, 0x20AC, 0x02DC],
  [0x00C3, 0x00A2, 0x201A, 0x00AC, 0x00E2, 0x201E, 0x00A2],
  [0x00C3, 0x201A],
].map((arr) => String.fromCodePoint(...arr));

const roots = [".roadmap", "docs", "scripts", "test-results"];
const allowedExtensions = [".md", ".sql", ".js", ".mjs", ".ts", ".tsx", ".json"];

function walk(dir) {
  const files = [];
  try {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      const stat = statSync(path);
      if (stat.isDirectory()) files.push(...walk(path));
      else if (allowedExtensions.some((ext) => path.endsWith(ext))) files.push(path);
    }
  } catch {}
  return files;
}

const violations = [];
for (const root of roots) {
  for (const file of walk(root)) {
    const content = readFileSync(file, "utf8");
    for (const token of forbidden) if (content.includes(token)) violations.push({ file, token });
  }
}

if (violations.length > 0) {
  console.error("Encoding/mojibake artifacts found:");
  for (const violation of violations) console.error(`- ${violation.file}: ${violation.token}`);
  process.exit(1);
}

console.log("Encoding/mojibake check passed.");
