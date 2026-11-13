// Your own demonstration clip for an exercise, uploaded by staff. It sits beside the licensed library pictures as an extra media row (kind "video",
// resolution "own"), is stored in the same private bucket, and is served through the same short-lived signed links. The app prefers it over the
// library picture when there is one.

export const OWN_VIDEO_KIND = "video";
export const OWN_VIDEO_RESOLUTION = "own";
/** Short clips only: a few seconds of someone doing the exercise. */
export const OWN_VIDEO_MAX_BYTES = 25 * 1024 * 1024;

const TYPES: Record<string, string> = {
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
};

export function ownVideoExtension(contentType: string): string | null {
  return TYPES[contentType.toLowerCase().split(";")[0].trim()] ?? null;
}

export function ownVideoStoragePath(exerciseId: string, extension: string): string {
  return `own/${exerciseId}/clip.${extension}`;
}

export function checkOwnVideo(contentType: string, bytes: number): { ok: true; extension: string } | { ok: false; message: string } {
  const extension = ownVideoExtension(contentType);
  if (!extension) return { ok: false, message: "Use an MP4, MOV or WebM video." };
  if (!(bytes > 0)) return { ok: false, message: "That file is empty." };
  if (bytes > OWN_VIDEO_MAX_BYTES) return { ok: false, message: "That clip is over 25 MB. Trim it to a few seconds and try again." };
  return { ok: true, extension };
}
