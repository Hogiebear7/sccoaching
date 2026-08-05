"use client";

import { useEffect } from "react";

const RELOAD_GUARD_KEY = "chunk-error-reload-at";
const RELOAD_GUARD_WINDOW_MS = 10_000;

function isChunkLoadError(reason: unknown): boolean {
  const message = reason instanceof Error ? `${reason.name} ${reason.message}` : String(reason);
  return /ChunkLoadError|Loading chunk .* failed|Failed to fetch dynamically imported module/i.test(message);
}

// A deploy on Hostinger can briefly leave a visitor's already-loaded page
// pointing at JS chunk filenames from the previous build (old process still
// serving traffic, or an edge cache not yet refreshed). Rather than strand
// them on the "That didn't work" error boundary, force one full reload to
// fetch the current build — guarded against looping if the reload itself
// hits the same stale response.
export function ChunkErrorRecovery() {
  useEffect(() => {
    const recover = (reason: unknown) => {
      if (!isChunkLoadError(reason)) return;

      const lastReload = Number(sessionStorage.getItem(RELOAD_GUARD_KEY) ?? 0);
      if (Date.now() - lastReload < RELOAD_GUARD_WINDOW_MS) return;

      sessionStorage.setItem(RELOAD_GUARD_KEY, String(Date.now()));
      window.location.reload();
    };

    const onError = (event: ErrorEvent) => recover(event.error ?? event.message);
    const onRejection = (event: PromiseRejectionEvent) => recover(event.reason);

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  return null;
}
