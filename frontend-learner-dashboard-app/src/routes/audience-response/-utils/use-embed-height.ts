import { useCallback, useEffect, useRef } from "react";

/**
 * Message the form posts to the page it is embedded in. The admin's embed
 * snippet (Audience → Embed code) listens for it and sizes the iframe to the
 * form, so a long form is not cut off and a short one leaves no empty box.
 */
export const EMBED_HEIGHT_MESSAGE = "vacademy-form-height";

/**
 * Upper bound on a reported height. A child sized in viewport units (custom
 * CSS) grows with the iframe, which would otherwise feed back without end.
 */
const MAX_HEIGHT_PX = 20_000;

/** True only inside an iframe; the standalone page never posts anything. */
const isEmbedded = (): boolean => {
  try {
    return window.self !== window.top;
  } catch {
    // Cross-origin parent: reading window.top throws, which itself means framed.
    return true;
  }
};

/**
 * Ref callback for the form page's root. Reports the height of what is
 * actually on screen — the root's children, not the root itself: the root is
 * `min-h-screen`, so inside an iframe it is always at least the iframe's own
 * height and could never shrink. Nothing about the layout changes.
 */
export function useEmbedHeight() {
  const observer = useRef<ResizeObserver | null>(null);
  const childWatch = useRef<MutationObserver | null>(null);
  const lastSent = useRef(0);

  const post = useCallback((root: HTMLElement) => {
    const height = Math.min(
      MAX_HEIGHT_PX,
      Math.ceil(
        Array.from(root.children).reduce(
          (sum, child) => sum + child.getBoundingClientRect().height,
          0
        )
      )
    );
    if (height <= 0 || height === lastSent.current) return;
    lastSent.current = height;
    // Only a height leaves the frame — nothing the visitor typed.
    window.parent.postMessage({ type: EMBED_HEIGHT_MESSAGE, height }, "*");
  }, []);

  useEffect(
    () => () => {
      observer.current?.disconnect();
      childWatch.current?.disconnect();
    },
    []
  );

  return useCallback(
    (root: HTMLElement | null) => {
      observer.current?.disconnect();
      childWatch.current?.disconnect();
      observer.current = null;
      childWatch.current = null;
      if (!root || !isEmbedded() || typeof ResizeObserver === "undefined") return;
      const ro = new ResizeObserver(() => post(root));
      const observeChildren = () =>
        Array.from(root.children).forEach((child) => ro.observe(child));
      observeChildren();
      observer.current = ro;
      // A section that mounts later (a banner, an error block) is watched too.
      if (typeof MutationObserver !== "undefined") {
        const mo = new MutationObserver(() => {
          observeChildren();
          post(root);
        });
        mo.observe(root, { childList: true });
        childWatch.current = mo;
      }
      post(root);
    },
    [post]
  );
}
