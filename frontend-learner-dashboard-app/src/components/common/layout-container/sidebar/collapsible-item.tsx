import React, { useState } from "react";
import { Link, useRouter } from "@tanstack/react-router";
import { CaretRight } from "@phosphor-icons/react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
    SidebarMenuButton,
    SidebarMenuItem,
    SidebarMenuSub,
    SidebarMenuSubButton,
    SidebarMenuSubItem,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import { SidebarItemProps } from "../../../../types/layout-container-types";
import { sidebarOpenGroups } from "./open-groups";

export const CollapsibleItem = ({ icon, title, subItems, onClick }: SidebarItemProps) => {
    const router = useRouter();
    const currentRoute = router.state.location.pathname;
    const currentSearch = router.state.location.search as Record<string, unknown>;
    // A sub-item is active when its pathname matches AND every search param it
    // carries matches the URL — so the per-mentor chat entries (/chat?dm=<id>)
    // highlight exactly the mentor whose conversation is open, never each other.
    const isSubItemActive = (item: NonNullable<typeof subItems>[number]): boolean =>
        item.subItemLink === currentRoute &&
        (!item.subItemSearch ||
            Object.entries(item.subItemSearch).every(
                ([key, value]) => currentSearch?.[key] === value
            ));
    const isChildActive = subItems?.some(isSubItemActive);
    const [open, setOpen] = useState(() =>
        sidebarOpenGroups.resolve(title, !!isChildActive)
    );
    const handleOpenChange = (next: boolean) => {
        setOpen(next);
        sidebarOpenGroups.set(title, next);
    };

    return (
        <Collapsible asChild open={open} onOpenChange={handleOpenChange} className="group/collapsible">
            <SidebarMenuItem>
                <CollapsibleTrigger asChild>
                    <SidebarMenuButton
                        tooltip={title}
                        isActive={isChildActive}
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
                        {isChildActive && (
                            <span
                                aria-hidden
                                className="absolute inset-y-2 start-0 w-1 rounded-full bg-nav-active-text"
                            />
                        )}
                        {icon && React.createElement(icon, {
                            weight: isChildActive ? "fill" : "duotone",
                            className: "size-5 shrink-0"
                        })}
                        <span className="flex-1 truncate">{title}</span>
                        <CaretRight className="ms-auto shrink-0 transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                    </SidebarMenuButton>
                </CollapsibleTrigger>
                <CollapsibleContent>
                    <SidebarMenuSub>
                        {subItems?.map((item) => (
                            <SidebarMenuSubItem key={item.subItem}>
                                <SidebarMenuSubButton
                                    asChild
                                    isActive={isSubItemActive(item)}
                                    className={cn(
                                        "h-8 rounded-md text-body text-nav-text",
                                        "hover:bg-nav-surface-hover/60 focus-visible:ring-2 focus-visible:ring-ring",
                                        "data-[active=true]:bg-nav-active data-[active=true]:text-nav-active-text data-[active=true]:font-medium",
                                        "[.ui-vibrant_&]:data-[active=true]:bg-primary-100",
                                        "[.ui-play_&]:rounded-lg [.ui-play_&]:data-[active=true]:bg-play-highlight [.ui-play_&]:data-[active=true]:text-play-ink"
                                    )}
                                >
                                    <Link
                                        to={item.subItemLink}
                                        search={item.subItemSearch}
                                        onClick={onClick}
                                    >
                                        <span className="truncate">{item.subItem}</span>
                                    </Link>
                                </SidebarMenuSubButton>
                            </SidebarMenuSubItem>
                        ))}
                    </SidebarMenuSub>
                </CollapsibleContent>
            </SidebarMenuItem>
        </Collapsible>
    );
};
