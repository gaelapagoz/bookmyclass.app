import Image from "next/image";
import type { PublicInstructor } from "@/lib/public-content/team-service";

type TeacherCardProps = {
  instructor: PublicInstructor;
  reverse?: boolean;
};

export function TeacherCard({ instructor, reverse = false }: TeacherCardProps) {
  const imageUrl = instructor.imageUrl.trim();

  return (
    <article className="overflow-hidden rounded-3xl border border-[#e5d7cb] bg-[#fffdfa] shadow-[0_20px_40px_-30px_rgba(55,31,31,0.5)]">
      <div className={`grid md:grid-cols-2 ${reverse ? "md:[&>div:first-child]:order-2 md:[&>div:last-child]:order-1" : ""}`}>
        <div className="relative min-h-[280px] bg-[#f4eee8] md:min-h-[420px]">
          {imageUrl ? (
            <Image
              src={imageUrl}
              alt={`${instructor.name} portrait`}
              fill
              className="object-cover"
              sizes="(min-width: 768px) 50vw, 100vw"
            />
          ) : (
            <div className="flex h-full items-center justify-center px-6 text-sm text-[#8a5959]">
              Instructor photo coming soon
            </div>
          )}
        </div>
        <div className="flex flex-col justify-center px-6 py-8 md:px-10 md:py-12">
          <h2 className="text-3xl font-semibold tracking-tight text-[#6f2b2b]">{instructor.name}</h2>
          <p className="mt-5 max-w-2xl text-base leading-8 text-[#5f4040]">{instructor.bio}</p>
        </div>
      </div>
    </article>
  );
}
