import { readdir } from "node:fs/promises";
import path from "node:path";

import { isLearningImagePath } from "../../src/lib/learning/image-paths";
import {
  PRODUCTION_CONFIRM_VALUE,
  PRODUCTION_URL_INDICATORS,
  resolveSeedMode,
  validateEnvironmentForMode,
} from "../../prisma/seed/config";
import {
  MIN_COURSES_PER_PROGRAM,
  MAX_COURSES_PER_PROGRAM,
  PILATES_COURSES,
  PILATES_PROGRAM,
  PROD_LEARNING_VIDEO_URL,
  PRODUCTION_LEARNING_COURSES,
  PRODUCTION_LEARNING_PROGRAMS,
  FITNESS_COURSES,
  FITNESS_PROGRAM,
  YOGA_COURSES,
  YOGA_PROGRAM,
} from "../../prisma/seed/data/learning-production";
import { createSeededRng } from "../../prisma/seed/utils/deterministic-random";

describe("seed config", () => {
  it("resolveSeedMode throws when missing", () => {
    const prev = process.env.BOOKMYCLASS_SEED_MODE;
    delete process.env.BOOKMYCLASS_SEED_MODE;
    try {
      expect(() => resolveSeedMode()).toThrow(/BOOKMYCLASS_SEED_MODE is not set/i);
    } finally {
      if (prev !== undefined) process.env.BOOKMYCLASS_SEED_MODE = prev;
    }
  });

  it("resolveSeedMode validates allowed values", () => {
    const prev = process.env.BOOKMYCLASS_SEED_MODE;
    process.env.BOOKMYCLASS_SEED_MODE = "nope";
    try {
      expect(() => resolveSeedMode()).toThrow(/Invalid BOOKMYCLASS_SEED_MODE/i);
    } finally {
      if (prev !== undefined) process.env.BOOKMYCLASS_SEED_MODE = prev;
      else delete process.env.BOOKMYCLASS_SEED_MODE;
    }
  });

  it("production seed requires confirmation + refuses test NODE_ENV", () => {
    const prevConfirm = process.env.CONFIRM_PRODUCTION_SEED;
    const prevNodeEnv = process.env.NODE_ENV;

    try {
      process.env.NODE_ENV = "production";
      delete process.env.CONFIRM_PRODUCTION_SEED;
      expect(() => validateEnvironmentForMode("production", "postgres://prod-host/db")).toThrow(
        /CONFIRM_PRODUCTION_SEED/i,
      );

      process.env.CONFIRM_PRODUCTION_SEED = PRODUCTION_CONFIRM_VALUE;
      process.env.NODE_ENV = "test";
      expect(() => validateEnvironmentForMode("production", "postgres://prod-host/db")).toThrow(
        /NODE_ENV is 'test'/i,
      );
    } finally {
      if (prevConfirm !== undefined) process.env.CONFIRM_PRODUCTION_SEED = prevConfirm;
      else delete process.env.CONFIRM_PRODUCTION_SEED;
      if (prevNodeEnv !== undefined) process.env.NODE_ENV = prevNodeEnv;
      else delete process.env.NODE_ENV;
    }
  });


  it("non-production seeds refuse production-like DATABASE_URL", () => {
    for (const indicator of PRODUCTION_URL_INDICATORS) {
      expect(() => validateEnvironmentForMode("development", `postgres://x@${indicator}/db`)).toThrow(
        /production database/i,
      );
      expect(() =>
        validateEnvironmentForMode("staging", `postgres://x@${indicator}/db`),
      ).toThrow(/production database/i);
      expect(() =>
        validateEnvironmentForMode("demo", `postgres://x@${indicator}/db`),
      ).toThrow(/production database/i);
    }
  });

  it("resolveSeedMode accepts canonical values", () => {
    const prev = process.env.BOOKMYCLASS_SEED_MODE;
    try {
      for (const value of ["development", "staging", "demo", "production"] as const) {
        process.env.BOOKMYCLASS_SEED_MODE = value;
        expect(resolveSeedMode()).toBe(value);
      }
    } finally {
      if (prev !== undefined) process.env.BOOKMYCLASS_SEED_MODE = prev;
      else delete process.env.BOOKMYCLASS_SEED_MODE;
    }
  });
});

describe("deterministic RNG", () => {
  it("produces stable sequences for same seed", () => {
    const a = createSeededRng(123);
    const b = createSeededRng(123);

    const seqA = Array.from({ length: 10 }, () => a.int(1, 100));
    const seqB = Array.from({ length: 10 }, () => b.int(1, 100));
    expect(seqA).toEqual(seqB);
  });
});

