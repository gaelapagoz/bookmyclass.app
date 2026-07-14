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
    title: "About Studio Aster",
    intro:
      "Studio Aster is a boutique movement studio offering yoga, Pilates and functional training in small groups. The timetable combines recurring group classes, private sessions and guided online practice.",
  },
  philosophy: [
    {
      title: "Small groups",
      body: "Group classes are kept intentionally small so teachers can give practical options and individual attention.",
    },
    {
      title: "Clear teaching",
      body: "Classes use straightforward sequencing, steady progressions and room for different experience levels.",
    },
    {
      title: "Booking first",
      body: "Clients book before attending so the studio can manage capacity, waitlists and teacher rosters accurately.",
    },
  ] as StudioSection[],
  classTypes: [
    "Vinyasa and Rocket Yoga classes with strength, balance and mobility work.",
    "Mat Pilates and Pilates & Stretching classes focused on control, posture and range of motion.",
    "Functional Training classes using bodyweight, dumbbells and kettlebells.",
    "Private Reformer sessions by appointment for individual goals and training needs.",
  ],
  images: [
    {
      src: "/uploads/classes/vinyasa-yoga.jpg",
      alt: "Studio Aster Vinyasa Yoga class",
    },
    {
      src: "/uploads/classes/mat-pilates.jpg",
      alt: "Studio Aster Mat Pilates class",
    },
    {
      src: "/uploads/classes/functional-strength.jpg",
      alt: "Studio Aster Functional Training class",
    },
  ],
} as const;

export const termsPageContent = {
  hero: {
    title: "Terms and Conditions",
    intro:
      `Sample terms for the ${siteConfig.brandName} demonstration studio. They describe how the demo booking, packs, membership, wallet and cancellation flows are presented.`,
  },
  sections: [
    {
      title: "Overview",
      body: [
        "Bookings are required before attending any group class or private session.",
        "These sample terms apply only to this demonstration environment and do not describe a real studio contract.",
      ],
    },
    {
      title: "Class packs and membership",
      body: [
        "Drop-in Class credits are valid for 30 days from purchase.",
        "5-Class Pack credits are valid for 90 days from purchase.",
        "10-Class Pack credits are valid for 180 days from purchase.",
        "Unlimited Monthly Membership renews monthly while the recurring subscription remains active.",
      ],
    },
    {
      title: "Private sessions",
      body: [
        "5 Private Sessions credits are valid for 180 days from purchase.",
        "10 Private Sessions credits are valid for 240 days from purchase.",
        "Private-session credits and group-class credits are not interchangeable unless a product explicitly grants both.",
      ],
    },
    {
      title: "Cancellations",
      body: [
        "Bookings may be cancelled up to 24 hours before the scheduled class start time.",
        "When cancellation happens before the cutoff, the used credit is restored where applicable.",
        "Late cancellations and missed sessions are treated as used.",
      ],
    },
    {
      title: "Waitlist",
      body: [
        "When a group class is full, eligible clients may join the waitlist.",
        "If a place opens, the system promotes waitlisted clients in order when eligibility still applies.",
      ],
    },
    {
      title: "Payments, passes and wallets",
      body: [
        "Passes are personal and non-transferable.",
        "Gift-card balance and studio credit are tracked separately from class credits.",
        "Classes, private sessions, gift cards and store products follow the product rules shown at checkout.",
      ],
    },
    {
      title: "Contact",
      body: [`For questions about this demonstration studio, contact ${siteConfig.contactEmail}.`],
    },
  ] as TermsSection[],
} as const;

export const faqPageContent = {
  hero: {
    title: "FAQ",
    intro: "Answers about booking, class packs, membership, waitlists and support.",
  },
  items: [
    {
      id: "book-class",
      question: "How do I book a class?",
      answer: "Choose a class from Book a Class, select an available session, then use an eligible pack, membership or checkout option.",
    },
    {
      id: "account-required",
      question: "Do I need an account?",
      answer: "Yes. Bookings, purchases, wallet balance and loyalty activity are connected to a verified client account.",
    },
    {
      id: "beginners",
      question: "Are classes suitable for beginners?",
      answer: "Many classes include options for different experience levels. Rocket Yoga is faster paced, so previous yoga experience is recommended.",
    },
    {
      id: "bring",
      question: "What should I bring?",
      answer: "Wear comfortable clothing and bring water. Any class-specific guidance appears on the booking page when available.",
    },
    {
      id: "languages",
      question: "Which languages are used in class?",
      answer: "The demo teacher profiles list English, French, Romanian and Dutch language support across the team.",
    },
    {
      id: "full-class",
      question: "What happens when a class is full?",
      answer: "Eligible clients can join the waitlist. If a place opens, the first eligible waitlisted client is promoted automatically.",
    },
    {
      id: "cancellation-period",
      question: "What is the cancellation period?",
      answer: "The configured cancellation cutoff is 24 hours before the class start time.",
    },
    {
      id: "packs",
      question: "How do class packs work?",
      answer: "Class packs grant credits for eligible group classes. The next booking uses the eligible pack that expires first.",
    },
    {
      id: "private-sessions",
      question: "How do private sessions work?",
      answer: "Private Reformer sessions use private-session credits and are arranged directly with the studio.",
    },
    {
      id: "contact",
      question: "How do I contact the studio?",
      answer: `Send questions to ${siteConfig.contactEmail}.`,
    },
  ] as FaqItem[],
} as const;
