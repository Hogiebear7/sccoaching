// Prototype data for /app, /admin, /admin-mobile only — not wired to real
// auth/db. See docs/surface-architecture.md before connecting any consumer
// of this file to lib/db.ts or lib/session.ts.

// ─── Types ────────────────────────────────────────────────────────────────────

export type Tier = "Basic" | "Premium" | "Elite";
export type MemberStatus = "Active" | "Inactive";
export type ResourceType = "PDF" | "Video" | "Program";
export type ClassType = "HIIT" | "Strength" | "Yoga" | "Mobility" | "CrossFit" | "Mixed";

export interface Member {
  id: string;
  name: string;
  email: string;
  initials: string;
  tier: Tier;
  joinDate: string;
  lastVisit: string;
  totalVisits: number;
  status: MemberStatus;
  goals: string;
  currentWeight: number;
  targetWeight: number;
  streak: number;
  phone: string;
}

export interface Exercise {
  id: string;
  name: string;
  muscleGroup: string;
  category: "Strength" | "Cardio" | "Mobility";
}

export interface WorkoutSet {
  reps: number;
  weightKg: number;
  durationSecs?: number;
}

export interface WorkoutExercise {
  exerciseId: string;
  name: string;
  sets: WorkoutSet[];
}

export interface WorkoutSession {
  id: string;
  memberId: string;
  date: string;
  durationMins: number;
  exercises: WorkoutExercise[];
}

export interface GymClass {
  id: string;
  name: string;
  type: ClassType;
  coachName: string;
  date: string;
  time: string;
  durationMins: number;
  capacity: number;
  enrolled: number;
  enrolledMemberIds: string[];
}

export interface Message {
  id: string;
  fromId: string;
  toId: string;
  fromName: string;
  toName: string;
  subject: string;
  body: string;
  timestamp: string;
  read: boolean;
}

export interface Resource {
  id: string;
  title: string;
  type: ResourceType;
  category: string;
  sharedDate: string;
  sizeLabel: string;
  description: string;
}

export interface AttendanceCell {
  dayOfWeek: number; // 0=Mon … 6=Sun
  hour: number;      // 6–21
  count: number;
}

export interface WeeklyAttendance {
  week: string;
  count: number;
}

export interface BodyweightEntry {
  memberId: string;
  date: string;
  weightKg: number;
}

export interface MonthlyReport {
  month: string;
  revenue: number;
  newMembers: number;
  churnedMembers: number;
  avgVisitsPerMember: number;
}

export interface KpiSnapshot {
  activeMembersTotal: number;
  mtdRevenue: number;
  newSignUpsThisMonth: number;
  avgVisitsPerWeek: number;
}

// ─── Members ──────────────────────────────────────────────────────────────────

export const members: Member[] = [
  { id: "m1", name: "Alex Rivera", email: "alex.r@email.com", initials: "AR", tier: "Premium", joinDate: "2024-01-15", lastVisit: "2026-06-10", totalVisits: 87, status: "Active", goals: "Build muscle, improve deadlift", currentWeight: 82.5, targetWeight: 78.0, streak: 12, phone: "+1 555 0101" },
  { id: "m2", name: "Jordan Kim", email: "jordan.k@email.com", initials: "JK", tier: "Elite", joinDate: "2023-06-20", lastVisit: "2026-06-11", totalVisits: 143, status: "Active", goals: "Competition prep, powerlifting", currentWeight: 76.0, targetWeight: 74.0, streak: 28, phone: "+1 555 0102" },
  { id: "m3", name: "Sam Chen", email: "sam.c@email.com", initials: "SC", tier: "Basic", joinDate: "2025-09-01", lastVisit: "2026-06-09", totalVisits: 34, status: "Active", goals: "General fitness, lose weight", currentWeight: 91.0, targetWeight: 82.0, streak: 3, phone: "+1 555 0103" },
  { id: "m4", name: "Taylor Brooks", email: "taylor.b@email.com", initials: "TB", tier: "Premium", joinDate: "2024-08-10", lastVisit: "2026-06-08", totalVisits: 56, status: "Active", goals: "Improve cardio, tone up", currentWeight: 68.5, targetWeight: 65.0, streak: 7, phone: "+1 555 0104" },
  { id: "m5", name: "Morgan Davis", email: "morgan.d@email.com", initials: "MD", tier: "Elite", joinDate: "2022-11-30", lastVisit: "2026-06-11", totalVisits: 201, status: "Active", goals: "Advanced strength, Olympic lifting", currentWeight: 85.0, targetWeight: 85.0, streak: 45, phone: "+1 555 0105" },
  { id: "m6", name: "Riley Thompson", email: "riley.t@email.com", initials: "RT", tier: "Basic", joinDate: "2025-11-15", lastVisit: "2026-05-02", totalVisits: 12, status: "Inactive", goals: "Try something new", currentWeight: 72.0, targetWeight: 70.0, streak: 0, phone: "+1 555 0106" },
  { id: "m7", name: "Casey Martinez", email: "casey.m@email.com", initials: "CM", tier: "Premium", joinDate: "2024-03-22", lastVisit: "2026-06-10", totalVisits: 78, status: "Active", goals: "Functional fitness, HIIT", currentWeight: 79.0, targetWeight: 77.0, streak: 15, phone: "+1 555 0107" },
  { id: "m8", name: "Drew Wilson", email: "drew.w@email.com", initials: "DW", tier: "Basic", joinDate: "2025-06-01", lastVisit: "2026-06-07", totalVisits: 29, status: "Active", goals: "Build a workout habit", currentWeight: 88.0, targetWeight: 84.0, streak: 5, phone: "+1 555 0108" },
];

