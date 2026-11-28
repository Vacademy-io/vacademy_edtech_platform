import { createFileRoute } from '@tanstack/react-router';
import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { Helmet } from 'react-helmet';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavHeadingStore } from '@/stores/layout-container/useNavHeadingStore';
import { CaretLeft } from '@phosphor-icons/react';
import { Loader2 } from 'lucide-react';
import ScheduleStep1 from '../-components/scheduleStep1';
import { useNavigate } from '@tanstack/react-router';
import { useLiveSessionStore } from '../-store/sessionIdstore';
import { useLiveSessionSettings } from '@/hooks/useLiveSessionSettings';
export const Route = createFileRoute('/study-library/live-session/schedule/step1/')({
    component: RouteComponent,
});

function RouteComponent() {
    const { t } = useTranslation('studyLibraryLiveSessionScheduleStep1');
    const { setNavHeading } = useNavHeadingStore();
    const { clearSessionId, clearStep1Data, isEdit } = useLiveSessionStore();
    const navigate = useNavigate();
    const { settings, isLoading } = useLiveSessionSettings();

    const heading = (
        <div className="flex items-center gap-4">
            <CaretLeft
                onClick={() => navigate({ to: '/study-library/live-session' })}
                className="cursor-pointer"
            />
            <div>{t('heading')}</div>
        </div>
    );

    useEffect(() => {
        setNavHeading(heading);
        // Only clear data if not in edit mode
        if (!isEdit) {
            clearSessionId();
            clearStep1Data();
        }
    }, [isEdit, setNavHeading, clearSessionId, clearStep1Data]);

    // Route-level guard for new (non-edit) sessions: if single-class
    // scheduling is disabled (institute or role), redirect to bulk if
    // available, otherwise back to the list. Edit mode always renders so
    // existing sessions can be modified regardless of the toggle.
    useEffect(() => {
        if (isLoading || isEdit) return;
        if (settings.singleScheduleEnabled) return;
        navigate({
            to: settings.bulkScheduleEnabled
                ? '/study-library/live-session/schedule/bulk'
                : '/study-library/live-session',
        });
    }, [
        isLoading,
        isEdit,
        settings.singleScheduleEnabled,
        settings.bulkScheduleEnabled,
        navigate,
    ]);

    if (isLoading || (!isEdit && !settings.singleScheduleEnabled)) {
        return (
            <LayoutContainer>
                <div className="flex h-64 items-center justify-center">
                    <Loader2 className="size-8 animate-spin text-neutral-400" />
                </div>
            </LayoutContainer>
        );
    }

    return (
        <LayoutContainer>
            <Helmet>
                <title>{t('pageTitle')}</title>
                <meta name="description" content={t('pageDescription')} />
            </Helmet>
            <ScheduleStep1 />
        </LayoutContainer>
    );
}
