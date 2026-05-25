import "./helpers/setup-env";
import { Role } from "@prisma/client";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { GET as getInstructors } from "../../src/app/api/instructors/route";
import { prisma } from "./helpers/db";
import { resetDb } from "./helpers/reset-db";

describe("instructors api", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("returns teacher users with name, bio, and fallback-safe imageUrl", async () => {
    const legacyInstructorImage = ["/images", "instructors", "legacy-teacher.jpg"].join("/");
    const uploadsDir = await mkdtemp(path.join(os.tmpdir(), "bookmyclass-instructors-"));
    process.env.UPLOADS_DIR = uploadsDir;
    process.env.PUBLIC_UPLOADS_BASE_PATH = "/uploads";
    await mkdir(path.join(uploadsDir, "teachers"), { recursive: true });
    await writeFile(path.join(uploadsDir, "teachers", "ana-profile.jpg"), Buffer.from([0xff, 0xd8, 0xff]));

    await prisma.user.createMany({
      data: [
        {
          name: "Sofia Van den Berg",
          firstName: "Sofia",
          lastName: "Van den Berg",
          email: "sofia.vandenberg.test@yogapilatesfitness.local",
          role: Role.TEACHER,
          image: "/uploads/teachers/missing-sofia-instructor-bio.jpg",
        },
        {
          name: "Legacy Teacher",
          firstName: "Legacy",
          lastName: "Teacher",
          email: "legacy.teacher.test@yogapilatesfitness.local",
          role: Role.TEACHER,
          image: legacyInstructorImage,
        },
        {
          name: "Ana Ionescu",
          firstName: "Ana",
          lastName: "Ionescu",
          email: "ana.ionescu.test@yogapilatesfitness.local",
          role: Role.TEACHER,
          image: "/uploads/teachers/ana-profile.jpg",
        },
      ],
    });

    const teachers = await prisma.user.findMany({
      where: { role: Role.TEACHER },
      orderBy: { email: "asc" },
      select: { id: true, email: true },
    });

    await prisma.teacherProfile.createMany({
      data: teachers.map((teacher) => ({
        userId: teacher.id,
        bio:
          teacher.email.startsWith("ana.")
            ? "Ana leads classes with a clear and progressive approach to movement."
            : "Sofia teaches flowing classes with a warm and supportive approach.",
        specialties: [],
        certifications: [],
      })),
    });

    const response = await getInstructors();
    const body = (await response.json()) as {
      instructors: Array<{ bio: string; imageUrl: string; name: string }>;
    };

    expect(response.status).toBe(200);
    expect(body.instructors).toHaveLength(3);
    expect(body.instructors[0]).toMatchObject({
      name: "Ana Ionescu",
      bio: "Ana leads classes with a clear and progressive approach to movement.",
      imageUrl: "/uploads/teachers/ana-profile.jpg",
    });
    expect(body.instructors[1]).toMatchObject({
      name: "Legacy Teacher",
      bio: "Sofia teaches flowing classes with a warm and supportive approach.",
      imageUrl: "",
    });
    expect(body.instructors[2]).toMatchObject({
      name: "Sofia Van den Berg",
      bio: "Sofia teaches flowing classes with a warm and supportive approach.",
      imageUrl: "",
    });
  });
});
