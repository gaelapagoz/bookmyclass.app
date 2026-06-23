import { siteConfig } from "@/lib/site-config";

export type LoyaltyHowItWorksStep = {
  body: string;
  detail?: string;
  title: string;
};

export const loyaltyHowItWorksPageContent = {
  hero: {
    title: "Loyalty Points",
    imageSrc: "/images/loyalty-points-hero.jpg",
    imageAlt: "Studio client holding a gift box with loyalty points and reward icons around her",
  },
  steps: [
    {
      title: "1. Sign in to your studio account",
      body:
        "Your loyalty activity is tied to your client profile, so points visibility works best when you book and purchase while signed in with your verified account.",
    },
    {
      title: "2. Earn on eligible settled purchases",
      detail: "Buy eligible products",
      body:
        "Points are awarded after payment settles on approved one-time purchases. The live program uses spend-based earning, so unpaid or failed checkouts do not create points.",
    },
    {
      title: "3. Track points from your dashboard",
      detail: "Separate from gift cards",
      body:
        "You can already view your current points balance and recent loyalty activity from your dashboard and wallet pages. Redemption is not part of this first public rollout yet.",
    },
  ] as LoyaltyHowItWorksStep[],
  highlights: [
    "Loyalty points are separate from gift cards and wallet balances.",
    "Only eligible settled purchases count toward earning.",
    "Your recent loyalty activity appears in the client dashboard overview.",
  ],
  support: `Questions about loyalty visibility or your points history? Contact ${siteConfig.contactEmail}.`,
} as const;
