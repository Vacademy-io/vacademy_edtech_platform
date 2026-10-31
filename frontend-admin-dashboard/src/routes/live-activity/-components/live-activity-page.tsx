import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Helmet } from 'react-helmet';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { Broadcast, Pause, Play, WarningCircle } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useNavHeadingStore } from '@/stores/layout-container/useNavHeadingStore';
import { getInstituteId } from '@/constants/helper';
import {
    markLiveActivitySeen,
    useLiveActivityAnalytics,
    useLiveActivityBackfill,
    useLiveActivityCounts,
    type LiveActivityCategory,
} from '../-services/live-activity-service';
import { useLiveActivityStream } from '../-hooks/useLiveActivityStream';
import { collapseEvents } from './collapse-events';
import { ActivityRow } from './ActivityRow';
import { KpiTiles } from './KpiTiles';
import {
    ActivityTimeline,
    CallOutcomes,
    CounsellorActivity,
    EnrolmentFunnel,
    LeadSources,
} from './DashboardCharts';

const ALL_TAB = 'ALL';

const ALL_CATEGORIES: LiveActivityCategory[] = [
    'INVITE_FORM',
    'LEAD_FORM',
    'CALL',
    'PAYMENT',
    'COUNSELLOR',
];

const CATEGORY_LABELS: Record<LiveActivityCategory, string> = {
    INVITE_FORM: 'Enrolments',
    LEAD_FORM: 'Leads',
    CALL: 'Calls',
    PAYMENT: 'Payments',
    COUNSELLOR: 'Counsellors',
};

const START_OF_TODAY = () => {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    return now.getTime();
};

