import React, { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useStore } from "zustand";
import { cn } from "@/lib/utils";
import { AssistantAvatar, SiteAssistantPanel, type SiteAssistantDisplay } from "./SiteAssistantPanel";
import type { LauncherSide } from "./settings";
import type { SiteAssistantCard } from "./types";
import { useSiteAssistantUi } from "./context";
import "./site-assistant.css";

interface Props {
  display: SiteAssistantDisplay;
  side: LauncherSide;
  variant: "hosted" | "embed";
  /** Hosted: bottom offset classes from launcherStack(). */
  launcherOffsetClassName?: string;
  /** Hosted: stack level, read by site-assistant.css for the checkout-bar lift. */
  stackLevel?: 0 | 1;
  /** Embed: the loader made the frame full-screen (phone width). */
  fullscreen?: boolean;
  fallbackContact?: Extract<SiteAssistantCard, { type: "contact_info" }> | null;
  /** Inline CSS custom properties (the assistant's accent colour ramp). */
  themeVars?: Record<string, string>;
}

const MOBILE_QUERY = "(max-width: 767px)";

/**
 * Launcher bubble + chat panel. Hosted: fixed to the page corner, a
 * full-screen sheet on phones. Embed: fills the iframe the loader sized
 * (launcher-sized when closed, panel-sized or full-screen when open).
 */
export const SiteAssistantWidget: React.FC<Props> = ({
  display,
  side,
  variant,
  launcherOffsetClassName,
  stackLevel = 0,
  fullscreen = false,
  fallbackContact = null,
  themeVars,
}) => {
  const { t } = useTranslation("siteAssistant");
  const { controller } = useSiteAssistantUi();
  const open = useStore(controller.store, (s) => s.open);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(open);

  // Return focus to the launcher when the panel closes.
  useEffect(() => {
    if (wasOpen.current && !open) launcherRef.current?.focus();
    wasOpen.current = open;
  }, [open]);

  // The session is created lazily, when the visitor first opens the chat.
  useEffect(() => {
    if (open) void controller.connect();
  }, [open, controller]);

  // Hosted phone sheet: the page behind must not scroll under it.
  useEffect(() => {
    if (variant !== "hosted" || !open) return;
    let mobile = false;
    try {
      mobile = window.matchMedia(MOBILE_QUERY).matches;
    } catch {
      mobile = false;
    }
    if (!mobile) return;
    const root = document.documentElement;
    root.classList.add("site-assistant-scroll-lock");
    return () => root.classList.remove("site-assistant-scroll-lock");
  }, [open, variant]);

  const close = () => controller.setOpen(false);
  const sideClass = side === "start" ? "start-4" : "end-4";

  const launcher = (
    <button
      ref={launcherRef}
      type="button"
      onClick={() => controller.setOpen(true)}
      aria-label={t("launcher.open", { name: display.name })}
      title={display.name}
      aria-haspopup="dialog"
      aria-expanded={false}
      className={cn(
        "flex size-14 items-center justify-center rounded-full bg-primary-500 text-primary-foreground shadow-lg transition hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500 active:scale-95",
        variant === "hosted"
          ? cn("site-assistant-launcher fixed z-catalogue-fixed", sideClass, launcherOffsetClassName)
          : cn("absolute bottom-3", side === "start" ? "start-3" : "end-3"),
      )}
      data-stack={stackLevel}
    >
      <AssistantAvatar url={display.avatarUrl} className="size-12" />
    </button>
  );

  const panelClass =
    variant === "hosted"
      ? cn(
          "fixed inset-0 z-60 md:inset-auto md:bottom-6 md:h-reg-600 md:max-h-screen-85 md:w-reg-380 md:rounded-catalogue-xl",
          side === "start" ? "md:start-4" : "md:end-4",
        )
      : fullscreen
        ? "absolute inset-0"
        : "absolute inset-2 rounded-catalogue-xl";

  return (
    // Dynamic: the assistant's accent colour (settings / session) as a primary ramp.
    <div className="site-assistant-root" data-variant={variant} style={themeVars}>
      {open ? <SiteAssistantPanel display={display} onClose={close} fallbackContact={fallbackContact} className={panelClass} /> : launcher}
    </div>
  );
};