export const currentMember = members[0]; // Alex Rivera — the "logged-in" member

// ─── Exercises ────────────────────────────────────────────────────────────────

export const exercises: Exercise[] = [
  { id: "e1",  name: "Back Squat",         muscleGroup: "Quads / Glutes",     category: "Strength" },
  { id: "e2",  name: "Bench Press",         muscleGroup: "Chest / Triceps",    category: "Strength" },
  { id: "e3",  name: "Deadlift",            muscleGroup: "Hamstrings / Back",  category: "Strength" },
  { id: "e4",  name: "Overhead Press",      muscleGroup: "Shoulders",          category: "Strength" },
  { id: "e5",  name: "Barbell Row",         muscleGroup: "Back / Biceps",      category: "Strength" },
  { id: "e6",  name: "Pull-Up",             muscleGroup: "Back / Biceps",      category: "Strength" },
  { id: "e7",  name: "Dip",                 muscleGroup: "Chest / Triceps",    category: "Strength" },
  { id: "e8",  name: "Romanian Deadlift",   muscleGroup: "Hamstrings / Glutes",category: "Strength" },
  { id: "e9",  name: "Bicep Curl",          muscleGroup: "Biceps",             category: "Strength" },
  { id: "e10", name: "Tricep Pushdown",     muscleGroup: "Triceps",            category: "Strength" },
  { id: "e11", name: "Lat Pulldown",        muscleGroup: "Back",               category: "Strength" },
  { id: "e12", name: "Seated Cable Row",    muscleGroup: "Back",               category: "Strength" },
  { id: "e13", name: "Leg Press",           muscleGroup: "Quads",              category: "Strength" },
  { id: "e14", name: "Leg Curl",            muscleGroup: "Hamstrings",         category: "Strength" },
  { id: "e15", name: "Hip Thrust",          muscleGroup: "Glutes",             category: "Strength" },
  { id: "e16", name: "Calf Raise",          muscleGroup: "Calves",             category: "Strength" },
  { id: "e17", name: "Face Pull",           muscleGroup: "Rear Delts",         category: "Strength" },
  { id: "e18", name: "Incline DB Press",    muscleGroup: "Upper Chest",        category: "Strength" },
  { id: "e19", name: "Lateral Raise",       muscleGroup: "Shoulders",          category: "Strength" },
  { id: "e20", name: "Skull Crusher",       muscleGroup: "Triceps",            category: "Strength" },
  { id: "e21", name: "Hammer Curl",         muscleGroup: "Biceps",             category: "Strength" },
  { id: "e22", name: "Front Squat",         muscleGroup: "Quads",              category: "Strength" },
  { id: "e23", name: "Treadmill Run",       muscleGroup: "Cardio",             category: "Cardio"   },
  { id: "e24", name: "Rowing Machine",      muscleGroup: "Full Body",          category: "Cardio"   },
  { id: "e25", name: "Assault Bike",        muscleGroup: "Cardio",             category: "Cardio"   },
  { id: "e26", name: "Box Jump",            muscleGroup: "Explosive Power",    category: "Cardio"   },
  { id: "e27", name: "Farmer's Carry",      muscleGroup: "Core / Grip",        category: "Strength" },
  { id: "e28", name: "Kettlebell Swing",    muscleGroup: "Full Body",          category: "Strength" },
  { id: "e29", name: "Plank",              muscleGroup: "Core",               category: "Mobility" },
  { id: "e30", name: "Jump Rope",           muscleGroup: "Cardio",             category: "Cardio"   },
];

