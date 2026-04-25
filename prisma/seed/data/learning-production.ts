/**
 * Production learning catalogue — 3 programs, 20+ courses each.
 * Video URL is always the canonical test URL.
 * Images use the three production course images (one per program topic).
 */

export const PROD_LEARNING_VIDEO_URL = "https://www.youtube.com/watch?v=ZdfJcN-yBIE";

// Canonical image paths — must match /images/learning/*.jpg pattern.
export const PROD_LEARNING_IMAGE_FITNESS = "/images/learning/course_1_fitness.jpg";
export const PROD_LEARNING_IMAGE_YOGA = "/images/learning/course_2_yoga.jpg";
export const PROD_LEARNING_IMAGE_PILATES = "/images/learning/course_3_pilates.jpg";

export type ProdLearningProgram = {
  legacyId: string;
  mainTitle: string;
  mainDescription: string;
  courseType: string;
  title: string;
  description1: string;
  description2: string;
  description3: string;
  videoPromo: string;
  picture1: string;
  picture2: string;
  picture3: string;
};

export type ProdLearningCourse = {
  legacyId: string;
  title: string;
  description: string;
  shortDescription: string;
  category: string;
  categoryType: string;
  categoryLevel: string;
  thumbnail: string;
  videoUrl: string;
  priority: number;
};

// ─────────────────────────────────────────────────────────────────────────────
// PROGRAM 1 — FITNESS
// ─────────────────────────────────────────────────────────────────────────────

export const FITNESS_PROGRAM: ProdLearningProgram = {
  legacyId: "prod-program-fitness",
  mainTitle: "Total Body Fitness",
  mainDescription:
    "A comprehensive fitness programme covering strength, conditioning, and functional movement. Suitable for all levels, from beginners building a foundation to advanced athletes refining performance.",
  courseType: "prod-fitness",
  title: "Total Body Fitness Programme",
  description1:
    "Build real-world strength through functional movement patterns, progressive overload principles, and evidence-based conditioning protocols designed for sustainable results.",
  description2:
    "Each session targets a distinct area — core stability, lower body power, upper body endurance, or total body circuits — so you always train with purpose and avoid plateaus.",
  description3:
    "Coached by studio instructors with years of experience in functional training, these classes are designed to be safe, effective, and adaptable to your fitness level.",
  videoPromo: PROD_LEARNING_VIDEO_URL,
  picture1: PROD_LEARNING_IMAGE_FITNESS,
  picture2: PROD_LEARNING_IMAGE_FITNESS,
  picture3: PROD_LEARNING_IMAGE_FITNESS,
};

