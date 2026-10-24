import { useTranslation } from "react-i18next";
import { SidebarTrigger, useSidebar } from "@/components/ui/sidebar";
import { Sidebar } from "@phosphor-icons/react";
import { isChildViewActive } from "@/routes/parent/child/-lib/child-view";
import { useNavHeadingStore } from "@/stores/layout-container/useNavHeadingStore";
import { useEffect, useMemo, useState } from "react";
import useStore from "../sidebar/useSidebar";
import { getStudentDisplaySettings } from "@/services/student-display-settings";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Student } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { handleFetchUserRoleDetails } from "@/routes/study-library/courses/-services/institute-details";
import { DashboardLoader } from "@/components/core/dashboard-loader";
import { TokenKey } from "@/constants/auth/tokens";
import { NotificationsBell } from "./NotificationsBell";
import { AchievementsPill } from "@/routes/dashboard/-components/AchievementsPill";
import { TutorialsHelpButton } from "@/components/tutorials/TutorialsHelpButton";
import { UserMenu } from "./UserMenu";
import { handleGetPublicInstituteDetails } from "../services/navbar-services";
import { useRouter, useRouterState } from "@tanstack/react-router";
import { ArrowLeft, House } from "@phosphor-icons/react";
import { getInstituteLogoQuery } from "@/services/institute-logo";
import { useIsIOS } from "@/hooks/useIsIOS";
import { getTerminology } from "@/components/common/layout-container/sidebar/utils";
import { RoleTerms, SystemTerms } from "@/types/naming-settings";
import { Question } from "@phosphor-icons/react";
import { useQueryDialogStore } from "@/stores/useQueryDialogStore";
import { useDoubtManagementSetting } from "@/services/doubt-management-settings";
import { QueryDialog } from "@/components/common/queries/QueryDialog";
import { LanguageDropdown } from "@/components/common/localization/language-dropdown";
import { useLanguageStore } from "@/stores/localization/useLanguageStore";
import {
  getEnabledLocales,
  syncLanguageSettingFromSettingJson,
} from "@/services/language-settings";

interface UserRole {
  id: string;
  institute_id: string;
  role_name: string;
  status: string;
  role_id: string;
}

