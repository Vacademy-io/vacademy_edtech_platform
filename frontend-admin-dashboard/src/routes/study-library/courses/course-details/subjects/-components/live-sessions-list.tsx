import { useMemo } from 'react';
import { format } from 'date-fns';
import { useTranslation } from 'react-i18next';
import { useNavigate } from '@tanstack/react-router';
import { Plus, VideoCamera } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import { getTokenDecodedData, getTokenFromCookie } from '@/lib/auth/sessionUtility';
import { TokenKey } from '@/constants/auth/tokens';
import { useLiveSessionSettings } from '@/hooks/useLiveSessionSettings';
import { useSessionSearch } from '@/routes/study-library/live-session/-hooks/useLiveSessions';
import type { SessionSearchRequest } from '@/routes/study-library/live-session/-services/utils';
import CompactSessionCard from './compact-session-card';

const getInstituteId = (): string => {
    try {
        const tokenData = getTokenDecodedData(getTokenFromCookie(TokenKey.accessToken));
        return (tokenData && Object.keys(tokenData.authorities)[0]) || '';
    } catch {
        return '';
    }
};

const LiveSessions = ({ packageSessionId }: { packageSessionId: string }) => {
    const { t } = useTranslation('studyLibraryLiveSessionsList');
    const navigate = useNavigate();
    const instituteId = useMemo(getInstituteId, []);
    const { settings } = useLiveSessionSettings();

    const liveTerm = getTerminology(ContentTerms.LiveSession, SystemTerms.LiveSession);
    const canSchedule = settings.singleScheduleEnabled || settings.bulkScheduleEnabled;

    const baseRequest = {
        institute_id: instituteId,
        batch_ids: [packageSessionId],
        statuses: ['LIVE'],
        size: 100,
        sort_direction: 'ASC' as const,
    };

    // LIVE: intentionally omit start_date/end_date. With statuses=['LIVE'] and no
    // date range, the backend applies its timezone-aware "currently in progress"
    // filter. Sending an explicit range pushes it into a plain date filter that
    // returns every session scheduled today. (See sessions-list-page.tsx.)
    const liveQuery = useSessionSearch({
        ...baseRequest,
        sort_by: 'startTime',
        time_status: 'LIVE',
    } as SessionSearchRequest);

    // UPCOMING: the backend applies a restrictive default window unless an explicit
    // range is provided. Mirror the native list page — from today out to the far
    // future — otherwise this section comes back empty.
    const { todayFormatted, farFutureFormatted } = useMemo(() => {
        const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const nowLocal = new Date(new Date().toLocaleString('en-US', { timeZone: userTimezone }));
        const farFuture = new Date(nowLocal);
        farFuture.setFullYear(farFuture.getFullYear() + 50);
        return {
            todayFormatted: format(nowLocal, 'yyyy-MM-dd'),
            farFutureFormatted: format(farFuture, 'yyyy-MM-dd'),
        };
    }, []);

    const upcomingQuery = useSessionSearch({
        ...baseRequest,
        sort_by: 'meetingDate',
        time_status: 'UPCOMING',
        start_date: todayFormatted,
        end_date: farFutureFormatted,
    } as SessionSearchRequest);

    const liveSessions = liveQuery.data?.sessions ?? [];
    const upcomingSessions = upcomingQuery.data?.sessions ?? [];

    const isLoading = liveQuery.isLoading || upcomingQuery.isLoading;
    const isError = liveQuery.isError || upcomingQuery.isError;
    const isEmpty = liveSessions.length === 0 && upcomingSessions.length === 0;

    const handleCreate = () => {
        // Deep-link into the schedule flow with this batch preselected and a
        // return URL back to the exact course-details page (the last-selected
        // tab is restored from localStorage), so creation lands the admin right
        // back here.
        const returnUrl = window.location.pathname + window.location.search;
        navigate({
            to: '/study-library/live-session/schedule',
            search: { batchId: packageSessionId, returnUrl },
        });
    };

    return (
        <div className="p-6 py-2">
            <div className="mb-4 flex flex-col items-start justify-between gap-2 md:flex-row md:items-center">
                <div className="flex-1">
                    <h2 className="text-base font-semibold text-gray-800">
                        {t('manage', { term: liveTerm })}
                    </h2>
                    <p className="mt-0.5 text-xs text-gray-500">
                        {t('description', { term: liveTerm.toLocaleLowerCase() })}
                    </p>
                </div>
                {canSchedule && (
                    <MyButton
                        type="button"
                        scale="medium"
                        buttonType="primary"
                        onClick={handleCreate}
                        className="flex items-center gap-1"
                    >
                        <Plus size={18} />
                        {t('create', { term: liveTerm })}
                    </MyButton>
                )}
            </div>

            {isLoading ? (
                <div className="flex items-center justify-center py-10">
                    <DashboardLoader />
                </div>
            ) : isError ? (
                <div className="rounded-md bg-white p-6 text-center text-sm text-danger-500 shadow-sm">
                    {t('failedToLoad', { term: liveTerm.toLocaleLowerCase() })}
                </div>
            ) : isEmpty ? (
                <div className="flex flex-col items-center gap-3 rounded-md bg-white p-10 text-center shadow-sm">
                    <VideoCamera size={40} className="text-neutral-300" />
                    <div className="text-sm text-neutral-500">
                        {t('emptyState', { term: liveTerm.toLocaleLowerCase() })}
                    </div>
                    {canSchedule && (
                        <MyButton
                            type="button"
                            scale="medium"
                            buttonType="secondary"
                            onClick={handleCreate}
                            className="flex items-center gap-1"
                        >
                            <Plus size={18} />
                            {t('create', { term: liveTerm })}
                        </MyButton>
                    )}
                </div>
            ) : (
                <div className="flex flex-col gap-6">
                    {liveSessions.length > 0 && (
                        <section className="flex flex-col gap-2">
                            <div className="flex items-center gap-2">
                                <span className="inline-block size-2 animate-pulse rounded-full bg-danger-500" />
                                <h3 className="text-sm font-semibold text-gray-800">
                                    {t('liveNow')}
                                </h3>
                            </div>
                            {liveSessions.map((session) => (
                                <CompactSessionCard key={session.session_id} session={session} />
                            ))}
                        </section>
                    )}
                    {upcomingSessions.length > 0 && (
                        <section className="flex flex-col gap-2">
                            <h3 className="text-sm font-semibold text-gray-800">
                                {t('upcoming')}
                            </h3>
                            {upcomingSessions.map((session) => (
                                <CompactSessionCard key={session.session_id} session={session} />
                            ))}
                        </section>
                    )}
                </div>
            )}
        </div>
    );
};

export default LiveSessions;
