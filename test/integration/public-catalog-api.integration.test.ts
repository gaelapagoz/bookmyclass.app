import "./helpers/setup-env";
import { describe, expect, it, beforeEach } from "vitest";
import { GET as getCategories } from "../../src/app/api/categories/route";
import { GET as getServices } from "../../src/app/api/services/route";
import { prisma } from "./helpers/db";
import { createClassCategory, createClassType } from "./helpers/factories";
import { resetDb } from "./helpers/reset-db";

describe("public catalogue api", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("returns only active categories ordered by sortOrder then name", async () => {
    const pilates = await createClassCategory(prisma, {
      name: "Pilates Collective Classes",
      slug: "pilates-collective",
      sortOrder: 20,
      isActive: true,
    });
    const yoga = await createClassCategory(prisma, {
      name: "Yoga Collective Classes",
      slug: "yoga-collective",
      sortOrder: 10,
      isActive: true,
    });
    await createClassCategory(prisma, {
      name: "Archived Category",
      slug: "archived-category",
      sortOrder: 0,
      isActive: false,
    });

    await createClassType(prisma, {
      categoryId: yoga.id,
      name: "Vinyasa Yoga",
      slug: "vinyasa-yoga-for-categories",
      sortOrder: 10,
      isActive: true,
      isVisible: true,
    });
    await createClassType(prisma, {
      categoryId: pilates.id,
      name: "Mat Pilates",
      slug: "mat-pilates-for-categories",
      sortOrder: 10,
      isActive: true,
      isVisible: true,
    });

    const response = await getCategories();
    const body = (await response.json()) as {
      categories: Array<{ name: string; slug: string }>;
    };

    expect(response.status).toBe(200);
    expect(body.categories.map((category) => category.slug)).toEqual([
      "yoga-collective",
      "pilates-collective",
    ]);
  });

  it("returns 400 when category query is missing", async () => {
    const request = new Request("http://localhost:3000/api/services");

    const response = await getServices(request);

    expect(response.status).toBe(400);
  });

  it("returns only active and visible services for a category, ordered by sortOrder then name", async () => {
    const yoga = await createClassCategory(prisma, {
      name: "Yoga Collective Classes",
      slug: "yoga-collective",
      sortOrder: 10,
      isActive: true,
    });
    const pilates = await createClassCategory(prisma, {
      name: "Pilates Collective Classes",
      slug: "pilates-collective",
      sortOrder: 20,
      isActive: true,
    });

    await createClassType(prisma, {
      categoryId: yoga.id,
      name: "Vinyasa Yoga",
      slug: "vinyasa-yoga",
      sortOrder: 20,
      isActive: true,
      isVisible: true,
    });
    await createClassType(prisma, {
      categoryId: yoga.id,
      name: "Rocket Yoga",
      slug: "rocket-yoga",
      sortOrder: 10,
      isActive: true,
      isVisible: true,
    });
    await createClassType(prisma, {
      categoryId: yoga.id,
      name: "Hidden Yoga",
      slug: "hidden-yoga",
      sortOrder: 5,
      isActive: true,
      isVisible: false,
    });
    await createClassType(prisma, {
      categoryId: yoga.id,
      name: "Inactive Yoga",
      slug: "inactive-yoga",
      sortOrder: 1,
      isActive: false,
      isVisible: true,
    });
    await createClassType(prisma, {
      categoryId: pilates.id,
      name: "Mat Pilates",
      slug: "mat-pilates",
      sortOrder: 5,
      isActive: true,
      isVisible: true,
    });

    const request = new Request(
      "http://localhost:3000/api/services?category=yoga-collective",
    );

    const response = await getServices(request);
    const body = (await response.json()) as {
      services: Array<{ title: string; slug: string }>;
    };

    expect(response.status).toBe(200);
    expect(body.services.map((service) => service.slug)).toEqual([
      "rocket-yoga",
      "vinyasa-yoga",
    ]);
    expect(body.services.map((service) => service.title)).toEqual([
      "Rocket Yoga",
      "Vinyasa Yoga",
    ]);
  });

  it("returns an empty list for unknown category slug", async () => {
    const request = new Request(
      "http://localhost:3000/api/services?category=missing-category",
    );

    const response = await getServices(request);
    const body = (await response.json()) as {
      services: Array<unknown>;
    };

    expect(response.status).toBe(200);
    expect(body.services).toEqual([]);
  });
});