// ─── Workout Sessions ─────────────────────────────────────────────────────────
// Push (bench), pull (deadlift), leg (squat) splits for Alex (m1) over 6 months

const pushDates   = ["2026-01-08","2026-01-22","2026-02-05","2026-02-19","2026-03-05","2026-03-19","2026-04-09","2026-05-07"];
const pullDates   = ["2026-01-10","2026-01-24","2026-02-07","2026-02-21","2026-03-07","2026-03-21","2026-04-11","2026-05-09"];
const legDates    = ["2026-01-13","2026-01-27","2026-02-10","2026-02-24","2026-03-10","2026-03-24","2026-04-14","2026-05-12"];

const benchWeights  = [60, 62.5, 65, 67.5, 70, 72.5, 77.5, 82.5];
const ohpWeights    = [40, 42.5, 45, 47.5, 50, 52.5, 55, 57.5];
const dlWeights     = [100, 105, 107.5, 112.5, 117.5, 122.5, 125, 130];
const squatWeights  = [80, 82.5, 85, 87.5, 90, 95, 100, 105];

function pushSession(i: number): WorkoutSession {
  const bw = benchWeights[i], ow = ohpWeights[i];
  return {
    id: `push-${i + 1}`, memberId: "m1", date: pushDates[i], durationMins: 65,
    exercises: [
      { exerciseId: "e2", name: "Bench Press", sets: [
        { reps: 5, weightKg: 40 }, { reps: 3, weightKg: bw * 0.8 },
        { reps: i < 4 ? 5 : 3, weightKg: bw }, { reps: i < 4 ? 5 : 3, weightKg: bw }, { reps: i < 4 ? 4 : 2, weightKg: bw },
      ]},
      { exerciseId: "e4", name: "Overhead Press", sets: [
        { reps: 8, weightKg: ow }, { reps: 8, weightKg: ow }, { reps: 6, weightKg: ow },
      ]},
      { exerciseId: "e7", name: "Dip", sets: [
        { reps: 12, weightKg: 0 }, { reps: 10, weightKg: 0 }, { reps: 8, weightKg: 0 },
      ]},
      { exerciseId: "e19", name: "Lateral Raise", sets: [
        { reps: 15, weightKg: 8 + Math.floor(i / 2) * 2 }, { reps: 15, weightKg: 8 + Math.floor(i / 2) * 2 },
      ]},
    ],
  };
}

function pullSession(i: number): WorkoutSession {
  const dw = dlWeights[i];
  return {
    id: `pull-${i + 1}`, memberId: "m1", date: pullDates[i], durationMins: 70,
    exercises: [
      { exerciseId: "e3", name: "Deadlift", sets: [
        { reps: 5, weightKg: 60 }, { reps: 3, weightKg: dw * 0.8 },
        { reps: i < 4 ? 5 : 3, weightKg: dw }, { reps: i < 4 ? 4 : 2, weightKg: dw },
      ]},
      { exerciseId: "e5", name: "Barbell Row", sets: [
        { reps: 8, weightKg: 60 + i * 2.5 }, { reps: 8, weightKg: 60 + i * 2.5 }, { reps: 8, weightKg: 60 + i * 2.5 },
      ]},
      { exerciseId: "e6", name: "Pull-Up", sets: [
        { reps: 8 + i, weightKg: 0 }, { reps: 7 + i, weightKg: 0 }, { reps: 6 + i, weightKg: 0 },
      ]},
      { exerciseId: "e9", name: "Bicep Curl", sets: [
        { reps: 12, weightKg: 12 + Math.floor(i / 2) * 2 }, { reps: 10, weightKg: 12 + Math.floor(i / 2) * 2 },
      ]},
    ],
  };
}