export function LiveActivityPage() {
    const { setNavHeading } = useNavHeadingStore();
    const search = useSearch({ from: '/live-activity/' });
    const navigate = useNavigate({ from: '/live-activity/' });
    const instituteId = getInstituteId() ?? '';

    const [paused, setPaused] = useState(false);
    const activeTab = search.category ?? ALL_TAB;
    const since = useMemo(START_OF_TODAY, []);

    const { events, bufferedCount, status, allowedCategories, releaseBuffer, seed } =
        useLiveActivityStream({ instituteId, paused });

    const backfill = useLiveActivityBackfill(instituteId, { size: 100 });
    const counts = useLiveActivityCounts(instituteId, since);
    const analytics = useLiveActivityAnalytics(instituteId, since, since + 24 * 60 * 60 * 1000);

    // Refresh the numbers when the stream delivers something, rather than on a timer. The
    // dashboard is a view of the same events the feed is already receiving, so polling it
    // would re-ask a question we have just been told the answer to.
    const queryClient = useQueryClient();
    const eventCount = events.length;
    useEffect(() => {
        if (eventCount === 0) return;
        const t = setTimeout(() => {
            void queryClient.invalidateQueries({ queryKey: ['live-activity', 'analytics'] });
            void queryClient.invalidateQueries({ queryKey: ['live-activity', 'counts'] });
        }, 3000);
        // Debounced: a burst of events should cost one refresh, not one per event.
        return () => clearTimeout(t);
    }, [eventCount, queryClient]);

    useEffect(() => {
        setNavHeading(<h1 className="text-subtitle font-medium">Live Activity</h1>);
    }, [setNavHeading]);

    // Seed once from the backfill, then let the stream take over. Ordering matters: the
    // hook dedupes by eventId, so an event arriving during the handoff is not shown twice.
    useEffect(() => {
        if (backfill.data?.content) {
            seed(backfill.data.content);
        }
    }, [backfill.data, seed]);

    // Opening the page clears the sidebar badge.
    useEffect(() => {
        if (instituteId) {
            void markLiveActivitySeen(instituteId).catch(() => {
                // A failed mark-seen only means the badge lingers -- not worth surfacing.
            });
        }
    }, [instituteId]);

    // Render every category tab regardless of what the token reported.
    //
    // These were previously driven by allowedCategories, which only arrives after the
    // stream token is minted -- so a slow or failed mint left the page with no tabs at
    // all, which reads as broken rather than degraded. Access is enforced server-side
    // anyway: the token carries the permitted set and the bus filters each frame against
    // it, so a tab the caller may not see simply stays empty. allowedCategories is still
    // consulted below, purely to hide a tab that genuinely returns nothing for this role.
    const visibleCategories: LiveActivityCategory[] =
        allowedCategories.length > 0 ? allowedCategories : ALL_CATEGORIES;

    const filtered = useMemo(() => {
        if (activeTab === ALL_TAB) return events;
        return events.filter((event) => event.category === activeTab);
    }, [events, activeTab]);

    const collapsed = useMemo(() => collapseEvents(filtered), [filtered]);

    const setTab = (tab: string) => {
        navigate({
            search: (prev) => ({
                ...prev,
                category: tab === ALL_TAB ? undefined : tab,
            }),
            replace: true,
        });
    };

    return (
        <>
            <Helmet>
                <title>Live Activity</title>
                <meta
                    name="description"
                    content="See enrolments, leads, calls and payments as they happen."
                />
            </Helmet>

            <header className="mb-5 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-3">
                    <span className="mt-0.5 inline-flex size-10 items-center justify-center rounded-lg bg-primary-50 text-primary-500">
                        <Broadcast className="size-5" weight="fill" />
                    </span>
                    <div>
                        <h1 className="text-h3 font-semibold tracking-tight text-neutral-700">
                            Live Activity
                        </h1>
                        <p className="mt-0.5 text-body text-neutral-600">
                            Enrolments, leads, calls and payments as they happen.
                        </p>
                    </div>
                </div>
                <StreamStatusBadge status={status} />
            </header>

            <div className="flex flex-wrap items-center justify-between gap-3">
                <Tabs value={activeTab} onValueChange={setTab}>
                    <TabsList>
                        <TabsTrigger value={ALL_TAB}>All</TabsTrigger>
                        {visibleCategories.map((category) => (
                            <TabsTrigger key={category} value={category} className="gap-1.5">
                                {CATEGORY_LABELS[category]}
                                {counts.data?.[category] != null && (
                                    <span className="text-caption text-neutral-500">
                                        {counts.data[category]}
                                    </span>
                                )}
                            </TabsTrigger>
                        ))}
                    </TabsList>
                </Tabs>

                <MyButton
                    buttonType="secondary"
                    scale="small"
                    onClick={() => {
                        if (paused) releaseBuffer();
                        setPaused(!paused);
                    }}
                >
                    {paused ? <Play className="size-4" /> : <Pause className="size-4" />}
                    {paused ? 'Resume' : 'Pause'}
                </MyButton>
            </div>

            {/*
             * Release pill. A live list that reorders under the cursor is unusable, so new
             * events buffer while paused rather than pushing the row being read off-screen.
             */}
            {paused && bufferedCount > 0 && (
                <button
                    type="button"
                    onClick={() => {
                        releaseBuffer();
                        setPaused(false);
                    }}
                    className="mt-3 w-full rounded-lg bg-primary-50 px-3 py-2 text-body text-primary-600 hover:bg-primary-100"
                >
                    {bufferedCount} new {bufferedCount === 1 ? 'event' : 'events'} — show
                </button>
            )}

            {/*
             * The dashboard answers "how are we doing"; the stream below answers "who needs
             * me now". Only on All -- a category tab is a filtered stream, and repeating
             * institute-wide totals above it would be answering a question nobody asked.
             */}
            {activeTab === ALL_TAB && (
                <div className="mt-4 space-y-4">
                    {analytics.isLoading && <DashboardSkeleton />}

                    {/*
                     * An explicit failure state, not a silent one. The first version
                     * rendered this block only when data was present, so any error left the
                     * page looking exactly like a feed with no dashboard -- indistinguishable
                     * from "not deployed yet" and impossible to diagnose from the UI.
                     */}
                    {analytics.isError && (
                        <DashboardError
                            message={errorMessage(analytics.error)}
                            onRetry={() => void analytics.refetch()}
                        />
                    )}

                    {analytics.data && (
                        <>
                            <KpiTiles data={analytics.data} />
                            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                                <EnrolmentFunnel data={analytics.data} />
                                <ActivityTimeline data={analytics.data} />
                                <LeadSources data={analytics.data} />
                                <CounsellorActivity data={analytics.data} />
                                <CallOutcomes data={analytics.data} />
                            </div>
                        </>
                    )}
                </div>
            )}

            {activeTab === ALL_TAB && (
                <h2 className="mt-6 text-body font-medium text-neutral-700">Recent activity</h2>
            )}

            <div
                className="mt-4 flex flex-col gap-2"
                // Pausing on hover keeps the row under the pointer still while it is read.
                onMouseEnter={() => setPaused(true)}
                onMouseLeave={() => {
                    releaseBuffer();
                    setPaused(false);
                }}
            >
                {collapsed.length === 0 ? (
                    <EmptyState loading={backfill.isLoading} />
                ) : (
                    collapsed.map((group) => <ActivityRow key={group.key} group={group} />)
                )}
            </div>
        </>
    );
}

