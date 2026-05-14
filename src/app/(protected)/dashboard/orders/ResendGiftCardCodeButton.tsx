"use client";

import { useState, useTransition } from "react";
import { resendGiftCardCodeAction } from "./actions";

export function ResendGiftCardCodeButton({ orderItemId }: { orderItemId: string }) {
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  function handleClick() {
    setMessage(null);
    startTransition(async () => {
      const result = await resendGiftCardCodeAction(orderItemId);
      setMessage({ text: result.message, ok: result.success });
    });
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        className="text-xs font-medium text-[#7b2d2d] underline underline-offset-2 hover:opacity-80 disabled:opacity-50"
        data-testid="resend-gift-card-code"
      >
        {isPending ? "Sending..." : "Resend code"}
      </button>
      {message ? (
        <span
          className={`text-xs ${message.ok ? "text-[#166534]" : "text-[#7b2d2d]"}`}
          data-testid="resend-gift-card-result"
        >
          {message.text}
        </span>
      ) : null}
    </span>
  );
}