function legSession(i: number): WorkoutSession {
  const sw = squatWeights[i];
  return {
    id: `leg-${i + 1}`, memberId: "m1", date: legDates[i], durationMins: 75,
    exercises: [
      { exerciseId: "e1", name: "Back Squat", sets: [
        { reps: 5, weightKg: 50 }, { reps: 3, weightKg: sw * 0.8 },
        { reps: i < 4 ? 5 : 3, weightKg: sw }, { reps: i < 4 ? 5 : 3, weightKg: sw }, { reps: i < 4 ? 4 : 2, weightKg: sw },
      ]},
      { exerciseId: "e8", name: "Romanian Deadlift", sets: [
        { reps: 10, weightKg: 70 + i * 2.5 }, { reps: 10, weightKg: 70 + i * 2.5 }, { reps: 10, weightKg: 70 + i * 2.5 },
      ]},
      { exerciseId: "e13", name: "Leg Press", sets: [
        { reps: 12, weightKg: 120 + i * 5 }, { reps: 12, weightKg: 120 + i * 5 }, { reps: 10, weightKg: 140 + i * 5 },
      ]},
      { exerciseId: "e16", name: "Calf Raise", sets: [
        { reps: 20, weightKg: 40 }, { reps: 20, weightKg: 40 }, { reps: 15, weightKg: 50 },
      ]},
    ],
  };
}

export const workoutSessions: WorkoutSession[] = [
  ...Array.from({ length: 8 }, (_, i) => pushSession(i)),
  ...Array.from({ length: 8 }, (_, i) => pullSession(i)),
  ...Array.from({ length: 8 }, (_, i) => legSession(i)),
  // A recent full-body session for Jun 2 (visible in history)
  {
    id: "full-1", memberId: "m1", date: "2026-06-02", durationMins: 60,
    exercises: [
      { exerciseId: "e1", name: "Back Squat", sets: [{ reps: 3, weightKg: 100 }, { reps: 3, weightKg: 100 }] },
      { exerciseId: "e2", name: "Bench Press", sets: [{ reps: 3, weightKg: 80 }, { reps: 3, weightKg: 80 }] },
      { exerciseId: "e24", name: "Rowing Machine", sets: [{ reps: 1, weightKg: 0, durationSecs: 600 }] },
    ],
  },
];

// ─── Gym Classes (next 2 weeks from Jun 11 2026) ──────────────────────────────

function makeClass(id: string, name: string, type: ClassType, date: string, time: string, durationMins: number, capacity: number, enrolled: number, enrolledIds: string[]): GymClass {
  return { id, name, type, coachName: "Sarah O'Brien", date, time, durationMins, capacity, enrolled, enrolledMemberIds: enrolledIds };
}

export const classes: GymClass[] = [
  // Thu Jun 11
  makeClass("c1",  "Morning HIIT",         "HIIT",     "2026-06-11", "06:00", 45, 15,  11, ["m1","m2","m5","m7"]),
  makeClass("c2",  "Yoga Flow",            "Yoga",     "2026-06-11", "09:00", 60, 20,  14, ["m3","m4","m6"]),
  makeClass("c3",  "Lunchtime CrossFit",   "CrossFit", "2026-06-11", "12:00", 45, 10,   8, ["m2","m5"]),
  makeClass("c4",  "Evening Strength",     "Strength", "2026-06-11", "18:00", 60, 12,  10, ["m1","m7","m8"]),
  // Fri Jun 12
  makeClass("c5",  "Morning HIIT",         "HIIT",     "2026-06-12", "06:00", 45, 15,   9, ["m1","m4","m7"]),
  makeClass("c6",  "Strength Training",    "Strength", "2026-06-12", "07:00", 60, 12,   7, ["m2","m5","m8"]),
  makeClass("c7",  "Evening HIIT",         "HIIT",     "2026-06-12", "18:00", 45, 20,  16, ["m1","m3","m4","m7"]),
  // Sat Jun 13
  makeClass("c8",  "Weekend Warriors",     "Mixed",    "2026-06-13", "09:00", 75, 25,  18, ["m1","m2","m3","m4","m5"]),
  makeClass("c9",  "Yoga Flow",            "Yoga",     "2026-06-13", "10:00", 60, 20,  12, ["m6","m7"]),
  // Sun Jun 14
  makeClass("c10", "Weekend Warriors",     "Mixed",    "2026-06-14", "09:00", 75, 25,  10, ["m3","m5","m8"]),
  // Mon Jun 15
  makeClass("c11", "Morning HIIT",         "HIIT",     "2026-06-15", "06:00", 45, 15,  13, ["m1","m2","m7"]),
  makeClass("c12", "Strength Training",    "Strength", "2026-06-15", "07:00", 60, 12,   5, ["m5","m8"]),
  makeClass("c13", "Lunchtime CrossFit",   "CrossFit", "2026-06-15", "12:00", 45, 10,   7, ["m2","m4","m7"]),
  makeClass("c14", "Evening HIIT",         "HIIT",     "2026-06-15", "18:00", 45, 20,  15, ["m1","m3","m7","m8"]),
  // Tue Jun 16
  makeClass("c15", "Yoga Flow",            "Yoga",     "2026-06-16", "09:00", 60, 20,  16, ["m4","m6"]),
  makeClass("c16", "Lunchtime CrossFit",   "CrossFit", "2026-06-16", "12:00", 45, 10,   6, ["m2","m5"]),
  makeClass("c17", "Evening Strength",     "Strength", "2026-06-16", "18:00", 60, 12,   9, ["m1","m7","m8"]),
  // Wed Jun 17
  makeClass("c18", "Morning HIIT",         "HIIT",     "2026-06-17", "06:00", 45, 15,  12, ["m1","m5","m7"]),
  makeClass("c19", "Strength Training",    "Strength", "2026-06-17", "07:00", 60, 12,   8, ["m2","m4","m8"]),
  makeClass("c20", "Mobility & Recovery",  "Mobility", "2026-06-17", "17:00", 45, 15,  11, ["m3","m6","m7"]),
  makeClass("c21", "Evening HIIT",         "HIIT",     "2026-06-17", "18:00", 45, 20,  14, ["m1","m2","m4","m5"]),
  // Thu Jun 18
  makeClass("c22", "Yoga Flow",            "Yoga",     "2026-06-18", "09:00", 60, 20,  13, ["m3","m6"]),
  makeClass("c23", "Evening Strength",     "Strength", "2026-06-18", "18:00", 60, 12,  10, ["m1","m2","m7"]),
  // Fri Jun 19
  makeClass("c24", "Morning HIIT",         "HIIT",     "2026-06-19", "06:00", 45, 15,   8, ["m1","m4"]),
  makeClass("c25", "Strength Training",    "Strength", "2026-06-19", "07:00", 60, 12,   6, ["m5","m8"]),
  makeClass("c26", "Evening HIIT",         "HIIT",     "2026-06-19", "18:00", 45, 20,  17, ["m1","m3","m4","m7","m8"]),
  // Sat Jun 20
  makeClass("c27", "Weekend Warriors",     "Mixed",    "2026-06-20", "09:00", 75, 25,  20, ["m1","m2","m3","m4","m5","m7"]),
  makeClass("c28", "Mobility & Recovery",  "Mobility", "2026-06-20", "11:00", 45, 15,   9, ["m4","m6"]),
];

