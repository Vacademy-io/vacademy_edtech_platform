import React, { useContext, useEffect, useMemo, useState } from "react";
import { useLocation } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useStore } from "zustand";
import { ChatbotContext } from "@/components/chatbot/ChatbotContextType";
import { getTokenFromStorage, isTokenExpired } from "@/lib/auth/sessionUtility";
import { TokenKey } from "@/constants/auth/tokens";
import { getStoredUtm } from "@/lib/utm-attribution";
import { RouteMatcher } from "@/routes/$tagName/-services/route-matcher";
import { useCatalogueLocale, useSiteT } from "@/routes/$tagName/-utils/catalogue-locale";
import { useSiteNavigate } from "@/routes/$tagName/-utils/catalogue-route-search";
import { emitLeadCaptured } from "@/routes/$tagName/-utils/catalogue-tracking";
import { buildPrimaryScaleVars } from "@/routes/$tagName/-utils/style-utils";
import { SiteAssistantApiError, createSiteAssistantApi } from "./api";
import { AssistantLinkContext, type AssistantLinkHandler } from "./link-context";
import { SiteAssistantUiContext } from "./context";
import { createSiteAssistantController, getHostedController } from "./controller";
import { classifyHref } from "./links";
import {
  launcherSide,
  launcherStack,
  pageHasCatalogueBlock,
  resolveSiteAssistantSettings,
  shouldShowSiteAssistant,
} from "./settings";
import { getStoredSessionId, getVisitorId, storeSessionId } from "./storage";
import { SiteAssistantWidget } from "./SiteAssistantWidget";
import type { CreateSessionBody, SiteAssistantCard, SiteAssistantPageContext } from "./types";

/**
 * The Site Assistant on a hosted catalogue site. Mounted by the catalogue
 * page shells next to their other floating widgets (WhatsApp, back-to-top);
 * shows when globalSettings.siteAssistant.enabled and its placement matches
 * this page, never while the Student AI launcher is on screen, never in the
 * editor's preview. The session is created on first open.
 */

interface Props {
  /** The site's published globalSettings (catalogue JSON). */
  globalSettings: unknown;
  tagName: string;
  pageKind: "home" | "page" | "course";
  /** The active page's components (placement mode catalogue_and_courses). */
  pageComponents?: unknown;
  courseId?: string;
  /** A fixed mobile action bar sits at the foot of this page on phones. */
  hasMobileBar: boolean;
}

/** Per-site live inputs the long-lived controller reads at call time. */
const runtime = new Map<string, { courseId?: string; locale?: string }>();

const api = createSiteAssistantApi();

const learnerToken = async (): Promise<string | null> => {
  try {
    const token = await getTokenFromStorage(TokenKey.accessToken);
    return token && !isTokenExpired(token) ? token : null;
  } catch {
    return null;
  }
};

const currentPage = (siteKey: string): SiteAssistantPageContext => {
  const extra = runtime.get(siteKey);
  return {
    url: window.location.href.slice(0, 2000),
    route: window.location.pathname,
    title: (document.title || "").slice(0, 300),
    ...(extra?.courseId ? { course_id: extra.courseId } : {}),
  };
};

const hostedController = (tagName: string) => {
  const siteKey = tagName.toLowerCase();
  return getHostedController(siteKey, () => {
    const bodyFor = (resumeId: string | null): CreateSessionBody => {
      const utm = (getStoredUtm() || {}) as Record<string, string>;
      const locale = runtime.get(siteKey)?.locale;
      return {
        site_tag: tagName,
        page: currentPage(siteKey),
        visitor_id: getVisitorId(),
        ...(resumeId ? { resume_session_id: resumeId } : {}),
        ...(locale ? { locale } : {}),
        ...(Object.keys(utm).length ? { utm } : {}),
      };
    };
    const create = async (resume: boolean) => {
      const resumeId = resume ? getStoredSessionId(siteKey) : null;
      const jwt = await learnerToken();
      try {
        return await api.createSession(bodyFor(resumeId), { learnerToken: jwt });
      } catch (err) {
        if (!(err instanceof SiteAssistantApiError)) throw err;
        // A learner token for another institute must not lock a visitor out,
        if ((err.status === 401 || err.status === 403) && jwt) return api.createSession(bodyFor(resumeId));
        // and a stale resume id must not block a fresh conversation.
        if (err.code === "invalid" && resumeId) {
          storeSessionId(siteKey, null);
          return api.createSession(bodyFor(null), { learnerToken: jwt });
        }
        throw err;
      }
    };
    return createSiteAssistantController({
      api,
      source: { get: () => create(true), refresh: () => create(false) },
      getPage: () => currentPage(siteKey),
      onSession: (s) => storeSessionId(siteKey, s.session_id),
    });
  });
};

