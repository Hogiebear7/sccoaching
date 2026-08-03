import type { WorkoutRunEntry } from "@/lib/db";

// Pure formatting/parsing helpers shared by the log form and both view
// variants (history rendering). Extracted so Variant A and Variant B never
// duplicate — let alone diverge on — how a run or duration is parsed and
// displayed.

export function todayDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

// Parses "MM:SS" or "H:MM:SS" → total seconds, or a bare number as minutes.
// Returns null if the input is empty or unparseable.
export function parseDuration(raw: string): number | null {
  const s = raw.trim();
  if (!s) return null;
  const parts = s.split(":").map(Number);
  if (parts.some((n) => !Number.isFinite(n) || n < 0)) return null;
  if (parts.length === 2) {
    const [m, sec] = parts;
    if (sec >= 60) return null;
    return m * 60 + sec;
  }
  if (parts.length === 3) {
    const [h, m, sec] = parts;
    if (m >= 60 || sec >= 60) return null;
    return h * 3600 + m * 60 + sec;
  }
  // bare number treated as minutes
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 60) : null;
}

export function formatDuration(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// Live pace preview for the run input. Both fields must independently parse
// to positive values — a missing or garbled side shows nothing rather than a
// misleading number. Metre distances convert to km first.
export function livePace(distanceRaw: string, distanceUnit: "km" | "m", durationRaw: string): string | null {
  const rawDistance = parseFloat(distanceRaw);
  if (!Number.isFinite(rawDistance) || rawDistance <= 0) return null;
  const km = distanceUnit === "m" ? rawDistance / 1000 : rawDistance;

  const secs = parseDuration(durationRaw);
  if (secs === null || secs <= 0) return null;

  const paceSecs = Math.round(secs / km);
  return `${Math.floor(paceSecs / 60)}:${String(paceSecs % 60).padStart(2, "0")} /km`;
}

export function formatRun(run: WorkoutRunEntry): string {
  const parts: string[] = [];
  if (run.distance !== null) parts.push(`${run.distance} ${run.distanceUnit}`);
  if (run.durationSecs !== null) parts.push(formatDuration(run.durationSecs));
  // Pace only when both sides of the division exist — never inferred.
  if (run.distance !== null && run.distance > 0 && run.durationSecs !== null && run.durationSecs > 0) {
    const paceSecs = Math.round(run.durationSecs / run.distance);
    parts.push(`${Math.floor(paceSecs / 60)}:${String(paceSecs % 60).padStart(2, "0")} /km`);
  }
  if (run.sets !== null && run.reps !== null) parts.push(`${run.sets}×${run.reps}`);
  else if (run.sets !== null) parts.push(`${run.sets} sets`);
  else if (run.reps !== null) parts.push(`${run.reps} reps`);
  return parts.join(" · ");
}
