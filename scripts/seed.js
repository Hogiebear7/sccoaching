// Demo seed script. Replaces data/db.json with a small, realistic dataset
// covering every membership/recovery/messaging/booking state in the app, so
// the prototype can be demoed without manually clicking through every flow
// first. Safe to re-run — it always starts from a clean slate.
//
// Usage: npm run seed

const { mkdirSync, writeFileSync } = require("fs");
const path = require("path");
const { randomUUID, randomBytes, scryptSync } = require("crypto");

const DATA_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "db.json");

const DEMO_PASSWORD = "Demo1234!";

// Mirrors lib/password.ts's hashPassword() — keep these in sync.
function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

// Mirrors lib/recovery.ts's computeReadinessScore() — keep these in sync.
function computeReadinessScore({ sleepHours, sleepQuality, soreness, fatigue }) {
  const clamp = (v, min, max) => Math.min(Math.max(v, min), max);
  const sleepHoursScore = (clamp(sleepHours, 0, 8) / 8) * 25;
  const sleepQualityScore = (clamp(sleepQuality - 1, 0, 4) / 4) * 25;
  const sorenessScore = (clamp(5 - soreness, 0, 4) / 4) * 25;
  const fatigueScore = (clamp(5 - fatigue, 0, 4) / 4) * 25;
  return Math.round(sleepHoursScore + sleepQualityScore + sorenessScore + fatigueScore);
}

