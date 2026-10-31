import { useTranslation } from "react-i18next";
import {
  AppleLogo,
  AppStoreLogo,
  DeviceMobile,
  Globe,
  GooglePlayLogo,
  WindowsLogo,
} from "@phosphor-icons/react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import useSidebarStore from "@/components/common/layout-container/sidebar/useSidebar";
import { cn } from "@/lib/utils";

/**
 * "Get the app" dashboard widget.
 *
 * The same store links the sidebar footer carries, as a full card on the
 * dashboard rail — for institutes that would rather advertise their app in the
 * page than in a corner of the sidebar. The two surfaces are independent
 * switches (`dashboard.widgets[getApp]` and `sidebar.appLinks`), so an
 * institute can run either, both, or neither.
 *
 * Links come from the institute's domain-routing row via the sidebar store,
 * which is the one place they are normalised (scheme added, self-links
 * dropped). Nothing is fetched here.
 */
export function GetAppWidget() {
  const { t } = useTranslation("dashboard");
  const playStoreAppLink = useSidebarStore((s) => s.playStoreAppLink);
  const appStoreAppLink = useSidebarStore((s) => s.appStoreAppLink);
  const windowsAppLink = useSidebarStore((s) => s.windowsAppLink);
  const macAppLink = useSidebarStore((s) => s.macAppLink);
  const learnerPortalUrl = useSidebarStore((s) => s.learnerPortalUrl);

  const entries = [
    {
      href: playStoreAppLink,
      label: t("getApp.android"),
      icon: <GooglePlayLogo className="size-5 text-green-600" weight="fill" />,
    },
    {
      href: appStoreAppLink,
      label: t("getApp.ios"),
      icon: <AppStoreLogo className="size-5 text-sky-600" weight="fill" />,
    },
    {
      href: windowsAppLink,
      label: t("getApp.windows"),
      icon: <WindowsLogo className="size-5 text-blue-600" weight="fill" />,
    },
    {
      href: macAppLink,
      label: t("getApp.mac"),
      icon: (
        <AppleLogo
          className="size-5 text-neutral-800 dark:text-neutral-200"
          weight="fill"
        />
      ),
    },
    {
      href: learnerPortalUrl,
      label: t("getApp.webPortal"),
      icon: <Globe className="size-5 text-muted-foreground" weight="duotone" />,
    },
  ].filter((e): e is typeof e & { href: string } => Boolean(e.href));

  // An institute with no app configured gets nothing rather than an empty card
  // telling learners to download something that does not exist.
  if (entries.length === 0) return null;

  return (
    <Card className="[.ui-play_&]:rounded-2xl [.ui-play_&]:border-2 [.ui-play_&]:border-primary-200">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-body font-semibold">
          <DeviceMobile className="size-5 text-primary-500" weight="duotone" />
          {t("getApp.title")}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <p className="text-caption text-muted-foreground">
          {t("getApp.subtitle")}
        </p>
        <div className="flex flex-col gap-1">
          {entries.map((entry) => (
            <a
              key={entry.label}
              href={entry.href}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(
                "flex items-center gap-3 rounded-lg px-2 py-2 text-body transition-colors",
                "hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                "[.ui-play_&]:rounded-xl [.ui-play_&]:hover:bg-primary-50"
              )}
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted/60 [.ui-play_&]:rounded-full [.ui-play_&]:bg-primary-100">
                {entry.icon}
              </span>
              <span className="min-w-0 flex-1 truncate font-medium">
                {entry.label}
              </span>
            </a>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export default GetAppWidget;
