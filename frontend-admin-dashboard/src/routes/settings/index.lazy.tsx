import { createLazyFileRoute, useNavigate } from '@tanstack/react-router';
import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { useNavHeadingStore } from '@/stores/layout-container/useNavHeadingStore';
import { useEffect, useState } from 'react';
import { SettingsTabs } from './-constants/terms';
import { getAvailableSettingsTabs } from './-utils/utils';
import {
    filterSettingsTabs,
    isSettingsTabEntitled,
    resolveSettingsTab,
} from './-utils/settings-entitlements';
import { useEntitlement } from '@/lib/capabilities/use-entitlement';
import { Route as SettingsRoute } from '.';

export const Route = createLazyFileRoute('/settings/')({
    component: () => (
        <LayoutContainer>
            <RouteComponent />
        </LayoutContainer>
    ),
});

const SafeRouteSearch = () => {
    try {
        return SettingsRoute.useSearch() as { selectedTab?: string };
    } catch (error) {
        // Return a default object if the hook fails
        return { selectedTab: SettingsTabs.RoleDisplay };
    }
};

function RouteComponent() {
    const searchParams = SafeRouteSearch();
    const [selectedTab, setSelectedTab] = useState<string>(SettingsTabs.RoleDisplay);
    const { setNavHeading } = useNavHeadingStore();
    const entitlement = useEntitlement();
    const navigate = useNavigate();

    useEffect(() => {
        setNavHeading('Settings');
    }, [setNavHeading]);

    // Sync selectedTab with URL search params when they change
    useEffect(() => {
        if (searchParams.selectedTab) {
            setSelectedTab(searchParams.selectedTab);
        }
    }, [searchParams.selectedTab]);

    // Find the active tab component. Falls back to Display Settings (not
    // availableTabs[0]) when selectedTab is the 'tab' sentinel used by the
    // bare Settings rail icon — a deliberate default, not array order. MANAGED:
    // screens outside the plan are not offered, and a deep link to one falls
    // back the same way.
    const availableTabs = filterSettingsTabs(getAvailableSettingsTabs(), entitlement);
    const activeTabConfig = resolveSettingsTab(selectedTab, availableTabs);
    const outsidePlan =
        !!searchParams.selectedTab && !isSettingsTabEntitled(searchParams.selectedTab, entitlement);
    const fallbackTab = activeTabConfig?.tab;

    // Point the URL at the screen actually shown, so the settings nav highlights it.
    useEffect(() => {
        if (outsidePlan && fallbackTab) {
            navigate({ to: '/settings', search: { selectedTab: fallbackTab }, replace: true });
        }
    }, [outsidePlan, fallbackTab, navigate]);

    const ActiveComponent = activeTabConfig?.component;

    return <div>{ActiveComponent && <ActiveComponent isTab={true} />}</div>;
}
