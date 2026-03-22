import type { LearningCourse, LearningProgram } from "@prisma/client";

export type LegacyLearningProgram = {
  ID: string;
  MainTitle: string;
  MainDescription: string | null;
  CourseType: string;
  Title: string;
  Description1: string | null;
  Description2: string | null;
  Description3: string | null;
  VideoPromo: string | null;
  Picture1: string | null;
  Picture2: string | null;
  Picture3: string | null;
};

export type LegacyLearningCourse = {
  ID: string;
  Title: string;
  Description: string | null;
  "Short Description": string | null;
  Category: string;
  "Category Type": string | null;
  "Category Level": string | null;
  Thumbnail: string | null;
  VideoURL: string | null;
  Priority: number;
};

export function toLegacyLearningProgram(program: LearningProgram): LegacyLearningProgram {
  return {
    ID: program.legacyId,
    MainTitle: program.mainTitle,
    MainDescription: program.mainDescription,
    CourseType: program.courseType,
    Title: program.title,
    Description1: program.description1,
    Description2: program.description2,
    Description3: program.description3,
    VideoPromo: program.videoPromo,
    Picture1: program.picture1,
    Picture2: program.picture2,
    Picture3: program.picture3,
  };
}

export function toLegacyLearningCourse(course: LearningCourse): LegacyLearningCourse {
  return {
    ID: course.legacyId,
    Title: course.title,
    Description: course.description,
    "Short Description": course.shortDescription,
    Category: course.category,
    "Category Type": course.categoryType,
    "Category Level": course.categoryLevel,
    Thumbnail: course.thumbnail,
    VideoURL: course.videoUrl,
    Priority: course.priority,
  };
}
