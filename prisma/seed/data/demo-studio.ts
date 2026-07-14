import { ProductType, ServicePricingMode, EntitlementScope, Weekday } from "@prisma/client";

export const DEMO_STUDIO = {
  name: "Studio Aster",
  descriptor: "Yoga, Pilates & Functional Training",
  contactEmail: "hello@bookmyclass.app",
} as const;

export const DEMO_CLIENT_COUNT = 24;

export const DEMO_CLIENTS = [
  ["emma.desmet", "Emma", "De Smet", "+320470000001", "Added after a phone booking request."],
  ["laura.martin", "Laura", "Martin", "+320470000002", "Prefers communication in French."],
  ["camille.dubois", "Camille", "Dubois", "+320470000003", ""],
  ["sofia.janssens", "Sofia", "Janssens", "+320470000004", "Contacted after waitlist promotion."],
  ["marta.kovacs", "Marta", "Kovacs", "+320470000005", ""],
  ["daniel.garcia", "Daniel", "Garcia", "+320470000006", "Credit restored after an instructor cancellation."],
  ["charlotte.peeters", "Charlotte", "Peeters", "+320470000007", ""],
  ["alice.bernard", "Alice", "Bernard", "+320470000008", ""],
  ["nina.vermeulen", "Nina", "Vermeulen", "+320470000009", "Private-session schedule agreed directly with the studio."],
  ["sarah.laurent", "Sarah", "Laurent", "+320470000010", ""],
  ["thomas.janssen", "Thomas", "Janssen", "+320470000011", ""],
  ["clara.rossi", "Clara", "Rossi", "+320470000012", ""],
  ["noah.wilson", "Noah", "Wilson", "+320470000013", ""],
  ["amina.benali", "Amina", "Benali", "+320470000014", "Recently registered; intro email answered."],
  ["julien.moreau", "Julien", "Moreau", "+320470000015", ""],
  ["elise.nguyen", "Elise", "Nguyen", "+320470000016", ""],
  ["olivia.smith", "Olivia", "Smith", "+320470000017", ""],
  ["marie.leclerc", "Marie", "Leclerc", "+320470000018", "Declining recent attendance; check in after next missed booking."],
  ["victor.dumont", "Victor", "Dumont", "+320470000019", ""],
  ["ines.haddad", "Ines", "Haddad", "+320470000020", ""],
  ["luca.bianchi", "Luca", "Bianchi", "+320470000021", ""],
  ["yara.almeida", "Yara", "Almeida", "+320470000022", ""],
  ["samira.elhadi", "Samira", "El Hadi", "+320470000023", ""],
  ["eva.mertens", "Eva", "Mertens", "+320470000024", "Inactive client used for retention view."],
] as const;

export const DEMO_TEACHERS = {
  ana: {
    firstName: "Ana",
    lastName: "Ionescu",
    email: "ana@bookmyclass.app",
    phone: "+32000000001",
    bio: "Ana teaches Vinyasa and Rocket Yoga with clear sequencing and practical options for different experience levels. Her classes combine strength, balance, mobility and breath-led movement.",
    specialties: ["Vinyasa Yoga", "Rocket Yoga", "Mobility"],
    certifications: ["RYT-500", "Mobility training"],
  },
  elena: {
    firstName: "Elena",
    lastName: "Moreau",
    email: "elena@bookmyclass.app",
    phone: "+32000000003",
    bio: "Elena teaches Mat Pilates, stretching and private reformer sessions. Her classes focus on control, posture, core stability and gradual progression.",
    specialties: ["Mat Pilates", "Pilates & Stretching", "Private Reformer"],
    certifications: ["Comprehensive Pilates", "Reformer training"],
  },
  sofia: {
    firstName: "Sofia",
    lastName: "Van den Berg",
    email: "sofia@bookmyclass.app",
    phone: "+32000000004",
    bio: "Sofia teaches small-group functional training using bodyweight, dumbbells and kettlebells. Sessions are structured around strength, movement quality and manageable conditioning intervals.",
    specialties: ["Functional Training", "Strength and conditioning"],
    certifications: ["Certified personal trainer"],
  },
} as const;