const MOBILE_QUERY = "(max-width: 767px)";
const isMobile = () => {
  try {
    return window.matchMedia(MOBILE_QUERY).matches;
  } catch {
    return false;
  }
};

export const HostedSiteAssistant: React.FC<Props> = ({
  globalSettings,
  tagName,
  pageKind,
  pageComponents,
  courseId,
  hasMobileBar,
}) => {
  const { t } = useTranslation("siteAssistant");
  const siteT = useSiteT();
  const { locale } = useCatalogueLocale();
  const location = useLocation();
  const siteNavigate = useSiteNavigate();
  const studentAi = useContext(ChatbotContext);
  const [isPreview] = useState(
    () => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("preview") === "true",
  );

  const gs = (globalSettings && typeof globalSettings === "object" ? globalSettings : {}) as Record<string, unknown>;
  const settings = useMemo(() => resolveSiteAssistantSettings(gs.siteAssistant), [gs.siteAssistant]);
  const siteKey = tagName.toLowerCase();
  const controller = useMemo(() => hostedController(tagName), [tagName]);
  const assistant = useStore(controller.store, (s) => s.assistant);
  const sessionId = useStore(controller.store, (s) => s.sessionId);

  useEffect(() => {
    runtime.set(siteKey, { courseId, locale });
  }, [siteKey, courseId, locale]);

  const siteRoute = RouteMatcher.segmentsAfterBase(location.pathname, tagName).join("/");
  const visible = shouldShowSiteAssistant({
    settings,
    siteRoute,
    pageKind,
    hasCatalogueBlock: pageHasCatalogueBlock(pageComponents),
    studentAiVisible: !!studentAi?.shouldShowChatbot?.(),
    isPreview,
  });

  const linkHandler = useMemo<AssistantLinkHandler>(
    () => ({
      resolve: (href) =>
        classifyHref(href, { mode: "hosted", origin: window.location.origin, basePath: RouteMatcher.basePath(tagName) }),
      navigate: (target) => {
        if (target.kind === "internal") {
          if (target.path.startsWith("#")) {
            document.getElementById(decodeURIComponent(target.path.slice(1)))?.scrollIntoView({ behavior: "smooth" });
          } else {
            void siteNavigate(target.path);
          }
          // On a phone the sheet covers the page the visitor asked to see.
          if (isMobile()) controller.setOpen(false);
        } else {
          window.open(target.url, "_blank", "noopener,noreferrer");
        }
      },
    }),
    [tagName, siteNavigate, controller],
  );

  const fallbackContact = useMemo<Extract<SiteAssistantCard, { type: "contact_info" }> | null>(() => {
    const s = settings.support;
    if (!s.email && !s.phone && !s.whatsapp && !s.loginUrl) return null;
    return { type: "contact_info", email: s.email, phone: s.phone, whatsapp: s.whatsapp, login_url: s.loginUrl };
  }, [settings.support]);

  if (!visible) return null;

  const side = launcherSide(settings.position);
  const stack = launcherStack({
    side,
    whatsapp: gs.whatsapp as never,
    backToTop: gs.backToTop === true,
    hasMobileBar,
  });
  const display = {
    name: siteT(settings.name) || assistant?.name || t("launcher.defaultName"),
    avatarUrl: settings.avatarUrl || assistant?.avatar_url || null,
    greeting: siteT(settings.greeting) || assistant?.greeting || t("greeting.default"),
    suggestions: settings.suggestions.length ? settings.suggestions.map((s) => siteT(s)) : assistant?.suggestions ?? [],
  };

  return (
    <SiteAssistantUiContext.Provider
      value={{
        controller,
        consentText: siteT(settings.leads.consentText) || null,
        onLeadSubmitted: () => emitLeadCaptured({ sourceType: "SITE_ASSISTANT", sourceId: sessionId ?? undefined }),
      }}
    >
      <AssistantLinkContext.Provider value={linkHandler}>
        <SiteAssistantWidget
          display={display}
          side={side}
          variant="hosted"
          launcherOffsetClassName={stack.className}
          stackLevel={stack.level}
          fallbackContact={fallbackContact}
          themeVars={buildPrimaryScaleVars(settings.accentColor)}
        />
      </AssistantLinkContext.Provider>
    </SiteAssistantUiContext.Provider>
  );
};

export default HostedSiteAssistant;
