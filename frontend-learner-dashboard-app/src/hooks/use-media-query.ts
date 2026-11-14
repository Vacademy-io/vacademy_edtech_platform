import { useCallback, useSyncExternalStore } from "react";

function mediaQueryList(query: string): MediaQueryList | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return null;
  try {
    return window.matchMedia(query);
  } catch {
    return null;
  }
}

/**
 * Whether a CSS media query matches, e.g. `useMediaQuery("(min-width: 1024px)")`.
 *
 * The first render already has the right answer (read synchronously, not in an
 * effect), so a layout that picks a slot from it never renders in the wrong slot
 * first. Updates on change. False where `matchMedia` is unavailable.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mql = mediaQueryList(query);
      if (!mql) return () => {};
      if (typeof mql.addEventListener === "function") {
        mql.addEventListener("change", onChange);
        return () => mql.removeEventListener("change", onChange);
      }
      // Safari < 14
      mql.addListener(onChange);
      return () => mql.removeListener(onChange);
    },
    [query]
  );
  const getSnapshot = useCallback(() => mediaQueryList(query)?.matches ?? false, [query]);
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