export const DEMO_CLASS_CATALOGUE = [
  {
    slug: "vinyasa-yoga",
    categorySlug: "yoga",
    categoryName: "Yoga",
    name: "Vinyasa Yoga",
    description: "A flowing yoga class combining standing sequences, balance, strength and floor work. Options are provided for different experience levels.",
    durationMinutes: 60,
    capacity: 10,
    teacherKey: "ana",
    imageKey: "vinyasaYoga",
    pricingMode: ServicePricingMode.SINGLE_OR_PLAN,
    serviceScope: EntitlementScope.COLLECTIVE_CLASSES,
    productType: ProductType.CLASS_PACK,
  },
  {
    slug: "rocket-yoga",
    categorySlug: "yoga",
    categoryName: "Yoga",
    name: "Rocket Yoga",
    description: "A faster-paced sequence with repeated transitions, balance work and optional inversion preparation. Previous yoga experience is recommended.",
    durationMinutes: 60,
    capacity: 10,
    teacherKey: "ana",
    imageKey: "rocketYoga",
    pricingMode: ServicePricingMode.SINGLE_OR_PLAN,
    serviceScope: EntitlementScope.COLLECTIVE_CLASSES,
    productType: ProductType.CLASS_PACK,
  },
  {
    slug: "mat-pilates",
    categorySlug: "pilates",
    categoryName: "Pilates",
    name: "Mat Pilates",
    description: "A mat-based class focused on core control, posture, hip stability and coordinated movement.",
    durationMinutes: 55,
    capacity: 10,
    teacherKey: "elena",
    imageKey: "matPilates",
    pricingMode: ServicePricingMode.SINGLE_OR_PLAN,
    serviceScope: EntitlementScope.COLLECTIVE_CLASSES,
    productType: ProductType.CLASS_PACK,
  },
  {
    slug: "pilates-and-stretching",
    categorySlug: "pilates",
    categoryName: "Pilates",
    name: "Pilates & Stretching",
    description: "Controlled Pilates exercises followed by longer mobility and stretching work for the hips, spine and shoulders.",
    durationMinutes: 60,
    capacity: 10,
    teacherKey: "elena",
    imageKey: "reformerFoundations",
    pricingMode: ServicePricingMode.SINGLE_OR_PLAN,
    serviceScope: EntitlementScope.COLLECTIVE_CLASSES,
    productType: ProductType.CLASS_PACK,
  },
  {
    slug: "functional-training",
    categorySlug: "fitness",
    categoryName: "Fitness",
    name: "Functional Training",
    description: "Small-group strength and conditioning using bodyweight, dumbbells, kettlebells and simple movement circuits.",
    durationMinutes: 45,
    capacity: 8,
    teacherKey: "sofia",
    imageKey: "functionalStrength",
    pricingMode: ServicePricingMode.SINGLE_OR_PLAN,
    serviceScope: EntitlementScope.COLLECTIVE_CLASSES,
    productType: ProductType.CLASS_PACK,
  },
  {
    slug: "private-reformer",
    categorySlug: "private-sessions",
    categoryName: "Private sessions",
    name: "Private Reformer",
    description: "An individual reformer session adapted to the client's experience, movement goals and current training needs.",
    durationMinutes: 50,
    capacity: 1,
    teacherKey: "elena",
    imageKey: "privateReformerCoaching",
    pricingMode: ServicePricingMode.PLAN_ONLY,
    serviceScope: EntitlementScope.PRIVATE_CLASSES,
    productType: ProductType.PRIVATE_PACK,
  },
] as const;

export const DEMO_WEEKLY_SCHEDULE = [
  { dayOfWeek: Weekday.MONDAY, startTime: "18:00", endTime: "18:45", label: "Functional Training" },
  { dayOfWeek: Weekday.MONDAY, startTime: "19:00", endTime: "20:00", label: "Vinyasa Yoga" },
  { dayOfWeek: Weekday.TUESDAY, startTime: "18:00", endTime: "18:55", label: "Mat Pilates" },
  { dayOfWeek: Weekday.TUESDAY, startTime: "19:15", endTime: "20:15", label: "Vinyasa Yoga" },
  { dayOfWeek: Weekday.WEDNESDAY, startTime: "18:30", endTime: "19:30", label: "Pilates & Stretching" },
  { dayOfWeek: Weekday.THURSDAY, startTime: "18:00", endTime: "18:55", label: "Mat Pilates" },
  { dayOfWeek: Weekday.THURSDAY, startTime: "19:15", endTime: "20:15", label: "Pilates & Stretching" },
  { dayOfWeek: Weekday.SATURDAY, startTime: "09:30", endTime: "10:30", label: "Rocket Yoga" },
  { dayOfWeek: Weekday.SATURDAY, startTime: "11:00", endTime: "12:00", label: "Vinyasa Yoga" },
] as const;

export const DEMO_PRODUCTS = [
  { slug: "collective-drop-in", name: "Drop-in Class", description: "One credit for a single group class. Valid for 30 days from purchase.", validForDays: 30 },
  { slug: "collective-5-class-pack", name: "5-Class Pack", description: "Five credits for group classes. Valid for 90 days from purchase.", validForDays: 90 },
  { slug: "collective-10-class-pack", name: "10-Class Pack", description: "Ten credits for group classes. Valid for 180 days from purchase.", validForDays: 180 },
  { slug: "monthly-unlimited-collective", name: "Unlimited Monthly Membership", description: "Recurring monthly access to eligible group classes.", validForDays: undefined },
  { slug: "private-5-class-pack", name: "5 Private Sessions", description: "Five credits for private sessions. Valid for 180 days from purchase.", validForDays: 180 },
  { slug: "private-10-class-pack", name: "10 Private Sessions", description: "Ten credits for private sessions. Valid for 240 days from purchase.", validForDays: 240 },
] as const;

export const DEMO_LEARNING_PROGRAMS = [
  "Yoga Foundations",
  "Pilates Essentials",
  "Functional Strength Basics",
] as const;

export const DEMO_SHARED_VIDEO_URL = "https://player.vimeo.com/video/000000000";

export function assertDemoScheduleAgreement(): void {
  const visibleClasses = new Set(DEMO_CLASS_CATALOGUE.map((entry) => entry.name));
  const mismatches = DEMO_WEEKLY_SCHEDULE.filter((entry) => !visibleClasses.has(entry.label));
  if (mismatches.length > 0) {
    throw new Error(
      `Demo schedule contains labels without matching class catalogue entries: ${mismatches
        .map((entry) => `${entry.dayOfWeek} ${entry.startTime} ${entry.label}`)
        .join("; ")}`,
    );
  }
}
