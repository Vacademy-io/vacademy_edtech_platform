import { useState, useEffect } from "react";

/**
 * Returns true when the "Corporate" UI skin is active.
 * Listens for class changes on <html> via MutationObserver. Mirrors
 * use-play-theme.ts / use-cleaner-play-theme.ts.
 *
 * Prefer `[.ui-corporate_&]:` class variants for anything that is purely
 * visual. Reach for this hook only when Corporate needs different MARKUP —
 * e.g. a Phosphor line icon in place of an emoji, which no stylesheet can swap.
 */
export function useCorporateTheme(): boolean {
  const [isCorporate, setIsCorporate] = useState(
    () => document.documentElement.classList.contains("ui-corporate")
  );

  useEffect(() => {
    const root = document.documentElement;

    const observer = new MutationObserver(() => {
      setIsCorporate(root.classList.contains("ui-corporate"));
    });

    observer.observe(root, {
      attributes: true,
      attributeFilter: ["class"],
    });

    setIsCorporate(root.classList.contains("ui-corporate"));

    return () => observer.disconnect();
  }, []);

  return isCorporate;
}
