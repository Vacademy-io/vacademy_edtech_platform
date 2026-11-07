import React, { useEffect, useMemo, useState } from "react";
import { I18nextProvider, useTranslation } from "react-i18next";
import { useStore } from "zustand";
import { normalizeLocale } from "@/i18n/locales";
import { siteI18nInstance } from "@/routes/$tagName/-utils/catalogue-i18n-instance";
import { buildPrimaryScaleVars } from "@/routes/$tagName/-utils/style-utils";
import { AssistantLinkContext, type AssistantLinkHandler } from "./link-context";
import { SiteAssistantUiContext } from "./context";
import { createEmbedBridge, type ParentMessage } from "./embed-protocol";
import { createEmbedRuntime } from "./embed-runtime";
import { classifyHref } from "./links";
import { launcherSide, type LauncherSide } from "./settings";
import { SiteAssistantWidget } from "./SiteAssistantWidget";
import type { SiteAssistantInfo } from "./types";

/**
 * The assistant inside the iframe public/site-assistant.js puts on an
 * institute's own website. The loader owns the session (created from the
 * parent page so the Origin is the verified site) and hands it over by
 * postMessage; this side only renders and talks to the visitor API with that
 * token. Protocol and origin rules: embed-protocol.ts; session hand-over:
 * embed-runtime.ts.
 */

interface Props {
  sid: string | null;
  position: "left" | "right" | null;
  lang: string | null;
  /** Open the chat as soon as the session arrives (reopen after "Take me there"). */
  startOpen?: boolean;
}

export const EmbeddedSiteAssistant: React.FC<Props> = ({ sid, position, lang, startOpen = false }) => {
  const { i18n } = useTranslation("siteAssistant");
  const [rt] = useState(() => {
    const runtime = createEmbedRuntime();
    if (startOpen) runtime.controller.setOpen(true);
    return runtime;
  });
  const { controller } = rt;
  const [fullscreen, setFullscreen] = useState(false);
  const assistant = useStore(controller.store, (s) => s.assistant);
  const status = useStore(controller.store, (s) => s.status);
  const open = useStore(controller.store, (s) => s.open);

  // Transparent document: only the launcher / panel paint over the host page.
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add("site-assistant-embed");
    return () => root.classList.remove("site-assistant-embed");
  }, []);

  useEffect(() => {
    const onLayout = (m: ParentMessage) => {
      if (m.type === "layout") setFullscreen(m.fullscreen);
    };
    rt.listeners.add(onLayout);
    const bridge = createEmbedBridge({ win: window, expectedSid: sid, onMessage: rt.onMessage });
    rt.bridge = bridge;
    bridge.post({ type: "ready" });
    return () => {
      rt.listeners.delete(onLayout);
      bridge.dispose();
      if (rt.bridge === bridge) rt.bridge = null;
    };
  }, [rt, sid]);

  // Launcher ↔ panel: the loader resizes the iframe.
  useEffect(() => {
    if (status === "ready") rt.bridge?.post({ type: "resize", open });
  }, [open, status, rt]);

  const linkHandler = useMemo<AssistantLinkHandler>(
    () => ({
      resolve: (href) => classifyHref(href, { mode: "embed", parentOrigin: rt.bridge?.parentOrigin() ?? "" }),
      navigate: (target) => {
        if (target.kind === "parent") rt.bridge?.post({ type: "navigate", url: target.url });
        else if (target.kind === "external") window.open(target.url, "_blank", "noopener,noreferrer");
      },
    }),
    [rt],
  );

  const siteI18n = useMemo(() => {
    const locale = lang ? normalizeLocale(lang) : null;
    return locale && locale !== i18n.language ? siteI18nInstance(i18n, locale) : null;
  }, [lang, i18n]);

  // Nothing shows until the loader has handed over a session the server accepted.
  if (!assistant) return null;

  const side = launcherSide(
    assistant.position ?? (position === "left" ? "bottom-left" : position === "right" ? "bottom-right" : null),
  );
  const tree = (
    <SiteAssistantUiContext.Provider value={{ controller, consentText: null }}>
      <AssistantLinkContext.Provider value={linkHandler}>
        <EmbedWidget assistant={assistant} side={side} fullscreen={fullscreen} />
      </AssistantLinkContext.Provider>
    </SiteAssistantUiContext.Provider>
  );
  return siteI18n ? <I18nextProvider i18n={siteI18n}>{tree}</I18nextProvider> : tree;
};

/** Inside the (maybe site-language) i18n provider, so the fallbacks follow the site language. */
const EmbedWidget: React.FC<{ assistant: SiteAssistantInfo; side: LauncherSide; fullscreen: boolean }> = ({
  assistant,
  side,
  fullscreen,
}) => {
  const { t } = useTranslation("siteAssistant");
  return (
    <SiteAssistantWidget
      display={{
        name: assistant.name || t("launcher.defaultName"),
        avatarUrl: assistant.avatar_url,
        greeting: assistant.greeting || t("greeting.default"),
        suggestions: assistant.suggestions,
      }}
      side={side}
      variant="embed"
      fullscreen={fullscreen}
      themeVars={buildPrimaryScaleVars(assistant.accent_color)}
    />
  );
};

export default EmbeddedSiteAssistant;
