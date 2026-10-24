import React from "react";
import { Link, useRouter } from "@tanstack/react-router";
import { SidebarItemProps } from "../../../../types/layout-container-types";
import { SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import { isNavRouteActive } from "./active-route";

export const NonCollapsibleItem = ({ icon, title, to, onClick, badgeCount, navRoutes = [] }: SidebarItemProps) => {
    const router = useRouter();
    const currentRoute = router.state.location.pathname;
    const isActive = isNavRouteActive(currentRoute, to, navRoutes);

    return (
        <SidebarMenuItem>
            <SidebarMenuButton
                asChild
                isActive={isActive}
                tooltip={title}
                size="default"
                className={cn(
                    "relative h-10 gap-3 rounded-lg px-3 text-body font-medium text-nav-text [&>svg]:size-5",
                    "hover:bg-nav-surface-hover/60 focus-visible:ring-2 focus-visible:ring-ring",
                    "data-[active=true]:bg-nav-active data-[active=true]:text-nav-active-text",
                    "group-data-[collapsible=icon]:!size-10 group-data-[collapsible=icon]:!p-2",
                    "[.ui-vibrant_&]:data-[active=true]:bg-primary-100",
                    "[.ui-play_&]:rounded-xl [.ui-play_&]:[&>svg]:size-6",
                    "[.ui-play_&]:data-[active=true]:bg-play-highlight [.ui-play_&]:data-[active=true]:text-play-ink"
                )}
            >
                <Link to={to} onClick={onClick}>
                    {isActive && (
                        <span
                            aria-hidden
                            className="absolute inset-y-2 start-0 w-1 rounded-full bg-nav-active-text"
                        />
                    )}
                    {icon && React.createElement(icon, {
                        weight: isActive ? "fill" : "duotone",
                        className: "size-5 shrink-0"
                    })}
                    <span className="truncate">{title}</span>
                    {!!badgeCount && badgeCount > 0 && (
                        <span
                            className={cn(
                                "ms-auto flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-primary-500 px-1.5 text-caption font-semibold tabular-nums text-white",
                                // Collapsed icon rail: pin the count to the icon's corner.
                                "group-data-[collapsible=icon]:absolute group-data-[collapsible=icon]:end-0 group-data-[collapsible=icon]:top-0"
                            )}
                        >
                            {badgeCount > 99 ? "99+" : badgeCount}
                        </span>
                    )}
                </Link>
            </SidebarMenuButton>
        </SidebarMenuItem>
    );
};
