import { siteConfig } from "@/lib/site-config";

export type StudioSection = {
  body: string;
  title: string;
};

export type FaqItem = {
  answer: string;
  id: string;
  question: string;
};

export type TermsSection = {
  body: string[];
  title: string;
};

export const studioPageContent = {
  hero: {
    title: "Our Studio",
    intro:
      `${siteConfig.brandName} is a welcoming space in Brussels where movement, breath, and consistency come together to support long-term wellbeing.`,
  },
  philosophy: [
    {
      title: "Movement with purpose",
      body: "We teach with clear progressions so each class helps you build strength, mobility, and better body awareness at your own pace.",
    },
    {
      title: "Wellbeing in practice",
      body: "Our sessions balance challenge and recovery. You leave class feeling energized, grounded, and better prepared for daily life.",
    },
    {
      title: "Community-first environment",
      body: "Small groups, attentive coaching, and respectful energy create a studio culture where beginners and experienced practitioners feel equally supported.",
    },
  ] as StudioSection[],
  classTypes: [
    "Collective Yoga classes focused on flow, alignment, and mindful breathing.",
    "Pilates sessions that strengthen your core, posture, and movement control.",
    "Functional training classes designed to improve strength, stability, and endurance.",
    "Private coaching sessions for personalized guidance and progression.",
  ],
  images: [
    {
      src: "/images/classes/vinyasa-yoga.jpg",
      alt: "Students practicing yoga in a bright studio room",
    },
    {
      src: "/images/classes/mat-pilates.jpg",
      alt: "Pilates class focused on core and posture",
    },
    {
      src: "/images/classes/functional-strength.jpg",
      alt: "Functional training group class in studio",
    },
  ],
} as const;

export const termsPageContent = {
  hero: {
    title: "Terms and Conditions",
    intro:
      `These terms explain how sessions, bookings, cancellations, and memberships are handled at ${siteConfig.brandName}.`,
  },
  sections: [
    {
      title: "Overview",
      body: [
        "By purchasing a class pass, private coaching package, gift card, or subscription, you agree to these terms for the duration of the service you selected.",
        "These terms apply to both studio and online sessions when relevant.",
      ],
    },
    {
      title: "Session validity",
      body: [
        "Collective class services are valid for 3 months from purchase.",
        "Private coaching services are valid for 6 months from purchase.",
        "Gift cards are valid for 3 months from purchase.",
      ],
    },
    {
      title: "Bookings and reservations",
      body: [
        "Bookings are required before attending a session.",
        "Each session is scheduled for the duration and location shown at the time of booking.",
      ],
    },
    {
      title: "Cancellations and rescheduling",
      body: [
        "You may cancel or reschedule up to 24 hours before the session start time.",
        "Changes requested with less than 24 hours notice are treated as late and the session is forfeited.",
      ],
    },
    {
      title: "No-shows",
      body: [
        "If you do not attend a booked session and did not cancel within the allowed notice period, the session is treated as used and cannot be recovered.",
      ],
    },
    {
      title: "Payments and refunds",
      body: [
        "All fees are due according to the selected ticket, pass, or subscription price.",
        "If you cancel attendance, paid amounts are not refunded.",
      ],
    },
    {
      title: "Subscriptions usage",
      body: [
        "Subscriptions and passes must be used for the category they were purchased for.",
        "Collective classes and private coaching are not interchangeable unless explicitly stated in the purchased offering.",
      ],
    },
    {
      title: "Non-transferability",
      body: [
        "Sessions, passes, and subscriptions are personal and cannot be resold, shared, or transferred to another person.",
      ],
    },
    {
      title: "Health and responsibility",
      body: [
        "Please inform the studio about relevant health changes before your session.",
        "If you are under medical care, confirm with your healthcare professional that participation is appropriate for you.",
      ],
    },
    {
      title: "Liability",
      body: [
        "The studio provides services with due care and skill.",
        "Liability is limited to what applies under mandatory law and, where permitted, to the amount paid for the relevant sessions.",
      ],
    },
    {
      title: "Contact",
      body: [
        `For support about bookings or terms, contact ${siteConfig.contactEmail}.`,
      ],
    },
  ] as TermsSection[],
} as const;

