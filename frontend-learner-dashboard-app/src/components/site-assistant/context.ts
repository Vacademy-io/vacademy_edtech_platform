import { createContext, useContext } from "react";
import type { SiteAssistantController } from "./controller";

export interface SiteAssistantUiContextValue {
  controller: SiteAssistantController;
  /** The site's own consent sentence (settings.leads.consentText), when the card has none. */
  consentText: string | null;
  /** Called after a lead was accepted (hosted: the site's GA4/Pixel conversion). */
  onLeadSubmitted?: () => void;
}

export const SiteAssistantUiContext = createContext<SiteAssistantUiContextValue | null>(null);

export const useSiteAssistantUi = (): SiteAssistantUiContextValue => {
  const ctx = useContext(SiteAssistantUiContext);
  if (!ctx) throw new Error("useSiteAssistantUi must be used inside SiteAssistantUiContext");
  return ctx;
};
