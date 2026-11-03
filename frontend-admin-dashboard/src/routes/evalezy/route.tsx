import { createFileRoute, Outlet } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Prohibit } from '@phosphor-icons/react';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import { useInstituteQuery } from '@/services/student-list-section/getInstituteDetails';
import { EvalezyHeader } from './-components/EvalezyHeader';
import { useEvalezySettings } from './-hooks/useEvalezySettings';

export const Route = createFileRoute('/evalezy')({
    component: EvalezyLayout,
});

/**
 * Evalezy shell: a bare page (no portal sidebar or navbar) with the Evalezy top
 * bar. Everything under /evalezy renders here, after the institute's
 * "Evalezy app" switch has been checked.
 */
function EvalezyLayout() {
    const { t } = useTranslation('evalezy');
    const { data: institute } = useQuery(useInstituteQuery());
    const { settings, isLoading } = useEvalezySettings();

    return (
        // The native body already pads the safe-area insets, so the shell only fills
        // what is left. min-w-0: this sits in the portal's flex wrapper, and without it
        // long nowrap titles widen the page and the WebView zooms the whole app out.
        <div className="min-h-screen-safe flex w-full min-w-0 flex-col bg-neutral-50">
            <EvalezyHeader instituteName={institute?.institute_name} />
            <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col p-4 sm:py-6">
                {isLoading ? (
                    <DashboardLoader />
                ) : settings.enabled ? (
                    <Outlet />
                ) : (
                    <div className="mt-10 flex flex-col items-center gap-3 rounded-lg border border-neutral-200 bg-white p-6 text-center">
                        <Prohibit size={32} className="text-neutral-400" />
                        <h1 className="text-h3 font-semibold text-neutral-800">{t('off.title')}</h1>
                        <p className="max-w-md text-body text-neutral-500">{t('off.body')}</p>
                    </div>
                )}
            </main>
        </div>
    );
}
