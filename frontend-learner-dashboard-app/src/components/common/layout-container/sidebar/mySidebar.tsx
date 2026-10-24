import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

import { sideBarStateType } from "../../../../types/layout-container-types";
import { SidebarItem } from "./sidebar-item";
import { collectSidebarNavRoutes } from "./active-route";
import {
  getHamBurgerSidebarItemsData,
  stripOfflineEntries,
  filterHamburgerMenuItemsWithPermissions,
  getTerminology,
  getTerminologyPlural,
  readEngagementPlanFlag,
  ENGAGEMENT_PLAN_FLAG_EVENT,
} from "./utils";
import {
  ContentTerms,
  RoleTerms,
  SystemTerms,
} from "@/types/naming-settings";
import "./scrollbarStyle.css";
import useStore from "./useSidebar";
import { isNullOrEmptyOrUndefined } from "@/lib/utils";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { getStudentDisplaySettings } from "@/services/student-display-settings";
import { getChatEnabled } from "@/services/chat/getChatEnabled";
import { CONVERSATIONS_KEY, UNREAD_COUNT_KEY, getUnreadCount, listConversations } from "@/services/chat/chatApi";
import type { ChatConversationResponse } from "@/services/chat/chatApi";
import { getInstituteId } from "@/constants/helper";
import {
  handleGetMyMentors,
  type MyMentor,
  handleGetMentorDirectory,
} from "@/routes/my-mentors/-services/my-mentors-service";
import type { StudentSidebarTabConfig } from "@/types/student-display-settings";
import {
  SquaresFour,
  Globe,
  GooglePlayLogo,
  AppStoreLogo,
  WindowsLogo,
  AppleLogo,
  SignOut,
  ListChecks,
} from "@phosphor-icons/react";
import {
  NavHouseIcon,
  NavBookIcon,
  NavNotepadIcon,
  NavClipboardCheckIcon,
  NavChatIcon,
  NavGiftIcon,
  NavCalendarCheckIcon,
  NavUsersIcon,
} from "./nav-icons";
import type {
  SidebarItemsType,
  subItemsType,
} from "../../../../types/layout-container-types";
import { useOfflineAvailable } from "@/hooks/offline/use-offline-availability";
import { useStudentPermissions } from "@/hooks/use-student-permissions";
import { useIsIOS } from "@/hooks/useIsIOS";
import { Capacitor } from "@capacitor/core";
import { Preferences } from "@capacitor/preferences";
import type { Student } from "@/types/user/user-detail";
import { X } from "@phosphor-icons/react";

// Local letter-based icon factory for tabs without predefined icons
const createLetterIcon =
  (letter: string) =>
    ({ className }: { className?: string; weight?: unknown }) =>
    (
      <div
        className={`flex items-center justify-center rounded-md bg-neutral-100 dark:bg-neutral-800 ${className || ""
          }`}
        aria-hidden
      >
        <span className="text-caption leading-none font-medium uppercase">{letter}</span>
      </div>
    );

/**
 * "Daily tasks" nav icon. Phosphor's light weight matches the thin-line custom
 * nav set (nav-icons.tsx); the sidebar's active/inactive `weight` is ignored
 * the same way those icons ignore it, since state is carried by colour.
 */
const NavDailyTasksIcon = ({ className }: { className?: string; weight?: unknown }) => (
  <ListChecks weight="light" className={className} aria-hidden />
);

/** Sidebar tab id of the injected "Daily tasks" entry. */
const DAILY_TASKS_TAB_ID = "daily-tasks";

