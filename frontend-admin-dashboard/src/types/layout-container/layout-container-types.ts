import { IconProps } from '@phosphor-icons/react';

/**
 * The sidebar's top-level worlds, shown as the icon rail.
 *
 * Single source of truth: the rail, the panel, search, colors, recents and the
 * per-role display settings all key off this union, so a new category is added
 * here once rather than in every literal that used to spell it out.
 *
 * ERP is the operations world (HR & Payroll today; accounting/inventory next).
 */
export type SidebarCategory = 'CRM' | 'LMS' | 'AI' | 'ERP';

export interface subItemsType {
    subItem: string | undefined;
    subItemLink: string | undefined;
    subItemId: string;
    adminOnly?: boolean;
    locked?: boolean;
}

export interface SidebarItemsType {
    icon: React.FC<IconProps>;
    title: string;
    to?: string;
    subItems?: subItemsType[];
    id: string;
    locked?: boolean;
    showForInstitute?: string;
    category?: SidebarCategory;
}
export interface SidebarItemProps {
    icon?: React.FC<IconProps>;
    title: string;
    to?: string;
    subItems?: subItemsType[];
    selectedItem?: string;
    locked?: boolean;
    category?: SidebarCategory;
}

export interface SidebarStateType {
    state: string;
}
