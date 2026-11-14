import { useEffect, useSyncExternalStore } from "react";
import { useFunTheme } from "@/hooks/use-fun-theme";
import { hslChannelsToHex } from "@/lib/colour/contrast";
import { funBrandColours } from "./brand-colours";

/**
 * Runs once at the app root. While the Fun skin is on it loads the skin's fonts
 * (useFunTheme) and keeps --fun-brand, --fun-brand-tint and --fun-brand-lip on
 * <html> in step with the institute's live brand. With any other skin it adds
 * nothing to <html> and makes no request.
 */
export const FUN_BRAND_VARS = ["--fun-brand", "--fun-brand-tint", "--fun-brand-lip"] as const;

function subscribeToRootStyle(listener: () => void): () => void {
  const observer = new MutationObserver(listener);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["style"] });
  return () => observer.disconnect();
}

const readPrimary = () => getComputedStyle(document.documentElement).getPropertyValue("--primary-500").trim();
const nothing = () => () => {};
const noBrand = () => "";

/** Sets or clears a property only when it would change, so the style observer is not fed. */
function setVar(root: HTMLElement, name: string, value: string | null): void {
  const current = root.style.getPropertyValue(name);
  if (value === null) {
    if (current) root.style.removeProperty(name);
  } else if (current !== value) {
    root.style.setProperty(name, value);
  }
}

export function applyFunBrandVars(root: HTMLElement, primaryChannels: string | null): void {
  const colours = primaryChannels === null ? null : funBrandColours(hslChannelsToHex(primaryChannels));
  setVar(root, "--fun-brand", colours?.solid ?? null);
  setVar(root, "--fun-brand-tint", colours?.tint ?? null);
  setVar(root, "--fun-brand-lip", colours?.lip ?? null);
}

export function useFunSkinRuntime(): boolean {
  const on = useFunTheme();
  const primary = useSyncExternalStore(on ? subscribeToRootStyle : nothing, on ? readPrimary : noBrand, noBrand);
  useEffect(() => {
    applyFunBrandVars(document.documentElement, on ? primary : null);
  }, [on, primary]);
  return on;
}
