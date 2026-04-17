export type SlotUiState = "BOOKABLE" | "WAITLIST_JOINABLE" | "FULL_WAITLIST_UNAVAILABLE";

export type SlotUiStateInput = {
  isAvailable: boolean;
  isWaitlistAvailable: boolean;
  isWaitlistSupported: boolean;
};

export function getSlotUiState(input: SlotUiStateInput): SlotUiState {
  if (input.isAvailable) {
    return "BOOKABLE";
  }

  if (input.isWaitlistAvailable) {
    return "WAITLIST_JOINABLE";
  }

  return "FULL_WAITLIST_UNAVAILABLE";
}

export function getFullSlotMessage(input: Pick<SlotUiStateInput, "isWaitlistSupported">): string {
  if (input.isWaitlistSupported) {
    return "Session is full. Waitlist is currently full.";
  }

  return "Session is full. Waitlist is unavailable for this class.";
}
