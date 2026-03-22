import "dotenv/config";
import { getLearningPrograms } from "../src/lib/learning/catalogue";

async function main() {
  const programs = await getLearningPrograms();
  console.log("programs length", programs.length);
  console.log(programs.map((p) => ({ legacyId: p.legacyId, courseType: p.courseType, mainTitle: p.mainTitle })));
}

main().catch((e) => {
  console.error("FAILED", e);
  process.exit(1);
});
