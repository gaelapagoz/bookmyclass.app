import LearningProgramsSection from "@/components/learning/LearningProgramsSection";
import { getLearningPrograms } from "@/lib/learning/catalogue";

export const dynamic = "force-dynamic";

export default async function LearningLandingPage() {
  let hasLoadError = false;
  let programs: Awaited<ReturnType<typeof getLearningPrograms>> = [];

  try {
    programs = await getLearningPrograms();
  } catch (error) {
    hasLoadError = true;
    console.error("[learning/page] Failed to load programs.", error);
  }

  if (hasLoadError) {
    return (
      <section className="mx-auto w-full max-w-6xl px-6 py-12">
        <h1 className="text-3xl font-semibold text-[#6f2b2b] md:text-4xl">
          Online Learning
        </h1>
        <p className="mt-3 text-sm text-[#7f5a5a] md:text-base">
          Learning programs are temporarily unavailable. Please try again shortly.
        </p>
      </section>
    );
  }

  if (programs.length === 0) {
    return (
      <section className="mx-auto w-full max-w-6xl px-6 py-12">
        <h1 className="text-3xl font-semibold text-[#6f2b2b] md:text-4xl">
          Online Learning
        </h1>
        <p className="mt-3 text-sm text-[#7f5a5a] md:text-base">
          No learning programs are available right now. Please check back soon.
        </p>
      </section>
    );
  }

  return <LearningProgramsSection programs={programs} />;
}
