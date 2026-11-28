import { SidebarTrigger } from "@/components/ui/sidebar";
import { Sidebar } from "@phosphor-icons/react";
import { ArrowLeft, Bell, Users } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useRouter } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";

interface ParentPortalNavbarProps {
  title: string;
  parentName: string;
  onSwitchChild?: () => void;
  canSwitch: boolean;
  instituteLogoUrl?: string;
}

export function ParentPortalNavbar({
  title,
  parentName,
  onSwitchChild,
  canSwitch,
}: ParentPortalNavbarProps) {
  const { t } = useTranslation("parent");
  const router = useRouter();
  const [canGoBack, setCanGoBack] = useState(false);

  useEffect(() => {
    const check = () => setCanGoBack(window.history.length > 1);
    check();
    window.addEventListener("popstate", check);
    return () => window.removeEventListener("popstate", check);
  }, []);

  const handleGoBack = () => router.history.back();

  return (
    <header className="navbar sticky top-0 z-50 border-b border-primary-200/40 dark:border-neutral-800 flex h-12 md:h-14 items-center justify-between bg-white dark:bg-neutral-900 px-2 md:px-5 py-1.5 md:py-2 transition-all duration-300 shadow-sm w-full overflow-x-auto flex-nowrap gap-2">
      {/* Left — back button + sidebar trigger */}
      <div className="flex items-center gap-2 shrink-0">
        {canGoBack && (
          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>
              <button
                onClick={handleGoBack}
                className="group flex items-center justify-center w-7 h-7 md:w-8 md:h-8 rounded-md border border-primary-200/50 dark:border-neutral-700 bg-white dark:bg-neutral-800 hover:bg-primary-50 dark:hover:bg-neutral-700 hover:border-primary-300 dark:hover:border-neutral-600 transition-all duration-200"
              >
                <ArrowLeft className="w-4 h-4 text-primary-600 dark:text-primary-400" weight="bold" />
              </button>
            </TooltipTrigger>
            <TooltipContent className="bg-primary-400 text-white" side="bottom">
              {t("admissionPortal.navbar.goBack")}
            </TooltipContent>
          </Tooltip>
        )}

        <SidebarTrigger className="flex items-center justify-center w-7 h-7 md:w-8 md:h-8 rounded-md border border-primary-200/50 dark:border-neutral-700 bg-white dark:bg-neutral-800 hover:bg-primary-50 dark:hover:bg-neutral-700 hover:border-primary-300 dark:hover:border-neutral-600 transition-all duration-200 [&>svg]:hidden">
          <Sidebar className="w-4 h-4 text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300 transition-colors duration-200" />
        </SidebarTrigger>
      </div>

      {/* Centre — page title */}
      <h1 className="flex-1 text-sm md:text-base font-semibold truncate text-neutral-800 dark:text-neutral-100">
        {title}
      </h1>

      {/* Right — parent name + switch child + notifications */}
      <div className="flex items-center gap-2 shrink-0">
        {canSwitch && onSwitchChild && (
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={onSwitchChild}
              className="hidden sm:flex items-center gap-2 h-8 text-xs"
            >
              <Users className="h-3.5 w-3.5" weight="duotone" />
              {t("admissionPortal.navbar.switchChild")}
            </Button>
            <button
              onClick={onSwitchChild}
              className="sm:hidden flex items-center justify-center w-8 h-8 rounded-md border border-primary-200/50 dark:border-neutral-700 bg-white dark:bg-neutral-800 hover:bg-primary-50 transition-all duration-200"
              title={t("admissionPortal.navbar.switchChild")}
            >
              <Users className="h-4 w-4 text-primary-600" weight="duotone" />
            </button>
          </>
        )}

        {/* Parent name badge */}
        <div className="hidden lg:flex items-center gap-2 px-2.5 py-1 rounded-full bg-muted/50 border border-border/50">
          <div className="w-5 h-5 rounded-full bg-primary/10 flex items-center justify-center">
            <Users className="h-3 w-3 text-primary" weight="duotone" />
          </div>
          <span className="text-xs font-medium text-foreground pe-1">
            {parentName}
          </span>
        </div>

        {/* Notification bell */}
        <button className="relative flex items-center justify-center w-8 h-8 rounded-md border border-primary-200/50 dark:border-neutral-700 bg-white dark:bg-neutral-800 hover:bg-primary-50 transition-all duration-200">
          <Bell className="h-4 w-4 text-muted-foreground" weight="duotone" />
          <span className="absolute top-2 end-2 h-1.5 w-1.5 bg-orange-500 rounded-full border border-white" />
        </button>
      </div>
    </header>
  );
}