// ─── Messages ─────────────────────────────────────────────────────────────────

export const messages: Message[] = [
  { id: "msg1",  fromId: "coach", toId: "m1", fromName: "Coach Sarah", toName: "Alex Rivera",  subject: "Program Update", body: "Hey Alex! I've updated your program for the next 4 weeks. Check the Resources section for the new PDF. Let me know if you have questions.", timestamp: "2026-06-10T09:15:00", read: true },
  { id: "msg2",  fromId: "m1",   toId: "coach", fromName: "Alex Rivera", toName: "Coach Sarah", subject: "Re: Program Update", body: "Thanks Sarah! Looks great. Quick question — should I keep the same rest times on the heavy days?", timestamp: "2026-06-10T11:30:00", read: true },
  { id: "msg3",  fromId: "coach", toId: "m1", fromName: "Coach Sarah", toName: "Alex Rivera",  subject: "Re: Program Update", body: "Yes, keep 3 min on your main lifts and 90 sec on accessories. You're close to a new squat PR — let's not rush recovery.", timestamp: "2026-06-10T13:00:00", read: false },
  { id: "msg4",  fromId: "coach", toId: "m2", fromName: "Coach Sarah", toName: "Jordan Kim",   subject: "Competition Prep", body: "Jordan, great session yesterday. Your form on the snatch is improving a lot. We'll peak in 6 weeks.", timestamp: "2026-06-09T16:00:00", read: true },
  { id: "msg5",  fromId: "m2",   toId: "coach", fromName: "Jordan Kim",  toName: "Coach Sarah", subject: "Re: Competition Prep", body: "Thanks coach! Feeling strong. Should I add more volume this week or stay at the same intensity?", timestamp: "2026-06-09T17:45:00", read: true },
  { id: "msg6",  fromId: "coach", toId: "m3", fromName: "Coach Sarah", toName: "Sam Chen",     subject: "Nutrition Check-in", body: "Sam, how's the diet going? Remember to hit your protein targets — it makes a big difference early on.", timestamp: "2026-06-08T10:00:00", read: true },
  { id: "msg7",  fromId: "m3",   toId: "coach", fromName: "Sam Chen",   toName: "Coach Sarah", subject: "Re: Nutrition Check-in", body: "Getting there! Struggling with lunch. Any suggestions for quick high-protein meals?", timestamp: "2026-06-08T12:15:00", read: false },
  { id: "msg8",  fromId: "coach", toId: "m4", fromName: "Coach Sarah", toName: "Taylor Brooks", subject: "Schedule Change", body: "Hey Taylor, the Thursday yoga class has moved to 9:30am. Does that still work for you?", timestamp: "2026-06-07T09:00:00", read: true },
  { id: "msg9",  fromId: "m5",   toId: "coach", fromName: "Morgan Davis", toName: "Coach Sarah", subject: "PR Attempt Friday?", body: "Coach, I'm feeling really good this week. Is Friday a good day to attempt a new deadlift PR?", timestamp: "2026-06-06T08:30:00", read: false },
  { id: "msg10", fromId: "coach", toId: "m7", fromName: "Coach Sarah", toName: "Casey Martinez", subject: "Great Progress!", body: "Casey, I noticed you've been hitting the morning HIIT consistently. Your conditioning is noticeably better. Keep it up!", timestamp: "2026-06-05T14:00:00", read: true },
  { id: "msg11", fromId: "m1", toId: "coach", fromName: "Alex Rivera", toName: "Coach Sarah", subject: "Knee feeling tight", body: "Hey Sarah — left knee has been a bit tight after squats. Should I be worried or is this normal when weight goes up?", timestamp: "2026-06-03T20:00:00", read: true },
  { id: "msg12", fromId: "coach", toId: "m1", fromName: "Coach Sarah", toName: "Alex Rivera", subject: "Re: Knee feeling tight", body: "Good that you flagged it. Let's add some extra warmup sets next session and drop squats 5kg. If it persists we'll reassess.", timestamp: "2026-06-04T09:00:00", read: true },
];

