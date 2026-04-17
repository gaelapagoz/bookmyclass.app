"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { addMonths, getStudioDateKey } from "../../../lib/public-catalogue/timezone";
import { AvailabilityCalendar } from "./AvailabilityCalendar";
import { SignInModal } from "./SignInModal";
import { SlotList } from "./SlotList";

type PublicServiceDetail = {
  classSummary: {
    duration: string;
    location: string;
    teacher: string;
    title: string;
  };
  description: string;
  id: string;
  imageUrl: string | null;
  shortDescription: string;
  slug: string;
  title: string;
};

type AvailabilityDay = {
  availableSlots: number;
  date: string;
  hasAvailability: boolean;
  totalSlots: number;
};

type AvailabilityResponse = {
  days: AvailabilityDay[];
  month: string;
  timezone: string | null;
};

type Slot = {
  availableSpots: number;
  capacity: number;
  date: string;
  endTime: string;
  id: string;
  isAvailable: boolean;
  isWaitlistAvailable: boolean;
  isWaitlistSupported: boolean;
  startTime: string;
  waitlistSpotsLeft: number;
};

type SlotsResponse = {
  date: string | null;
  slots: Slot[];
  timezone: string | null;
};

type NextAvailabilityResponse = {
  next: (Slot & { month: string }) | null;
  timezone: string | null;
};

type ServiceBookingExperienceProps = {
  isAuthenticated: boolean;
  initialAvailabilityDays: AvailabilityDay[];
  initialMonthKey: string;
  initialSelectedDate: string | null;
  initialSlots: Slot[];
  service: PublicServiceDetail;
};

