import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { Pool } from "pg";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import "dotenv/config";

export type LearningProgramInput = {
  legacyId: string;
  mainTitle: string;
  mainDescription?: string | null;
  courseType: string;
  title: string;
  description1?: string | null;
  description2?: string | null;
  description3?: string | null;
  videoPromo?: string | null;
  picture1?: string | null;
  picture2?: string | null;
  picture3?: string | null;
};

export type LearningCourseInput = {
  legacyId: string;
  title: string;
  description?: string | null;
  shortDescription?: string | null;
  category: string;
  categoryType?: string | null;
  categoryLevel?: string | null;
  thumbnail?: string | null;
  videoUrl?: string | null;
  priority?: number;
};

export type LearningImportPayload = {
  programs: LearningProgramInput[];
  courses: LearningCourseInput[];
};

function asOptionalString(value: unknown): string | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }

  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function asRequiredId(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  return undefined;
}

function asRequiredString(value: unknown): string | undefined {
  const normalized = asOptionalString(value);
  return normalized && normalized.length > 0 ? normalized : undefined;
}

function asOptionalNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") {
    return undefined;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return undefined;
    }

    const parsed = Number(trimmed);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pickFirstDefined(record: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (record[key] !== undefined) {
      return record[key];
    }
  }

  return undefined;
}

export function parsePayload(raw: unknown): { payload: LearningImportPayload | null; errors: string[] } {
  if (!isRecord(raw)) {
    return {
      payload: null,
      errors: ["Root JSON value must be an object with 'programs' and 'courses' arrays."],
    };
  }

  const errors: string[] = [];
  const programsRaw = raw.programs;
  const coursesRaw = raw.courses;

  if (!Array.isArray(programsRaw)) {
    errors.push("Field 'programs' must be an array.");
  }

  if (!Array.isArray(coursesRaw)) {
    errors.push("Field 'courses' must be an array.");
  }

  if (errors.length > 0) {
    return { payload: null, errors };
  }

  const programs: LearningProgramInput[] = [];
  const courses: LearningCourseInput[] = [];

  const programItems = programsRaw as unknown[];
  const courseItems = coursesRaw as unknown[];

  programItems.forEach((item, index) => {
    if (!isRecord(item)) {
      errors.push(`programs[${index}] must be an object.`);
      return;
    }

    const legacyId = asRequiredId(pickFirstDefined(item, ["legacyId", "ID"]));
    const mainTitle = asRequiredString(pickFirstDefined(item, ["mainTitle", "MainTitle"]));
    const courseType = asRequiredString(pickFirstDefined(item, ["courseType", "CourseType"]));
    const title = asRequiredString(pickFirstDefined(item, ["title", "Title"]));

    if (!legacyId) errors.push(`programs[${index}].ID (or legacyId) is required.`);
    if (!mainTitle) errors.push(`programs[${index}].MainTitle (or mainTitle) is required.`);
    if (!courseType) errors.push(`programs[${index}].CourseType (or courseType) is required.`);
    if (!title) errors.push(`programs[${index}].Title (or title) is required.`);

    if (!legacyId || !mainTitle || !courseType || !title) {
      return;
    }

    programs.push({
      legacyId,
      mainTitle,
      mainDescription: asOptionalString(pickFirstDefined(item, ["mainDescription", "MainDescription"])),
      courseType,
      title,
      description1: asOptionalString(pickFirstDefined(item, ["description1", "Description1"])),
      description2: asOptionalString(pickFirstDefined(item, ["description2", "Description2"])),
      description3: asOptionalString(pickFirstDefined(item, ["description3", "Description3"])),
      videoPromo: asOptionalString(pickFirstDefined(item, ["videoPromo", "VideoPromo"])),
      picture1: asOptionalString(pickFirstDefined(item, ["picture1", "Picture1"])),
      picture2: asOptionalString(pickFirstDefined(item, ["picture2", "Picture2"])),
      picture3: asOptionalString(pickFirstDefined(item, ["picture3", "Picture3"])),
    });
  });

  courseItems.forEach((item, index) => {
    if (!isRecord(item)) {
      errors.push(`courses[${index}] must be an object.`);
      return;
    }

    const legacyId = asRequiredId(pickFirstDefined(item, ["legacyId", "ID"]));
    const title = asRequiredString(pickFirstDefined(item, ["title", "Title"]));
    const category = asRequiredString(pickFirstDefined(item, ["category", "Category"]));
    const rawPriority = pickFirstDefined(item, ["priority", "Priority"]);
    const priority = asOptionalNumber(rawPriority);

    if (!legacyId) errors.push(`courses[${index}].ID (or legacyId) is required.`);
    if (!title) errors.push(`courses[${index}].Title (or title) is required.`);
    if (!category) errors.push(`courses[${index}].Category (or category) is required.`);
    if (rawPriority !== undefined && priority === undefined) {
      errors.push(`courses[${index}].Priority (or priority) must be a valid number when provided.`);
    }

    if (!legacyId || !title || !category) {
      return;
    }

    courses.push({
      legacyId,
      title,
      description: asOptionalString(pickFirstDefined(item, ["description", "Description"])),
      shortDescription: asOptionalString(pickFirstDefined(item, ["shortDescription", "Short Description"])),
      category,
      categoryType: asOptionalString(pickFirstDefined(item, ["categoryType", "Category Type"])),
      categoryLevel: asOptionalString(pickFirstDefined(item, ["categoryLevel", "Category Level"])),
      thumbnail: asOptionalString(pickFirstDefined(item, ["thumbnail", "Thumbnail"])),
      videoUrl: asOptionalString(pickFirstDefined(item, ["videoUrl", "VideoURL"])),
      priority,
    });
  });

  const duplicateProgramLegacyIds = findDuplicates(programs.map((entry) => entry.legacyId));
  duplicateProgramLegacyIds.forEach((id) => {
    errors.push(`Duplicate program ID in JSON: '${id}'.`);
  });

  const duplicateCourseLegacyIds = findDuplicates(courses.map((entry) => entry.legacyId));
  duplicateCourseLegacyIds.forEach((id) => {
    errors.push(`Duplicate course ID in JSON: '${id}'.`);
  });

  const duplicateProgramCourseTypes = findDuplicates(programs.map((entry) => entry.courseType));
  duplicateProgramCourseTypes.forEach((value) => {
    errors.push(`Duplicate program CourseType in JSON: '${value}'.`);
  });

  if (errors.length > 0) {
    return { payload: null, errors };
  }

  return { payload: { programs, courses }, errors: [] };
}