// ─── Resources ────────────────────────────────────────────────────────────────

export const resources: Resource[] = [
  { id: "r1",  title: "12-Week Strength Foundation",     type: "Program", category: "Training",   sharedDate: "2026-06-01", sizeLabel: "3 programs", description: "Your progressive overload program for the next 12 weeks." },
  { id: "r2",  title: "Muscle Building Nutrition Guide", type: "PDF",     category: "Nutrition",  sharedDate: "2026-05-20", sizeLabel: "2.4 MB",     description: "Calorie and macro targets, meal timing, and food choices for hypertrophy." },
  { id: "r3",  title: "Big 3 Lift Form Guide",           type: "Video",   category: "Training",   sharedDate: "2026-05-15", sizeLabel: "18 min",     description: "Detailed cue breakdowns for Squat, Bench, and Deadlift technique." },
  { id: "r4",  title: "Weekly Mobility Routine",         type: "Video",   category: "Mobility",   sharedDate: "2026-05-10", sizeLabel: "22 min",     description: "Full-body mobility flow — do this before your main lifts." },
  { id: "r5",  title: "Intermittent Fasting Guide",      type: "PDF",     category: "Nutrition",  sharedDate: "2026-04-28", sizeLabel: "1.1 MB",     description: "How to implement IF without losing muscle or training performance." },
  { id: "r6",  title: "Advanced Strength Program",       type: "Program", category: "Training",   sharedDate: "2026-04-15", sizeLabel: "5 phases",   description: "For members who've completed the Foundation program." },
  { id: "r7",  title: "Recovery & Sleep Optimisation",   type: "PDF",     category: "Mobility",   sharedDate: "2026-04-01", sizeLabel: "900 KB",     description: "Science-backed strategies to improve recovery between sessions." },
  { id: "r8",  title: "Stretching for Strength Athletes",type: "Video",   category: "Mobility",   sharedDate: "2026-03-20", sizeLabel: "35 min",     description: "Post-session stretching sequences targeting the hip flexors, chest, and lats." },
  { id: "r9",  title: "Meal Prep Basics",                type: "PDF",     category: "Nutrition",  sharedDate: "2026-03-10", sizeLabel: "1.8 MB",     description: "Batch cooking strategies and 10 easy high-protein recipes." },
  { id: "r10", title: "Mental Performance Guide",        type: "PDF",     category: "Mindset",    sharedDate: "2026-02-22", sizeLabel: "750 KB",     description: "Mindset frameworks for consistency, handling setbacks, and peak performance." },
  { id: "r11", title: "12-Week Cutting Program",         type: "Program", category: "Training",   sharedDate: "2026-02-01", sizeLabel: "3 phases",   description: "Maintain muscle while losing body fat over 12 weeks." },
  { id: "r12", title: "Competition Prep Guide",          type: "PDF",     category: "Training",   sharedDate: "2026-01-15", sizeLabel: "3.2 MB",     description: "For members competing in powerlifting or CrossFit events." },
];