export function ServiceBookingExperience({
  isAuthenticated,
  service,
  initialMonthKey,
  initialAvailabilityDays,
  initialSelectedDate,
  initialSlots,
}: ServiceBookingExperienceProps) {
  const router = useRouter();
  const [monthKey, setMonthKey] = useState(initialMonthKey);
  const [availabilityDays, setAvailabilityDays] = useState(initialAvailabilityDays);
  const [selectedDate, setSelectedDate] = useState<string | null>(initialSelectedDate);
  const [slots, setSlots] = useState(initialSlots);
  const [isCalendarLoading, setIsCalendarLoading] = useState(false);
  const [isSlotsLoading, setIsSlotsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [waitlistMessage, setWaitlistMessage] = useState<string | null>(null);
  const [joiningSlotId, setJoiningSlotId] = useState<string | null>(null);
  const [joinedWaitlistSlotIds, setJoinedWaitlistSlotIds] = useState<string[]>([]);
  const [signInTargetHref, setSignInTargetHref] = useState<string | null>(null);
  const todayDateKey = getStudioDateKey(new Date());

  const fetchMonthAvailability = async (nextMonthKey: string) => {
    setIsCalendarLoading(true);
    setErrorMessage(null);
    setWaitlistMessage(null);
    try {
      const response = await fetch(
        `/api/services/${encodeURIComponent(service.slug)}/availability?month=${nextMonthKey}`,
      );
      if (!response.ok) {
        throw new Error("Failed to fetch month availability.");
      }

      const payload = (await response.json()) as AvailabilityResponse;
      setMonthKey(payload.month);
      setAvailabilityDays(payload.days);

      const nextDefaultDate = payload.days.find((day) => day.hasAvailability)?.date ?? null;
      setSelectedDate(nextDefaultDate);
      if (nextDefaultDate) {
        await fetchSlots(nextDefaultDate);
      } else {
        setSlots([]);
      }
    } catch {
      setErrorMessage("Could not load this month. Please try again.");
    } finally {
      setIsCalendarLoading(false);
    }
  };

  const fetchSlots = async (date: string) => {
    setIsSlotsLoading(true);
    setErrorMessage(null);
    setWaitlistMessage(null);
    try {
      const response = await fetch(
        `/api/services/${encodeURIComponent(service.slug)}/slots?date=${encodeURIComponent(date)}`,
      );
      if (!response.ok) {
        throw new Error("Failed to fetch slots.");
      }

      const payload = (await response.json()) as SlotsResponse;
      setSlots(payload.slots);
    } catch {
      setErrorMessage("Could not load slots for the selected day.");
      setSlots([]);
    } finally {
      setIsSlotsLoading(false);
    }
  };

  const handleSelectDate = async (date: string) => {
    setSelectedDate(date);
    await fetchSlots(date);
  };

  const handleNextAvailability = async () => {
    const fromDate = selectedDate ?? todayDateKey;
    setIsSlotsLoading(true);
    setErrorMessage(null);
    setWaitlistMessage(null);
    try {
      const response = await fetch(
        `/api/services/${encodeURIComponent(service.slug)}/next-availability?from=${encodeURIComponent(fromDate)}`,
      );
      if (!response.ok) {
        throw new Error("Failed to find next availability.");
      }

      const payload = (await response.json()) as NextAvailabilityResponse;
      if (!payload.next) {
        setErrorMessage("No upcoming availability found for this service.");
        return;
      }

      if (payload.next.month !== monthKey) {
        await fetchMonthAvailability(payload.next.month);
      }

      setSelectedDate(payload.next.date);
      await fetchSlots(payload.next.date);
    } catch {
      setErrorMessage("Could not fetch next availability right now.");
    } finally {
      setIsSlotsLoading(false);
    }
  };

  const handleRequireSignIn = (targetHref: string) => {
    setSignInTargetHref(targetHref);
  };

  const handleJoinWaitlist = async (sessionId: string) => {
    if (joiningSlotId) {
      return;
    }

    setJoiningSlotId(sessionId);
    setErrorMessage(null);
    setWaitlistMessage(null);
    try {
      const response = await fetch("/api/waitlist/join", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ sessionId }),
      });
      const payload = (await response.json()) as {
        code?: string;
        error?: string;
      };

      if (response.ok) {
        setJoinedWaitlistSlotIds((previous) => (
          previous.includes(sessionId) ? previous : [...previous, sessionId]
        ));
        await fetchSlots(selectedDate ?? todayDateKey);
        setWaitlistMessage("You have been added to the waitlist.");
        return;
      }

      if (response.status === 401) {
        setWaitlistMessage("Please sign in to join the waitlist.");
        setSignInTargetHref(`/book-a-class/${service.slug}`);
        return;
      }

      if (payload.code === "ALREADY_WAITLISTED") {
        setJoinedWaitlistSlotIds((previous) => (
          previous.includes(sessionId) ? previous : [...previous, sessionId]
        ));
        await fetchSlots(selectedDate ?? todayDateKey);
        setWaitlistMessage("You are already on the waitlist for this session.");
        return;
      }

      if (
        payload.code === "WAITLIST_FULL"
        || payload.code === "SESSION_NOT_FULL"
        || payload.code === "SESSION_NOT_BOOKABLE"
        || payload.code === "WAITLIST_NOT_SUPPORTED"
      ) {
        await fetchSlots(selectedDate ?? todayDateKey);
        setWaitlistMessage(payload.error ?? "Waitlist is unavailable for this session.");
        return;
      }

      setErrorMessage(payload.error ?? "Could not join the waitlist. Please try again.");
    } catch {
      setErrorMessage("Could not join the waitlist. Please try again.");
    } finally {
      setJoiningSlotId(null);
    }
  };

  return (
    <section className="mx-auto w-full max-w-6xl px-6 py-12">
      <Link
        href="/book-a-class"
        className="text-sm font-medium text-[#7b2d2d] underline underline-offset-4 hover:opacity-80"
      >
        Back to classes
      </Link>

      <div className="mt-4 grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div>
          <h1 className="text-3xl font-semibold text-[#6f2b2b]">{service.title}</h1>
          <p className="mt-2 text-sm leading-6 text-[#5f4040]">{service.description}</p>
        </div>

        <aside className="rounded-xl border border-[#d8cec6] bg-[#f4eee8] p-4">
          <h2 className="text-lg font-semibold text-[#6f2b2b]">{service.classSummary.title}</h2>
          <p className="mt-2 text-sm text-[#5f4040]">Duration: {service.classSummary.duration}</p>
          <p className="mt-1 text-sm text-[#5f4040]">Teacher: {service.classSummary.teacher}</p>
          <p className="mt-1 text-sm text-[#5f4040]">Location: {service.classSummary.location}</p>
          <p className="mt-4 text-xs text-[#7f5a5a]">
            Choose a date and slot below. Booking form and checkout are connected in the next step.
          </p>
        </aside>
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-[1.15fr_1fr]">
        <div>
          {isCalendarLoading ? (
            <div className="h-[24rem] rounded-xl border border-[#d8cec6] bg-white p-4">
              <div className="h-full animate-pulse rounded-lg bg-[#f2ede7]" />
            </div>
          ) : (
            <AvailabilityCalendar
              monthKey={monthKey}
              days={availabilityDays}
              selectedDate={selectedDate}
              onSelectDate={handleSelectDate}
              onPreviousMonth={() => fetchMonthAvailability(addMonths(monthKey, -1))}
              onNextMonth={() => fetchMonthAvailability(addMonths(monthKey, 1))}
              todayDateKey={todayDateKey}
            />
          )}
        </div>

        <div>
          {isSlotsLoading ? (
            <div className="h-48 rounded-xl border border-[#d8cec6] bg-white p-4">
              <div className="h-full animate-pulse rounded-lg bg-[#f2ede7]" />
            </div>
          ) : (
            <SlotList
              isAuthenticated={isAuthenticated}
              joinedWaitlistSlotIds={joinedWaitlistSlotIds}
              joiningSlotId={joiningSlotId}
              onJoinWaitlist={handleJoinWaitlist}
              onRequireSignIn={handleRequireSignIn}
              serviceSlug={service.slug}
              selectedDate={selectedDate}
              slots={slots}
            />
          )}

          <button
            type="button"
            onClick={handleNextAvailability}
            className="mt-4 rounded-md border border-[#7b2d2d] px-4 py-2 text-sm font-medium text-[#7b2d2d] hover:bg-[#f2ede7]"
            aria-label="Check next available date"
          >
            Check Next Availability
          </button>
          {waitlistMessage ? <p className="mt-3 text-sm text-[#2f6b35]">{waitlistMessage}</p> : null}
          {errorMessage ? <p className="mt-3 text-sm text-[#7b2d2d]">{errorMessage}</p> : null}
        </div>
      </div>
      {signInTargetHref ? (
        <SignInModal
          targetHref={signInTargetHref}
          onClose={() => setSignInTargetHref(null)}
          onSuccess={(targetHref) => {
            setSignInTargetHref(null);
            router.push(targetHref);
            router.refresh();
          }}
        />
      ) : null}
    </section>
  );
}
