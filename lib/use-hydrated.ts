import { useSyncExternalStore } from "react";

function subscribe() {
  return () => {};
}

// False during server rendering and hydration, true once the component is
// running in the browser. Replaces the `useState(false)` + `useEffect(() =>
// setMounted(true))` pattern without a second render-triggering effect.
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
