import { describe, expect, it } from "vitest";
import { parsePayload } from "../../scripts/import-learning-platform";

describe("learning importer payload parsing", () => {
  it("parses legacy JSON shape into normalized program/course payload", () => {
    const raw = {
      programs: [
        {
          ID: "1",
          MainTitle: "Yoga Program",
          MainDescription: "Program description",
          CourseType: "Yoga",
          Title: "Yoga",
          Description1: "d1",
          Description2: "d2",
          Description3: "d3",
          VideoPromo: "https://www.youtube.com/watch?v=promo",
          Picture1: "/images/program-1.jpg",
          Picture2: "/images/program-2.jpg",
          Picture3: "/images/program-3.jpg",
        },
      ],
      courses: [
        {
          ID: "101",
          Title: "Sun Salutation",
          Description: "Full class",
          "Short Description": "Short class description",
          Category: "Yoga",
          "Category Type": "Flow",
          "Category Level": "Beginner",
          Thumbnail: "/images/course-1.jpg",
          VideoURL: "https://www.youtube.com/watch?v=course",
          Priority: "2",
        },
      ],
    };

    const result = parsePayload(raw);

    expect(result.errors).toEqual([]);
    expect(result.payload).not.toBeNull();
    expect(result.payload?.programs[0]).toEqual({
      legacyId: "1",
      mainTitle: "Yoga Program",
      mainDescription: "Program description",
      courseType: "Yoga",
      title: "Yoga",
      description1: "d1",
      description2: "d2",
      description3: "d3",
      videoPromo: "https://www.youtube.com/watch?v=promo",
      picture1: "/images/program-1.jpg",
      picture2: "/images/program-2.jpg",
      picture3: "/images/program-3.jpg",
    });
    expect(result.payload?.courses[0]).toEqual({
      legacyId: "101",
      title: "Sun Salutation",
      description: "Full class",
      shortDescription: "Short class description",
      category: "Yoga",
      categoryType: "Flow",
      categoryLevel: "Beginner",
      thumbnail: "/images/course-1.jpg",
      videoUrl: "https://www.youtube.com/watch?v=course",
      priority: 2,
    });
  });

  it("parses normalized JSON shape without requiring legacy keys", () => {
    const raw = {
      programs: [
        {
          legacyId: "2",
          mainTitle: "Pilates Program",
          courseType: "Pilates",
          title: "Pilates",
        },
      ],
      courses: [
        {
          legacyId: "202",
          title: "Core Burn",
          category: "Pilates",
          priority: 1,
        },
      ],
    };

    const result = parsePayload(raw);

    expect(result.errors).toEqual([]);
    expect(result.payload).toEqual({
      programs: [
        {
          legacyId: "2",
          mainTitle: "Pilates Program",
          mainDescription: undefined,
          courseType: "Pilates",
          title: "Pilates",
          description1: undefined,
          description2: undefined,
          description3: undefined,
          videoPromo: undefined,
          picture1: undefined,
          picture2: undefined,
          picture3: undefined,
        },
      ],
      courses: [
        {
          legacyId: "202",
          title: "Core Burn",
          description: undefined,
          shortDescription: undefined,
          category: "Pilates",
          categoryType: undefined,
          categoryLevel: undefined,
          thumbnail: undefined,
          videoUrl: undefined,
          priority: 1,
        },
      ],
    });
  });

  it("reports duplicate IDs and duplicate program courseType values", () => {
    const raw = {
      programs: [
        {
          ID: "p-1",
          MainTitle: "Program A",
          CourseType: "Yoga",
          Title: "A",
        },
        {
          ID: "p-1",
          MainTitle: "Program B",
          CourseType: "Yoga",
          Title: "B",
        },
      ],
      courses: [
        {
          ID: "c-1",
          Title: "Course A",
          Category: "Yoga",
        },
        {
          ID: "c-1",
          Title: "Course B",
          Category: "Yoga",
        },
      ],
    };

    const result = parsePayload(raw);

    expect(result.payload).toBeNull();
    expect(result.errors).toContain("Duplicate program ID in JSON: 'p-1'.");
    expect(result.errors).toContain("Duplicate course ID in JSON: 'c-1'.");
    expect(result.errors).toContain("Duplicate program CourseType in JSON: 'Yoga'.");
  });
});
