/**
 * Studio Aster learning catalogue seed.
 * Three programs, six videos per program, with route-safe human-readable course types.
 */

export const PROD_LEARNING_VIDEO_URL = "https://www.youtube.com/watch?v=ZdfJcN-yBIE";

export const PROD_LEARNING_IMAGE_FITNESS = "/uploads/learning/course_1_fitness.jpg";
export const PROD_LEARNING_IMAGE_YOGA = "/uploads/learning/course_2_yoga.jpg";
export const PROD_LEARNING_IMAGE_PILATES = "/uploads/learning/course_3_pilates.jpg";

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

export const FITNESS_PROGRAM: ProdLearningProgram = {
  legacyId: "prod-program-fitness",
  mainTitle: "Functional Training Foundations",
  mainDescription:
    "A focused strength and conditioning program for building confidence with functional movement, simple equipment and efficient home-friendly circuits.",
  courseType: "Functional Training",
  title: "Functional Training Foundations",
  description1:
    "Start with the movement patterns used most often in Studio Aster classes: squat, hinge, push, pull, carry and rotate.",
  description2:
    "You will learn how to warm up well, move with control, build useful strength and scale every circuit to your current energy level.",
  description3:
    "Includes six short videos designed as a complete starter track for clients who want better technique before joining small-group sessions.",
  videoPromo: PROD_LEARNING_VIDEO_URL,
  picture1: PROD_LEARNING_IMAGE_FITNESS,
  picture2: PROD_LEARNING_IMAGE_FITNESS,
  picture3: PROD_LEARNING_IMAGE_FITNESS,
};

export const YOGA_PROGRAM: ProdLearningProgram = {
  legacyId: "prod-program-yoga",
  mainTitle: "Vinyasa Yoga Essentials",
  mainDescription:
    "A calm, practical yoga program covering breath, alignment and flowing sequences for Studio Aster's Vinyasa and Rocket-inspired classes.",
  courseType: "Yoga",
  title: "Vinyasa Yoga Essentials",
  description1:
    "Build a clear foundation for sun salutations, standing poses, balance work and slower recovery shapes.",
  description2:
    "You will learn how to connect breath and movement, use props when useful and choose options that keep the practice steady and sustainable.",
  description3:
    "Includes six guided videos that move from fundamentals into a compact full-flow practice.",
  videoPromo: PROD_LEARNING_VIDEO_URL,
  picture1: PROD_LEARNING_IMAGE_YOGA,
  picture2: PROD_LEARNING_IMAGE_YOGA,
  picture3: PROD_LEARNING_IMAGE_YOGA,
};

export const PILATES_PROGRAM: ProdLearningProgram = {
  legacyId: "prod-program-pilates",
  mainTitle: "Mat Pilates Essentials",
  mainDescription:
    "A precise Pilates program for core control, posture, spinal articulation and graceful strength on the mat.",
  courseType: "Pilates",
  title: "Mat Pilates Essentials",
  description1:
    "Learn the core principles that make Pilates feel controlled rather than rushed: breath, centering, alignment and precision.",
  description2:
    "You will practise the key mat patterns used in class, with clear options for beginners and returning clients.",
  description3:
    "Includes six videos that build from fundamentals into a complete mat sequence.",
  videoPromo: PROD_LEARNING_VIDEO_URL,
  picture1: PROD_LEARNING_IMAGE_PILATES,
  picture2: PROD_LEARNING_IMAGE_PILATES,
  picture3: PROD_LEARNING_IMAGE_PILATES,
};