const humanizeText = (text: string) => {
  if (!text) return "";
  return text
    .split(/[-_]/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
};

export const MySidebar = ({
  sidebarComponent,
  hideBrandingHeader,
}: {
  sidebarComponent?: React.ReactNode;
  /** Set by a custom sidebar that shows the institute itself (the slides
   *  viewer does). Without it the panel gets two stacked headers, each with
   *  its own copy of the logo. Off by default — the chapters sidebar has no
   *  identity block of its own and still needs this one. */
  hideBrandingHeader?: boolean;
}) => {
  const { t, i18n } = useTranslation("layoutCommonA");
  const { t: tEngagement } = useTranslation("dashboardEngagement");
  const navigate = useNavigate();
  const { state, isMobile, toggleSidebar } = useSidebar();
  const isAndroid = Capacitor.getPlatform() === 'android';
  const {
    sideBarState,
    instituteName,
    instituteLogoFileUrl,
    homeIconClickRoute,
    playStoreAppLink,
    appStoreAppLink,
    windowsAppLink,
    macAppLink,
    learnerPortalUrl,
    subOrgName,
    subOrgLogoUrl,
    hideInstituteName,
    logoWidthPx,
    logoHeightPx,
    stackNameBelowLogo,
  } = useStore();
  const handleInstituteLogoClick = () => {
    if (homeIconClickRoute) {
      window.location.href = homeIconClickRoute;
    }
  };

  const { permissions } = useStudentPermissions();
  // Native-only AND admin-enabled; see use-offline-availability.
  const offlineAvailable = useOfflineAvailable();
  const isIOS = useIsIOS();
  const [configuredTabs, setConfiguredTabs] = useState<
    StudentSidebarTabConfig[]
  >([]);
  const [filteredHamburgerItems, setFilteredHamburgerItems] = useState(() =>
    getHamBurgerSidebarItemsData(t)
  );
  const [hideSidebar, setHideSidebar] = useState<boolean>(false);
  // Institutes that moved their downloads to the dashboard's getApp widget turn
  // this off. Starts true so the links do not flicker out on every load while
  // the settings request is in flight.
  const [showAppLinks, setShowAppLinks] = useState<boolean>(true);
  // One gate for the footer's presence check and its contents, so the two can
  // never disagree and leave an empty bordered strip above the profile row.
  const hasAppLinks =
    showAppLinks &&
    Boolean(
      playStoreAppLink ||
        appStoreAppLink ||
        windowsAppLink ||
        macAppLink ||
        learnerPortalUrl
    );
  const [studentData, setStudentData] = useState<Student | null>(null);
  // Whether the institute's chat FEATURE is on (independent of the In-App
  // Messages tab's visibility) — gates the per-mentor chat entries.
  const [chatFeatureEnabled, setChatFeatureEnabled] = useState(false);

  // Unread badge on the In-App Messages tab. On /chat, ChatScreen keeps the conversation list live over
  // SSE, so the badge reads that cached list (this observer never fetches). Elsewhere it polls the cheap
  // unread-count aggregate — never the full list — and only while the chat tab is actually rendered.
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const onChatRoute = pathname === "/chat" || pathname.startsWith("/chat/");
  const { data: liveUnread } = useQuery({
    // Observe the shared list only on /chat; elsewhere a mounted observer would pin a stale list in the
    // cache indefinitely (no gc), which ChatScreen would then open with.
    queryKey: onChatRoute ? CONVERSATIONS_KEY : (["chat", "conversations", "sidebar-idle"] as const),
    // Same fetcher as ChatScreen (never run from here: enabled=false) so the shared query can't pick up
    // a different queryFn from this observer.
    queryFn: () => listConversations(undefined, 30),
    enabled: false,
    // Community excluded, as in the server's unread total: an unopened community would pin the badge at 99+.
    select: (convs: ChatConversationResponse[]) =>
      convs.reduce((sum, c) => sum + (c.type === "COMMUNITY" ? 0 : c.unreadCount || 0), 0),
  });
  const { data: polledUnread = 0 } = useQuery({
    queryKey: UNREAD_COUNT_KEY,
    queryFn: getUnreadCount,
    enabled: chatFeatureEnabled && !onChatRoute && !sidebarComponent && !hideSidebar
      && sideBarState !== sideBarStateType.HAMBURGER,
    staleTime: 60_000,
    refetchInterval: 60_000,
    retry: false,
  });
  const chatUnreadCount = onChatRoute ? liveUnread ?? polledUnread : polledUnread;

  // The learner's assigned mentors drive the My Mentors tab (see
  // ensureMentorTab). Shares the widget's query cache key.
  const [instituteId, setInstituteId] = useState<string | undefined>();
  useEffect(() => {
    getInstituteId().then((id) => setInstituteId(id ?? undefined));
  }, []);
  const myMentorsQuery = useQuery(handleGetMyMentors(instituteId));

  // "Daily tasks" shows only to learners whose institute runs a daily-task
  // plan. The dashboard records that from the feed (see readEngagementPlanFlag),
  // so the sidebar never polls the feed itself on every page.
  const [hasEngagementPlan, setHasEngagementPlan] = useState<boolean>(() =>
    readEngagementPlanFlag()
  );
  useEffect(() => {
    const sync = () => setHasEngagementPlan(readEngagementPlanFlag(instituteId));
    sync();
    window.addEventListener(ENGAGEMENT_PLAN_FLAG_EVENT, sync);
    return () => window.removeEventListener(ENGAGEMENT_PLAN_FLAG_EVENT, sync);
  }, [instituteId]);
  // A learner with no mentor still needs a way in to Find a mentor, so the tab
  // also appears when their institute lists mentors for browsing. The directory
  // is only fetched in that case — learners who already have a mentor see the
  // tab regardless and shouldn't pay for an extra request.
  const mentorDirectoryQuery = useQuery({
    ...handleGetMentorDirectory(instituteId),
    enabled: !!instituteId && myMentorsQuery.isSuccess && (myMentorsQuery.data?.length ?? 0) === 0,
  });

  // Identity footer: read the logged-in learner from Preferences (same
  // storage the hamburger sheet uses) so the sidebar can show who is
  // signed in and link to the profile screen.
  useEffect(() => {
    const fetchStudentData = async () => {
      try {
        const { value } = await Preferences.get({ key: "StudentDetails" });
        if (!value) return;
        const parsedData = JSON.parse(value);
        let studentDetails: Student | null = null;
        if (Array.isArray(parsedData)) {
          studentDetails = parsedData.length > 0 ? parsedData[0] : null;
        } else if (typeof parsedData === "object" && parsedData !== null) {
          studentDetails = parsedData;
        }
        if (studentDetails) setStudentData(studentDetails);
      } catch (error) {
        console.error("Error reading student details for sidebar:", error);
      }
    };
    fetchStudentData();
  }, []);

  const learnerDisplayName =
    studentData?.full_name?.trim() ||
    getTerminology(RoleTerms.Learner, SystemTerms.Learner);
  const learnerInitials =
    learnerDisplayName
      .split(/\s+/)
      .slice(0, 2)
      .map((word) => word.charAt(0))
      .join("")
      .toUpperCase() || "L";

  const iconByTabId: Record<string, unknown> = useMemo(
    () => ({
      dashboard: NavHouseIcon,
      "learning-center": NavBookIcon,
      homework: NavNotepadIcon,
      "assessment-center": NavClipboardCheckIcon,
      chat: NavChatIcon,
      referral: NavGiftIcon,
      attendance: NavCalendarCheckIcon,
      "my-mentors": NavUsersIcon,
      [DAILY_TASKS_TAB_ID]: NavDailyTasksIcon,
    }),
    []
  );

  const defaultRouteByTabId: Record<string, string> = useMemo(
    () => ({
      dashboard: "/dashboard",
      referral: "/referral",
      attendance: "/learning-centre/attendance",
      chat: "/chat",
      "my-mentors": "/my-mentors",
      [DAILY_TASKS_TAB_ID]: "/engagement",
    }),
    []
  );

  const labelByTabId: Record<string, string> = useMemo(
    () => ({
      dashboard: t("sidebar.tabs.dashboard"),
      "learning-center": t("sidebar.tabs.learningCenter"),
      homework: t("sidebar.tabs.homework"),
      "assessment-center": t("sidebar.tabs.assessmentCentre"),
      referral: t("sidebar.tabs.referral"),
      attendance: t("sidebar.tabs.attendance"),
      chat: t("sidebar.tabs.inAppMessages"),
      "my-mentors": t("sidebar.tabs.myMentors"),
      [DAILY_TASKS_TAB_ID]: tEngagement("nav.dailyTasks"),
    }),
    // t's identity is stable across a language switch in react-i18next; key
    // off i18n.language too so this fallback map actually re-translates.
    [t, tEngagement, i18n.language]
  );

  const transformTabsToSidebarItems = (
    tabs: StudentSidebarTabConfig[]
  ): SidebarItemsType[] => {
    return tabs
      .filter((t) => t.visible !== false)
      .map<SidebarItemsType>((t) => {
        const hasSubTabs = (t.subTabs || []).some((s) => s.visible !== false);
        const subItems: subItemsType[] | undefined = hasSubTabs
          ? (t.subTabs || [])
            .filter((s) => s.visible !== false)
            .map((s) => {
              let subLabel = s.label;
              if (!subLabel && s.id === "live-classes") {
                subLabel = getTerminologyPlural(
                  ContentTerms.LiveSession,
                  SystemTerms.LiveSession
                );
              }
              // Routes may carry a query string (e.g. /my-mentors?chat=<userId>
              // for the per-mentor chat entries); TanStack Link needs the
              // search params separated from the pathname.
              const [path, query] = (s.route || "/").split("?");
              return {
                subItem: subLabel || humanizeText(s.id),
                subItemLink: path || "/",
                subItemSearch: query
                  ? Object.fromEntries(new URLSearchParams(query))
                  : undefined,
              };
            })
          : undefined;
        const computedLabel = (
          t.label ||
          labelByTabId[t.id] ||
          t.id ||
          ""
        ).trim();
        const firstLetter = (computedLabel.charAt(0) || "?").toUpperCase();
        return {
          id: t.id,
          icon: iconByTabId[t.id] || createLetterIcon(firstLetter),
          title: t.label || labelByTabId[t.id] || humanizeText(t.id),
          to: subItems
            ? undefined
            : t.route || defaultRouteByTabId[t.id] || "/",
          subItems,
        } as SidebarItemsType;
      });
  };

  // The Chat tab is gated on the institute's chat-enabled flag (chat is OFF
  // by default — see getChatEnabled, which fails closed). When chat is enabled
  // we inject a default visible chat tab right after the dashboard tab whenever
  // the settings omit it, so it appears in a sensible position without
  // depending on saved config. When chat is disabled we strip any chat tab the
  // saved config may have carried, so no entry point leaks through.
  const ensureChatTab = (
    tabs: StudentSidebarTabConfig[],
    chatEnabled: boolean
  ): StudentSidebarTabConfig[] => {
    if (!chatEnabled) return tabs.filter((t) => t.id !== "chat");
    if (tabs.some((t) => t.id === "chat")) return tabs;
    const dashboardIndex = tabs.findIndex((t) => t.id === "dashboard");
    const chatTab: StudentSidebarTabConfig = {
      id: "chat",
      label: t("sidebar.tabs.inAppMessages"),
      route: "/chat",
      order: 0,
      visible: true,
    };
    const next = tabs.slice();
    next.splice(dashboardIndex >= 0 ? dashboardIndex + 1 : next.length, 0, chatTab);
    return next;
  };

  // The My Mentors tab is data-driven: the moment the learner actually has a
  // mentor assigned, surface the tab even if the institute's display settings
  // leave it hidden (the default), so the learner can find and contact their
  // mentor without any admin configuration. Each mentor gets their own
  // sub-entry that opens their chat directly (/my-mentors?chat=<userId>); an
  // admin-customised label always wins. Learners with no mentors keep whatever
  // the admin configured (hidden by default — the page has its own empty state).
  const ensureMentorTab = (
    tabs: StudentSidebarTabConfig[],
    mentors: MyMentor[],
    chatOn: boolean,
    directoryHasMentors: boolean
  ): StudentSidebarTabConfig[] => {
    if (mentors.length === 0 && !directoryHasMentors) return tabs;
    const soleMentorName =
      mentors.length === 1
        ? (mentors[0]?.display_name || mentors[0]?.name || "").trim()
        : "";
    const mentorLabel = soleMentorName
      ? t("sidebar.mentorLabelWithName", { name: soleMentorName.split(/\s+/)[0] })
      : t("sidebar.tabs.myMentors");
    // One chat entry per mentor (capped so a big list can't flood the rail),
    // after an "All mentors" entry for the full page with booking. When the
    // institute's chat feature is OFF the chat entries would be dead links, so
    // the tab collapses to a plain link (booking still works there).
    // With no mentors yet there is nothing to chat with, so the tab stays a plain
    // link straight to the page (where Find a mentor lives).
    const mentorSubTabs = chatOn && mentors.length > 0
      ? [
          {
            id: "my-mentors-all",
            label: t("sidebar.allMentors"),
            route: "/my-mentors",
            order: 1,
            visible: true,
          },
          ...mentors.slice(0, 6).map((m, i) => ({
            id: `my-mentor-chat-${m.user_id}`,
            label: t("sidebar.chatWithMentorName", {
              name: (m.display_name || m.name || t("sidebar.mentorFallbackName")).trim(),
            }),
            // Opens the full In-App Messages screen with this mentor's
            // conversation selected (resolved by /chat's ?dm= handling).
            route: `/chat?dm=${encodeURIComponent(m.user_id)}`,
            order: i + 2,
            visible: true,
          })),
        ]
      : undefined;
    const next = tabs.slice();
    const existingIndex = next.findIndex((t) => t.id === "my-mentors");
    if (existingIndex >= 0) {
      const existing = next[existingIndex] as StudentSidebarTabConfig;
      next[existingIndex] = {
        ...existing,
        visible: true,
        label: existing.label || mentorLabel,
        subTabs: mentorSubTabs,
      };
      return next;
    }
    const chatIndex = next.findIndex((t) => t.id === "chat");
    const dashboardIndex = next.findIndex((t) => t.id === "dashboard");
    const insertAt =
      chatIndex >= 0
        ? chatIndex + 1
        : dashboardIndex >= 0
          ? dashboardIndex + 1
          : next.length;
    next.splice(insertAt, 0, {
      id: "my-mentors",
      label: mentorLabel,
      route: "/my-mentors",
      order: 0,
      visible: true,
      subTabs: mentorSubTabs,
    });
    return next;
  };

  // The "Daily tasks" entry (/engagement, active on every /engagement page) is
  // data-driven like My Mentors: injected right after the dashboard while the
  // learner has a plan, and absent otherwise. A saved tab with this id (should
  // an institute ever configure one) keeps its own position and visibility.
  const ensureDailyTasksTab = (
    tabs: StudentSidebarTabConfig[],
    hasPlan: boolean
  ): StudentSidebarTabConfig[] => {
    if (!hasPlan) return tabs.filter((tab) => tab.id !== DAILY_TASKS_TAB_ID);
    if (tabs.some((tab) => tab.id === DAILY_TASKS_TAB_ID)) return tabs;
    const dashboardIndex = tabs.findIndex((tab) => tab.id === "dashboard");
    const next = tabs.slice();
    next.splice(dashboardIndex >= 0 ? dashboardIndex + 1 : 0, 0, {
      id: DAILY_TASKS_TAB_ID,
      route: "/engagement",
      order: 0,
      visible: true,
    });
    return next;
  };

  const filteredSidebarItems = useMemo(
    () =>
      transformTabsToSidebarItems(
        ensureDailyTasksTab(
          ensureMentorTab(
            configuredTabs,
            myMentorsQuery.data ?? [],
            chatFeatureEnabled,
            (mentorDirectoryQuery.data?.length ?? 0) > 0
          ),
          hasEngagementPlan
        )
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      configuredTabs,
      myMentorsQuery.data,
      mentorDirectoryQuery.data,
      chatFeatureEnabled,
      hasEngagementPlan,
      labelByTabId,
    ]
  );

  useEffect(() => {
    // Load display settings + chat-enabled flag and compute sidebar items.
    // getChatEnabled fails closed (chat hidden) when the flag is
    // unknown/loading/errored, matching chat being off by default.
    Promise.all([getStudentDisplaySettings(false), getChatEnabled()]).then(
      ([settings, chatEnabled]) => {
        const shouldHide = settings?.sidebar?.visible === false;
        setHideSidebar(!!shouldHide);
        // Only an explicit false hides the footer links: settings saved before
        // this flag existed have no value here and must keep showing them.
        setShowAppLinks(settings?.sidebar?.appLinks !== false);
        setChatFeatureEnabled(chatEnabled);
        setConfiguredTabs(
          ensureChatTab((settings?.sidebar?.tabs || []).slice(), chatEnabled)
        );
      }
    );

    if (sideBarState === sideBarStateType.HAMBURGER) {
      // Filter hamburger menu items based on permissions
      filterHamburgerMenuItemsWithPermissions(
        getHamBurgerSidebarItemsData(t),
        permissions || {
          canViewProfile: false,
          canEditProfile: false,
          canDeleteProfile: false,
          canViewFiles: false,
          canViewReports: false,
        }
      ).then((data) => {
        setFilteredHamburgerItems(data);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sideBarState]);

  const isExpanded = state === "expanded";

  // When the operator enables "stack name below logo", switch the expanded
  // header to a centered vertical layout (logo on top, name beneath). Only in
  // expanded, non-sub-org, name-visible mode; the collapsed rail stays icon-only.
  const stackNameBelowLogoLayout =
    stackNameBelowLogo && isExpanded && !hideInstituteName && !subOrgName;

  // Operator-configured logo dimensions only apply when the sidebar is
  // expanded — in icon-collapsed mode the rail has a fixed narrow width, so
  // a wide custom logo would overflow. Fall back to the default 28px square
  // in collapsed mode regardless of override.
  const hasCustomLogoDims =
    isExpanded && (logoWidthPx != null || logoHeightPx != null);
  // maxWidth: 100% caps the logo at the available sidebar width so an
  // admin-configured pixel width larger than the panel doesn't overflow —
  // it just fills the available space.
  const customLogoStyle: React.CSSProperties | undefined = hasCustomLogoDims
    ? {
        width: logoWidthPx ?? undefined,
        height: logoHeightPx ?? undefined,
        maxWidth: '100%',
      }
    : undefined;

  if (hideSidebar && !sidebarComponent) {
    return null;
  }

  return (
    <Sidebar
      side="left"
      collapsible={sidebarComponent ? "offcanvas" : "icon"}
      // Custom sidebars (the slides-viewer course tree) carry long slide
      // titles and a breadcrumb trail; give them a wider rail than the
      // standard nav sidebar.
      style={
        sidebarComponent
          ? ({ "--sidebar-width": "19rem" } as React.CSSProperties)
          : undefined
      }
    >
      <SidebarContent className={`sidebar-content flex flex-col bg-nav-surface dark:bg-neutral-900 py-1 transition-all  duration-200 ${isIOS ? 'mt-10' : ''} ease-in-out max-w-full w-full overflow-x-hidden`}>
        {/* A custom sidebar that carries its own identity block (the slides
            viewer puts institute and course on one compact line) suppresses
            this one — two stacked headers, each with its own copy of the
            logo, ate ~110px off the top of the panel before a single lesson
            appeared. The Android close button is kept either way: it's the
            only way out of the sheet. */}
        <SidebarHeader
          className={
            hideBrandingHeader
              ? // The Android close button is absolutely positioned and used to
                // clear the branding menu's `mt-12`. With the menu gone it needs
                // its own room, or it lands on top of the panel's header.
                isAndroid
                ? "p-0 pt-16"
                : "p-0"
              : "border-b border-border pb-2"
          }
        >
          {isAndroid && (
            <button
              type="button"
              onClick={toggleSidebar}
              aria-label={t("sidebar.closeSidebar")}
              className="absolute top-4 mt-6 end-4 z-10 size-8 flex items-center justify-center rounded-full bg-neutral-100 dark:bg-neutral-800 text-neutral-500 dark:text-neutral-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X size={18} />
            </button>
          )}
          {!hideBrandingHeader && (
          <SidebarMenu className={`px-1 ${isAndroid || isIOS ? 'mt-12' : ''}`}>
            <SidebarMenuItem>
              <SidebarMenuButton
                size="default"
                className={cn(
                  "h-auto min-h-10 gap-3 rounded-lg data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground",
                  "group-data-[collapsible=icon]:!size-10 group-data-[collapsible=icon]:!p-1",
                  "[.ui-play_&]:rounded-xl",
                  // When the institute name is hidden and we're not in
                  // sub-org mode, center the logo in the expanded sidebar
                  // so a wide custom-sized logo fills the sheet area.
                  hideInstituteName && !subOrgName && isExpanded && "justify-center",
                  // "Stack name below logo": centered vertical header.
                  stackNameBelowLogoLayout && "flex-col items-center gap-2 py-2 text-center"
                )}
                onClick={
                  homeIconClickRoute ? handleInstituteLogoClick : undefined
                }
              >
                {subOrgName ? (
                  /* Sub-org branding: show sub-org logo/name + "Powered by parent" */
                  <div className="flex flex-col gap-1 py-1 w-full">
                    <div className="flex h-10 items-center gap-3">
                      <div className="flex aspect-square size-8 items-center justify-center rounded-md text-sidebar-primary-foreground shrink-0">
                        {subOrgLogoUrl ? (
                          <img src={subOrgLogoUrl} alt={t("sidebar.logoAlt")} className="size-8 object-contain rounded-md bg-white" />
                        ) : (
                          <div className="size-8 rounded-md bg-primary-50 dark:bg-neutral-800 flex items-center justify-center text-caption font-semibold text-primary-500 dark:text-neutral-200">
                            {(subOrgName[0] || "S").toUpperCase()}
                          </div>
                        )}
                      </div>
                      {isExpanded && (
                        <span className="truncate text-subtitle font-semibold">
                          {subOrgName}
                        </span>
                      )}
                    </div>
                    {isExpanded && (
                      <div className="flex items-center gap-1.5 ps-11">
                        <span className="text-caption text-muted-foreground whitespace-nowrap">{t("common.poweredBy")}</span>
                        {!isNullOrEmptyOrUndefined(instituteLogoFileUrl) ? (
                          <img src={instituteLogoFileUrl} alt={instituteName} className="h-4 w-auto max-w-20 object-contain" />
                        ) : (
                          <span className="text-caption font-semibold text-muted-foreground truncate">{instituteName}</span>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  /* Default: parent institute branding */
                  <>
                    <div
                      className={
                        hasCustomLogoDims
                          ? "flex items-center justify-center text-sidebar-primary-foreground shrink-0"
                          : "flex aspect-square size-8 items-center justify-center rounded-md text-sidebar-primary-foreground shrink-0"
                      }
                      style={customLogoStyle}
                    >
                      {!isNullOrEmptyOrUndefined(instituteLogoFileUrl) ? (
                        <img
                          src={instituteLogoFileUrl}
                          alt={t("sidebar.logoAlt")}
                          className={
                            hasCustomLogoDims
                              ? "object-contain rounded-md bg-white"
                              : "size-8 object-contain rounded-md bg-white"
                          }
                          style={customLogoStyle}
                        />
                      ) : (
                        <div
                          className={
                            hasCustomLogoDims
                              ? "rounded-md bg-primary-50 dark:bg-neutral-800 flex items-center justify-center text-caption font-semibold text-primary-500 dark:text-neutral-200"
                              : "size-8 rounded-md bg-primary-50 dark:bg-neutral-800 flex items-center justify-center text-caption font-semibold text-primary-500 dark:text-neutral-200"
                          }
                          style={customLogoStyle}
                        >
                          {(instituteName?.[0] || "I").toUpperCase()}
                        </div>
                      )}
                    </div>
                    {!hideInstituteName && (
                      <div
                        className={cn(
                          "leading-tight",
                          stackNameBelowLogoLayout
                            ? "w-full min-w-0 text-center"
                            : "grid h-10 flex-1 content-center text-start"
                        )}
                      >
                        <span
                          className={cn(
                            "text-subtitle font-semibold",
                            // Stacked: wrap up to 2 lines (centered), ellipsis
                            // beyond. Beside the logo: single-line ellipsis.
                            stackNameBelowLogoLayout
                              ? "w-full line-clamp-2 break-words"
                              : "truncate"
                          )}
                        >
                          {instituteName}
                        </span>
                      </div>
                    )}
                  </>
                )}
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
          )}
        </SidebarHeader>

        <SidebarMenu
          className={`flex flex-col space-y-1 px-2 flex-1 transition-all duration-200 max-w-full w-full overflow-x-hidden ${isExpanded ? "items-stretch" : "items-center"
            }`}
        >
          {sidebarComponent
            ? sidebarComponent
            : (() => {
              const baseItems =
                sideBarState === sideBarStateType.HAMBURGER
                  ? filteredHamburgerItems
                  : filteredSidebarItems;
              // Hide every offline entry unless the platform supports it AND
              // the institute has offline access switched on. `null` = still
              // unknown, so hide until we're sure rather than flashing it in.
              const items =
                offlineAvailable === true ? baseItems : stripOfflineEntries(baseItems);
              const navRoutes = collectSidebarNavRoutes(
                items.map((obj) => ({ ...obj, to: obj.to || "/" })),
                pathname
              );

              return items.map((obj, key) => (
                <div
                  key={key}
                  className="animate-slide-in-left max-w-full w-full"
                  style={{
                    animationDelay: `${key * 30}ms`,
                  }}
                >
                  <SidebarItem
                    icon={obj.icon}
                    subItems={
                      obj.subItems as
                      | { subItem: string; subItemLink: string }[]
                      | undefined
                    }
                    title={obj.title}
                    to={(obj.to || "/") as string}
                    badgeCount={obj.id === "chat" ? chatUnreadCount : undefined}
                    navRoutes={navRoutes}
                  />
                </div>
              ));
            })()}
        </SidebarMenu>
      </SidebarContent>
      {(hasAppLinks || studentData) && (
          <SidebarFooter className="border-t border-border">
            {hasAppLinks &&
            ((state === "expanded" || isMobile) ? (
              <div className="flex flex-col gap-2 px-2">
                <span className="text-caption font-semibold uppercase text-muted-foreground tracking-wider ps-1 [.ui-play_&]:font-black [.ui-play_&]:text-primary-500">
                  {t("sidebar.appsAndPortals")}
                </span>
                <div className="flex flex-wrap gap-1">
                  {learnerPortalUrl && (
                    <a
                      href={learnerPortalUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex h-8 w-8 items-center justify-center rounded-md text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors [.ui-play_&]:rounded-full [.ui-play_&]:bg-primary-100 [.ui-play_&]:hover:bg-primary-200 [.ui-play_&]:border-2 [.ui-play_&]:border-primary-200 [.ui-play_&]:shadow-play-press"
                      title={t("sidebar.webPortal")}
                    >
                      <Globe className="h-5 w-5" weight="duotone" />
                    </a>
                  )}
                  {playStoreAppLink && (
                    <a
                      href={playStoreAppLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex h-8 w-8 items-center justify-center rounded-md text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors [.ui-play_&]:rounded-full [.ui-play_&]:bg-primary-100 [.ui-play_&]:hover:bg-primary-200 [.ui-play_&]:border-2 [.ui-play_&]:border-primary-200 [.ui-play_&]:shadow-play-press"
                      title={t("sidebar.androidApp")}
                    >
                      <GooglePlayLogo className="h-5 w-5 text-green-600" weight="fill" />
                    </a>
                  )}
                  {appStoreAppLink && (
                    <a
                      href={appStoreAppLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex h-8 w-8 items-center justify-center rounded-md text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors [.ui-play_&]:rounded-full [.ui-play_&]:bg-primary-100 [.ui-play_&]:hover:bg-primary-200 [.ui-play_&]:border-2 [.ui-play_&]:border-primary-200 [.ui-play_&]:shadow-play-press"
                      title={t("sidebar.iosApp")}
                    >
                      <AppStoreLogo className="h-5 w-5 text-sky-600" weight="fill" />
                    </a>
                  )}
                  {windowsAppLink && (
                    <a
                      href={windowsAppLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex h-8 w-8 items-center justify-center rounded-md text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors [.ui-play_&]:rounded-full [.ui-play_&]:bg-primary-100 [.ui-play_&]:hover:bg-primary-200 [.ui-play_&]:border-2 [.ui-play_&]:border-primary-200 [.ui-play_&]:shadow-play-press"
                      title={t("sidebar.windowsApp")}
                    >
                      <WindowsLogo className="h-5 w-5 text-blue-600" weight="fill" />
                    </a>
                  )}
                  {macAppLink && (
                    <a
                      href={macAppLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex h-8 w-8 items-center justify-center rounded-md text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors [.ui-play_&]:rounded-full [.ui-play_&]:bg-primary-100 [.ui-play_&]:hover:bg-primary-200 [.ui-play_&]:border-2 [.ui-play_&]:border-primary-200 [.ui-play_&]:shadow-play-press"
                      title={t("sidebar.macApp")}
                    >
                      <AppleLogo className="h-5 w-5 text-neutral-800 dark:text-neutral-200" weight="fill" />
                    </a>
                  )}
                </div>
              </div>
            ) : (
              <SidebarMenu>
                <SidebarMenuItem>
                  <Popover>
                    <PopoverTrigger asChild>
                      <SidebarMenuButton
                        size="lg"
                        className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground justify-center"
                        tooltip={t("sidebar.appsAndPortals")}
                      >
                        <SquaresFour weight="duotone" className="h-5 w-5" />
                      </SidebarMenuButton>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-1 min-w-12" side="right" align="end">
                      <div className="flex flex-col gap-1 items-center">
                        {learnerPortalUrl && (
                          <a
                            href={learnerPortalUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-accent transition-colors"
                            title={t("sidebar.webPortal")}
                          >
                            <Globe className="h-5 w-5" weight="duotone" />
                          </a>
                        )}
                        {playStoreAppLink && (
                          <a
                            href={playStoreAppLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-accent transition-colors"
                            title={t("sidebar.androidApp")}
                          >
                            <GooglePlayLogo className="h-5 w-5 text-green-600" weight="fill" />
                          </a>
                        )}
                        {appStoreAppLink && (
                          <a
                            href={appStoreAppLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-accent transition-colors"
                            title={t("sidebar.iosApp")}
                          >
                            <AppStoreLogo className="h-5 w-5 text-sky-600" weight="fill" />
                          </a>
                        )}
                        {windowsAppLink && (
                          <a
                            href={windowsAppLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-accent transition-colors"
                            title={t("sidebar.windowsApp")}
                          >
                            <WindowsLogo className="h-5 w-5 text-blue-600" weight="fill" />
                          </a>
                        )}
                        {macAppLink && (
                          <a
                            href={macAppLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-accent transition-colors"
                            title={t("sidebar.macApp")}
                          >
                            <AppleLogo className="h-5 w-5 text-neutral-800 dark:text-neutral-200" weight="fill" />
                          </a>
                        )}
                      </div>
                    </PopoverContent>
                  </Popover>
                </SidebarMenuItem>
              </SidebarMenu>
            ))}
            {studentData &&
              (state === "expanded" || isMobile ? (
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => navigate({ to: "/user-profile" })}
                    className="flex h-11 min-w-0 flex-1 items-center gap-3 rounded-lg px-2 text-start hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [.ui-play_&]:rounded-xl"
                  >
                    <span
                      aria-hidden
                      className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary-50 text-caption font-semibold text-primary-500"
                    >
                      {learnerInitials}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-body font-medium">
                      {learnerDisplayName}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => navigate({ to: "/logout" })}
                    aria-label={t("common.logOut")}
                    title={t("common.logOut")}
                    className="flex size-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [.ui-play_&]:rounded-xl"
                  >
                    <SignOut className="size-5" weight="duotone" />
                  </button>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-1">
                  <button
                    type="button"
                    onClick={() => navigate({ to: "/user-profile" })}
                    aria-label={t("sidebar.openProfile")}
                    title={learnerDisplayName}
                    className="flex size-10 items-center justify-center rounded-lg hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [.ui-play_&]:rounded-xl"
                  >
                    <span
                      aria-hidden
                      className="flex size-8 items-center justify-center rounded-full bg-primary-50 text-caption font-semibold text-primary-500"
                    >
                      {learnerInitials}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => navigate({ to: "/logout" })}
                    aria-label={t("common.logOut")}
                    title={t("common.logOut")}
                    className="flex size-10 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [.ui-play_&]:rounded-xl"
                  >
                    <SignOut className="size-5" weight="duotone" />
                  </button>
                </div>
              ))}
          </SidebarFooter>
        )}
    </Sidebar>
  );
};
