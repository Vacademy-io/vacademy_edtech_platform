import { CollapsibleItem } from "./collapsible-item";
import { NonCollapsibleItem } from "./non-collapsible-item";
import { SidebarItemProps } from "@/types/layout-container-types";

export const SidebarItem = ({ icon, title, to, subItems, onClick, badgeCount, navRoutes }: SidebarItemProps) => {
    return subItems && subItems.length > 0 ? (
        <CollapsibleItem icon={icon} title={title} to={to} subItems={subItems} onClick={onClick} />
    ) : (
        <NonCollapsibleItem icon={icon} title={title} to={to} onClick={onClick} badgeCount={badgeCount} navRoutes={navRoutes} />
    );
};
