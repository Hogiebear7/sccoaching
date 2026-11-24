// How a member appears on leaderboards and challenge standings (owner decision 2026-11-24). Three choices, stored on their own CommunityPrivacyRecord:
//   named   the default: their name, as set by "Show my full name"
//   alias   they stay ranked with their numbers showing, but under an alias they pick, so nobody else can wrongly think they are first
//   hidden  not shown at all (the old "off" setting)
// Gym staff (coaches and admins) always see real names for everyone, hidden or not, and are told which entries are hidden from members.
// An aliased member's profile card detail stays private whatever their profile setting says (see the profile route).
import type { CommunityPrivacyRecord } from "./db";

export const LEADERBOARD_MODES = ["named", "alias", "hidden"] as const;
export type LeaderboardMode = (typeof LEADERBOARD_MODES)[number];

export const DEFAULT_ALIAS = "Hidden user";

// The owner supplies 6 to 8 male and 6 to 8 female names to add here. Members can only pick from this list, never type their own, so an alias can never
// be offensive or pass for another real member.
export const MALE_ALIAS_NAMES: readonly string[] = [];
export const FEMALE_ALIAS_NAMES: readonly string[] = [];

export const LEADERBOARD_ALIASES: readonly string[] = [DEFAULT_ALIAS, "Shadow user", ...MALE_ALIAS_NAMES, ...FEMALE_ALIAS_NAMES];

export const isLeaderboardMode = (v: unknown): v is LeaderboardMode => typeof v === "string" && (LEADERBOARD_MODES as readonly string[]).includes(v);
export const isLeaderboardAlias = (v: unknown): v is string => typeof v === "string" && LEADERBOARD_ALIASES.includes(v);

/**
 * The mode that applies. A stored mode wins; a record from before this setting existed falls back to the old on/off switch
 * (leaderboardVisible false meant hidden), so nobody who had switched themselves off is suddenly shown.
 */
export function leaderboardModeOf(privacy: Pick<CommunityPrivacyRecord, "leaderboardMode" | "leaderboardVisible"> | undefined): LeaderboardMode {
  if (isLeaderboardMode(privacy?.leaderboardMode)) return privacy.leaderboardMode;
  return privacy?.leaderboardVisible === false ? "hidden" : "named";
}

/** The chosen alias, or the default if none was chosen or it has since left the list. */
export function leaderboardAliasOf(privacy: Pick<CommunityPrivacyRecord, "leaderboardAlias"> | undefined): string {
  return isLeaderboardAlias(privacy?.leaderboardAlias) ? privacy.leaderboardAlias : DEFAULT_ALIAS;
}
