import { describe, expect, it } from "vitest";

import { checkOwnVideo, OWN_VIDEO_MAX_BYTES, ownVideoExtension, ownVideoStoragePath } from "@/lib/exercise-library/own-video";

describe("own demonstration clip checks", () => {
  it("accepts the common phone formats", () => {
    expect(ownVideoExtension("video/mp4")).toBe("mp4");
    expect(ownVideoExtension("video/quicktime")).toBe("mov");
    expect(ownVideoExtension("video/webm; codecs=vp9")).toBe("webm");
    expect(checkOwnVideo("video/mp4", 5_000_000)).toEqual({ ok: true, extension: "mp4" });
  });

  it("refuses other types, empty files and long clips with a plain message", () => {
    expect(checkOwnVideo("image/gif", 1000)).toMatchObject({ ok: false });
    expect(checkOwnVideo("video/mp4", 0)).toMatchObject({ ok: false, message: "That file is empty." });
    const big = checkOwnVideo("video/mp4", OWN_VIDEO_MAX_BYTES + 1);
    expect(big).toMatchObject({ ok: false });
    expect(big.ok === false && big.message).toContain("25 MB");
  });

  it("stores the clip under the exercise's own folder", () => {
    expect(ownVideoStoragePath("abc", "mp4")).toBe("own/abc/clip.mp4");
  });
});