function findDuplicates(values: string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();

  for (const value of values) {
    if (seen.has(value)) {
      duplicates.add(value);
    } else {
      seen.add(value);
    }
  }

  return Array.from(duplicates);
}

export async function loadImportFile(filePath: string): Promise<LearningImportPayload> {
  const absolutePath = resolve(filePath);
  const content = await readFile(absolutePath, "utf8");
  let parsed: unknown;

  try {
    parsed = JSON.parse(content) as unknown;
  } catch {
    throw new Error(`Invalid JSON in file: ${absolutePath}`);
  }

  const { payload, errors } = parsePayload(parsed);

  if (!payload) {
    const message = ["Import validation failed:", ...errors.map((error) => `- ${error}`)].join("\n");
    throw new Error(message);
  }

  return payload;
}

export async function runLearningImport() {
  const importPathArg = process.argv[2];
  if (!importPathArg) {
    throw new Error(
      "Missing JSON file path.\nUsage: npm run learning:import -- <path-to-learning-json>",
    );
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not set.");
  }

  const payload = await loadImportFile(importPathArg);
  console.info(`[learning-import] Loaded ${payload.programs.length} programs and ${payload.courses.length} courses.`);

  const pool = new Pool({ connectionString: databaseUrl });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  let createdPrograms = 0;
  let updatedPrograms = 0;
  let createdCourses = 0;
  let updatedCourses = 0;

  try {
    await prisma.$transaction(async (tx) => {
      for (const program of payload.programs) {
        const existing = await tx.learningProgram.findUnique({
          where: { legacyId: program.legacyId },
          select: { id: true },
        });

        await tx.learningProgram.upsert({
          where: { legacyId: program.legacyId },
          create: {
            ...program,
          },
          update: {
            ...program,
          },
        });

        if (existing) {
          updatedPrograms += 1;
        } else {
          createdPrograms += 1;
        }
      }

      for (const course of payload.courses) {
        const existing = await tx.learningCourse.findUnique({
          where: { legacyId: course.legacyId },
          select: { id: true },
        });

        await tx.learningCourse.upsert({
          where: { legacyId: course.legacyId },
          create: {
            ...course,
            priority: course.priority ?? 0,
          },
          update: {
            ...course,
            priority: course.priority ?? 0,
          },
        });

        if (existing) {
          updatedCourses += 1;
        } else {
          createdCourses += 1;
        }
      }
    });

    console.info("[learning-import] Import completed successfully.");
    console.info(
      `[learning-import] Programs: created=${createdPrograms}, updated=${updatedPrograms}, total=${payload.programs.length}.`,
    );
    console.info(
      `[learning-import] Courses: created=${createdCourses}, updated=${updatedCourses}, total=${payload.courses.length}.`,
    );
    console.info("[learning-import] No deletions were performed.");
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

const isDirectExecution =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectExecution) {
  runLearningImport().catch((error) => {
    console.error("[learning-import] Failed:", error instanceof Error ? error.message : error);
    process.exit(1);
  });
}


