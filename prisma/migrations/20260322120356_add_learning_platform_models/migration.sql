-- CreateTable
CREATE TABLE "LearningProgram" (
    "id" TEXT NOT NULL,
    "legacyId" TEXT NOT NULL,
    "mainTitle" TEXT NOT NULL,
    "mainDescription" TEXT,
    "courseType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description1" TEXT,
    "description2" TEXT,
    "description3" TEXT,
    "videoPromo" TEXT,
    "picture1" TEXT,
    "picture2" TEXT,
    "picture3" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LearningProgram_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LearningCourse" (
    "id" TEXT NOT NULL,
    "legacyId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "shortDescription" TEXT,
    "category" TEXT NOT NULL,
    "categoryType" TEXT,
    "categoryLevel" TEXT,
    "thumbnail" TEXT,
    "videoUrl" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LearningCourse_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LearningProgram_legacyId_key" ON "LearningProgram"("legacyId");

-- CreateIndex
CREATE UNIQUE INDEX "LearningProgram_courseType_key" ON "LearningProgram"("courseType");

-- CreateIndex
CREATE UNIQUE INDEX "LearningCourse_legacyId_key" ON "LearningCourse"("legacyId");

-- CreateIndex
CREATE INDEX "LearningCourse_category_idx" ON "LearningCourse"("category");

-- CreateIndex
CREATE INDEX "LearningCourse_priority_idx" ON "LearningCourse"("priority");