export const FITNESS_COURSES: ProdLearningCourse[] = [
  {
    legacyId: "prod-fitness-001",
    title: "Introduction to Functional Fitness",
    description:
      "Discover the principles behind functional training and why movement quality matters more than weight lifted. This introductory session sets the foundation for the entire programme.",
    shortDescription: "Start your fitness journey with functional movement fundamentals.",
    category: "prod-fitness",
    categoryType: "Foundation",
    categoryLevel: "Beginner",
    thumbnail: PROD_LEARNING_IMAGE_FITNESS,
    videoUrl: PROD_LEARNING_VIDEO_URL,
    priority: 1,
  },
  {
    legacyId: "prod-fitness-002",
    title: "Core Strength Fundamentals",
    description:
      "A focused session on deep core activation, anti-rotation, and lumbar stability. Learn how a strong core transfers to every other movement pattern in the gym and in daily life.",
    shortDescription: "Build a resilient core foundation from the ground up.",
    category: "prod-fitness",
    categoryType: "Core",
    categoryLevel: "Beginner",
    thumbnail: PROD_LEARNING_IMAGE_FITNESS,
    videoUrl: PROD_LEARNING_VIDEO_URL,
    priority: 2,
  },
  {
    legacyId: "prod-fitness-003",
    title: "Lower Body Power Circuit",
    description:
      "Squats, lunges, hip hinges, and loaded carries combined into an efficient lower body circuit that targets the glutes, quads, hamstrings, and calves with progressive intensity.",
    shortDescription: "Strengthen your lower body with a structured power circuit.",
    category: "prod-fitness",
    categoryType: "Lower Body",
    categoryLevel: "Intermediate",
    thumbnail: PROD_LEARNING_IMAGE_FITNESS,
    videoUrl: PROD_LEARNING_VIDEO_URL,
    priority: 3,
  },
  {
    legacyId: "prod-fitness-004",
    title: "Upper Body Strength & Endurance",
    description:
      "Push, pull, and press patterns designed to develop balanced shoulder, chest, and back strength. Includes mobility warm-up and cool-down to protect the shoulder complex.",
    shortDescription: "Develop balanced upper body strength and pulling capacity.",
    category: "prod-fitness",
    categoryType: "Upper Body",
    categoryLevel: "Intermediate",
    thumbnail: PROD_LEARNING_IMAGE_FITNESS,
    videoUrl: PROD_LEARNING_VIDEO_URL,
    priority: 4,
  },
  {
    legacyId: "prod-fitness-005",
    title: "Total Body HIIT Circuit",
    description:
      "A high-intensity interval training session combining compound movements with short rest periods. Builds cardiovascular capacity while preserving lean muscle mass.",
    shortDescription: "Burn calories and build fitness with a full-body HIIT circuit.",
    category: "prod-fitness",
    categoryType: "Cardio",
    categoryLevel: "Intermediate",
    thumbnail: PROD_LEARNING_IMAGE_FITNESS,
    videoUrl: PROD_LEARNING_VIDEO_URL,
    priority: 5,
  },
  {
    legacyId: "prod-fitness-006",
    title: "Glute & Hip Strength",
    description:
      "Targeted session focusing on posterior chain development — hip thrusts, Romanian deadlifts, banded work, and single-leg exercises for athletic glute strength and stability.",
    shortDescription: "Build strong, functional glutes and hips with targeted exercises.",
    category: "prod-fitness",
    categoryType: "Lower Body",
    categoryLevel: "Intermediate",
    thumbnail: PROD_LEARNING_IMAGE_FITNESS,
    videoUrl: PROD_LEARNING_VIDEO_URL,
    priority: 6,
  },
  {
    legacyId: "prod-fitness-007",
    title: "Mobility & Flexibility Foundations",
    description:
      "Improve joint range of motion, reduce injury risk, and enhance movement quality with systematic mobility work drawn from dynamic stretching and controlled articular rotation principles.",
    shortDescription: "Unlock better movement with essential mobility work.",
    category: "prod-fitness",
    categoryType: "Mobility",
    categoryLevel: "Beginner",
    thumbnail: PROD_LEARNING_IMAGE_FITNESS,
    videoUrl: PROD_LEARNING_VIDEO_URL,
    priority: 7,
  },
  {
    legacyId: "prod-fitness-008",
    title: "Athletic Conditioning Blast",
    description:
      "Sports-inspired conditioning session using agility, plyometrics, and strength combos. Designed to elevate athletic performance and challenge your aerobic and anaerobic systems.",
    shortDescription: "Train like an athlete with this conditioning-focused class.",
    category: "prod-fitness",
    categoryType: "Cardio",
    categoryLevel: "Advanced",
    thumbnail: PROD_LEARNING_IMAGE_FITNESS,
    videoUrl: PROD_LEARNING_VIDEO_URL,
    priority: 8,
  },
  {
    legacyId: "prod-fitness-009",
    title: "Core & Abs Deep Work",
    description:
      "Thirty minutes of targeted abdominal and spinal erector training. Moves beyond crunches to include planks, rollouts, Pallof presses, and loaded carries for functional core strength.",
    shortDescription: "Challenge your core with functional, deep abdominal work.",
    category: "prod-fitness",
    categoryType: "Core",
    categoryLevel: "Intermediate",
    thumbnail: PROD_LEARNING_IMAGE_FITNESS,
    videoUrl: PROD_LEARNING_VIDEO_URL,
    priority: 9,
  },
  {
    legacyId: "prod-fitness-010",
    title: "Bodyweight Strength Fundamentals",
    description:
      "No equipment needed. Master push-ups, dips, inverted rows, pistol progressions, and hollow body holds to build genuine strength using only your body weight.",
    shortDescription: "Build functional strength with zero equipment.",
    category: "prod-fitness",
    categoryType: "Foundation",
    categoryLevel: "Beginner",
    thumbnail: PROD_LEARNING_IMAGE_FITNESS,
    videoUrl: PROD_LEARNING_VIDEO_URL,
    priority: 10,
  },
  {
    legacyId: "prod-fitness-011",
    title: "Progressive Overload Principles",
    description:
      "Understand how to systematically increase training stimulus over time to ensure continuous progress. Covers volume, intensity, frequency, and deload strategies.",
    shortDescription: "Learn how to keep making progress with progressive overload.",
    category: "prod-fitness",
    categoryType: "Foundation",
    categoryLevel: "Beginner",
    thumbnail: PROD_LEARNING_IMAGE_FITNESS,
    videoUrl: PROD_LEARNING_VIDEO_URL,
    priority: 11,
  },
  {
    legacyId: "prod-fitness-012",
    title: "Posterior Chain Power Session",
    description:
      "Deadlift variations, good mornings, back extensions, and Nordic curls to develop the hamstrings, glutes, and lower back for injury resilience and explosive power.",
    shortDescription: "Target your posterior chain for strength and protection.",
    category: "prod-fitness",
    categoryType: "Lower Body",
    categoryLevel: "Advanced",
    thumbnail: PROD_LEARNING_IMAGE_FITNESS,
    videoUrl: PROD_LEARNING_VIDEO_URL,
    priority: 12,
  },
  {
    legacyId: "prod-fitness-013",
    title: "Shoulder Health & Stability",
    description:
      "A prehabilitation-focused session for the shoulder complex. Band pull-aparts, face pulls, external rotation drills, and scapular control exercises to prevent common injuries.",
    shortDescription: "Protect and strengthen your shoulders with targeted stability work.",
    category: "prod-fitness",
    categoryType: "Upper Body",
    categoryLevel: "Beginner",
    thumbnail: PROD_LEARNING_IMAGE_FITNESS,
    videoUrl: PROD_LEARNING_VIDEO_URL,
    priority: 13,
  },
  {
    legacyId: "prod-fitness-014",
    title: "Full Body Strength Circuit",
    description:
      "A supersets-based full body session pairing antagonist muscle groups for time efficiency. Combines pushing, pulling, and hinging in a flowing, low-rest format.",
    shortDescription: "Maximize your workout efficiency with a full body circuit.",
    category: "prod-fitness",
    categoryType: "Foundation",
    categoryLevel: "Intermediate",
    thumbnail: PROD_LEARNING_IMAGE_FITNESS,
    videoUrl: PROD_LEARNING_VIDEO_URL,
    priority: 14,
  },
  {
    legacyId: "prod-fitness-015",
    title: "Plyometric Power Development",
    description:
      "Jump squats, box jumps, explosive lunges, and bounding drills designed to develop fast-twitch muscle fibres and improve ground contact time for sport and fitness.",
    shortDescription: "Develop explosive power with plyometric training.",
    category: "prod-fitness",
    categoryType: "Cardio",
    categoryLevel: "Advanced",
    thumbnail: PROD_LEARNING_IMAGE_FITNESS,
    videoUrl: PROD_LEARNING_VIDEO_URL,
    priority: 15,
  },
  {
    legacyId: "prod-fitness-016",
    title: "Recovery & Active Restoration",
    description:
      "Strategic recovery session combining light movement, breathing techniques, foam rolling, and targeted stretching to accelerate muscle repair between hard training sessions.",
    shortDescription: "Restore your body and prepare for your next session.",
    category: "prod-fitness",
    categoryType: "Mobility",
    categoryLevel: "Beginner",
    thumbnail: PROD_LEARNING_IMAGE_FITNESS,
    videoUrl: PROD_LEARNING_VIDEO_URL,
    priority: 16,
  },
  {
    legacyId: "prod-fitness-017",
    title: "Unilateral Strength Training",
    description:
      "Single-leg and single-arm movements to correct muscular imbalances, improve proprioception, and transfer strength gains into real-world movement patterns.",
    shortDescription: "Balance and strengthen your body with unilateral training.",
    category: "prod-fitness",
    categoryType: "Foundation",
    categoryLevel: "Intermediate",
    thumbnail: PROD_LEARNING_IMAGE_FITNESS,
    videoUrl: PROD_LEARNING_VIDEO_URL,
    priority: 17,
  },
  {
    legacyId: "prod-fitness-018",
    title: "Metabolic Conditioning Intervals",
    description:
      "Work-to-rest ratio training combining strength moves with aerobic bursts. Increases metabolic rate, builds mental resilience, and improves body composition over time.",
    shortDescription: "Boost your metabolism with structured interval training.",
    category: "prod-fitness",
    categoryType: "Cardio",
    categoryLevel: "Intermediate",
    thumbnail: PROD_LEARNING_IMAGE_FITNESS,
    videoUrl: PROD_LEARNING_VIDEO_URL,
    priority: 18,
  },
  {
    legacyId: "prod-fitness-019",
    title: "Anti-Rotation Core Mastery",
    description:
      "Advanced core session focused on resisting unwanted rotation under load — Pallof presses, suitcase carries, Copenhagen planks, and landmine exercises for elite core control.",
    shortDescription: "Master anti-rotation strength for a bulletproof core.",
    category: "prod-fitness",
    categoryType: "Core",
    categoryLevel: "Advanced",
    thumbnail: PROD_LEARNING_IMAGE_FITNESS,
    videoUrl: PROD_LEARNING_VIDEO_URL,
    priority: 19,
  },
  {
    legacyId: "prod-fitness-020",
    title: "Strength & Cardio Fusion Finisher",
    description:
      "The ultimate programme finisher: a 30-minute full body session blending maximal strength moves with cardio bursts, designed to test your conditioning and leave you at your best.",
    shortDescription: "Finish strong with this ultimate strength and cardio fusion.",
    category: "prod-fitness",
    categoryType: "Foundation",
    categoryLevel: "Advanced",
    thumbnail: PROD_LEARNING_IMAGE_FITNESS,
    videoUrl: PROD_LEARNING_VIDEO_URL,
    priority: 20,
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// PROGRAM 2 — YOGA
// ─────────────────────────────────────────────────────────────────────────────

export const YOGA_PROGRAM: ProdLearningProgram = {
  legacyId: "prod-program-yoga",
  mainTitle: "Complete Yoga Practice",
  mainDescription:
    "A full yoga curriculum from foundational poses to advanced sequencing. Explore breath, alignment, and mindful movement across vinyasa, hatha, and restorative styles.",
  courseType: "prod-yoga",
  title: "Complete Yoga Practice Programme",
  description1:
    "Whether you are stepping onto the mat for the first time or deepening an existing practice, this programme offers a structured path through the essential elements of yoga.",
  description2:
    "Sessions cover sun salutations, standing balances, backbends, inversions, and restorative postures — each taught with clear alignment cues and accessible modifications.",
  description3:
    "Practise with intention. Every class connects breath to movement, cultivating not just physical flexibility but mental clarity, body awareness, and lasting wellbeing.",
  videoPromo: PROD_LEARNING_VIDEO_URL,
  picture1: PROD_LEARNING_IMAGE_YOGA,
  picture2: PROD_LEARNING_IMAGE_YOGA,
  picture3: PROD_LEARNING_IMAGE_YOGA,
};

export const YOGA_COURSES: ProdLearningCourse[] = [
  {
    legacyId: "prod-yoga-001",
    title: "Yoga for Absolute Beginners",
    description:
      "A gentle introduction to the mat. Learn how to breathe, find mountain pose, and move through your first sun salutation with confidence and comfort.",
    shortDescription: "Your very first step onto the yoga mat — calm, clear, and welcoming.",
    category: "prod-yoga",
    categoryType: "Foundation",
    categoryLevel: "Beginner",
    thumbnail: PROD_LEARNING_IMAGE_YOGA,
    videoUrl: PROD_LEARNING_VIDEO_URL,
    priority: 1,
  },
  {
    legacyId: "prod-yoga-002",
    title: "Sun Salutation Mastery",
    description:
      "Break down Surya Namaskar A and B with precision. Understand each transition, the role of breath, and how to flow without strain. Perfect as a daily morning practice.",
    shortDescription: "Master the sun salutation to ignite your daily yoga practice.",
    category: "prod-yoga",
    categoryType: "Vinyasa",
    categoryLevel: "Beginner",
    thumbnail: PROD_LEARNING_IMAGE_YOGA,
    videoUrl: PROD_LEARNING_VIDEO_URL,
    priority: 2,
  },
  {
    legacyId: "prod-yoga-003",
    title: "Standing Balances & Hip Opening",
    description:
      "Warrior sequences, triangle, half-moon, and tree pose explored with alignment focus and balance progressions. Build strength, stability, and awareness in the lower body.",
    shortDescription: "Ground your practice with standing poses and hip-opening sequences.",
    category: "prod-yoga",
    categoryType: "Hatha",
    categoryLevel: "Beginner",
    thumbnail: PROD_LEARNING_IMAGE_YOGA,
    videoUrl: PROD_LEARNING_VIDEO_URL,
    priority: 3,
  },
  {
    legacyId: "prod-yoga-004",
    title: "Vinyasa Flow Level 1",
    description:
      "A dynamic breath-led class connecting postures in a continuous flow. Builds strength, flexibility, and coordination while keeping the nervous system calm and the mind present.",
    shortDescription: "Find your flow in this accessible, breath-driven vinyasa class.",
    category: "prod-yoga",
    categoryType: "Vinyasa",
    categoryLevel: "Beginner",
    thumbnail: PROD_LEARNING_IMAGE_YOGA,
    videoUrl: PROD_LEARNING_VIDEO_URL,
    priority: 4,
  },
  {
    legacyId: "prod-yoga-005",
    title: "Backbend Fundamentals",
    description:
      "Cobra, upward-facing dog, bridge, camel, and wheel explored with careful preparation and counter-poses. Learn to open the thoracic spine without compressing the lumbar.",
    shortDescription: "Open your heart and spine with safe, progressive backbends.",
    category: "prod-yoga",
    categoryType: "Hatha",
    categoryLevel: "Intermediate",
    thumbnail: PROD_LEARNING_IMAGE_YOGA,
    videoUrl: PROD_LEARNING_VIDEO_URL,
    priority: 5,
  },
  {
    legacyId: "prod-yoga-006",
    title: "Forward Folds & Hamstring Release",
    description:
      "Seated and standing forward folds to lengthen the hamstrings, decompress the spine, and calm the nervous system. Includes yin-inspired holds for deeper release.",
    shortDescription: "Release tension and lengthen the posterior body with forward folds.",
    category: "prod-yoga",
    categoryType: "Hatha",
    categoryLevel: "Beginner",
    thumbnail: PROD_LEARNING_IMAGE_YOGA,
    videoUrl: PROD_LEARNING_VIDEO_URL,
    priority: 6,
  },
  {
    legacyId: "prod-yoga-007",
    title: "Core Strength Yoga",
    description:
      "Navasana, plank variations, forearm balance prep, and dynamic core sequences woven into a yoga flow that builds functional abdominal and spinal strength.",
    shortDescription: "Strengthen your centre through a yoga lens.",
    category: "prod-yoga",
    categoryType: "Vinyasa",
    categoryLevel: "Intermediate",
    thumbnail: PROD_LEARNING_IMAGE_YOGA,
    videoUrl: PROD_LEARNING_VIDEO_URL,
    priority: 7,
  },
  {
    legacyId: "prod-yoga-008",
    title: "Twist & Detox Flow",
    description:
      "Revolved triangle, seated twists, and supine spinal rotations to wring out the abdominal organs, release back tension, and stimulate digestive flow.",
    shortDescription: "Detoxify and restore with a deep twisting yoga sequence.",
    category: "prod-yoga",
    categoryType: "Hatha",
    categoryLevel: "Intermediate",
    thumbnail: PROD_LEARNING_IMAGE_YOGA,
    videoUrl: PROD_LEARNING_VIDEO_URL,
    priority: 8,
  },
  {
    legacyId: "prod-yoga-009",
    title: "Inversion Introduction",
    description:
      "Shoulder stand, headstand against the wall, and legs-up-the-wall explored safely. Inversions build upper body strength, improve circulation, and shift perspective.",
    shortDescription: "Take your practice upside down with safe inversion techniques.",
    category: "prod-yoga",
    categoryType: "Vinyasa",
    categoryLevel: "Intermediate",
    thumbnail: PROD_LEARNING_IMAGE_YOGA,
    videoUrl: PROD_LEARNING_VIDEO_URL,
    priority: 9,
  },
  {
    legacyId: "prod-yoga-010",
    title: "Restorative Yoga for Recovery",
    description:
      "Fully supported poses held for 5–8 minutes each to activate the parasympathetic nervous system. The antidote to stress, over-training, and chronic tension.",
    shortDescription: "Rest deeply and recover completely with restorative yoga.",
    category: "prod-yoga",
    categoryType: "Restorative",
    categoryLevel: "Beginner",
    thumbnail: PROD_LEARNING_IMAGE_YOGA,
    videoUrl: PROD_LEARNING_VIDEO_URL,
    priority: 10,
  },
  {
    legacyId: "prod-yoga-011",
    title: "Rocket Yoga Level 1 Introduction",
    description:
      "Your entry point into the Rocket Yoga system — an energetic series derived from Ashtanga that opens the body faster and invites creative expression within a structured format.",
    shortDescription: "Begin the Rocket series with this dynamic and energising introduction.",
    category: "prod-yoga",
    categoryType: "Rocket",
    categoryLevel: "Intermediate",
    thumbnail: PROD_LEARNING_IMAGE_YOGA,
    videoUrl: PROD_LEARNING_VIDEO_URL,
    priority: 11,
  },
  {
    legacyId: "prod-yoga-012",
    title: "Hip Flexor & Psoas Release",
    description:
      "Low lunge variations, lizard, pigeon, and targeted psoas stretches to counteract prolonged sitting, improve gait, and release deep-seated emotional tension held in the hips.",
    shortDescription: "Free your hips and unlock deeper movement with this targeted class.",
    category: "prod-yoga",
    categoryType: "Hatha",
    categoryLevel: "Beginner",
    thumbnail: PROD_LEARNING_IMAGE_YOGA,
    videoUrl: PROD_LEARNING_VIDEO_URL,
    priority: 12,
  },
  {
    legacyId: "prod-yoga-013",
    title: "Breath & Pranayama Essentials",
    description:
      "Ujjayi, Nadi Shodhana, Kapalabhati, and Bhramari breathing techniques explained and practised. Breath is the anchor of every yoga session — learn to use it consciously.",
    shortDescription: "Harness the power of breath to transform your practice.",
    category: "prod-yoga",
    categoryType: "Foundation",
    categoryLevel: "Beginner",
    thumbnail: PROD_LEARNING_IMAGE_YOGA,
    videoUrl: PROD_LEARNING_VIDEO_URL,
    priority: 13,
  },
  {
    legacyId: "prod-yoga-014",
    title: "Power Vinyasa Advanced Flow",
    description:
      "A challenging, continuous flow for experienced practitioners. Arm balances, peak poses, deep backbends, and advanced transitions in a high-energy 30-minute format.",
    shortDescription: "Push your practice to new heights with this advanced vinyasa flow.",
    category: "prod-yoga",
    categoryType: "Vinyasa",
    categoryLevel: "Advanced",
    thumbnail: PROD_LEARNING_IMAGE_YOGA,
    videoUrl: PROD_LEARNING_VIDEO_URL,
    priority: 14,
  },
  {
    legacyId: "prod-yoga-015",
    title: "Arm Balance Foundations",
    description:
      "Crow pose, side crow, and firefly introduced with preparatory drills. Learn to shift your weight, engage the right muscles, and find lightness in challenging arm balances.",
    shortDescription: "Take flight with these foundational arm balance techniques.",
    category: "prod-yoga",
    categoryType: "Vinyasa",
    categoryLevel: "Advanced",
    thumbnail: PROD_LEARNING_IMAGE_YOGA,
    videoUrl: PROD_LEARNING_VIDEO_URL,
    priority: 15,
  },
  {
    legacyId: "prod-yoga-016",
    title: "Yin Yoga: Lower Body Focus",
    description:
      "Long-held poses targeting the hips, thighs, and lower spine. Yin yoga stimulates the connective tissue and meridians, offering a profoundly different experience from active styles.",
    shortDescription: "Go deep into the lower body with a calming yin yoga session.",
    category: "prod-yoga",
    categoryType: "Restorative",
    categoryLevel: "Beginner",
    thumbnail: PROD_LEARNING_IMAGE_YOGA,
    videoUrl: PROD_LEARNING_VIDEO_URL,
    priority: 16,
  },
  {
    legacyId: "prod-yoga-017",
    title: "Morning Energiser Flow",
    description:
      "A 30-minute sunrise sequence to awaken the body and set a positive tone for the day. Dynamic sun salutations, standing poses, and a brief seated meditation.",
    shortDescription: "Start every morning with energy and intention.",
    category: "prod-yoga",
    categoryType: "Vinyasa",
    categoryLevel: "Beginner",
    thumbnail: PROD_LEARNING_IMAGE_YOGA,
    videoUrl: PROD_LEARNING_VIDEO_URL,
    priority: 17,
  },
  {
    legacyId: "prod-yoga-018",
    title: "Evening Wind-Down Yoga",
    description:
      "A gentle evening practice to release the stress of the day. Slow hip openers, supported forward folds, legs-up-the-wall, and a guided yoga nidra relaxation to prepare for sleep.",
    shortDescription: "Unwind completely before bed with this calming evening practice.",
    category: "prod-yoga",
    categoryType: "Restorative",
    categoryLevel: "Beginner",
    thumbnail: PROD_LEARNING_IMAGE_YOGA,
    videoUrl: PROD_LEARNING_VIDEO_URL,
    priority: 18,
  },
  {
    legacyId: "prod-yoga-019",
    title: "Shoulder & Upper Back Opening",
    description:
      "Targeted sequences for the thoracic spine, shoulders, and neck. Thread the needle, puppy pose, gomukhasana arms, and garudasana to relieve chronic upper body tension.",
    shortDescription: "Release shoulder and upper back tightness with this focused flow.",
    category: "prod-yoga",
    categoryType: "Hatha",
    categoryLevel: "Beginner",
    thumbnail: PROD_LEARNING_IMAGE_YOGA,
    videoUrl: PROD_LEARNING_VIDEO_URL,
    priority: 19,
  },
  {
    legacyId: "prod-yoga-020",
    title: "Full Spectrum Yoga: Complete Practice",
    description:
      "A 30-minute all-encompassing class touching standing poses, twists, backbends, inversions, forward folds, and savasana. The ideal single-session summary of the full programme.",
    shortDescription: "Experience a complete yoga practice in one cohesive session.",
    category: "prod-yoga",
    categoryType: "Foundation",
    categoryLevel: "Intermediate",
    thumbnail: PROD_LEARNING_IMAGE_YOGA,
    videoUrl: PROD_LEARNING_VIDEO_URL,
    priority: 20,
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// PROGRAM 3 — PILATES
// ─────────────────────────────────────────────────────────────────────────────

export const PILATES_PROGRAM: ProdLearningProgram = {
  legacyId: "prod-program-pilates",
  mainTitle: "Classical Pilates Method",
  mainDescription:
    "A structured pilates curriculum grounded in the classical method. Develop core strength, postural alignment, and graceful movement from mat fundamentals to advanced sequences.",
  courseType: "prod-pilates",
  title: "Classical Pilates Method Programme",
  description1:
    "Pilates is a precise practice. Each exercise is taught with deliberate attention to breath, neutral spine, and scapular stability — the non-negotiable foundations of the method.",
  description2:
    "Progress through beginner mat work, props integration, and advanced classical exercises at a pace that respects your body. Every session has a clear purpose and measurable outcomes.",
  description3:
    "Taught by certified instructors trained in the classical lineage, these classes will transform your posture, strengthen your deep stabilisers, and elevate how you move in everyday life.",
  videoPromo: PROD_LEARNING_VIDEO_URL,
  picture1: PROD_LEARNING_IMAGE_PILATES,
  picture2: PROD_LEARNING_IMAGE_PILATES,
  picture3: PROD_LEARNING_IMAGE_PILATES,
};

export const PILATES_COURSES: ProdLearningCourse[] = [
  {
    legacyId: "prod-pilates-001",
    title: "Pilates Fundamentals: The Five Principles",
    description:
      "Learn the five core principles of pilates — concentration, control, centring, precision, and breath. This foundational session sets the language and intention for all future classes.",
    shortDescription: "Master the five principles that underpin every pilates exercise.",
    category: "prod-pilates",
    categoryType: "Foundation",
    categoryLevel: "Beginner",
    thumbnail: PROD_LEARNING_IMAGE_PILATES,
    videoUrl: PROD_LEARNING_VIDEO_URL,
    priority: 1,
  },
  {
    legacyId: "prod-pilates-002",
    title: "Neutral Spine & Imprint Position",
    description:
      "Understand the difference between neutral spine and imprint, when to use each, and why it matters for protecting your lumbar spine during every exercise in the programme.",
    shortDescription: "Find your spine's safe zone with this essential positioning class.",
    category: "prod-pilates",
    categoryType: "Foundation",
    categoryLevel: "Beginner",
    thumbnail: PROD_LEARNING_IMAGE_PILATES,
    videoUrl: PROD_LEARNING_VIDEO_URL,
    priority: 2,
  },
  {
    legacyId: "prod-pilates-003",
    title: "Scapular Stabilisation Essentials",
    description:
      "Serratus anterior activation, shoulder blade setting, and upper arm bone placement. Correct scapular mechanics prevent neck tension and improve every exercise from the waist up.",
    shortDescription: "Build strong, stable shoulders from the inside out.",
    category: "prod-pilates",
    categoryType: "Foundation",
    categoryLevel: "Beginner",
    thumbnail: PROD_LEARNING_IMAGE_PILATES,
    videoUrl: PROD_LEARNING_VIDEO_URL,
    priority: 3,
  },
  {
    legacyId: "prod-pilates-004",
    title: "Breathing Principles in Pilates",
    description:
      "Lateral thoracic breathing, the exhale-on-effort rule, and how breath coordinates with movement to protect the pelvic floor and deep abdominals during all pilates exercises.",
    shortDescription: "Breathe correctly and unlock the full potential of every movement.",
    category: "prod-pilates",
    categoryType: "Foundation",
    categoryLevel: "Beginner",
    thumbnail: PROD_LEARNING_IMAGE_PILATES,
    videoUrl: PROD_LEARNING_VIDEO_URL,
    priority: 4,
  },
  {
    legacyId: "prod-pilates-005",
    title: "The Classical Hundred",
    description:
      "Joseph Pilates' signature exercise taught in full detail — preparation phases, breathing rhythm, leg positions, and common corrections. A benchmark of abdominal endurance.",
    shortDescription: "Conquer the hundred with perfect form and endurance.",
    category: "prod-pilates",
    categoryType: "Mat",
    categoryLevel: "Beginner",
    thumbnail: PROD_LEARNING_IMAGE_PILATES,
    videoUrl: PROD_LEARNING_VIDEO_URL,
    priority: 5,
  },
  {
    legacyId: "prod-pilates-006",
    title: "Roll Up, Roll Down & Spinal Articulation",
    description:
      "Sequential spinal flexion and extension through rolling exercises that massage the vertebrae, lengthen the hamstrings, and build deep abdominal control.",
    shortDescription: "Articulate your spine and build core control with rolling work.",
    category: "prod-pilates",
    categoryType: "Mat",
    categoryLevel: "Beginner",
    thumbnail: PROD_LEARNING_IMAGE_PILATES,
    videoUrl: PROD_LEARNING_VIDEO_URL,
    priority: 6,
  },
  {
    legacyId: "prod-pilates-007",
    title: "Single Leg Circles & Hip Mobility",
    description:
      "Explore the classical single and double leg circle exercises with variations for beginners and intermediates. Improves hip joint mobility, pelvic stability, and body awareness.",
    shortDescription: "Free your hips and develop pelvic stability with leg circle sequences.",
    category: "prod-pilates",
    categoryType: "Mat",
    categoryLevel: "Beginner",
    thumbnail: PROD_LEARNING_IMAGE_PILATES,
    videoUrl: PROD_LEARNING_VIDEO_URL,
    priority: 7,
  },
  {
    legacyId: "prod-pilates-008",
    title: "Rolling Like a Ball & Spinal Massage",
    description:
      "The playful and therapeutic rolling series — rolling like a ball, open leg rocker, and seal — for spinal decompression, balance, and deep core activation.",
    shortDescription: "Roll your way to a healthy spine and better balance.",
    category: "prod-pilates",
    categoryType: "Mat",
    categoryLevel: "Intermediate",
    thumbnail: PROD_LEARNING_IMAGE_PILATES,
    videoUrl: PROD_LEARNING_VIDEO_URL,
    priority: 8,
  },
  {
    legacyId: "prod-pilates-009",
    title: "Series of Five: Core Endurance",
    description:
      "Single leg stretch, double leg stretch, scissors, lower lift, and criss-cross — the five classical exercises that form pilates' core endurance sequence.",
    shortDescription: "Build core endurance with the classical series of five.",
    category: "prod-pilates",
    categoryType: "Mat",
    categoryLevel: "Intermediate",
    thumbnail: PROD_LEARNING_IMAGE_PILATES,
    videoUrl: PROD_LEARNING_VIDEO_URL,
    priority: 9,
  },
  {
    legacyId: "prod-pilates-010",
    title: "Spine Stretch Forward & Saw",
    description:
      "Seated exercises focusing on thoracic flexion and rotation. The spine stretch and saw improve flexibility, breathing mechanics, and the integrity of the spinal curves.",
    shortDescription: "Lengthen and rotate your spine with these classic seated exercises.",
    category: "prod-pilates",
    categoryType: "Mat",
    categoryLevel: "Intermediate",
    thumbnail: PROD_LEARNING_IMAGE_PILATES,
    videoUrl: PROD_LEARNING_VIDEO_URL,
    priority: 10,
  },
  {
    legacyId: "prod-pilates-011",
    title: "Swan Dive & Back Extension Series",
    description:
      "Progressive back extension work from prone — baby swan, swan, swan dive prep — to strengthen the erectors and glutes while improving thoracic mobility and posture.",
    shortDescription: "Build a strong, pain-free back with the classical extension series.",
    category: "prod-pilates",
    categoryType: "Mat",
    categoryLevel: "Intermediate",
    thumbnail: PROD_LEARNING_IMAGE_PILATES,
    videoUrl: PROD_LEARNING_VIDEO_URL,
    priority: 11,
  },
  {
    legacyId: "prod-pilates-012",
    title: "Pilates with Props: Resistance Band",
    description:
      "Use a resistance band to deepen muscle engagement in the classical series. The band provides feedback, increases challenge, and helps beginners find correct muscle activation.",
    shortDescription: "Intensify your pilates practice with a resistance band.",
    category: "prod-pilates",
    categoryType: "Props",
    categoryLevel: "Intermediate",
    thumbnail: PROD_LEARNING_IMAGE_PILATES,
    videoUrl: PROD_LEARNING_VIDEO_URL,
    priority: 12,
  },
  {
    legacyId: "prod-pilates-013",
    title: "Pilates with Props: Small Ball",
    description:
      "A small inflatable ball placed strategically to add instability, increase tactile feedback, and target the inner thighs, glutes, and deep abdominals with precision.",
    shortDescription: "Discover how a small ball transforms your pilates workout.",
    category: "prod-pilates",
    categoryType: "Props",
    categoryLevel: "Beginner",
    thumbnail: PROD_LEARNING_IMAGE_PILATES,
    videoUrl: PROD_LEARNING_VIDEO_URL,
    priority: 13,
  },
  {
    legacyId: "prod-pilates-014",
    title: "Side Kick Series: Lateral Hip Strength",
    description:
      "Classical side-lying exercises — front and back kicks, up and down circles, inner thigh lifts — to develop hip abductor and adductor strength and pelvic stability.",
    shortDescription: "Sculpt and strengthen the lateral hip with the side kick series.",
    category: "prod-pilates",
    categoryType: "Mat",
    categoryLevel: "Intermediate",
    thumbnail: PROD_LEARNING_IMAGE_PILATES,
    videoUrl: PROD_LEARNING_VIDEO_URL,
    priority: 14,
  },
  {
    legacyId: "prod-pilates-015",
    title: "Teaser: The Pilates V-Shape Challenge",
    description:
      "Progressive preparation for the teaser — pilates' signature V-shape exercise. Broken down into accessible stages so every student can work toward the full expression.",
    shortDescription: "Work towards the iconic pilates teaser step by step.",
    category: "prod-pilates",
    categoryType: "Mat",
    categoryLevel: "Advanced",
    thumbnail: PROD_LEARNING_IMAGE_PILATES,
    videoUrl: PROD_LEARNING_VIDEO_URL,
    priority: 15,
  },
  {
    legacyId: "prod-pilates-016",
    title: "Hip Circles & Boomerang",
    description:
      "Advanced classical exercises combining balance, control, and fluid spinal movement. The hip circle and boomerang challenge coordination and require full core integration.",
    shortDescription: "Challenge your control and coordination with advanced classical moves.",
    category: "prod-pilates",
    categoryType: "Mat",
    categoryLevel: "Advanced",
    thumbnail: PROD_LEARNING_IMAGE_PILATES,
    videoUrl: PROD_LEARNING_VIDEO_URL,
    priority: 16,
  },
  {
    legacyId: "prod-pilates-017",
    title: "Pilates for Posture Correction",
    description:
      "A targeted session addressing common postural patterns — forward head, rounded shoulders, and anterior pelvic tilt — with specific exercises to restore alignment.",
    shortDescription: "Stand taller and feel better with this posture-focused pilates class.",
    category: "prod-pilates",
    categoryType: "Foundation",
    categoryLevel: "Beginner",
    thumbnail: PROD_LEARNING_IMAGE_PILATES,
    videoUrl: PROD_LEARNING_VIDEO_URL,
    priority: 17,
  },
  {
    legacyId: "prod-pilates-018",
    title: "Full Classical Mat Sequence: Beginner",
    description:
      "The complete beginner classical mat order performed at a measured pace with coaching cues throughout. Ideal as a weekly benchmark session to measure your progress.",
    shortDescription: "Perform the full classical mat sequence from start to finish.",
    category: "prod-pilates",
    categoryType: "Mat",
    categoryLevel: "Beginner",
    thumbnail: PROD_LEARNING_IMAGE_PILATES,
    videoUrl: PROD_LEARNING_VIDEO_URL,
    priority: 18,
  },
  {
    legacyId: "prod-pilates-019",
    title: "Pilates for Back Pain Relief",
    description:
      "Evidence-informed pilates sequences specifically designed for people with chronic lower back discomfort. Emphasises decompression, gentle strengthening, and pain-safe movement.",
    shortDescription: "Move without pain — pilates exercises safe for the lower back.",
    category: "prod-pilates",
    categoryType: "Foundation",
    categoryLevel: "Beginner",
    thumbnail: PROD_LEARNING_IMAGE_PILATES,
    videoUrl: PROD_LEARNING_VIDEO_URL,
    priority: 19,
  },
  {
    legacyId: "prod-pilates-020",
    title: "Full Classical Mat Sequence: Intermediate",
    description:
      "The complete intermediate classical mat order performed with energy and precision. The natural next step after the beginner sequence — a 30-minute classical challenge.",
    shortDescription: "Rise to the intermediate level with the full classical mat sequence.",
    category: "prod-pilates",
    categoryType: "Mat",
    categoryLevel: "Intermediate",
    thumbnail: PROD_LEARNING_IMAGE_PILATES,
    videoUrl: PROD_LEARNING_VIDEO_URL,
    priority: 20,
  },
];

export const PRODUCTION_LEARNING_PROGRAMS: ProdLearningProgram[] = [
  FITNESS_PROGRAM,
  YOGA_PROGRAM,
  PILATES_PROGRAM,
];

export const PRODUCTION_LEARNING_COURSES: ProdLearningCourse[] = [
  ...FITNESS_COURSES,
  ...YOGA_COURSES,
  ...PILATES_COURSES,
];

/** Minimum courses required per program (enforced by tests). */
export const MIN_COURSES_PER_PROGRAM = 20;
