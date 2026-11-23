/**
 * The app skin class on <html> (Vibrant, Play, Cleaner Play, Corporate, Fun,
 * Neon City) and its suspension while an exam screen with its own look is open.
 *
 * Every skin sheet is keyed on one of these classes, and so are the custom
 * properties a skin redefines on <html>. A themed exam screen has to look like
 * the exam it copies, not like the institute's skin, so while it is mounted
 * the skin class is taken off <html> and put back exactly when it unmounts.
 *
 * The root route applies the skin asynchronously (after the settings call)
 * and again when a learner switches institute. It goes through
 * `applyAppSkinClass`, so a skin that arrives while an exam suspends the skin
 * is remembered and applied on release instead of reappearing mid-exam.
 */

export const APP_SKIN_CLASSES = [
  "ui-vibrant",
  "ui-play",
  "ui-cleaner-play",
  "ui-corporate",
  "ui-fun",
  "ui-neon-city",
] as const;

export type AppSkinClass = (typeof APP_SKIN_CLASSES)[number];

let suspendCount = 0;
// The skin classes to put back on release (what <html> had, or what the
// root route asked for while suspended).
let pendingClasses: string[] = [];

const rootElement = (): HTMLElement | null =>
  typeof document === "undefined" ? null : document.documentElement;

const currentSkinClasses = (root: HTMLElement): string[] =>
  APP_SKIN_CLASSES.filter((name) => root.classList.contains(name));

/** Whether an exam screen currently holds the skin off. */
export const isAppSkinSuspended = (): boolean => suspendCount > 0;

/**
 * The classes <html> carries for a skin value. Neon City is drawn on Fun's
 * screens, so it carries ui-fun as well: every Fun rule and every useFunTheme()
 * reader applies, and the ui-neon-city sheet repaints them.
 */
export function uiSkinClasses(skin: string | null | undefined): AppSkinClass[] {
  switch (skin) {
    case "vibrant":
      return ["ui-vibrant"];
    case "play":
      return ["ui-play"];
    case "cleanerPlay":
      return ["ui-cleaner-play"];
    case "corporate":
      return ["ui-corporate"];
    case "fun":
      return ["ui-fun"];
    case "neonCity":
      return ["ui-fun", "ui-neon-city"];
    default:
      return [];
  }
}

/**
 * Sets the app skin (null = no skin). While suspended, only remembers it.
 */
export function applyAppSkinClass(
  className: AppSkinClass | readonly AppSkinClass[] | null
): void {
  const next: string[] = className === null ? [] : typeof className === "string" ? [className] : [...className];
  if (suspendCount > 0) {
    pendingClasses = next;
    return;
  }
  const root = rootElement();
  if (!root) return;
  root.classList.remove(...APP_SKIN_CLASSES);
  if (next.length > 0) root.classList.add(...next);
}

/**
 * Takes the skin class off <html> until the returned release function runs.
 * Nested holds are counted; the skin returns when the last one is released.
 * Calling a release function more than once does nothing.
 */
export function suspendAppSkin(): () => void {
  const root = rootElement();
  if (suspendCount === 0 && root) {
    pendingClasses = currentSkinClasses(root);
    root.classList.remove(...APP_SKIN_CLASSES);
  }
  suspendCount += 1;

  let released = false;
  return () => {
    if (released) return;
    released = true;
    suspendCount = Math.max(0, suspendCount - 1);
    if (suspendCount > 0) return;
    const element = rootElement();
    if (!element) return;
    element.classList.remove(...APP_SKIN_CLASSES);
    if (pendingClasses.length > 0) element.classList.add(...pendingClasses);
    pendingClasses = [];
  };
}