export const faqPageContent = {
  hero: {
    title: "FAQ",
    intro: "Find quick answers about access, bookings, passes, cancellations, and support.",
  },
  items: [
    {
      id: "reach-studio",
      question: "How do I reach the studio?",
      answer:
        "The studio is located near Merode in Brussels, on Avenue de Tervueren. You can reach the area by metro, tram, bus, bike, or on foot from the European quarter.",
    },
    {
      id: "doorbell",
      question: "Which doorbell should I use?",
      answer:
        `Use the doorbell labeled ${siteConfig.brandName} at the entrance. If you have trouble entering, contact support by email and we will help you quickly.`,
    },
    {
      id: "passes-coverage",
      question: "Which classes are included in class passes?",
      answer:
        "Collective class passes are valid for collective classes (Yoga, Pilates, and Fitness). Private coaching requires a private coaching offer, and categories are not interchangeable.",
    },
    {
      id: "pricing",
      question: "Where can I see prices?",
      answer:
        "Current prices are available on the Subscription page. Each option clearly shows what is included and the billing type.",
    },
    {
      id: "reserve-class",
      question: "How do I reserve a class?",
      answer:
        "Go to Book a Class, choose your class and time slot, then select either an existing eligible plan or buy the required option during checkout.",
    },
    {
      id: "agenda",
      question: "Where can I see the full schedule?",
      answer:
        "Use Book a Class to browse upcoming dates and time slots by class. Available spots are shown in real time for each session.",
    },
    {
      id: "reservation-required",
      question: "Is reservation mandatory?",
      answer: "Yes. Every class requires a reservation before attendance.",
    },
    {
      id: "support",
      question: "How can I contact support?",
      answer: `For help with bookings or payments, contact ${siteConfig.contactEmail}.`,
    },
    {
      id: "first-class-offer",
      question: "Is there a first-class offer?",
      answer:
        "If a first-timer offer is available, it appears directly in the purchasable options during checkout.",
    },
    {
      id: "intro-pass",
      question: "What is the Intro Pass?",
      answer:
        "The Intro Pass is a first-time customer offer when available. You can review eligibility and validity directly in the product details before purchasing.",
    },
    {
      id: "reserve-after-purchase",
      question: "After buying a pass, do I still need to reserve?",
      answer:
        "Yes. Purchasing gives you access, but each class still requires a reservation in Book a Class.",
    },
    {
      id: "pass-validity",
      question: "How long are passes valid?",
      answer:
        "Validity depends on the offer. Collective class services are valid for 3 months, private coaching for 6 months, and gift cards for 3 months.",
    },
    {
      id: "subscription-usage",
      question: "Can I use any subscription for any class category?",
      answer:
        "No. Subscriptions and passes are valid only for the category they were purchased for.",
    },
    {
      id: "no-show-policy",
      question: "What happens if I do not attend a booked class?",
      answer:
        "If you miss a booked class without cancelling in time, the session is forfeited.",
    },
    {
      id: "transfer-policy",
      question: "Can I transfer or resell my sessions?",
      answer:
        "No. Sessions, passes, and subscriptions are personal and cannot be transferred or resold.",
    },
    {
      id: "pass-differences",
      question: "What is the difference between pass types?",
      answer:
        "Passes differ by number of sessions, total price, and billing model. The product listing shows exactly what each option includes.",
    },
    {
      id: "attendance-history",
      question: "Can I see my attendance history?",
      answer:
        "Yes. Signed-in clients can review their booking history from the dashboard.",
    },
    {
      id: "class-language",
      question: "What language are classes taught in?",
      answer:
        "Classes are primarily taught in English, and teachers can support in French when needed depending on the group.",
    },
    {
      id: "cancellation-policy",
      question: "What is the cancellation policy?",
      answer:
        "You can cancel or reschedule up to 24 hours before class start time. Later changes are treated as late cancellations and the session is forfeited.",
    },
    {
      id: "refund-policy",
      question: "What is the refund policy?",
      answer:
        "Payments are non-refundable after purchase. Please review Terms and Conditions before completing checkout.",
    },
    {
      id: "rescheduling-policy",
      question: "How does rescheduling work?",
      answer:
        "You can reschedule up to 24 hours before the session start time. Later changes are treated as late cancellations and the session is forfeited.",
    },
  ] as FaqItem[],
} as const;
