// Uploaded gym logos. Each logo is one small file beside the datastore (not inside db.json), named by the gym's id, so replacing or removing a logo never touches
// the datastore. Only PNG, JPEG and WebP are accepted, recognised by the file's own first bytes rather than its name or the type the browser claims, and never SVG
// (an SVG can carry script). The cap is 1 MB.
import fs from "fs";
import path from "path";

import { dataDirectory } from "./db";

export const MAX_LOGO_BYTES = 1_000_000;

export type LogoType = { ext: "png" | "jpg" | "webp"; mime: "image/png" | "image/jpeg" | "image/webp" };

const SAFE_ID = /^[A-Za-z0-9_-]{1,80}$/;
const EXTS: LogoType["ext"][] = ["png", "jpg", "webp"];

export function detectLogoType(bytes: Uint8Array): LogoType | null {
  const b = bytes;
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return { ext: "png", mime: "image/png" };
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { ext: "jpg", mime: "image/jpeg" };
  const ascii = (from: number, to: number) => String.fromCharCode(...Array.from(b.slice(from, to)));
  if (b.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return { ext: "webp", mime: "image/webp" };
  return null;
}

function logoDir(): string {
  return path.join(dataDirectory(), "gym-logos");
}

function fileFor(gymId: string, ext: string): string {
  return path.join(logoDir(), `${gymId}.${ext}`);
}

/** Saves the logo (replacing any earlier one for the gym). Written to a temporary name first, then renamed, so a reader never sees a half-written file. */
export function saveGymLogo(gymId: string, bytes: Uint8Array, type: LogoType): void {
  if (!SAFE_ID.test(gymId)) throw new Error("Unsafe gym id.");
  fs.mkdirSync(logoDir(), { recursive: true });
  removeGymLogo(gymId);
  const target = fileFor(gymId, type.ext);
  const tmp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, bytes, { mode: 0o600 });
  fs.renameSync(tmp, target);
}

export function removeGymLogo(gymId: string): void {
  if (!SAFE_ID.test(gymId)) return;
  for (const ext of EXTS) fs.rmSync(fileFor(gymId, ext), { force: true });
}

export function readGymLogo(gymId: string): { data: Buffer; mime: LogoType["mime"] } | null {
  if (!SAFE_ID.test(gymId)) return null;
  for (const ext of EXTS) {
    const file = fileFor(gymId, ext);
    if (!fs.existsSync(file)) continue;
    const data = fs.readFileSync(file);
    const type = detectLogoType(data);
    return type ? { data, mime: type.mime } : null;
  }
  return null;
}
