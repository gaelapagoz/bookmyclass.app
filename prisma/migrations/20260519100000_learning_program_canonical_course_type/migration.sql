-- LearningProgram canonical field cleanup
-- Canonical value priority: mainTitle -> title -> existing courseType
UPDATE "LearningProgram"
SET "courseType" = COALESCE(NULLIF(TRIM("mainTitle"), ''), NULLIF(TRIM("title"), ''), "courseType");

ALTER TABLE "LearningProgram"
DROP COLUMN "mainTitle",
DROP COLUMN "title";