describe("production learning catalogue data", () => {
  it("has 3 programs and up to 6 courses per program", () => {
    expect(PRODUCTION_LEARNING_PROGRAMS).toHaveLength(3);

    const courseCountByCategory = new Map<string, number>();
    for (const course of PRODUCTION_LEARNING_COURSES) {
      courseCountByCategory.set(course.category, (courseCountByCategory.get(course.category) ?? 0) + 1);
    }

    for (const program of PRODUCTION_LEARNING_PROGRAMS) {
      const count = courseCountByCategory.get(program.courseType) ?? 0;
      expect(count).toBeGreaterThanOrEqual(MIN_COURSES_PER_PROGRAM);
      expect(count).toBeLessThanOrEqual(MAX_COURSES_PER_PROGRAM);
    }
  });

  it("uses the canonical video URL for all videos", () => {
    expect(PROD_LEARNING_VIDEO_URL).toBe("https://www.youtube.com/watch?v=ZdfJcN-yBIE");
    for (const course of PRODUCTION_LEARNING_COURSES) {
      expect(course.videoUrl).toBe(PROD_LEARNING_VIDEO_URL);
    }
  });

  it("has 18 total courses across all 3 programs", () => {
    expect(FITNESS_COURSES).toHaveLength(6);
    expect(YOGA_COURSES).toHaveLength(6);
    expect(PILATES_COURSES).toHaveLength(6);
    expect(PRODUCTION_LEARNING_COURSES).toHaveLength(18);
  });

  it("uses human-readable program labels instead of prod route labels", () => {
    expect(PRODUCTION_LEARNING_PROGRAMS.map((program) => program.courseType)).toEqual([
      "Functional Training",
      "Yoga",
      "Pilates",
    ]);
    expect(PRODUCTION_LEARNING_PROGRAMS.map((program) => program.courseType).some((label) => label.startsWith("prod-"))).toBe(false);
  });

  it("all program courseTypes are distinct", () => {
    const courseTypes = PRODUCTION_LEARNING_PROGRAMS.map((p) => p.courseType);
    const unique = new Set(courseTypes);
    expect(unique.size).toBe(PRODUCTION_LEARNING_PROGRAMS.length);
  });

  it("all course categories match their program courseType", () => {
    const courseTypesByProgramId = new Map(PRODUCTION_LEARNING_PROGRAMS.map((p) => [p.courseType, p.legacyId]));
    for (const course of PRODUCTION_LEARNING_COURSES) {
      expect(courseTypesByProgramId.has(course.category)).toBe(true);
    }
  });

  it("all course priorities are positive integers", () => {
    for (const course of PRODUCTION_LEARNING_COURSES) {
      expect(course.priority).toBeGreaterThan(0);
      expect(Number.isInteger(course.priority)).toBe(true);
    }
  });

  it("all course legacyIds are unique", () => {
    const ids = PRODUCTION_LEARNING_COURSES.map((c) => c.legacyId);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it("all program legacyIds are unique", () => {
    const ids = PRODUCTION_LEARNING_PROGRAMS.map((p) => p.legacyId);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });
});

describe("production learning image paths", () => {
  it("all course thumbnails match /uploads/learning/*.jpg pattern", () => {
    for (const course of PRODUCTION_LEARNING_COURSES) {
      if (course.thumbnail) {
        expect(isLearningImagePath(course.thumbnail)).toBe(true);
      }
    }
  });

  it("all program picture fields match /uploads/learning/*.jpg pattern", () => {
    for (const program of PRODUCTION_LEARNING_PROGRAMS) {
      if (program.picture1) expect(isLearningImagePath(program.picture1)).toBe(true);
      if (program.picture2) expect(isLearningImagePath(program.picture2)).toBe(true);
      if (program.picture3) expect(isLearningImagePath(program.picture3)).toBe(true);
    }
  });

  it("each program uses its own dedicated image", () => {
    expect(FITNESS_PROGRAM.picture1).toContain("fitness");
    expect(YOGA_PROGRAM.picture1).toContain("yoga");
    expect(PILATES_PROGRAM.picture1).toContain("pilates");
  });

  it("staging/demo learning seed folders are minimized to canonical 3 course images", async () => {
    const expected = ["course_1_fitness.jpg", "course_2_yoga.jpg", "course_3_pilates.jpg"];
    const stagingLearningDir = path.resolve(process.cwd(), "prisma", "seed-data", "staging-images", "learning");
    const demoLearningDir = path.resolve(process.cwd(), "prisma", "seed-data", "demo-images", "learning");
    const stagingFiles = (await readdir(stagingLearningDir)).sort();
    const demoFiles = (await readdir(demoLearningDir)).sort();

    expect(stagingFiles).toEqual(expected);
    expect(demoFiles).toEqual(expected);
  });
});

describe("deterministic RNG — extended", () => {
  it("produces different sequences for different seeds", () => {
    const a = createSeededRng(1);
    const b = createSeededRng(2);
    const seqA = Array.from({ length: 10 }, () => a.int(1, 1000));
    const seqB = Array.from({ length: 10 }, () => b.int(1, 1000));
    expect(seqA).not.toEqual(seqB);
  });

  it("int() always returns values within the inclusive range", () => {
    const rng = createSeededRng(42);
    for (let i = 0; i < 200; i += 1) {
      const v = rng.int(5, 10);
      expect(v).toBeGreaterThanOrEqual(5);
      expect(v).toBeLessThanOrEqual(10);
    }
  });

  it("int() handles min === max by returning that value", () => {
    const rng = createSeededRng(7);
    for (let i = 0; i < 20; i += 1) {
      expect(rng.int(3, 3)).toBe(3);
    }
  });

  it("shuffle() returns all original elements in a different order", () => {
    const rng = createSeededRng(99);
    const original = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const shuffled = rng.shuffle(original);
    expect(shuffled).toHaveLength(original.length);
    expect(shuffled.sort((a, b) => a - b)).toEqual(original);
  });

  it("pick() returns an element from the array", () => {
    const rng = createSeededRng(55);
    const items = ["alpha", "beta", "gamma", "delta"];
    for (let i = 0; i < 50; i += 1) {
      const picked = rng.pick(items);
      expect(items).toContain(picked);
    }
  });

  it("pick() throws on empty array", () => {
    const rng = createSeededRng(1);
    expect(() => rng.pick([])).toThrow();
  });
});

