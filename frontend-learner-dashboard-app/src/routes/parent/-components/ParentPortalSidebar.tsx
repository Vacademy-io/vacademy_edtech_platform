import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { useRouter, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import type { ChildProfile } from "@/types/parent-portal";
import { useNavTabs, type TabId } from "./navigation-config";
import { shouldHidePaidPurchaseUI } from "@/utils/ios-iap-compliance";

interface ParentPortalSidebarProps {
  child: ChildProfile;
  activeTab: TabId;
  instituteName?: string;
  instituteLogoUrl?: string;
}

export function ParentPortalSidebar({
  child,
  activeTab,
  instituteName,
  instituteLogoUrl,
}: ParentPortalSidebarProps) {
  const { t } = useTranslation("parent");
  const navTabs = useNavTabs();
  const router = useRouter();
  const { state } = useSidebar();
  const isExpanded = state === "expanded";

  const childInitials = child.full_name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <Sidebar side="left" collapsible="icon">
      <SidebarContent className="flex flex-col bg-white dark:bg-neutral-900 border-e border-gray-200 dark:border-neutral-800 py-2 transition-all duration-200 ease-in-out max-w-full w-full overflow-x-hidden">
        {/* Header — institute logo or child initials */}
        <SidebarHeader>
          <SidebarMenu className="px-2">
            <SidebarMenuItem>
              <SidebarMenuButton
                size="lg"
                className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
              >
                <div className="flex aspect-square size-8 items-center justify-center rounded-lg text-sidebar-primary-foreground shrink-0">
                  {instituteLogoUrl ? (
                    <img
                      src={instituteLogoUrl}
                      alt={t("admissionPortal.sidebar.logoAlt")}
                      className="size-8 object-contain rounded-md"
                    />
                  ) : (
                    <div className="bg-primary/10 border border-primary/20 rounded-md flex items-center justify-center w-8 h-8">
                      <span className="text-xs font-bold text-primary">
                        {childInitials}
                      </span>
                    </div>
                  )}
                </div>
                <div className="grid flex-1 text-start text-sm leading-tight">
                  <span className="truncate font-semibold">
                    {instituteName || child.full_name}
                  </span>
                  <span className="truncate text-xs text-muted-foreground">
                    {child.grade_applying ||
                      t("admissionPortal.sidebar.admissionPortal")}
                  </span>
                </div>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>

        {/* Nav items */}
        <SidebarMenu
          className={`flex flex-col space-y-1 px-2 flex-1 transition-all duration-200 max-w-full w-full overflow-x-hidden ${
            isExpanded ? "items-stretch" : "items-center"
          }`}
        >
          {navTabs.filter(
            // Reader mode (native iOS): the "Payment" tab embeds an external
            // Razorpay checkout — hide it (Apple 3.1.1). The route is also
            // blocked in __root, so this just removes the now-dead tab.
            (tab) => !(shouldHidePaidPurchaseUI() && tab.id === "payments"),
          ).map((tab, index) => {
            const currentPath = router.state.location.pathname;
            const isActive =
              tab.id === activeTab ||
              (tab.route === "/parent-portal/"
                ? currentPath === "/parent-portal" ||
                  currentPath === "/parent-portal/"
                : currentPath.startsWith(tab.route.replace(/\/$/, "")));

            return (
              <div
                key={tab.id}
                className="animate-slide-in-left max-w-full w-full"
                style={{ animationDelay: `${index * 30}ms` }}
              >
                <SidebarMenuItem>
                  <SidebarMenuButton
                    isActive={isActive}
                    tooltip={tab.label}
                    size="lg"
                    onClick={() => {
                      console.log(
                        `Navigating to ${tab.route} for tab ${tab.id}`,
                      ); // Debug log
                    }}
                  >
                    <Link
                      to={tab.route}
                      className="flex gap-2 justify-center items-center"
                    >
                      <tab.icon className="w-4 h-4" />
                      <span>{tab.label}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </div>
            );
          })}
        </SidebarMenu>
      </SidebarContent>
    </Sidebar>
  );
}
