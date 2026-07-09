"use client";

import { useEffect } from "react";

// Registers the service worker on first mount. Renders nothing visible.
// Push permission prompts and subscription management are handled separately
// in the profile settings UI (Phase 3).
export function PushServiceWorkerRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    navigator.serviceWorker.register("/sw.js").catch((err) => {
      console.warn("[sw] Registration failed:", err);
    });
  }, []);

  return null;
}