function StreamStatusBadge({ status }: { status: string }) {
    const label =
        status === 'live'
            ? 'Live'
            : status === 'reconnecting'
              ? 'Reconnecting…'
              : status === 'error'
                ? 'Disconnected'
                : 'Connecting…';
    const tone =
        status === 'live'
            ? 'bg-success-50 text-success-600'
            : status === 'error'
              ? 'bg-danger-50 text-danger-600'
              : 'bg-neutral-100 text-neutral-600';

    return (
        <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-caption ${tone}`}
        >
            <span className="size-1.5 rounded-full bg-current" />
            {label}
        </span>
    );
}

function EmptyState({ loading }: { loading: boolean }) {
    return (
        <div className="rounded-lg border border-dashed border-neutral-200 px-4 py-10 text-center">
            <p className="text-body text-neutral-600">
                {loading ? 'Loading recent activity…' : 'Nothing yet.'}
            </p>
            {!loading && (
                // Say this plainly. An empty feed genuinely does not mean nothing is
                // happening -- calls placed from a personal phone, messages sent outside
                // the platform and in-person conversations are all invisible here.
                <p className="mt-1 text-caption text-neutral-500">
                    Activity outside the platform (personal-phone calls, direct WhatsApp) will not
                    appear here.
                </p>
            )}
        </div>
    );
}

function DashboardSkeleton() {
    return (
        <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
                {[0, 1, 2, 3, 4].map((i) => (
                    <div
                        key={i}
                        className="h-20 animate-pulse rounded-lg border border-neutral-200 bg-neutral-50"
                    />
                ))}
            </div>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                {[0, 1].map((i) => (
                    <div
                        key={i}
                        className="h-56 animate-pulse rounded-lg border border-neutral-200 bg-neutral-50"
                    />
                ))}
            </div>
        </div>
    );
}

function DashboardError({ message, onRetry }: { message: string; onRetry: () => void }) {
    return (
        <div className="rounded-lg border border-danger-200 bg-danger-50 px-4 py-3">
            <div className="flex items-start gap-2">
                <WarningCircle className="mt-0.5 size-4 shrink-0 text-danger-600" weight="fill" />
                <div className="min-w-0 flex-1">
                    <p className="text-body font-medium text-danger-700">
                        Could not load the dashboard
                    </p>
                    {/* The actual reason, verbatim. A generic "something went wrong" here
                        would leave exactly the diagnostic gap this block exists to close. */}
                    <p className="mt-0.5 break-words text-caption text-danger-600">{message}</p>
                    <p className="mt-1 text-caption text-neutral-600">
                        The activity feed below is unaffected.
                    </p>
                </div>
                <MyButton buttonType="secondary" scale="small" onClick={onRetry}>
                    Retry
                </MyButton>
            </div>
        </div>
    );
}

/** Surface the status and server message rather than a generic string. */
function errorMessage(error: unknown): string {
    const e = error as
        | { response?: { status?: number; data?: { message?: string } }; message?: string }
        | undefined;
    const status = e?.response?.status;
    const body = e?.response?.data?.message;
    if (status && body) return `HTTP ${status} - ${body}`;
    if (status) return `HTTP ${status}`;
    return e?.message ?? 'Unknown error';
}
