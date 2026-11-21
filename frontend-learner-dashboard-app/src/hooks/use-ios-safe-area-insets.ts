import { useEffect } from "react";
import { Capacitor } from "@capacitor/core";

const VIEWPORT_BASE =
  "width=device-width, initial-scale=1.0, maximum-scale=1, user-scalable=no";

let mountedScreens = 0;
let coverMeta: HTMLMetaElement | null = null;

const insertViewportMeta = (content: string): HTMLMetaElement => {
  const meta = document.createElement("meta");
  meta.name = "viewport";
  meta.content = content;
  document.head.appendChild(meta);
  return meta;
};

/**
 * Turn the iOS app's safe-area insets back on while an exam screen is mounted.
 *
 * The dashboard's <Helmet> inserts a viewport meta without
 * `viewport-fit=cover`. WebKit applies a viewport meta when it is inserted but
 * does not re-read the remaining one when it is removed, so after the first
 * dashboard visit every `env(safe-area-inset-*)` reads 0 for the rest of the
 * session, and the exam header (timer, Submit) sits under the status bar /
 * Dynamic Island despite `topSafeAreaInset`.
 *
 * The rest of the app is laid out for that zero-inset state, so it is only
 * flipped for the exam screens: insert a `viewport-fit=cover` meta on mount,
 * and when the last exam screen unmounts put back the same no-cover state the
 * dashboard leaves behind. No-op outside the iOS app.
 */
export function useIOSSafeAreaInsets(): void {
  useEffect(() => {
    if (Capacitor.getPlatform() !== "ios") return;

    mountedScreens += 1;
    if (!coverMeta) {
      coverMeta = insertViewportMeta(`${VIEWPORT_BASE}, viewport-fit=cover`);
    }

    return () => {
      mountedScreens -= 1;
      if (mountedScreens > 0) return;
      coverMeta?.remove();
      coverMeta = null;
      insertViewportMeta(VIEWPORT_BASE).remove();
    };
  }, []);
}
