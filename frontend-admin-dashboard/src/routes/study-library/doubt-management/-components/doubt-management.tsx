import { useEffect } from 'react';
import { getRouteApi } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Filters } from './filters/filters';
import { useNavHeadingStore } from '@/stores/layout-container/useNavHeadingStore';
import { DoubtInbox } from './inbox/doubt-inbox';
import { DoubtBoard } from './board/doubt-board';
import { DoubtViewToggle } from './doubt-view-toggle';
import { useDoubtFilters } from '../-stores/filter-store';
import { useDoubtView } from '../-stores/view-store';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';

const routeApi = getRouteApi('/study-library/doubt-management/');

export const DoubtManagement = () => {
    const { t } = useTranslation('studyLibraryDoubtManagement');
    const { setNavHeading } = useNavHeadingStore();
    const { updateFilters } = useDoubtFilters();
    const { view, setView } = useDoubtView();
    // Deep link from doubt-notification emails/alerts: open this specific doubt in the inbox.
    const { doubtId } = routeApi.useSearch();

    // Keyed on `t`: in dev the namespace lands a tick after mount, and a one-shot effect would
    // leave the raw "pageTitle" key in the header.
    useEffect(() => {
        setNavHeading(t('pageTitle'));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [t]);

    useEffect(() => {
        // Scope the inbox to the current institute so batchless general queries are visible and the
        // backend doesn't have to enumerate every batch.
        const instituteId = getCurrentInstituteId();
        if (instituteId) updateFilters({ institute_id: instituteId });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // A deep link targets the conversation, so land on the inbox even if the board is the saved
    // preference. One-shot: the user can still switch to the board afterwards.
    useEffect(() => {
        if (doubtId) setView('inbox');
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [doubtId]);

    return (
        <div className="flex flex-col gap-4">
            <Filters actions={<DoubtViewToggle value={view} onChange={setView} />} />
            {view === 'board' ? <DoubtBoard /> : <DoubtInbox initialDoubtId={doubtId} />}
        </div>
    );
};
