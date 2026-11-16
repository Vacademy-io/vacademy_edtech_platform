import { useEffect } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import { PLANS_SETTINGS_PATH } from '@/services/ai-plans/storefront';

/**
 * Telleo's plan page, the address product mails link to (invoice and credit-note mails build
 * "<host>/<product>/plan"). Telleo has no screen of its own for plans: it is Settings → AI plan.
 */
export const Route = createFileRoute('/telleo/plan')({
    component: TelleoPlanRedirect,
});

function TelleoPlanRedirect() {
    useEffect(() => {
        // A full navigation, like every other link to the plans (see PLANS_SETTINGS_PATH).
        window.location.replace(PLANS_SETTINGS_PATH);
    }, []);
    return <DashboardLoader />;
}
