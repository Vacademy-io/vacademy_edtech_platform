import { MySidebar } from './sidebar/mySidebar';
import { useSidebar } from '@/components/ui/sidebar';
import { Navbar } from './top-navbar.tsx/navbar';
import { cn } from '@/lib/utils';
import * as React from 'react';
import { useEffect, useRef } from 'react';
import { InternalSideBar } from './internal-sidebar/internalSideBar';
import { StudentSidebarProvider } from '@/routes/manage-students/students-list/-providers/student-sidebar-provider';
import { InternalSidebarComponent } from './internal-sidebar/internalSidebarComponent';
import { getDisplaySettingsFromCache } from '@/services/display-settings';
import { getActiveRoleDisplaySettingsKey } from '@/lib/auth/instituteUtils';
import { useAssistDockVisible } from '@/components/assist-dock/visibility';
import { useIsMobile, useIsTablet } from '@/hooks/use-mobile';
import { hasFacultyAssignedPermission } from '@/lib/auth/facultyAccessUtils';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { RouteAccessGuard } from './route-access-guard';

/**
 * New sidebar dimensions (Gmail-style two-bar):
 * - Rail:    64px (always visible on desktop)
 * - Panel:  250px (collapsible)
 * - Total expanded:  64 + 250 = 314px  (set via --sidebar-width in sidebar.tsx)
 * - Total collapsed: 64px (rail only)   (set via --sidebar-width-icon in sidebar.tsx)
 *
 * The shadcn <Sidebar> component handles its own spacer div via CSS variables,
 * so LayoutContainer no longer needs to manually reserve width.
 */

export const LayoutContainer = ({
    children,
    className,
    sidebarComponent,
    intrnalMargin = true,
    internalSideBar = false,
    sideBarList,
    sideBarData,
    internalSidebarComponent,
    hasInternalSidebarComponent = false,
    customSidebarControl = false,
    showMobileBackButton = false,
    internalSidebarMobileText,
}: {
    children?: React.ReactNode;
    className?: string;
    sidebarComponent?: React.ReactNode;
    intrnalMargin?: boolean;
    internalSideBar?: boolean;
    sideBarList?: { value: string; id: string }[];
    sideBarData?: { title: string; listIconText: string; searchParam: string };
    hasInternalSidebarComponent?: boolean;
    internalSidebarComponent?: React.ReactNode;
    customSidebarControl?: boolean;
    showMobileBackButton?: boolean;
    internalSidebarMobileText?: string;
}) => {
    const { open, setOpen } = useSidebar();
    const isMobile = useIsMobile();
    const isTablet = useIsTablet();
    // Same key the sidebar and navbar read (admin / teacher / custom role, for the CURRENT
    // institute), so `showSidebar` follows the role the user is actually signed in as.
    const roleDisplay = getDisplaySettingsFromCache(getActiveRoleDisplaySettingsKey());
    const { instituteDetails } = useInstituteDetailsStore();
    const hasFacultyPermission = hasFacultyAssignedPermission(instituteDetails?.id);
    const showMainSidebar = roleDisplay?.ui?.showSidebar !== false;

    // Whether the Assist Dock rail (right edge, mounted in __root) is visible
    // for this role — shares AssistDock's own resolution so the reserved right
    // gutter collapses exactly when the rail is hidden.
    const showAssistDock = useAssistDockVisible();

    // Track previous sidebar config to detect actual changes vs re-renders
    const prevConfigRef = useRef<string | null>(null);

    useEffect(() => {
        // Skip automatic sidebar control if customSidebarControl is enabled
        if (customSidebarControl) return;

        // On mobile, sidebar is handled via Sheet (drawer)
        if (isMobile) return;

        // Build a config key — the effect should only fire when this changes
        const configKey = `${isTablet}-${internalSideBar}-${hasInternalSidebarComponent}`;
        if (prevConfigRef.current === configKey) return; // No config change, don't override
        prevConfigRef.current = configKey;

        // On tablet, always collapse the sidebar (show rail only)
        if (isTablet) {
            setOpen(false);
            return;
        }

        // On desktop, expand if no internal sidebar, collapse if there is one
        const shouldExpand = !(internalSideBar || hasInternalSidebarComponent);
        setOpen(shouldExpand);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
        internalSideBar,
        hasInternalSidebarComponent,
        customSidebarControl,
        isMobile,
        isTablet,
    ]);

    return (
        <div className="flex min-h-screen w-full">
            {/* Main Sidebar — the <Sidebar> component handles its own spacer div */}
            {showMainSidebar && !isMobile && (
                <MySidebar sidebarComponent={sidebarComponent} />
            )}

            {/* Mobile Sidebar — rendered as Sheet/Drawer */}
            {showMainSidebar && isMobile && (
                <MySidebar sidebarComponent={sidebarComponent} />
            )}

            {/* Internal Sidebar */}
            {(hasInternalSidebarComponent || internalSideBar) && (
                <div
                    className={cn(
                        isMobile || isTablet
                            ? 'w-0 overflow-visible'
                            : 'sticky top-0 top-safe-native h-screen h-screen-safe-native flex-shrink-0',
                        isTablet && 'lg:hidden xl:block'
                    )}
                >
                    {hasInternalSidebarComponent && internalSidebarComponent ? (
                        <InternalSidebarComponent
                            sidebarComponent={internalSidebarComponent}
                            mobileButtonText={internalSidebarMobileText}
                        />
                    ) : (
                        internalSideBar && (
                            <InternalSideBar sideBarList={sideBarList} sideBarData={sideBarData} />
                        )
                    )}
                </div>
            )}

            {/* Main Content Area.
                md:pr-14 reserves the right gutter for the Assist Dock rail (a fixed
                w-14 column mounted globally in __root) on desktop, so page content/
                navbar never slide under it. On mobile the dock is hidden, so there's
                no gutter — content uses the full width. When the dock is hidden for
                this role via Display Settings, the gutter collapses too. */}
            <div
                className={cn(
                    'flex w-full min-w-0 flex-1 flex-col text-neutral-600',
                    showAssistDock && 'md:pr-14'
                )}
            >
                <Navbar showMobileBackButton={showMobileBackButton} />
                <StudentSidebarProvider>
                    <div
                        className={cn(
                            intrnalMargin
                                ? 'flex flex-1 flex-col p-2 sm:p-3 md:p-4 lg:m-7'
                                : 'm-0',
                            'overflow-x-hidden',
                            className
                        )}
                    >
                        {/* Plan (MANAGED only) + locked-for-role guard for deep links. */}
                        <RouteAccessGuard>{children}</RouteAccessGuard>
                    </div>
                </StudentSidebarProvider>
            </div>
        </div>
    );
};
