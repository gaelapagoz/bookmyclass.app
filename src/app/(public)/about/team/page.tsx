import { TeacherCard } from "@/components/about/TeacherCard";
import { getPublicInstructors } from "@/lib/public-content/team-service";

export default async function AboutTeamPage() {
  const instructors = await getPublicInstructors();

  return (
    <section className="mx-auto w-full max-w-6xl px-6 py-12">
      <header className="rounded-2xl border border-[#e5d7cb] bg-[#fffdfa] p-8">
        <h1 className="text-3xl font-semibold text-[#6f2b2b]">Our Team</h1>
        <p className="mt-4 max-w-3xl text-base leading-7 text-[#5f4040]">
          Meet the teachers guiding each session with experience, clarity, and personal attention.
        </p>
      </header>

      <div className="mt-10 space-y-8">
        {instructors.map((instructor, index) => (
          <TeacherCard key={instructor.id} instructor={instructor} reverse={index % 2 === 1} />
        ))}
      </div>
    </section>
  );
}