export const FITNESS_COURSES: ProdLearningCourse[] = [
  {
    legacyId: "prod-fitness-001",
    title: "Movement Prep & Warm-Up",
    description: "A short preparation class for mobilising hips, shoulders and spine before strength work.",
    shortDescription: "Warm up with intention before functional training.",
    category: FITNESS_PROGRAM.courseType,
    categoryType: "Foundation",
    categoryLevel: "Beginner",
    thumbnail: PROD_LEARNING_IMAGE_FITNESS,
    videoUrl: PROD_LEARNING_VIDEO_URL,
    priority: 1,
  },
  {
    legacyId: "prod-fitness-002",
    title: "Core Stability Basics",
    description: "Learn bracing, anti-rotation and controlled breathing for stronger, safer movement.",
    shortDescription: "Build the core control behind every circuit.",
    category: FITNESS_PROGRAM.courseType,
    categoryType: "Core",
    categoryLevel: "Beginner",
    thumbnail: PROD_LEARNING_IMAGE_FITNESS,
    videoUrl: PROD_LEARNING_VIDEO_URL,
    priority: 2,
  },
  {
    legacyId: "prod-fitness-003",
    title: "Squat & Hinge Technique",
    description: "Practise two essential lower-body patterns with simple coaching cues and scalable options.",
    shortDescription: "Refine squats and hip hinges for class confidence.",
    category: FITNESS_PROGRAM.courseType,
    categoryType: "Strength",
    categoryLevel: "Beginner",
    thumbnail: PROD_LEARNING_IMAGE_FITNESS,
    videoUrl: PROD_LEARNING_VIDEO_URL,
    priority: 3,
  },
  {
    legacyId: "prod-fitness-004",
    title: "Push, Pull & Posture",
    description: "A balanced upper-body session focused on shoulder position, pulling strength and pressing control.",
    shortDescription: "Train upper-body strength without losing posture.",
    category: FITNESS_PROGRAM.courseType,
    categoryType: "Strength",
    categoryLevel: "Intermediate",
    thumbnail: PROD_LEARNING_IMAGE_FITNESS,
    videoUrl: PROD_LEARNING_VIDEO_URL,
    priority: 4,
  },
  {
    legacyId: "prod-fitness-005",
    title: "Low-Impact Conditioning",
    description: "Raise your heart rate with a joint-friendly circuit that blends strength and steady pacing.",
    shortDescription: "Conditioning work that stays controlled and repeatable.",
    category: FITNESS_PROGRAM.courseType,
    categoryType: "Conditioning",
    categoryLevel: "Intermediate",
    thumbnail: PROD_LEARNING_IMAGE_FITNESS,
    videoUrl: PROD_LEARNING_VIDEO_URL,
    priority: 5,
  },
  {
    legacyId: "prod-fitness-006",
    title: "Full-Body Studio Circuit",
    description: "Put the foundations together in one complete circuit using clear work and recovery intervals.",
    shortDescription: "A complete functional training session in one class.",
    category: FITNESS_PROGRAM.courseType,
    categoryType: "Circuit",
    categoryLevel: "Intermediate",
    thumbnail: PROD_LEARNING_IMAGE_FITNESS,
    videoUrl: PROD_LEARNING_VIDEO_URL,
    priority: 6,
  },
];

export const YOGA_COURSES: ProdLearningCourse[] = [
  {
    legacyId: "prod-yoga-001",
    title: "Breath & Mat Orientation",
    description: "Set up your practice with simple breathing, grounding and alignment basics.",
    shortDescription: "Start with breath, steadiness and clear setup.",
    category: YOGA_PROGRAM.courseType,
    categoryType: "Foundation",
    categoryLevel: "Beginner",
    thumbnail: PROD_LEARNING_IMAGE_YOGA,
    videoUrl: PROD_LEARNING_VIDEO_URL,
    priority: 1,
  },
  {
    legacyId: "prod-yoga-002",
    title: "Sun Salutation Breakdown",
    description: "Learn the building blocks of a sun salutation with options for wrists, shoulders and hamstrings.",
    shortDescription: "Understand each transition in the flow.",
    category: YOGA_PROGRAM.courseType,
    categoryType: "Vinyasa",
    categoryLevel: "Beginner",
    thumbnail: PROD_LEARNING_IMAGE_YOGA,
    videoUrl: PROD_LEARNING_VIDEO_URL,
    priority: 2,
  },
  {
    legacyId: "prod-yoga-003",
    title: "Standing Poses & Balance",
    description: "Build stability through warrior shapes, triangle, tree pose and grounded balance work.",
    shortDescription: "Find strength and steadiness standing up.",
    category: YOGA_PROGRAM.courseType,
    categoryType: "Alignment",
    categoryLevel: "Beginner",
    thumbnail: PROD_LEARNING_IMAGE_YOGA,
    videoUrl: PROD_LEARNING_VIDEO_URL,
    priority: 3,
  },
  {
    legacyId: "prod-yoga-004",
    title: "Hip Opening Flow",
    description: "A steady sequence for hips and lower back using lunges, pigeon options and gentle twists.",
    shortDescription: "Release hips with a slow, useful flow.",
    category: YOGA_PROGRAM.courseType,
    categoryType: "Mobility",
    categoryLevel: "Beginner",
    thumbnail: PROD_LEARNING_IMAGE_YOGA,
    videoUrl: PROD_LEARNING_VIDEO_URL,
    priority: 4,
  },
  {
    legacyId: "prod-yoga-005",
    title: "Rocket-Inspired Energy",
    description: "A compact energetic practice with dynamic transitions and accessible strength options.",
    shortDescription: "Explore a brighter, faster-paced practice.",
    category: YOGA_PROGRAM.courseType,
    categoryType: "Rocket",
    categoryLevel: "Intermediate",
    thumbnail: PROD_LEARNING_IMAGE_YOGA,
    videoUrl: PROD_LEARNING_VIDEO_URL,
    priority: 5,
  },
  {
    legacyId: "prod-yoga-006",
    title: "Complete Vinyasa Practice",
    description: "Bring breath, standing work, mobility and rest into one balanced class.",
    shortDescription: "A complete Studio Aster-style Vinyasa session.",
    category: YOGA_PROGRAM.courseType,
    categoryType: "Vinyasa",
    categoryLevel: "Intermediate",
    thumbnail: PROD_LEARNING_IMAGE_YOGA,
    videoUrl: PROD_LEARNING_VIDEO_URL,
    priority: 6,
  },
];

