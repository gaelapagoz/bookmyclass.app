"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function getTokenFromHash(hashValue: string): string | null {
  const normalized = hashValue.startsWith("#") ? hashValue.slice(1) : hashValue;
  if (!normalized) {
    return null;
  }

  const hashParams = new URLSearchParams(normalized);
  const token = hashParams.get("token")?.trim();
  return token || null;
}

export function TokenFromHashBridge() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const existingToken = searchParams.get("token")?.trim();
    if (existingToken) {
      return;
    }

    const hashToken = getTokenFromHash(window.location.hash);
    if (!hashToken) {
      return;
    }

    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.set("token", hashToken);
    router.replace(`/reset-password?${nextParams.toString()}`);
  }, [router, searchParams]);

  return null;
}
