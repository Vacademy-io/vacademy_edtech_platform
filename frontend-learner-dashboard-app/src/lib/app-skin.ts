/**
 * The app skin class on <html> (Vibrant, Play, Cleaner Play, Corporate, Fun)
 * and its suspension while an exam screen with its own look is open.
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
 * Sets the app skin (null = no skin). While suspended, only remembers it.
 */
export function applyAppSkinClass(className: AppSkinClass | null): void {
  const next = className ? [className] : [];
  if (suspendCount > 0) {
    pendingClasses = next;
    return;
  }
  const root = rootElement();
  if (!root) return;
  root.classList.remove(...APP_SKIN_CLASSES);
  if (className) root.classList.add(className);
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