export const PILATES_COURSES: ProdLearningCourse[] = [
  {
    legacyId: "prod-pilates-001",
    title: "Pilates Principles",
    description: "Learn breath, centering, control and precision before adding more complex mat work.",
    shortDescription: "The foundations behind every Pilates class.",
    category: PILATES_PROGRAM.courseType,
    categoryType: "Foundation",
    categoryLevel: "Beginner",
    thumbnail: PROD_LEARNING_IMAGE_PILATES,
    videoUrl: PROD_LEARNING_VIDEO_URL,
    priority: 1,
  },
  {
    legacyId: "prod-pilates-002",
    title: "Neutral Spine & Core Control",
    description: "Practise neutral spine, imprint options and deep abdominal engagement with calm pacing.",
    shortDescription: "Find stable, supported movement from the centre.",
    category: PILATES_PROGRAM.courseType,
    categoryType: "Foundation",
    categoryLevel: "Beginner",
    thumbnail: PROD_LEARNING_IMAGE_PILATES,
    videoUrl: PROD_LEARNING_VIDEO_URL,
    priority: 2,
  },
  {
    legacyId: "prod-pilates-003",
    title: "The Hundred & Ab Prep",
    description: "Break down classic abdominal work with options that protect the neck and lower back.",
    shortDescription: "Build abdominal endurance with clean form.",
    category: PILATES_PROGRAM.courseType,
    categoryType: "Mat",
    categoryLevel: "Beginner",
    thumbnail: PROD_LEARNING_IMAGE_PILATES,
    videoUrl: PROD_LEARNING_VIDEO_URL,
    priority: 3,
  },
  {
    legacyId: "prod-pilates-004",
    title: "Roll Down & Spinal Articulation",
    description: "Use slow flexion and extension work to improve spinal awareness and control.",
    shortDescription: "Move the spine segment by segment.",
    category: PILATES_PROGRAM.courseType,
    categoryType: "Mat",
    categoryLevel: "Beginner",
    thumbnail: PROD_LEARNING_IMAGE_PILATES,
    videoUrl: PROD_LEARNING_VIDEO_URL,
    priority: 4,
  },
  {
    legacyId: "prod-pilates-005",
    title: "Side-Lying Hip Strength",
    description: "Strengthen glutes and lateral hips with controlled side-kick variations.",
    shortDescription: "Improve hip stability and lower-body control.",
    category: PILATES_PROGRAM.courseType,
    categoryType: "Mat",
    categoryLevel: "Intermediate",
    thumbnail: PROD_LEARNING_IMAGE_PILATES,
    videoUrl: PROD_LEARNING_VIDEO_URL,
    priority: 5,
  },
  {
    legacyId: "prod-pilates-006",
    title: "Complete Mat Flow",
    description: "Combine breath, abdominal work, spinal articulation and hip strength into one polished sequence.",
    shortDescription: "A complete Studio Aster-style Pilates class.",
    category: PILATES_PROGRAM.courseType,
    categoryType: "Mat",
    categoryLevel: "Intermediate",
    thumbnail: PROD_LEARNING_IMAGE_PILATES,
    videoUrl: PROD_LEARNING_VIDEO_URL,
    priority: 6,
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

export const MIN_COURSES_PER_PROGRAM = 6;
export const MAX_COURSES_PER_PROGRAM = 6;