// ─── Attendance Heatmap (7 days × hours 6–21) ─────────────────────────────────

function cell(dayOfWeek: number, hour: number, count: number): AttendanceCell {
  return { dayOfWeek, hour, count };
}

export const attendanceByHour: AttendanceCell[] = [
  // Mon (0) — busiest day
  cell(0,6,22), cell(0,7,38), cell(0,8,29), cell(0,9,14), cell(0,10,10), cell(0,11,8),
  cell(0,12,16), cell(0,13,11), cell(0,14,9), cell(0,15,10), cell(0,16,14), cell(0,17,32),
  cell(0,18,44), cell(0,19,30), cell(0,20,18), cell(0,21,8),
  // Tue (1)
  cell(1,6,14), cell(1,7,20), cell(1,8,18), cell(1,9,22), cell(1,10,15), cell(1,11,10),
  cell(1,12,14), cell(1,13,9),  cell(1,14,7),  cell(1,15,9),  cell(1,16,13), cell(1,17,24),
  cell(1,18,34), cell(1,19,22), cell(1,20,12), cell(1,21,5),
  // Wed (2) — 2nd busiest
  cell(2,6,20), cell(2,7,35), cell(2,8,27), cell(2,9,13), cell(2,10,9),  cell(2,11,7),
  cell(2,12,15), cell(2,13,10), cell(2,14,8),  cell(2,15,9),  cell(2,16,13), cell(2,17,30),
  cell(2,18,42), cell(2,19,28), cell(2,20,16), cell(2,21,7),
  // Thu (3)
  cell(3,6,12), cell(3,7,18), cell(3,8,16), cell(3,9,20), cell(3,10,13), cell(3,11,9),
  cell(3,12,13), cell(3,13,8),  cell(3,14,6),  cell(3,15,8),  cell(3,16,12), cell(3,17,22),
  cell(3,18,32), cell(3,19,20), cell(3,20,10), cell(3,21,4),
  // Fri (4)
  cell(4,6,18), cell(4,7,30), cell(4,8,22), cell(4,9,11), cell(4,10,8),  cell(4,11,7),
  cell(4,12,14), cell(4,13,9),  cell(4,14,8),  cell(4,15,7),  cell(4,16,11), cell(4,17,28),
  cell(4,18,40), cell(4,19,26), cell(4,20,14), cell(4,21,6),
  // Sat (5) — late-morning peak
  cell(5,6,5),  cell(5,7,8),  cell(5,8,18), cell(5,9,36), cell(5,10,44), cell(5,11,32),
  cell(5,12,22), cell(5,13,14), cell(5,14,10), cell(5,15,8),  cell(5,16,6),  cell(5,17,5),
  cell(5,18,4),  cell(5,19,3),  cell(5,20,2),  cell(5,21,1),
  // Sun (6) — lightest day
  cell(6,6,2),  cell(6,7,4),  cell(6,8,9),  cell(6,9,20), cell(6,10,28), cell(6,11,22),
  cell(6,12,15), cell(6,13,10), cell(6,14,7),  cell(6,15,5),  cell(6,16,3),  cell(6,17,3),
  cell(6,18,2),  cell(6,19,2),  cell(6,20,1),  cell(6,21,0),
];

// ─── Weekly Attendance (12 weeks) ─────────────────────────────────────────────

export const weeklyAttendance: WeeklyAttendance[] = [
  { week: "Mar 17", count: 118 },
  { week: "Mar 24", count: 124 },
  { week: "Mar 31", count: 119 },
  { week: "Apr 7",  count: 130 },
  { week: "Apr 14", count: 128 },
  { week: "Apr 21", count: 135 },
  { week: "Apr 28", count: 132 },
  { week: "May 5",  count: 140 },
  { week: "May 12", count: 138 },
  { week: "May 19", count: 145 },
  { week: "May 26", count: 148 },
  { week: "Jun 2",  count: 152 },
];

// ─── Bodyweight Entries (Alex, 16 weeks) ──────────────────────────────────────

