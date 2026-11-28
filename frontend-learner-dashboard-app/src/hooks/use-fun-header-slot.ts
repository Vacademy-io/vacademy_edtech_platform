import { useLayoutEffect, useSyncExternalStore } from "react";

/**
 * Where the Fun home's greeting row is drawn. On the home the app's top bar offers
 * an empty slot and the home puts its greeting row there, so the page has one bar
 * with one account button instead of a bar above a second header.
 *
 * - The top bar offers the slot (`offerFunHeaderSlot`, a callback ref) only in the Fun
 *   skin on the home route.
 * - The home claims it while its greeting row is inside (`useClaimFunHeaderSlot`).
 * - The top bar takes its Fun look only while the slot is claimed
 *   (`useFunHeaderSlotClaimed`), so a home that draws no greeting row leaves the bar
 *   exactly as it was.
 *
 * No other skin reads or writes any of this.
 */
let slot: HTMLElement | null = null;
let claims = 0;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Callback ref for the top bar's slot element. */
export function offerFunHeaderSlot(element: HTMLElement | null): void {
  if (slot === element) return;
  slot = element;
  emit();
}

/** The top bar's slot, or null when the bar offers none. */
export function useFunHeaderSlot(): HTMLElement | null {
  return useSyncExternalStore(subscribe, () => slot, () => null);
}

/** Marks the slot as holding the greeting row while `active` is true. */
export function useClaimFunHeaderSlot(active: boolean): void {
  useLayoutEffect(() => {
    if (!active) return;
    claims += 1;
    emit();
    return () => {
      claims -= 1;
      emit();
    };
  }, [active]);
}

/** The greeting row is inside the top bar's slot. */
export function useFunHeaderSlotClaimed(): boolean {
  return useSyncExternalStore(subscribe, () => claims > 0, () => false);
}

/** Test seam: forget the slot and every claim. */
export function resetFunHeaderSlotForTests(): void {
  slot = null;
  claims = 0;
  emit();
}
