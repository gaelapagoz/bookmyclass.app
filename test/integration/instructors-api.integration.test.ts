import "./helpers/setup-env";
import { Role } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";
import { GET as getInstructors } from "../../src/app/api/instructors/route";
import { prisma } from "./helpers/db";
import { resetDb } from "./helpers/reset-db";

describe("instructors api", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("returns teacher users with name, bio, and imageUrl", async () => {
    await prisma.user.createMany({
      data: [
        {
          name: "Sofia Van den Berg",
          firstName: "Sofia",
          lastName: "Van den Berg",
          email: "sofia.vandenberg.test@yogapilatesfitness.local",
          role: Role.TEACHER,
          image: "/images/instructors/sofia_instructor_bio.jpg",
        },
        {
          name: "Ana Ionescu",
          firstName: "Ana",
          lastName: "Ionescu",
          email: "ana.ionescu.test@yogapilatesfitness.local",
          role: Role.TEACHER,
          image: "/images/instructors/ana_instructor_bio.jpg",
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
    expect(body.instructors).toHaveLength(2);
    expect(body.instructors[0]).toMatchObject({
      name: "Ana Ionescu",
      bio: "Ana leads classes with a clear and progressive approach to movement.",
      imageUrl: "/images/instructors/ana_instructor_bio.jpg",
    });
    expect(body.instructors[1]).toMatchObject({
      name: "Sofia Van den Berg",
      bio: "Sofia teaches flowing classes with a warm and supportive approach.",
      imageUrl: "/images/instructors/sofia_instructor_bio.jpg",
    });
  });
});