export const bodyweightEntries: BodyweightEntry[] = [
  { memberId: "m1", date: "2026-02-24", weightKg: 85.5 },
  { memberId: "m1", date: "2026-03-03", weightKg: 85.2 },
  { memberId: "m1", date: "2026-03-10", weightKg: 84.8 },
  { memberId: "m1", date: "2026-03-17", weightKg: 84.9 },
  { memberId: "m1", date: "2026-03-24", weightKg: 84.4 },
  { memberId: "m1", date: "2026-03-31", weightKg: 84.1 },
  { memberId: "m1", date: "2026-04-07", weightKg: 83.8 },
  { memberId: "m1", date: "2026-04-14", weightKg: 84.0 },
  { memberId: "m1", date: "2026-04-21", weightKg: 83.6 },
  { memberId: "m1", date: "2026-04-28", weightKg: 83.2 },
  { memberId: "m1", date: "2026-05-05", weightKg: 83.0 },
  { memberId: "m1", date: "2026-05-12", weightKg: 83.1 },
  { memberId: "m1", date: "2026-05-19", weightKg: 82.8 },
  { memberId: "m1", date: "2026-05-26", weightKg: 82.6 },
  { memberId: "m1", date: "2026-06-02", weightKg: 82.4 },
  { memberId: "m1", date: "2026-06-09", weightKg: 82.5 },
];

// ─── Monthly Reports (Jan–Dec 2025) ───────────────────────────────────────────

export const monthlyReports: MonthlyReport[] = [
  { month: "Jan 2025", revenue: 14200, newMembers: 12, churnedMembers: 3, avgVisitsPerMember: 8.2 },
  { month: "Feb 2025", revenue: 13800, newMembers:  8, churnedMembers: 4, avgVisitsPerMember: 7.9 },
  { month: "Mar 2025", revenue: 15100, newMembers: 14, churnedMembers: 2, avgVisitsPerMember: 9.1 },
  { month: "Apr 2025", revenue: 15600, newMembers: 11, churnedMembers: 3, avgVisitsPerMember: 9.4 },
  { month: "May 2025", revenue: 16200, newMembers: 15, churnedMembers: 2, avgVisitsPerMember: 9.8 },
  { month: "Jun 2025", revenue: 15900, newMembers:  9, churnedMembers: 4, avgVisitsPerMember: 9.2 },
  { month: "Jul 2025", revenue: 14500, newMembers:  7, churnedMembers: 5, avgVisitsPerMember: 8.4 },
  { month: "Aug 2025", revenue: 15300, newMembers: 10, churnedMembers: 3, avgVisitsPerMember: 8.9 },
  { month: "Sep 2025", revenue: 17100, newMembers: 18, churnedMembers: 2, avgVisitsPerMember: 9.6 },
  { month: "Oct 2025", revenue: 17800, newMembers: 16, churnedMembers: 3, avgVisitsPerMember: 10.1 },
  { month: "Nov 2025", revenue: 18200, newMembers: 13, churnedMembers: 2, avgVisitsPerMember: 10.4 },
  { month: "Dec 2025", revenue: 17400, newMembers:  8, churnedMembers: 4, avgVisitsPerMember: 9.7 },
];

// ─── KPI Snapshot ─────────────────────────────────────────────────────────────

export const kpiSnapshot: KpiSnapshot = {
  activeMembersTotal: 127,
  mtdRevenue: 18450,
  newSignUpsThisMonth: 8,
  avgVisitsPerWeek: 3.2,
};

// ─── Helper Functions ─────────────────────────────────────────────────────────

export interface StrengthPoint {
  date: string;
  maxWeightKg: number;
}

export function getStrengthProgression(exerciseName: string, memberId: string): StrengthPoint[] {
  return workoutSessions
    .filter((s) => s.memberId === memberId && s.exercises.some((e) => e.name === exerciseName))
    .map((s) => {
      const ex = s.exercises.find((e) => e.name === exerciseName)!;
      const maxWeight = Math.max(...ex.sets.map((set) => set.weightKg));
      return { date: s.date, maxWeightKg: maxWeight };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

export interface LastPerformed {
  date: string;
  maxWeightKg: number;
  reps: number;
}

export function getLastPerformed(exerciseName: string, memberId: string): LastPerformed | null {
  const sessions = workoutSessions
    .filter((s) => s.memberId === memberId && s.exercises.some((e) => e.name === exerciseName))
    .sort((a, b) => b.date.localeCompare(a.date));

  if (sessions.length === 0) return null;
  const last = sessions[0];
  const ex = last.exercises.find((e) => e.name === exerciseName)!;
  const best = ex.sets.reduce((b, s) => (s.weightKg > b.weightKg ? s : b));
  return { date: last.date, maxWeightKg: best.weightKg, reps: best.reps };
}