function isoDaysAgo(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

function isoMinutesAgo(minutes) {
  const d = new Date();
  d.setMinutes(d.getMinutes() - minutes);
  return d.toISOString();
}

function dateStringDaysFromNow(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function dateStringDaysAgo(days) {
  return dateStringDaysFromNow(-days);
}

const now = new Date().toISOString();

// --- Users -----------------------------------------------------------
const coach = {
  id: randomUUID(),
  email: "coach@demo.local",
  role: "staff",
  createdAt: now,
  updatedAt: now,
  passwordHash: hashPassword(DEMO_PASSWORD),
};

const alex = { id: randomUUID(), email: "alex@demo.local", role: "member", createdAt: now, updatedAt: now, passwordHash: hashPassword(DEMO_PASSWORD) };
const jordan = { id: randomUUID(), email: "jordan@demo.local", role: "member", createdAt: now, updatedAt: now, passwordHash: hashPassword(DEMO_PASSWORD) };
const sam = { id: randomUUID(), email: "sam@demo.local", role: "member", createdAt: now, updatedAt: now, passwordHash: hashPassword(DEMO_PASSWORD) };
const taylor = { id: randomUUID(), email: "taylor@demo.local", role: "member", createdAt: now, updatedAt: now, passwordHash: hashPassword(DEMO_PASSWORD) };
const morgan = { id: randomUUID(), email: "morgan@demo.local", role: "member", createdAt: now, updatedAt: now, passwordHash: hashPassword(DEMO_PASSWORD) };
const riley = { id: randomUUID(), email: "riley@demo.local", role: "member", createdAt: now, updatedAt: now, passwordHash: hashPassword(DEMO_PASSWORD) };

const users = [coach, alex, jordan, sam, taylor, morgan, riley];

// --- Profiles ----------------------------------------------------------
function profileFor(user, overrides) {
  return {
    userId: user.id,
    fullName: overrides.fullName,
    email: user.email,
    phone: "+1 555 0100",
    gender: overrides.gender ?? "Other",
    primaryGoal: overrides.primaryGoal ?? "General Health",
    sportPlayed: null,
    currentWeightKg: overrides.currentWeightKg ?? null,
    additionalInfo: null,
    cycleTrackingEligible: overrides.gender === "Female",
    cycleTrackingEnabled: overrides.cycleTrackingEnabled ?? false,
    onboardingCompleted: true,
    createdAt: now,
    updatedAt: now,
  };
}

const profiles = [
  profileFor(coach, { fullName: "Casey Coach", gender: "Other" }),
  profileFor(alex, { fullName: "Alex Athlete", gender: "Male", primaryGoal: "Build Muscle", currentWeightKg: 78 }),
  profileFor(jordan, { fullName: "Jordan Jogger", gender: "Female", primaryGoal: "Improve Fitness", currentWeightKg: 64, cycleTrackingEnabled: true }),
  profileFor(sam, { fullName: "Sam Starter", gender: "Other", primaryGoal: "Weight Loss", currentWeightKg: 90 }),
  profileFor(taylor, { fullName: "Taylor Trainer", gender: "Male", primaryGoal: "Sports Performance", currentWeightKg: 82 }),
  profileFor(morgan, { fullName: "Morgan Mum", gender: "Female", primaryGoal: "General Health", currentWeightKg: 68, cycleTrackingEnabled: true }),
  profileFor(riley, { fullName: "Riley Runner", gender: "Other", primaryGoal: "Improve Fitness", currentWeightKg: 71 }),
];

// --- Cycle tracking data (Morgan and Jordan only) -------------------------
// Morgan: shares phase with coach so staff can see "Day N of ~28" on her
//         member detail page. Dates and notes remain private.
// Jordan: all private — demonstrates the "private" staff-panel state.
const cycleSettings = [
  {
    userId: morgan.id,
    lastPeriodStartDate: dateStringDaysAgo(14),
    averageCycleLengthDays: 28,
    periodLengthDays: 5,
    regularity: "Regular",
    privateNotes: null,
    createdAt: isoDaysAgo(14),
    updatedAt: isoDaysAgo(14),
  },
  {
    userId: jordan.id,
    lastPeriodStartDate: dateStringDaysAgo(7),
    averageCycleLengthDays: 30,
    periodLengthDays: 4,
    regularity: "Irregular",
    privateNotes: null,
    createdAt: isoDaysAgo(7),
    updatedAt: isoDaysAgo(7),
  },
];

const cyclePrivacyPreferences = [
  {
    userId: morgan.id,
    shareCurrentPhaseWithCoach: true,
    shareExactDatesWithCoach: false,
    shareNotesWithCoach: false,
    createdAt: isoDaysAgo(14),
    updatedAt: isoDaysAgo(14),
  },
  {
    userId: jordan.id,
    shareCurrentPhaseWithCoach: false,
    shareExactDatesWithCoach: false,
    shareNotesWithCoach: false,
    createdAt: isoDaysAgo(7),
    updatedAt: isoDaysAgo(7),
  },
];

// --- Membership catalog (Category → Package → Billing Option) -------------
// General-purpose categories every "normal" package can book.
const GENERAL_CATEGORIES = ["general", "strength", "cardio"];

const gymCategory = {
  id: randomUUID(),
  name: "Gym Memberships",
  slug: "gym-memberships",
  description: "Recurring memberships for classes and gym-floor access.",
  sortOrder: 0,
  visible: true,
  createdAt: now,
  updatedAt: now,
};

function pkg(name, shortDescription, allowanceType, count, eligible, sortOrder) {
  return {
    id: randomUUID(),
    categoryId: gymCategory.id,
    name,
    slug: name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""),
    shortDescription,
    fullDescription: null,
    packageType: "membership",
    sessionAllowanceType: allowanceType,
    sessionAllowanceCount: count,
    eligibleClassTypes: eligible,
    visible: true,
    sortOrder,
    stripeProductId: null,
    createdAt: now,
    updatedAt: now,
  };
}

function recurringOption(packageId, name, interval, priceCents, sortOrder) {
  const [unit, count] =
    interval === "annual" ? ["year", 1] : interval === "quarterly" ? ["month", 3] : ["month", 1];
  return {
    id: randomUUID(),
    packageId,
    name,
    billingType: "recurring",
    intervalUnit: unit,
    intervalCount: count,
    amountCents: priceCents,
    currency: "eur",
    visible: true,
    sortOrder,
    stripePriceId: null,
    createdAt: now,
    updatedAt: now,
  };
}

const basicPackage = pkg("Basic", "Open classes with a monthly session cap.", "fixed_count", 8, GENERAL_CATEGORIES, 0);
const premiumPackage = pkg("Premium", "Full access to all general classes and coaching.", "unlimited", null, GENERAL_CATEGORIES, 1);
const motherAndBabyPackage = pkg("Mother & Baby", "Access to Mother & Baby classes only.", "fixed_count", 8, ["mother_and_baby"], 2);

const membershipCategories = [gymCategory];
const membershipPackages = [basicPackage, premiumPackage, motherAndBabyPackage];

const basicMonthly = recurringOption(basicPackage.id, "Monthly", "monthly", 2999, 0);
const premiumMonthly = recurringOption(premiumPackage.id, "Monthly", "monthly", 4999, 0);
const premiumAnnual = recurringOption(premiumPackage.id, "Annual", "annual", 49900, 1);
const motherAndBabyMonthly = recurringOption(motherAndBabyPackage.id, "Monthly", "monthly", 3499, 0);

const membershipBillingOptions = [basicMonthly, premiumMonthly, premiumAnnual, motherAndBabyMonthly];

// --- Subscriptions: one of each demo-relevant state ----------------------
const subscriptions = [
  // Alex: active, unlimited Premium, manually activated by staff (cash
  // payment scenario), with a future period end so the "renews on X"
  // messaging shows correctly.
  {
    userId: alex.id,
    packageId: premiumPackage.id,
    billingOptionId: premiumMonthly.id,
    status: "active",
    provider: "none",
    providerCustomerId: null,
    providerSubscriptionId: null,
    currentPeriodEnd: dateStringDaysFromNow(20),
    lastWebhookEventAt: null,
    sessionsUsedThisPeriod: 1,
    periodLapsedNotifiedAt: null,
    createdAt: isoDaysAgo(40),
    updatedAt: isoDaysAgo(40),
  },
  // Jordan: pending — selected a plan minutes ago, genuinely still awaiting
  // payment confirmation (well within the 30-minute stale-checkout window).
  // Also on the Evening Conditioning waitlist — demonstrates a waitlisted
  // member who'd be skipped on promotion because her membership isn't
  // active yet. Naturally becomes a real expire-stale-checkouts case once
  // this sits for 30+ minutes without a reseed.
  {
    userId: jordan.id,
    packageId: basicPackage.id,
    billingOptionId: basicMonthly.id,
    status: "pending",
    provider: "none",
    providerCustomerId: null,
    providerSubscriptionId: null,
    currentPeriodEnd: null,
    lastWebhookEventAt: null,
    sessionsUsedThisPeriod: 0,
    periodLapsedNotifiedAt: null,
    createdAt: isoMinutesAgo(5),
    updatedAt: isoMinutesAgo(5),
  },
  // Taylor: past_due — payment failed / lapsed
  {
    userId: taylor.id,
    packageId: premiumPackage.id,
    billingOptionId: premiumMonthly.id,
    status: "past_due",
    provider: "none",
    providerCustomerId: null,
    providerSubscriptionId: null,
    currentPeriodEnd: dateStringDaysAgo(3),
    lastWebhookEventAt: null,
    sessionsUsedThisPeriod: 0,
    periodLapsedNotifiedAt: null,
    createdAt: isoDaysAgo(60),
    updatedAt: isoDaysAgo(3),
  },
  // Morgan: active Mother & Baby plan — can only book mother_and_baby
  // classes, with most of her monthly allowance still remaining.
  {
    userId: morgan.id,
    packageId: motherAndBabyPackage.id,
    billingOptionId: motherAndBabyMonthly.id,
    status: "active",
    provider: "none",
    providerCustomerId: null,
    providerSubscriptionId: null,
    currentPeriodEnd: dateStringDaysFromNow(15),
    lastWebhookEventAt: null,
    sessionsUsedThisPeriod: 1,
    periodLapsedNotifiedAt: null,
    createdAt: isoDaysAgo(10),
    updatedAt: isoDaysAgo(10),
  },
  // Riley: active Premium, but the billing period already ended and the
  // scheduler hasn't caught up to it yet — the cleanest live demo of the
  // notify-lapsed-memberships job. Run housekeeping from Staff Operations
  // (or POST /api/cron/run) to watch it message Riley and flip the badge.
  {
    userId: riley.id,
    packageId: premiumPackage.id,
    billingOptionId: premiumMonthly.id,
    status: "active",
    provider: "none",
    providerCustomerId: null,
    providerSubscriptionId: null,
    currentPeriodEnd: dateStringDaysAgo(2),
    lastWebhookEventAt: null,
    sessionsUsedThisPeriod: 4,
    periodLapsedNotifiedAt: null,
    createdAt: isoDaysAgo(35),
    updatedAt: isoDaysAgo(35),
  },
  // Sam: no subscription record at all — brand new member, no plan selected
];

// --- Classes & bookings ----------------------------------------------------
const upcomingClass1 = {
  id: randomUUID(),
  title: "Morning Strength",
  category: "strength",
  coachUserId: coach.id,
  date: dateStringDaysFromNow(1),
  startTime: "07:00",
  durationMins: 60,
  capacity: 10,
  createdAt: now,
  updatedAt: now,
};

// Capacity 1, already booked by Alex — full, with Jordan waitlisted. Lets
// the demo show the waitlist UI and (once Alex cancels, or Jordan's plan
// activates and someone else cancels) a real promotion.
const upcomingClass2 = {
  id: randomUUID(),
  title: "Evening Conditioning",
  category: "cardio",
  coachUserId: coach.id,
  date: dateStringDaysFromNow(2),
  startTime: "18:00",
  durationMins: 45,
  capacity: 1,
  createdAt: now,
  updatedAt: now,
};

const motherAndBabyClass = {
  id: randomUUID(),
  title: "Mum & Baby Movement",
  category: "mother_and_baby",
  coachUserId: coach.id,
  date: dateStringDaysFromNow(3),
  startTime: "10:30",
  durationMins: 40,
  capacity: 8,
  createdAt: now,
  updatedAt: now,
};

const pastClass = {
  id: randomUUID(),
  title: "Saturday Strength",
  category: "strength",
  coachUserId: coach.id,
  date: dateStringDaysAgo(5),
  startTime: "09:00",
  durationMins: 60,
  capacity: 10,
  createdAt: isoDaysAgo(10),
  updatedAt: isoDaysAgo(10),
};

const classes = [upcomingClass1, upcomingClass2, motherAndBabyClass, pastClass];

const bookings = [
  { id: randomUUID(), classId: upcomingClass1.id, userId: alex.id, attendedAt: null, createdAt: isoDaysAgo(2) },
  { id: randomUUID(), classId: upcomingClass2.id, userId: alex.id, attendedAt: null, createdAt: isoDaysAgo(1) },
  { id: randomUUID(), classId: motherAndBabyClass.id, userId: morgan.id, attendedAt: null, createdAt: isoDaysAgo(1) },
  { id: randomUUID(), classId: pastClass.id, userId: alex.id, attendedAt: isoDaysAgo(5), createdAt: isoDaysAgo(10) },
];

const waitlistEntries = [
  { id: randomUUID(), classId: upcomingClass2.id, userId: jordan.id, createdAt: isoMinutesAgo(3) },
];

// --- Recovery logs for Alex (5 days) ----------------------------------
const recoveryLogs = [];
const recoveryDays = [
  { daysAgo: 4, sleepHours: 6, sleepQuality: 3, soreness: 3, fatigue: 3, trainingDurationMins: 60, rpe: 7, goal: "Squat session" },
  { daysAgo: 3, sleepHours: 7.5, sleepQuality: 4, soreness: 2, fatigue: 2, trainingDurationMins: 45, rpe: 6, goal: "Easy conditioning" },
  { daysAgo: 2, sleepHours: 5, sleepQuality: 2, soreness: 4, fatigue: 4, trainingDurationMins: null, rpe: null, goal: "Rest day" },
  { daysAgo: 1, sleepHours: 8, sleepQuality: 5, soreness: 1, fatigue: 1, trainingDurationMins: 75, rpe: 8, goal: "Heavy upper body" },
  { daysAgo: 0, sleepHours: 7, sleepQuality: 4, soreness: 2, fatigue: 2, trainingDurationMins: 50, rpe: 7, goal: "Technique work" },
];

for (const day of recoveryDays) {
  recoveryLogs.push({
    id: randomUUID(),
    userId: alex.id,
    date: dateStringDaysAgo(day.daysAgo),
    sleepHours: day.sleepHours,
    sleepQuality: day.sleepQuality,
    soreness: day.soreness,
    fatigue: day.fatigue,
    trainingDurationMins: day.trainingDurationMins,
    rpe: day.rpe,
    goal: day.goal,
    notes: null,
    readinessScore: computeReadinessScore(day),
    createdAt: isoDaysAgo(day.daysAgo),
    updatedAt: isoDaysAgo(day.daysAgo),
  });
}

// --- Messages: a short thread between Alex and the coach -----------------
const messages = [
  {
    id: randomUUID(),
    memberId: alex.id,
    senderId: alex.id,
    senderRole: "member",
    body: "Hey Casey, is the Saturday class still on this week?",
    createdAt: isoDaysAgo(2),
  },
  {
    id: randomUUID(),
    memberId: alex.id,
    senderId: coach.id,
    senderRole: "staff",
    body: "Yep, still on for 9am — see you there!",
    createdAt: isoDaysAgo(2),
  },
];

// --- Coach notes -----------------------------------------------------------
const coachNotes = [
  {
    userId: alex.id,
    notes: "Strong squat progress this month. Keep an eye on sleep — readiness dips on low-sleep days.",
    updatedByStaffId: coach.id,
    updatedAt: isoDaysAgo(2),
  },
];

const db = {
  users,
  profiles,
  resetTokens: [],
  programmes: [],
  workoutSessions: [],
  classes,
  bookings,
  coachNotes,
  membershipCategories,
  membershipPackages,
  membershipBillingOptions,
  subscriptions,
  recoveryLogs,
  messages,
  waitlistEntries,
  jobRuns: [],
  cycleSettings,
  cyclePrivacyPreferences,
};

mkdirSync(DATA_DIR, { recursive: true });
writeFileSync(DB_PATH, JSON.stringify(db, null, 2), "utf-8");

console.log("Seeded data/db.json with demo data.\n");
console.log("Demo accounts (all use password: " + DEMO_PASSWORD + "):");
console.log("  Staff:  coach@demo.local   (Casey Coach)");
console.log("  Member: alex@demo.local    (Alex Athlete)   — active Premium (unlimited), 5 days of recovery logs, upcoming + past bookings, message thread");
console.log("  Member: jordan@demo.local  (Jordan Jogger)  — pending Basic membership; waitlisted for the full Evening Conditioning class");
console.log("  Member: sam@demo.local     (Sam Starter)    — no plan selected yet (booking gate will trigger once a plan exists)");
console.log("  Member: taylor@demo.local  (Taylor Trainer) — past_due Premium membership");
console.log("  Member: morgan@demo.local  (Morgan Mum)     — active Mother & Baby plan; cycle tracking enabled, phase shared with coach");
console.log("  Member: jordan@demo.local  (Jordan Jogger)  — cycle tracking enabled but all data private (staff see 'private' message)");
console.log("  Member: riley@demo.local   (Riley Runner)  — active Premium, but the period already lapsed; run housekeeping to see notify-lapsed-memberships fire");
