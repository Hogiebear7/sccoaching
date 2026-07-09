import { mkdirSync, existsSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { randomUUID, randomBytes, createHash } from "crypto";

import type {
  CyclePrivacyPreferencesRecord,
  CycleSettingsRecord,
  ProfileRecord,
  UserRecord,
} from "@/lib/profile-schema";

export type StoredUser = UserRecord & { passwordHash: string };

interface ResetTokenRecord {
  tokenHash: string;
  userId: string;
  expiresAt: string;
  createdAt: string;
}

export type ProgrammeStatus = "active" | "paused" | "completed";

export interface ProgrammeRecord {
  id: string;
  userId: string;
  title: string;
  phase: string | null;
  focus: string | null;
  status: ProgrammeStatus;
  startDate: string | null;
  currentWeek: number | null;
  totalWeeks: number | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export type ExerciseSection = "upper_push" | "upper_pull" | "lower_push" | "lower_pull";

export interface ExerciseRecord {
  id: string;
  name: string;
  section: ExerciseSection;
  createdAt: string;
  updatedAt: string;
}

// Snapshot stored inline on each session row so historical records remain
// readable even if the library exercise is later renamed or deleted.
export interface WorkoutExerciseEntry {
  exerciseId: string | null;
  name: string;
  weight: string | null;
  reps: number | null;
  sets: number | null;
  notes: string | null;
}

export interface WorkoutRunEntry {
  distance: number | null;
  distanceUnit: "km";
  durationSecs: number | null;
  reps: number | null;
  sets: number | null;
  notes: string | null;
}

export interface WorkoutSessionRecord {
  id: string;
  userId: string;
  date: string;
  title: string;
  durationMins: number | null;
  notes: string | null;
  exercises: WorkoutExerciseEntry[];
  runs: WorkoutRunEntry[];
  createdAt: string;
  updatedAt: string;
}

export interface AiMessageRecord {
  id: string;
  userId: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

export interface BodyWeightLogRecord {
  id: string;
  userId: string;
  date: string;
  weightKg: number;
  createdAt: string;
}

// ClassCategory is a string alias for category slugs. Valid values are the
// slug fields of ClassCategoryRecord rows currently in the DB.
export type ClassCategory = string;

export interface ClassCategoryRecord {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  updatedAt: string;
}

// Seeded into fresh installs only. Existing DBs already have their own
// category rows and are not affected by changes here.
const DEFAULT_CLASS_CATEGORIES: ClassCategoryRecord[] = [
  { id: "cat_general", slug: "general", name: "General", createdAt: "2024-01-01T00:00:00.000Z", updatedAt: "2024-01-01T00:00:00.000Z" },
  { id: "cat_strength", slug: "strength", name: "Strength", createdAt: "2024-01-01T00:00:00.000Z", updatedAt: "2024-01-01T00:00:00.000Z" },
  { id: "cat_cardio", slug: "cardio", name: "Cardio", createdAt: "2024-01-01T00:00:00.000Z", updatedAt: "2024-01-01T00:00:00.000Z" },
  { id: "cat_mother_and_baby", slug: "mother_and_baby", name: "Mother & Baby", createdAt: "2024-01-01T00:00:00.000Z", updatedAt: "2024-01-01T00:00:00.000Z" },
  { id: "cat_semi_private_pt", slug: "semi_private_pt", name: "Semi-Private PT", createdAt: "2024-01-01T00:00:00.000Z", updatedAt: "2024-01-01T00:00:00.000Z" },
  { id: "cat_parent_and_baby", slug: "parent_and_baby", name: "Parent and Baby Classes", createdAt: "2024-01-01T00:00:00.000Z", updatedAt: "2024-01-01T00:00:00.000Z" },
];

export interface ClassRecord {
  id: string;
  title: string;
  category: ClassCategory;
  coachUserId: string;
  date: string;
  startTime: string;
  durationMins: number;
  capacity: number;
  createdAt: string;
  updatedAt: string;
}

export interface BookingRecord {
  id: string;
  classId: string;
  userId: string;
  attendedAt: string | null;
  createdAt: string;
}

// FIFO queue for a full class. Position is implied by createdAt order.
//
// Lifecycle: queued → offered → accepted | rejected | expired
//            queued | offered → removed (member withdrew)
// Terminal states (accepted, rejected, expired, removed) are retained for
// audit purposes and purged by the cleanup job once the class has started.
export type WaitlistOfferState =
  | "queued"    // waiting in FIFO line, no slot held
  | "offered"   // provisional offer extended, one slot held against capacity
  | "accepted"  // member accepted; a BookingRecord was created
  | "rejected"  // member explicitly declined
  | "expired"   // offer window elapsed without a response
  | "removed";  // member withdrew from the waitlist

export interface WaitlistEntryRecord {
  id: string;
  classId: string;
  userId: string;
  offerState: WaitlistOfferState;
  offerExpiresAt: string | null;      // ISO — set when state is "offered"
  warningNotifiedAt: string | null;   // set once a window-narrowing warning is sent
  resolvedAt: string | null;          // ISO timestamp when terminal state was reached
  createdAt: string;
}

export interface CoachNoteRecord {
  userId: string;
  notes: string;
  updatedByStaffId: string;
  updatedAt: string;
}

export type BillingInterval = "monthly" | "annual";

export interface MembershipPlanRecord {
  id: string;
  name: string;
  description: string | null;
  // Denominated in EUR cents.
  priceCents: number;
  billingInterval: BillingInterval;
  // Sessions a member can book per billing period. null = unlimited.
  monthlySessionAllowance: number | null;
  // Class categories a member on this plan is allowed to book. Empty means
  // unrestricted (can book any category) — the create/edit form requires
  // staff to explicitly pick at least one to ever persist a restricted
  // plan, so "empty" only ever happens for legacy/unconfigured data.
  allowedCategories: ClassCategory[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

// "none" means no real payment provider is wired up, or the member's plan
// was activated manually by staff — see lib/billing.ts.
export type BillingProvider = "none" | "revolut";

// "pending" = a checkout was created with the provider but payment hasn't
// been confirmed yet (webhook hasn't fired). Only a provider webhook (or a
// staff manual override) should ever move a subscription to "active".
export type SubscriptionStatus = "inactive" | "pending" | "active" | "past_due" | "canceled";

// A manual class-pass credit granted by staff on top of the plan's monthly
// allowance (goodwill, catch-up, promo, correction). Grants apply to the
// current billing period only — they are cleared whenever a fresh period
// begins, alongside sessionsUsedThisPeriod.
export interface ExtraSessionGrant {
  id: string;
  amount: number;
  note: string | null;
  grantedByUserId: string;
  createdAt: string;
}

export interface SubscriptionRecord {
  userId: string;
  planId: string | null;
  status: SubscriptionStatus;
  provider: BillingProvider;
  providerCustomerId: string | null;
  // Revolut subscription ID (for subscription-based billing). Legacy records
  // created before the subscription flow may hold a Revolut order ID instead.
  providerSubscriptionId: string | null;
  // Revolut setup order ID — the one-time order Revolut creates as part of
  // subscription setup for the first payment checkout. Kept separate so
  // providerSubscriptionId always holds the subscription ID that webhook
  // SUBSCRIPTION_* events carry, not the transient setup order ID.
  providerSetupOrderId: string | null;
  currentPeriodEnd: string | null;
  // Timestamp of the last webhook event actually applied to this record.
  // Revolut doesn't guarantee webhook delivery order — comparing incoming
  // events against this prevents a late/out-of-order event from regressing
  // a more current status. Null until the first webhook event lands.
  lastWebhookEventAt: string | null;
  // Sessions consumed against the plan's monthlySessionAllowance during the
  // current billing period. Reset to 0 whenever a fresh period begins (see
  // app/api/billing/webhook/route.ts and the staff manual-override route).
  sessionsUsedThisPeriod: number;
  // Staff-granted extra class passes for the current billing period. Cleared
  // whenever a fresh period begins, alongside sessionsUsedThisPeriod.
  extraSessionGrants: ExtraSessionGrant[];
  // Set by the notify-lapsed-memberships job the first time it messages a
  // member about a lapsed period, so it doesn't re-notify on every run.
  // Reset to null whenever a fresh period begins, alongside sessionsUsedThisPeriod.
  periodLapsedNotifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RecoveryLogRecord {
  id: string;
  userId: string;
  date: string;
  sleepHours: number | null;
  sleepQuality: number | null;
  soreness: number | null;
  fatigue: number | null;
  trainingDurationMins: number | null;
  rpe: number | null;
  goal: string | null;
  notes: string | null;
  readinessScore: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface MessageRecord {
  id: string;
  memberId: string;
  senderId: string;
  senderRole: "member" | "staff";
  body: string;
  readAt: string | null;
  createdAt: string;
}

export interface PushSubscriptionRecord {
  id: string;
  userId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent: string | null;
  createdAt: string;
  updatedAt: string;
}

export type NotificationType =
  | "message"
  | "membership"
  | "class_reminder"
  | "cancellation"
  | "waitlist_offer"
  | "waitlist_timeout";

export interface NotificationRecord {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  readAt: string | null;
  linkHref: string | null;
  dedupeKey: string | null;
  createdAt: string;
}

export type JobStatus = "success" | "error";

// One row per individual job execution within a run (see lib/jobs/). Kept
// small and durable so staff/devs can see what ran and what happened
// without needing external logging infrastructure.
export interface JobRunRecord {
  id: string;
  jobName: string;
  status: JobStatus;
  summary: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  trigger: "cron" | "manual";
}

interface Database {
  users: StoredUser[];
  profiles: ProfileRecord[];
  resetTokens: ResetTokenRecord[];
  programmes: ProgrammeRecord[];
  workoutSessions: WorkoutSessionRecord[];
  exercises: ExerciseRecord[];
  aiMessages: AiMessageRecord[];
  bodyWeightLogs: BodyWeightLogRecord[];
  classes: ClassRecord[];
  classCategories: ClassCategoryRecord[];
  // slug → display name for categories that have been deleted. Populated by
  // deleteClassCategory so historical class/plan records still render a
  // human-readable label rather than a raw slug.
  deletedCategoryLabels: Record<string, string>;
  bookings: BookingRecord[];
  coachNotes: CoachNoteRecord[];
  membershipPlans: MembershipPlanRecord[];
  subscriptions: SubscriptionRecord[];
  recoveryLogs: RecoveryLogRecord[];
  messages: MessageRecord[];
  notifications: NotificationRecord[];
  waitlistEntries: WaitlistEntryRecord[];
  jobRuns: JobRunRecord[];
  cycleSettings: CycleSettingsRecord[];
  cyclePrivacyPreferences: CyclePrivacyPreferencesRecord[];
  pushSubscriptions: PushSubscriptionRecord[];
}

const DATA_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "db.json");
const RESET_TOKEN_TTL_MS = 15 * 60 * 1000;

function readDb(): Database {
  if (!existsSync(DB_PATH)) {
    return {
      users: [],
      profiles: [],
      resetTokens: [],
      programmes: [],
      workoutSessions: [],
      exercises: [],
      aiMessages: [],
      bodyWeightLogs: [],
      classes: [],
      classCategories: DEFAULT_CLASS_CATEGORIES,
      deletedCategoryLabels: {},
      bookings: [],
      coachNotes: [],
      membershipPlans: [],
      subscriptions: [],
      recoveryLogs: [],
      messages: [],
      notifications: [],
      waitlistEntries: [],
      jobRuns: [],
      cycleSettings: [],
      cyclePrivacyPreferences: [],
      pushSubscriptions: [],
    };
  }

  const raw = readFileSync(DB_PATH, "utf-8");
  const parsed = JSON.parse(raw) as Partial<Database>;

  return {
    users: (parsed.users ?? []).map((user) => ({ ...user, role: user.role ?? "member" })),
    profiles: (parsed.profiles ?? []).map((p) => ({
      ...p,
      dateOfBirth: p.dateOfBirth ?? null,
      menopauseSupportEnabled: p.menopauseSupportEnabled ?? false,
      reminderTimingsMins: p.reminderTimingsMins ?? null,
      emailNotificationsEnabled: p.emailNotificationsEnabled ?? true,
      pushNotificationsEnabled: p.pushNotificationsEnabled ?? false,
      preferredUnits: p.preferredUnits ?? "metric",
      programmeEnabled: p.programmeEnabled ?? false,
      drinkSettings: p.drinkSettings ?? null,
      drinkSettingsUpdatedAt: p.drinkSettingsUpdatedAt ?? null,
    })),
    resetTokens: parsed.resetTokens ?? [],
    programmes: parsed.programmes ?? [],
    workoutSessions: (parsed.workoutSessions ?? []).map((s) => ({
      ...s,
      exercises: s.exercises ?? [],
      runs: s.runs ?? [],
    })),
    exercises: parsed.exercises ?? [],
    aiMessages: parsed.aiMessages ?? [],
    bodyWeightLogs: parsed.bodyWeightLogs ?? [],
    classes: (parsed.classes ?? []).map((c) => ({ ...c, category: c.category ?? "general" })),
    // Seed built-in categories if the DB predates this field.
    // One-way migration: rows with isActive === false (previously archived) are
    // treated as deleted so they no longer appear in selection UIs.
    classCategories: (parsed.classCategories ?? DEFAULT_CLASS_CATEGORIES).filter(
      (c) => (c as { isActive?: boolean }).isActive !== false
    ),
    deletedCategoryLabels: parsed.deletedCategoryLabels ?? {},
    bookings: parsed.bookings ?? [],
    coachNotes: parsed.coachNotes ?? [],
    membershipPlans: (parsed.membershipPlans ?? []).map((plan) => ({
      ...plan,
      monthlySessionAllowance: plan.monthlySessionAllowance ?? null,
      allowedCategories: plan.allowedCategories ?? [],
    })),
    subscriptions: (parsed.subscriptions ?? []).map((s) => ({
      ...s,
      providerSetupOrderId: s.providerSetupOrderId ?? null,
      sessionsUsedThisPeriod: s.sessionsUsedThisPeriod ?? 0,
      extraSessionGrants: s.extraSessionGrants ?? [],
      periodLapsedNotifiedAt: s.periodLapsedNotifiedAt ?? null,
    })),
    recoveryLogs: parsed.recoveryLogs ?? [],
    messages: (parsed.messages ?? []).map((m) => ({ ...m, readAt: m.readAt ?? null })),
    notifications: (parsed.notifications ?? []).map((n) => ({
      ...n,
      readAt: n.readAt ?? null,
      linkHref: n.linkHref ?? null,
      dedupeKey: n.dedupeKey ?? null,
    })),
    waitlistEntries: (parsed.waitlistEntries ?? []).map((e) => ({
      ...e,
      offerState: e.offerState ?? "queued",
      offerExpiresAt: e.offerExpiresAt ?? null,
      warningNotifiedAt: e.warningNotifiedAt ?? null,
      resolvedAt: e.resolvedAt ?? null,
    })),
    jobRuns: parsed.jobRuns ?? [],
    cycleSettings: parsed.cycleSettings ?? [],
    cyclePrivacyPreferences: parsed.cyclePrivacyPreferences ?? [],
    pushSubscriptions: (parsed.pushSubscriptions ?? []).map((s) => ({
      ...s,
      userAgent: s.userAgent ?? null,
    })),
  };
}

function writeDb(db: Database) {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }

  writeFileSync(DB_PATH, JSON.stringify(db, null, 2), "utf-8");
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function findUserByEmail(email: string): StoredUser | undefined {
  const db = readDb();
  return db.users.find((user) => user.email.toLowerCase() === email.toLowerCase());
}

export function findUserById(id: string): StoredUser | undefined {
  const db = readDb();
  return db.users.find((user) => user.id === id);
}

export function findStaffUsers(): StoredUser[] {
  const db = readDb();
  return db.users.filter((user) => user.role === "staff");
}

// Used as the attributed sender for system-generated messages that aren't
// tied to a specific coach (e.g. a lapsed-membership notice from a job).
export function findAnyStaffUser(): StoredUser | undefined {
  const db = readDb();
  return db.users.find((user) => user.role === "staff");
}

export function findMembers(): StoredUser[] {
  const db = readDb();
  return db.users.filter((user) => user.role === "member");
}

export function createUser(email: string, passwordHash: string): StoredUser {
  const db = readDb();
  const now = new Date().toISOString();

  const user: StoredUser = {
    id: randomUUID(),
    email,
    passwordHash,
    role: "member",
    createdAt: now,
    updatedAt: now,
  };

  db.users.push(user);
  writeDb(db);

  return user;
}

export function updateUserPassword(userId: string, passwordHash: string) {
  const db = readDb();
  const user = db.users.find((u) => u.id === userId);
  if (!user) return;

  user.passwordHash = passwordHash;
  user.updatedAt = new Date().toISOString();
  writeDb(db);
}

export function updateUserEmail(userId: string, email: string): boolean {
  const db = readDb();
  const user = db.users.find((u) => u.id === userId);
  if (!user) return false;

  const emailTaken = db.users.some(
    (u) => u.id !== userId && u.email.toLowerCase() === email.toLowerCase()
  );
  if (emailTaken) return false;

  user.email = email;
  user.updatedAt = new Date().toISOString();
  writeDb(db);
  return true;
}

export function findProfileByUserId(userId: string): ProfileRecord | undefined {
  const db = readDb();
  return db.profiles.find((profile) => profile.userId === userId);
}

export function saveProfile(profile: ProfileRecord) {
  const db = readDb();
  const index = db.profiles.findIndex((p) => p.userId === profile.userId);

  if (index === -1) {
    db.profiles.push(profile);
  } else {
    db.profiles[index] = profile;
  }

  writeDb(db);
}

export function findProgrammeByUserId(userId: string): ProgrammeRecord | undefined {
  const db = readDb();
  return db.programmes.find((programme) => programme.userId === userId);
}

export function saveProgramme(programme: ProgrammeRecord) {
  const db = readDb();
  const index = db.programmes.findIndex((p) => p.userId === programme.userId);

  if (index === -1) {
    db.programmes.push(programme);
  } else {
    db.programmes[index] = programme;
  }

  writeDb(db);
}

export function findWorkoutSessionsByUserId(userId: string): WorkoutSessionRecord[] {
  const db = readDb();
  return db.workoutSessions
    .filter((session) => session.userId === userId)
    .sort((a, b) => b.date.localeCompare(a.date));
}

export function saveWorkoutSession(session: WorkoutSessionRecord) {
  const db = readDb();
  const index = db.workoutSessions.findIndex((s) => s.id === session.id);

  if (index === -1) {
    db.workoutSessions.push(session);
  } else {
    db.workoutSessions[index] = session;
  }

  writeDb(db);
}

export function findClasses(): ClassRecord[] {
  const db = readDb();
  return db.classes.sort(
    (a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime)
  );
}

export function findClassById(id: string): ClassRecord | undefined {
  const db = readDb();
  return db.classes.find((classRecord) => classRecord.id === id);
}

export function saveClass(classRecord: ClassRecord) {
  const db = readDb();
  const index = db.classes.findIndex((c) => c.id === classRecord.id);

  if (index === -1) {
    db.classes.push(classRecord);
  } else {
    db.classes[index] = classRecord;
  }

  writeDb(db);
}

export function findClassCategories(): ClassCategoryRecord[] {
  const db = readDb();
  return db.classCategories.sort((a, b) => a.name.localeCompare(b.name));
}

export function findClassCategoryById(id: string): ClassCategoryRecord | undefined {
  const db = readDb();
  return db.classCategories.find((c) => c.id === id);
}

export function findClassCategoryBySlug(slug: string): ClassCategoryRecord | undefined {
  const db = readDb();
  return db.classCategories.find((c) => c.slug === slug);
}

export function saveClassCategory(category: ClassCategoryRecord) {
  const db = readDb();
  const index = db.classCategories.findIndex((c) => c.id === category.id);
  if (index === -1) {
    db.classCategories.push(category);
  } else {
    db.classCategories[index] = category;
  }
  writeDb(db);
}

export function deleteClassCategory(id: string) {
  const db = readDb();
  const toDelete = db.classCategories.find((c) => c.id === id);
  if (toDelete) {
    db.deletedCategoryLabels = { ...db.deletedCategoryLabels, [toDelete.slug]: toDelete.name };
  }
  db.classCategories = db.classCategories.filter((c) => c.id !== id);
  writeDb(db);
}

export function findDeletedCategoryLabels(): Record<string, string> {
  const db = readDb();
  return db.deletedCategoryLabels;
}

export function findBookingsByClassId(classId: string): BookingRecord[] {
  const db = readDb();
  return db.bookings.filter((booking) => booking.classId === classId);
}

export function findBookingsByUserId(userId: string): BookingRecord[] {
  const db = readDb();
  return db.bookings.filter((booking) => booking.userId === userId);
}

export function findBookingById(id: string): BookingRecord | undefined {
  const db = readDb();
  return db.bookings.find((booking) => booking.id === id);
}

export function deleteBooking(id: string) {
  const db = readDb();
  db.bookings = db.bookings.filter((booking) => booking.id !== id);
  writeDb(db);
}

export function updateBookingAttendance(id: string, attended: boolean): boolean {
  const db = readDb();
  const booking = db.bookings.find((b) => b.id === id);
  if (!booking) return false;

  booking.attendedAt = attended ? new Date().toISOString() : null;
  writeDb(db);
  return true;
}

export function createBooking(booking: BookingRecord) {
  const db = readDb();
  db.bookings.push(booking);
  writeDb(db);
}

export function findCoachNoteByUserId(userId: string): CoachNoteRecord | undefined {
  const db = readDb();
  return db.coachNotes.find((note) => note.userId === userId);
}

export function saveCoachNote(note: CoachNoteRecord) {
  const db = readDb();
  const index = db.coachNotes.findIndex((n) => n.userId === note.userId);

  if (index === -1) {
    db.coachNotes.push(note);
  } else {
    db.coachNotes[index] = note;
  }

  writeDb(db);
}

export function findMembershipPlans(): MembershipPlanRecord[] {
  const db = readDb();
  return db.membershipPlans.sort((a, b) => a.priceCents - b.priceCents);
}

export function findMembershipPlanById(id: string): MembershipPlanRecord | undefined {
  const db = readDb();
  return db.membershipPlans.find((plan) => plan.id === id);
}

export function saveMembershipPlan(plan: MembershipPlanRecord) {
  const db = readDb();
  const index = db.membershipPlans.findIndex((p) => p.id === plan.id);

  if (index === -1) {
    db.membershipPlans.push(plan);
  } else {
    db.membershipPlans[index] = plan;
  }

  writeDb(db);
}

export function findSubscriptionByUserId(userId: string): SubscriptionRecord | undefined {
  const db = readDb();
  return db.subscriptions.find((subscription) => subscription.userId === userId);
}

export function findSubscriptionByProviderOrderId(
  providerOrderId: string
): SubscriptionRecord | undefined {
  const db = readDb();
  return db.subscriptions.find(
    (subscription) => subscription.providerSubscriptionId === providerOrderId
  );
}

export function saveSubscription(subscription: SubscriptionRecord) {
  const db = readDb();
  const index = db.subscriptions.findIndex((s) => s.userId === subscription.userId);

  if (index === -1) {
    db.subscriptions.push(subscription);
  } else {
    db.subscriptions[index] = subscription;
  }

  writeDb(db);
}

export function findRecoveryLogsByUserId(userId: string): RecoveryLogRecord[] {
  const db = readDb();
  return db.recoveryLogs
    .filter((log) => log.userId === userId)
    .sort((a, b) => b.date.localeCompare(a.date));
}

export function findRecoveryLogByUserIdAndDate(
  userId: string,
  date: string
): RecoveryLogRecord | undefined {
  const db = readDb();
  return db.recoveryLogs.find((log) => log.userId === userId && log.date === date);
}

export function saveRecoveryLog(log: RecoveryLogRecord) {
  const db = readDb();
  const index = db.recoveryLogs.findIndex(
    (l) => l.userId === log.userId && l.date === log.date
  );

  if (index === -1) {
    db.recoveryLogs.push(log);
  } else {
    db.recoveryLogs[index] = log;
  }

  writeDb(db);
}

export function findMessagesByMemberId(memberId: string): MessageRecord[] {
  const db = readDb();
  return db.messages
    .filter((message) => message.memberId === memberId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function createMessage(message: MessageRecord) {
  const db = readDb();
  db.messages.push(message);
  writeDb(db);
}

// Active states — the entry is still relevant to capacity and queue position.
// Terminal states (accepted, rejected, expired, removed) are kept for audit
// and purged later by the cleanup job.
const ACTIVE_OFFER_STATES: WaitlistOfferState[] = ["queued", "offered"];

// FIFO order — first to join is first in line for a spot offer.
// Returns only active (queued | offered) entries; terminal entries are
// excluded so members can re-join after a rejection or expiry.
export function findWaitlistEntriesByClassId(classId: string): WaitlistEntryRecord[] {
  const db = readDb();
  return db.waitlistEntries
    .filter(
      (entry) => entry.classId === classId && ACTIVE_OFFER_STATES.includes(entry.offerState)
    )
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

// Active entries for a user (queued or offered only).
export function findWaitlistEntriesByUserId(userId: string): WaitlistEntryRecord[] {
  const db = readDb();
  return db.waitlistEntries.filter(
    (entry) => entry.userId === userId && ACTIVE_OFFER_STATES.includes(entry.offerState)
  );
}

// Active entry for a specific class + user (excludes terminal states so
// members can re-join after a rejection or expiry).
export function findWaitlistEntryByClassAndUser(
  classId: string,
  userId: string
): WaitlistEntryRecord | undefined {
  const db = readDb();
  return db.waitlistEntries.find(
    (entry) =>
      entry.classId === classId &&
      entry.userId === userId &&
      ACTIVE_OFFER_STATES.includes(entry.offerState)
  );
}

// Look up any entry by id regardless of state (needed for the respond endpoint).
export function findWaitlistEntryById(id: string): WaitlistEntryRecord | undefined {
  const db = readDb();
  return db.waitlistEntries.find((entry) => entry.id === id);
}

export function createWaitlistEntry(entry: WaitlistEntryRecord) {
  const db = readDb();
  db.waitlistEntries.push(entry);
  writeDb(db);
}

// In-place update for state transitions (queued → offered → terminal).
export function saveWaitlistEntry(entry: WaitlistEntryRecord) {
  const db = readDb();
  const index = db.waitlistEntries.findIndex((e) => e.id === entry.id);
  if (index === -1) {
    db.waitlistEntries.push(entry);
  } else {
    db.waitlistEntries[index] = entry;
  }
  writeDb(db);
}

// Physical deletion — only used by the cleanup job to purge terminal records
// for classes that have already started.
export function deleteWaitlistEntry(id: string) {
  const db = readDb();
  db.waitlistEntries = db.waitlistEntries.filter((entry) => entry.id !== id);
  writeDb(db);
}

// Returns ALL entries across all states — used by the cleanup job so it can
// purge terminal records for past classes.
export function findAllWaitlistEntries(): WaitlistEntryRecord[] {
  const db = readDb();
  return db.waitlistEntries;
}

export function findAllSubscriptions(): SubscriptionRecord[] {
  const db = readDb();
  return db.subscriptions;
}

// Purges reset tokens past their expiry, independent of consumeResetToken's
// lazy on-read cleanup — useful as an explicit periodic housekeeping job.
// Returns the number removed.
export function purgeExpiredResetTokens(): number {
  const db = readDb();
  const now = new Date().toISOString();
  const before = db.resetTokens.length;

  db.resetTokens = db.resetTokens.filter((entry) => entry.expiresAt > now);

  writeDb(db);
  return before - db.resetTokens.length;
}

export function createResetToken(userId: string): { token: string; expiresAt: string } {
  const db = readDb();
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS).toISOString();

  db.resetTokens.push({
    tokenHash: hashToken(token),
    userId,
    expiresAt,
    createdAt: new Date().toISOString(),
  });

  writeDb(db);

  return { token, expiresAt };
}

export function consumeResetToken(token: string): string | undefined {
  const db = readDb();
  const now = new Date().toISOString();

  // Drop expired tokens before checking the submitted one.
  db.resetTokens = db.resetTokens.filter((entry) => entry.expiresAt > now);

  const tokenHash = hashToken(token);
  const match = db.resetTokens.find((entry) => entry.tokenHash === tokenHash);

  if (!match) {
    writeDb(db);
    return undefined;
  }

  const { userId } = match;

  // A successful reset invalidates every other outstanding token for this user.
  db.resetTokens = db.resetTokens.filter((entry) => entry.userId !== userId);

  writeDb(db);

  return userId;
}

const MAX_STORED_JOB_RUNS = 200;

export function createJobRun(run: JobRunRecord) {
  const db = readDb();
  db.jobRuns.push(run);

  // Keep storage bounded — this is operational history, not an audit log.
  if (db.jobRuns.length > MAX_STORED_JOB_RUNS) {
    db.jobRuns = db.jobRuns.slice(db.jobRuns.length - MAX_STORED_JOB_RUNS);
  }

  writeDb(db);
}

export function findRecentJobRuns(limit: number): JobRunRecord[] {
  const db = readDb();
  return [...db.jobRuns].sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, limit);
}

export function findCycleSettingsByUserId(userId: string): CycleSettingsRecord | undefined {
  const db = readDb();
  return db.cycleSettings.find((s) => s.userId === userId);
}

export function saveCycleSettings(settings: CycleSettingsRecord) {
  const db = readDb();
  const index = db.cycleSettings.findIndex((s) => s.userId === settings.userId);
  if (index === -1) {
    db.cycleSettings.push(settings);
  } else {
    db.cycleSettings[index] = settings;
  }
  writeDb(db);
}

export function findCyclePrivacyByUserId(userId: string): CyclePrivacyPreferencesRecord | undefined {
  const db = readDb();
  return db.cyclePrivacyPreferences.find((p) => p.userId === userId);
}

export function saveCyclePrivacy(prefs: CyclePrivacyPreferencesRecord) {
  const db = readDb();
  const index = db.cyclePrivacyPreferences.findIndex((p) => p.userId === prefs.userId);
  if (index === -1) {
    db.cyclePrivacyPreferences.push(prefs);
  } else {
    db.cyclePrivacyPreferences[index] = prefs;
  }
  writeDb(db);
}

// Exercise library

export function findExercises(): ExerciseRecord[] {
  const db = readDb();
  return [...db.exercises].sort(
    (a, b) => a.section.localeCompare(b.section) || a.name.localeCompare(b.name)
  );
}

export function findExerciseById(id: string): ExerciseRecord | undefined {
  const db = readDb();
  return db.exercises.find((e) => e.id === id);
}

export function saveExercise(exercise: ExerciseRecord) {
  const db = readDb();
  const index = db.exercises.findIndex((e) => e.id === exercise.id);
  if (index === -1) {
    db.exercises.push(exercise);
  } else {
    db.exercises[index] = exercise;
  }
  writeDb(db);
}

// Historical workout rows store their own exerciseId+name snapshot, so
// there is no integrity risk from hard-deleting a library exercise.
export function deleteExercise(id: string) {
  const db = readDb();
  db.exercises = db.exercises.filter((e) => e.id !== id);
  writeDb(db);
}

// AI chat messages (member-facing, deferred to Slice 3)

export function findAiMessagesByUserId(userId: string): AiMessageRecord[] {
  const db = readDb();
  return db.aiMessages
    .filter((m) => m.userId === userId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function createAiMessage(message: AiMessageRecord) {
  const db = readDb();
  db.aiMessages.push(message);
  writeDb(db);
}

// Bodyweight logs (member-facing, deferred to Slice 7)

export function findBodyWeightLogsByUserId(userId: string): BodyWeightLogRecord[] {
  const db = readDb();
  return db.bodyWeightLogs
    .filter((l) => l.userId === userId)
    .sort((a, b) => b.date.localeCompare(a.date));
}

export function saveBodyWeightLog(log: BodyWeightLogRecord) {
  const db = readDb();
  const index = db.bodyWeightLogs.findIndex((l) => l.id === log.id);
  if (index === -1) {
    db.bodyWeightLogs.push(log);
  } else {
    db.bodyWeightLogs[index] = log;
  }
  writeDb(db);
}

const MAX_STORED_NOTIFICATIONS = 500;

export function findNotificationsByUserId(userId: string): NotificationRecord[] {
  const db = readDb();
  return db.notifications
    .filter((n) => n.userId === userId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function findUnreadNotificationCount(userId: string): number {
  const db = readDb();
  return db.notifications.filter((n) => n.userId === userId && n.readAt === null).length;
}

export function createNotification(notification: NotificationRecord) {
  const db = readDb();
  db.notifications.push(notification);

  if (db.notifications.length > MAX_STORED_NOTIFICATIONS) {
    // Keep the most recent records per user — cull oldest globally
    db.notifications = db.notifications
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, MAX_STORED_NOTIFICATIONS);
  }

  writeDb(db);
}

export function markNotificationRead(id: string, userId: string): boolean {
  const db = readDb();
  const n = db.notifications.find((x) => x.id === id && x.userId === userId);
  if (!n) return false;
  n.readAt = new Date().toISOString();
  writeDb(db);
  return true;
}

export function markAllNotificationsRead(userId: string) {
  const db = readDb();
  const now = new Date().toISOString();
  db.notifications.forEach((n) => {
    if (n.userId === userId && n.readAt === null) {
      n.readAt = now;
    }
  });
  writeDb(db);
}

export function findNotificationByDedupeKey(
  userId: string,
  dedupeKey: string
): NotificationRecord | undefined {
  const db = readDb();
  return db.notifications.find((n) => n.userId === userId && n.dedupeKey === dedupeKey);
}

export function findAllBookings(): BookingRecord[] {
  const db = readDb();
  return db.bookings;
}

// ─── Push subscriptions ────────────────────────────────────────────────────────

// Upsert by (userId, endpoint): updates keys + updatedAt for an existing
// endpoint instead of inserting a duplicate row.
export function savePushSubscription(sub: PushSubscriptionRecord): void {
  const db = readDb();
  const existing = db.pushSubscriptions.find(
    (s) => s.userId === sub.userId && s.endpoint === sub.endpoint
  );
  if (existing) {
    existing.p256dh = sub.p256dh;
    existing.auth = sub.auth;
    existing.userAgent = sub.userAgent;
    existing.updatedAt = sub.updatedAt;
  } else {
    db.pushSubscriptions.push(sub);
  }
  writeDb(db);
}

export function findPushSubscriptionsByUserId(userId: string): PushSubscriptionRecord[] {
  const db = readDb();
  return db.pushSubscriptions.filter((s) => s.userId === userId);
}

// Scoped to userId so a user can only remove their own subscriptions.
export function deletePushSubscriptionByEndpoint(userId: string, endpoint: string): void {
  const db = readDb();
  db.pushSubscriptions = db.pushSubscriptions.filter(
    (s) => !(s.userId === userId && s.endpoint === endpoint)
  );
  writeDb(db);
}
