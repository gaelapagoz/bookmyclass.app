"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { SignInModal } from "@/components/book-a-class/service-detail/SignInModal";

type LearningVideoGateProps = {
  isAuthenticated: boolean;
  iframeUrl: string;
  targetHref: string;
  title: string;
};

export default function LearningVideoGate({
  isAuthenticated,
  iframeUrl,
  targetHref,
  title,
}: LearningVideoGateProps) {
  const router = useRouter();
  const [showSignInModal, setShowSignInModal] = useState(false);

  if (isAuthenticated) {
    return (
      <iframe
        src={iframeUrl}
        title={title}
        className="h-[320px] w-full md:h-[620px]"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
      />
    );
  }

  return (
    <>
      <div className="flex h-[320px] w-full flex-col items-center justify-center rounded-xl border border-[#d8cec6] bg-[#f4eee8] p-6 text-center md:h-[620px]">
        <h2 className="text-2xl font-semibold text-[#6f2b2b]">Sign in to watch this video</h2>
        <p className="mt-3 max-w-md text-sm text-[#7f5a5a] md:text-base">
          You can browse all programs and classes publicly. Video playback is
          available after authentication.
        </p>
        <button
          type="button"
          onClick={() => setShowSignInModal(true)}
          className="mt-5 rounded-md bg-[#7b2d2d] px-5 py-2.5 text-sm font-medium text-[#f8efea] transition-colors hover:bg-[#8b3434]"
        >
          Sign In To Watch
        </button>
      </div>

      {showSignInModal ? (
        <SignInModal
          targetHref={targetHref}
          onClose={() => setShowSignInModal(false)}
          onSuccess={(nextHref) => {
            setShowSignInModal(false);
            router.push(nextHref);
            router.refresh();
          }}
        />
      ) : null}
    </>
  );
}