export function Navbar() {
  const { t } = useTranslation("layoutCommonA");
  // useQuery (NOT useSuspenseQuery): a failed navbar fetch must degrade to the
  // fallback UI below, not throw to the router error boundary and replace the
  // whole page (live class, assessment, ...) with an error screen.
  const { data: instituteDetails } = useQuery(
    handleGetPublicInstituteDetails(),
  );

  // Keep the institute language cache fresh on every app load (it is
  // otherwise only written at login), then show the switcher only when the
  // institute has enabled more than one language — same gate as the admin
  // navbar.
  useEffect(() => {
    if (instituteDetails?.setting !== undefined) {
      syncLanguageSettingFromSettingJson(instituteDetails.setting);
    }
  }, [instituteDetails]);
  const currentLocale = useLanguageStore((state) => state.locale);
  const showLanguageSwitcher = useMemo(
    () => getEnabledLocales(currentLocale).length > 1,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentLocale, instituteDetails],
  );
  const {
    data: userRoleDetails,
    isLoading,
    error,
  } = useQuery(handleFetchUserRoleDetails());

  // Fetch cached institute logo URL (cached for 24 hours)
  // Use useQuery (not useSuspenseQuery) because getInstituteLogoQuery has enabled: !!fileId
  // and useSuspenseQuery does not support enabled: false in TanStack Query v5
  const { data: cachedLogoUrl } = useQuery(
    getInstituteLogoQuery(instituteDetails?.institute_logo_file_id ?? null),
  );
  const isIOS = useIsIOS();
  const { showTopbarIcon } = useDoubtManagementSetting();
  const openQueryDialog = useQueryDialogStore((s) => s.open);

  const hasTeacherAndStudentRole = useMemo(() => {
    const roles: UserRole[] | undefined = userRoleDetails?.roles;
    if (!roles || roles.length === 0) return false;
    const names = roles.map((r) => r.role_name);
    return names.includes("STUDENT") && names.includes("TEACHER");
  }, [userRoleDetails?.roles]);

  const { navHeading } = useNavHeadingStore();
  const {
    setInstituteDetails,
    instituteName,
    instituteLogoFileUrl,
    hasCustomSidebar,
    homeIconClickRoute,
    subOrgName,
    subOrgLogoUrl,
  } = useStore();
  const router = useRouter();
  const [canGoBack, setCanGoBack] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isDashboard = pathname.startsWith("/dashboard");

  // Deep link into Help & Queries → My queries: `?openQueries=1` (the AI
  // tutor's "Sent to your teacher" card) and `?doubtId=…` (the doubt email
  // link, which had no handler). Open the dialog, then drop the params so a
  // refresh or Back doesn't reopen it.
  const searchStr = useRouterState({ select: (s) => s.location.searchStr });
  useEffect(() => {
    const params = new URLSearchParams(searchStr);
    if (!params.has("openQueries") && !params.has("doubtId")) return;
    openQueryDialog("my-queries");
    params.delete("openQueries");
    params.delete("doubtId");
    const rest = params.toString();
    router.history.replace(`${window.location.pathname}${rest ? `?${rest}` : ""}`);
  }, [searchStr, openQueryDialog, router]);

  // Session state wiped mid-page (expired refresh token, cleared storage):
  // the role query fails with the missing-userId error, or with the
  // interceptor's "Unauthorized" (only thrown after auth state was wiped on a
  // definitively rejected refresh). Send the user to login with a deep link
  // back instead of leaving them on a dead page. Transient network errors
  // have different messages and fall through to the fallback navbar below.
  useEffect(() => {
    if (
      error?.message?.includes("Could not determine userId") ||
      error?.message === "Unauthorized"
    ) {
      const redirect = window.location.pathname + window.location.search;
      router.navigate({
        to: "/login",
        search: { redirect } as never,
      });
    }
  }, [error, router]);

  const handleNavigateToAdmin = () => {
    if (!instituteDetails?.teacher_portal_base_url) return;
    const accessToken = localStorage.getItem(TokenKey.accessToken);
    const refreshToken = localStorage.getItem(TokenKey.refreshToken);
    window.location.href = `https://${instituteDetails.teacher_portal_base_url}/auth-transfer?accessToken=${accessToken}&refreshToken=${refreshToken}`;
  };

  async function fetch() {
    try {
      if (instituteDetails) {
        // Use cached logo URL from React Query instead of fetching again
        setInstituteDetails(
          instituteDetails.institute_name,
          cachedLogoUrl || "",
          instituteDetails.home_icon_click_route ??
            instituteDetails.homeIconClickRoute ??
            null,
        );
      }
    } catch (error) {
      console.error("Error fetching institute details:", error);
    }
  }

  const [showSidebarControls, setShowSidebarControls] = useState(true);
  const { isMobile, openMobile } = useSidebar();

  useEffect(() => {
    // setNotifications(true);
    fetch();
    // Apply institute details from public query as a reliable source on refresh
    if (instituteDetails && cachedLogoUrl !== undefined) {
      // Use cached logo URL - no need to fetch again
      setInstituteDetails(
        instituteDetails.institute_name,
        cachedLogoUrl || "",
        (
          instituteDetails as {
            home_icon_click_route?: string | null;
            homeIconClickRoute?: string | null;
          }
        )?.home_icon_click_route ??
          (
            instituteDetails as {
              home_icon_click_route?: string | null;
              homeIconClickRoute?: string | null;
            }
          )?.homeIconClickRoute ??
          null,
      );
    }
    // Load sidebar visibility from Student Display Settings (uses cache on dashboard refresh)
    getStudentDisplaySettings(false)
      .then((s) => setShowSidebarControls(s?.sidebar?.visible !== false))
      .catch(() => setShowSidebarControls(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instituteDetails, cachedLogoUrl]);

  const handleInstituteLogoClick = () => {
    if (homeIconClickRoute) {
      window.location.href = homeIconClickRoute;
    }
  };

  const handleGoHome = () => {
    if (homeIconClickRoute) {
      window.location.href = homeIconClickRoute;
    } else {
      router.navigate({ to: "/dashboard" });
    }
  };

  const handleGoBack = () => {
    router.history.back();
  };

  useEffect(() => {
    // Check if we can go back in history
    const checkCanGoBack = () => {
      setCanGoBack(window.history.length > 1);
    };

    checkCanGoBack();

    // Listen for navigation changes
    const handleNavigation = () => {
      checkCanGoBack();
    };

    window.addEventListener("popstate", handleNavigation);

    return () => {
      window.removeEventListener("popstate", handleNavigation);
    };
  }, []);

  if (isLoading) return <DashboardLoader />;

  // Handle error gracefully
  if (error) {
    console.warn(
      "Navbar: Error loading user role details, showing fallback UI:",
      error,
    );
    // Return a simplified navbar without role-dependent features
    return (
      <div className={`navbar sticky ${isChildViewActive() ? "top-10" : "top-0"} z-50 border-b border-primary-200/40 dark:border-neutral-800 flex h-12 md:h-14 items-center justify-between bg-white/80 dark:bg-neutral-900/80 backdrop-blur-sm px-2 md:px-5 py-1.5 md:py-2 transition-all duration-300 w-full overflow-x-auto flex-nowrap [.ui-play_&]:border-b [.ui-play_&]:border-border [.ui-play_&]:bg-white [.ui-play_&]:backdrop-blur-none`}>
        {/* Left Section */}
        <div className="flex min-w-0 flex-1 items-center gap-2 md:gap-3">
          {canGoBack && !isDashboard && (
            <Tooltip delayDuration={0}>
              <TooltipTrigger asChild>
                <button
                  onClick={handleGoBack}
                  className="group flex items-center justify-center w-7 h-7 md:w-8 md:h-8 rounded-md border border-primary-200/50 dark:border-neutral-700 bg-white dark:bg-neutral-800 hover:bg-primary-50 dark:hover:bg-neutral-700 hover:border-primary-300 dark:hover:border-neutral-600 transition-all duration-200 [.ui-play_&]:rounded-xl [.ui-play_&]:border [.ui-play_&]:border-border"
                >
                  <ArrowLeft className="w-4 h-4 text-primary-600 dark:text-primary-400 group-hover:text-primary-700 dark:group-hover:text-primary-300 transition-colors duration-200" />
                </button>
              </TooltipTrigger>
              <TooltipContent
                className="bg-primary-400 text-white"
                side="bottom"
              >
                {t("navbar.goBack")}
              </TooltipContent>
            </Tooltip>
          )}
          {!isDashboard && (
            <Tooltip delayDuration={0}>
              <TooltipTrigger asChild>
                <button
                  onClick={handleGoHome}
                  className="group flex items-center justify-center w-7 h-7 md:w-8 md:h-8 rounded-md border border-primary-200/50 dark:border-neutral-700 bg-white dark:bg-neutral-800 hover:bg-primary-50 dark:hover:bg-neutral-700 hover:border-primary-300 dark:hover:border-neutral-600 transition-all duration-200 [.ui-play_&]:rounded-xl [.ui-play_&]:border [.ui-play_&]:border-border"
                >
                  <House className="w-4 h-4 text-primary-600 dark:text-primary-400 group-hover:text-primary-700 dark:group-hover:text-primary-300 transition-colors duration-200" />
                </button>
              </TooltipTrigger>
              <TooltipContent
                className="bg-primary-400 text-white"
                side="bottom"
              >
                {t("common.home")}
              </TooltipContent>
            </Tooltip>
          )}
          {showSidebarControls && (
            <SidebarTrigger>
              <div
                onClick={() => {}}
                className="group flex items-center justify-center w-7 h-7 md:w-8 md:h-8 rounded-md border border-primary-200/50 dark:border-neutral-700 bg-white dark:bg-neutral-800 hover:bg-primary-50 dark:hover:bg-neutral-700 hover:border-primary-300 dark:hover:border-neutral-600 transition-all duration-200"
              >
                <Sidebar className="w-4 h-4 text-primary-600 dark:text-primary-400 group-hover:text-primary-700 dark:group-hover:text-primary-300 transition-colors duration-200" />
              </div>
            </SidebarTrigger>
          )}

          {!(
            (showSidebarControls && (isMobile ? openMobile : true)) ||
            hasCustomSidebar
          ) && (
            <div className="flex shrink-0 items-center gap-3">
              {/* Institute / Sub-org brand */}
              <div className="flex items-center gap-2">
                {subOrgName ? (
                  /* Sub-org branding: sub-org logo + "Powered by parent" */
                  <div className="flex items-center gap-2">
                    {subOrgLogoUrl ? (
                      <img
                        src={subOrgLogoUrl}
                        alt={subOrgName}
                        className={`h-8 md:h-10 w-auto max-w-32 object-contain border border-primary-200/60 dark:border-neutral-700 rounded-sm${
                          homeIconClickRoute ? " cursor-pointer" : ""
                        }`}
                        onClick={
                          homeIconClickRoute
                            ? handleInstituteLogoClick
                            : undefined
                        }
                      />
                    ) : (
                      <div
                        className={`h-7 w-7 md:h-8 md:w-8 rounded-sm bg-primary-200/40 dark:bg-neutral-700/60 flex items-center justify-center text-caption font-semibold text-primary-700 dark:text-neutral-200${
                          homeIconClickRoute ? " cursor-pointer" : ""
                        }`}
                        onClick={
                          homeIconClickRoute
                            ? handleInstituteLogoClick
                            : undefined
                        }
                      >
                        {(subOrgName[0] || "S").toUpperCase()}
                      </div>
                    )}
                    <div className="hidden md:flex flex-col leading-tight">
                      <span className="text-xs font-semibold text-primary-900 dark:text-primary-100 truncate max-w-32">
                        {subOrgName}
                      </span>
                      <div className="flex items-center gap-1">
                        <span className="text-caption text-muted-foreground">
                          {t("common.poweredBy")}
                        </span>
                        {instituteLogoFileUrl ? (
                          <img
                            src={instituteLogoFileUrl}
                            alt={instituteName}
                            className="h-3 w-auto max-w-16 object-contain"
                          />
                        ) : (
                          <span className="text-caption font-medium text-muted-foreground">
                            {instituteName}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  /* Default parent institute brand */
                  <>
                    {instituteLogoFileUrl ? (
                      <img
                        src={instituteLogoFileUrl}
                        alt={instituteName || t("navbar.instituteFallbackAlt")}
                        onClick={
                          homeIconClickRoute
                            ? handleInstituteLogoClick
                            : undefined
                        }
                        className={`h-8 md:h-10 w-auto max-w-32 object-contain border border-primary-200/60 dark:border-neutral-700 rounded-sm${
                          homeIconClickRoute ? " cursor-pointer" : ""
                        }`}
                      />
                    ) : (
                      <div
                        className={`h-7 w-7 md:h-8 md:w-8 rounded-sm bg-primary-200/40 dark:bg-neutral-700/60 flex items-center justify-center text-caption font-semibold text-primary-700 dark:text-neutral-200${
                          homeIconClickRoute ? " cursor-pointer" : ""
                        }`}
                        onClick={
                          homeIconClickRoute
                            ? handleInstituteLogoClick
                            : undefined
                        }
                      >
                        {(instituteName?.[0] || "I").toUpperCase()}
                      </div>
                    )}
                  </>
                )}
              </div>
              <div className="h-7 md:h-8 w-px shrink-0 bg-primary-200/50 dark:bg-neutral-700" />
            </div>
          )}

          {/* Always-on page title */}
          <h1 className="min-w-0 truncate text-sm md:text-base font-semibold text-primary-900 dark:text-primary-100 [.ui-play_&]:font-bold">
            {navHeading || t("sidebar.tabs.dashboard")}
          </h1>
        </div>

        {/* Right Section */}
        <div className="flex shrink-0 items-center gap-1">
          {showLanguageSwitcher && <LanguageDropdown className="relative hidden sm:block" />}
          <TutorialsHelpButton className="h-9 w-9" />
          <NotificationsBell className="h-9 w-9" />
          <UserMenu showLanguage={showLanguageSwitcher} />
        </div>
      </div>
    );
  }

  return (
    <div
      className={`navbar sticky ${isChildViewActive() ? "top-10" : "top-0"} z-50 border-b border-primary-200/40 dark:border-neutral-800 flex h-12 md:h-14 items-center justify-between bg-white/80 dark:bg-neutral-900/80 backdrop-blur-sm px-2 md:px-5 py-1.5 md:py-2 transition-all duration-300 w-full overflow-x-auto flex-nowrap [.ui-play_&]:border-b [.ui-play_&]:border-border [.ui-play_&]:bg-white [.ui-play_&]:backdrop-blur-none ${isIOS ? "mt-10" : ""}`}
    >
      {/* Left Section */}
      <div className="flex min-w-0 flex-1 items-center gap-2 md:gap-3">
        {showSidebarControls && (
          <SidebarTrigger>
            <div
              onClick={() => {}}
              className="group flex items-center justify-center w-7 h-7 md:w-8 md:h-8 rounded-md border border-primary-200/50 dark:border-neutral-700 bg-white dark:bg-neutral-800 hover:bg-primary-50 dark:hover:bg-neutral-700 hover:border-primary-300 dark:hover:border-neutral-600 transition-all duration-200 [.ui-play_&]:rounded-xl [.ui-play_&]:border [.ui-play_&]:border-border"
            >
              <Sidebar className="w-4 h-4 text-primary-600 dark:text-neutral-300 group-hover:text-primary-700 dark:group-hover:text-neutral-200 transition-colors duration-200" />
            </div>
          </SidebarTrigger>
        )}
        {canGoBack && !isDashboard && (
          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>
              <button
                onClick={handleGoBack}
                className="group flex items-center justify-center w-7 h-7 md:w-8 md:h-8 rounded-md border border-primary-200/50 dark:border-neutral-700 bg-white dark:bg-neutral-800 hover:bg-primary-50 dark:hover:bg-neutral-700 hover:border-primary-300 dark:hover:border-neutral-600 transition-all duration-200"
              >
                <ArrowLeft className="w-4 h-4 text-primary-600 dark:text-neutral-300 group-hover:text-primary-700 dark:group-hover:text-neutral-200 transition-colors duration-200" />
              </button>
            </TooltipTrigger>
            <TooltipContent className="bg-primary-400 text-white" side="bottom">
              {t("navbar.goBack")}
            </TooltipContent>
          </Tooltip>
        )}
        {!isDashboard && (
          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>
              <button
                onClick={handleGoHome}
                className="group flex items-center justify-center w-7 h-7 md:w-8 md:h-8 rounded-md border border-primary-200/50 dark:border-neutral-700 bg-white dark:bg-neutral-800 hover:bg-primary-50 dark:hover:bg-neutral-700 hover:border-primary-300 dark:hover:border-neutral-600 transition-all duration-200 [.ui-play_&]:rounded-xl [.ui-play_&]:border [.ui-play_&]:border-border"
              >
                <House className="w-4 h-4 text-primary-600 dark:text-neutral-300 group-hover:text-primary-700 dark:group-hover:text-neutral-200 transition-colors duration-200" />
              </button>
            </TooltipTrigger>
            <TooltipContent className="bg-primary-400 text-white" side="bottom">
              {t("common.home")}
            </TooltipContent>
          </Tooltip>
        )}

        {!(
          (showSidebarControls && (isMobile ? openMobile : true)) ||
          hasCustomSidebar
        ) && (
          <div className="flex shrink-0 items-center gap-3">
            {/* Institute brand */}
            <div className="flex items-center gap-2">
              {instituteLogoFileUrl ? (
                <img
                  src={instituteLogoFileUrl}
                  alt={instituteName || t("navbar.instituteFallbackAlt")}
                  onClick={
                    homeIconClickRoute ? handleInstituteLogoClick : undefined
                  }
                  className={`h-8 md:h-10 w-auto max-w-32 object-contain dark:border-neutral-700 rounded-sm${
                    homeIconClickRoute ? " cursor-pointer" : ""
                  }`}
                />
              ) : (
                <div
                  className={`h-7 w-7 md:h-8 md:w-8 rounded-sm bg-primary-200/40 dark:bg-neutral-700/60 flex items-center justify-center text-caption font-semibold text-primary-700 dark:text-neutral-200${
                    homeIconClickRoute ? " cursor-pointer" : ""
                  }`}
                  onClick={
                    homeIconClickRoute ? handleInstituteLogoClick : undefined
                  }
                >
                  {(instituteName?.[0] || "I").toUpperCase()}
                </div>
              )}
            </div>
            <div className="hidden w-px h-7 md:h-8 shrink-0 bg-primary-200/60 dark:bg-neutral-700 sm:block"></div>
          </div>
        )}

        {/* Page title: identity + location. Dropped on phones on the dashboard,
            where the greeting already says where you are and the bar is full. */}
        {navHeading ? (
          <h1 className={`min-w-0 truncate text-sm md:text-base font-semibold leading-tight text-neutral-900 dark:text-neutral-100 [.ui-play_&]:font-bold${isDashboard ? " hidden sm:block" : ""}`}>
            {navHeading}
          </h1>
        ) : null}
      </div>

      {/* Right Section: one aligned cluster of ghost icon buttons */}
      <div className="flex shrink-0 items-center gap-1">
        {hasTeacherAndStudentRole && (
          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                className="h-8 md:h-10 rounded-full px-2 md:px-3 py-1.5 md:py-2 flex items-center gap-1.5 md:gap-2 [.ui-play_&]:rounded-xl [.ui-play_&]:border [.ui-play_&]:border-border [.ui-play_&]:font-bold"
                onClick={handleNavigateToAdmin}
              >
                <Student className="h-4 w-4 md:h-5 md:w-5" />
                <span className="hidden sm:inline text-xs md:text-sm font-medium">
                  {t("navbar.switchToRole", {
                    role: getTerminology(RoleTerms.Teacher, SystemTerms.Teacher),
                  })}
                </span>
              </Button>
            </TooltipTrigger>
            <TooltipContent className="bg-primary-400 text-white" side="left">
              <p>
                {t("navbar.switchToRole", {
                  role: getTerminology(RoleTerms.Teacher, SystemTerms.Teacher),
                })}
              </p>
            </TooltipContent>
          </Tooltip>
        )}
        {/* Achievements — badge count + points, opens the achievements popup */}
        <AchievementsPill className="hidden xs:flex" />
        {/* Language switcher — only when the institute enabled >1 language */}
        {showLanguageSwitcher && <LanguageDropdown className="relative hidden sm:block" />}
        {/* Help & tutorials */}
        <TutorialsHelpButton className="h-9 w-9" />
        {/* Notifications */}
        <NotificationsBell className="h-9 w-9" />

        {showTopbarIcon && (
          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={t("navbar.raiseQuery")}
                onClick={() => openQueryDialog()}
                className="hidden h-9 w-9 items-center justify-center rounded-md text-primary-600 transition-colors sm:flex duration-200 hover:bg-primary-50 hover:text-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 dark:text-primary-400 dark:hover:bg-neutral-700 dark:hover:text-primary-300 [.ui-play_&]:rounded-full [.ui-play_&]:border [.ui-play_&]:border-border [.ui-play_&]:bg-primary/10"
              >
                <Question className="h-4 w-4 md:h-5 md:w-5" />
              </button>
            </TooltipTrigger>
            <TooltipContent className="bg-primary-400 text-white" side="bottom">
              {t("navbar.raiseQuery")}
            </TooltipContent>
          </Tooltip>
        )}

        {/* Avatar + account dropdown (also holds language + raise-a-query on phones) */}
        <UserMenu
          showLanguage={showLanguageSwitcher}
          onRaiseQuery={showTopbarIcon ? () => openQueryDialog() : undefined}
        />
      </div>

      {/* Global query dialog — opened from this icon and the dashboard card */}
      <QueryDialog />
    </div>
  );
}
