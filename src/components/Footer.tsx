"use client";

import Image from "next/image";
import Link from "next/link";

const socialLinks = [
  {
    href: "http://facebook.com/orsiyogapilates",
    label: "Facebook",
    icon: (
      <svg viewBox="0 0 24 24" className="h-6 w-6 fill-current md:h-7 md:w-7">
        <path d="M13.5 21v-8h2.7l.4-3h-3.1V8.1c0-.9.3-1.5 1.6-1.5h1.7V4c-.3 0-1.4-.1-2.6-.1-2.6 0-4.3 1.6-4.3 4.5V10H7v3h2.9v8h3.6z" />
      </svg>
    ),
  },
  {
    href: "https://www.instagram.com/onthematstudiobe/",
    label: "Instagram",
    icon: (
      <svg viewBox="0 0 24 24" className="h-6 w-6 fill-current md:h-7 md:w-7">
        <path d="M7.8 2h8.4A5.8 5.8 0 0 1 22 7.8v8.4a5.8 5.8 0 0 1-5.8 5.8H7.8A5.8 5.8 0 0 1 2 16.2V7.8A5.8 5.8 0 0 1 7.8 2zm0 1.9A3.9 3.9 0 0 0 3.9 7.8v8.4a3.9 3.9 0 0 0 3.9 3.9h8.4a3.9 3.9 0 0 0 3.9-3.9V7.8a3.9 3.9 0 0 0-3.9-3.9H7.8zm8.9 1.5a1.2 1.2 0 1 1 0 2.4 1.2 1.2 0 0 1 0-2.4zM12 7a5 5 0 1 1 0 10 5 5 0 0 1 0-10zm0 1.9a3.1 3.1 0 1 0 0 6.2 3.1 3.1 0 0 0 0-6.2z" />
      </svg>
    ),
  },
  {
    href: "https://www.youtube.com/c/OrsiYogaPilates?sub_confirmation=1",
    label: "YouTube",
    icon: (
      <svg viewBox="0 0 24 24" className="h-6 w-6 fill-current md:h-7 md:w-7">
        <path d="M23 12s0-3.2-.4-4.7a3 3 0 0 0-2.1-2.1C19 4.8 12 4.8 12 4.8s-7 0-8.5.4a3 3 0 0 0-2.1 2.1C1 8.8 1 12 1 12s0 3.2.4 4.7a3 3 0 0 0 2.1 2.1c1.5.4 8.5.4 8.5.4s7 0 8.5-.4a3 3 0 0 0 2.1-2.1c.4-1.5.4-4.7.4-4.7zM9.8 15.5v-7l6.2 3.5-6.2 3.5z" />
      </svg>
    ),
  },
] as const;

export default function Footer() {
  const handleBackToTop = () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <>
      <div className="bg-[#f2ede7] px-6 py-4">
        <div className="mx-auto flex max-w-6xl justify-center">
          <button
            type="button"
            onClick={handleBackToTop}
            className="flex flex-col items-center gap-1 text-[#8a2b33] transition hover:opacity-80"
            aria-label="Back to top"
          >
            <svg
              viewBox="0 0 24 24"
              className="h-5 w-5 md:h-6 md:w-6"
              aria-hidden="true"
              focusable="false"
            >
              <path
                d="M6 14l6-6 6 6"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span className="text-lg md:text-xl">Back to Top</span>
          </button>
        </div>
      </div>

      <footer className="bg-[#7a232b] px-6 py-10 text-white">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center gap-8 md:flex-row md:items-start md:justify-between">
          <div className="text-center md:text-left">
            <p className="text-lg font-medium text-[#f2ede7] md:text-2xl">On The Mat Studio ASBL</p>
            <Link
              href="/book-a-class"
              className="mt-2 inline-block text-base underline underline-offset-4 transition hover:opacity-80 md:text-lg"
            >
              Book a Class
            </Link>
          </div>

          <div className="text-center">
            <p className="mb-3 text-lg font-medium md:text-2xl">Follow us</p>
            <div className="flex items-center justify-center gap-4">
              {socialLinks.map((social) => (
                <a
                  key={social.label}
                  href={social.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={social.label}
                  className="transition hover:opacity-80"
                >
                  {social.icon}
                </a>
              ))}
            </div>
          </div>

          <Image
            src="/images/yoga-logo.png"
            alt="Yoga Alliance Trainer Pro badge"
            width={128}
            height={128}
            className="h-24 w-24 rounded-full border-4 border-black object-cover md:h-32 md:w-32"
          />
        </div>

        <p className="mt-10 text-center text-sm md:text-base">&copy; 2026 by On The Mat Studio ASBL</p>
      </footer>
    </>
  );
}
