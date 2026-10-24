import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import {
    ArrowClockwise,
    ArrowSquareOut,
    CheckCircle,
    CircleNotch,
    MinusCircle,
    PlugsConnected,
    WarningCircle,
    XCircle,
} from '@phosphor-icons/react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { MyButton } from '@/components/design-system/button';
import { cn } from '@/lib/utils';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { LMS_CONNECTION_HEALTH } from '@/constants/urls';

// ── API shape (snake_case from LmsConnectionHealthDTO) ────────────────────────

type ConnectionStatus = 'HEALTHY' | 'UNHEALTHY' | 'NOT_APPLICABLE';

interface ConnectionHealth {
    id: string | null;
    name: string;
    type: string;
    status: ConnectionStatus;
    message: string | null;
    detail: string | null;
    /** Host only — never credentials. */
    target: string | null;
    latency_ms: number | null;
    is_default: boolean;
}

interface LmsConnectionHealthResponse {
    checked_at: string;
    config_source: string;
    total: number;
    healthy: number;
    unhealthy: number;
    not_applicable: number;
    connections: ConnectionHealth[];
}

async function fetchLmsConnectionHealth(
    instituteId: string,
    force = false
): Promise<LmsConnectionHealthResponse> {
    const response = await authenticatedAxiosInstance.get(LMS_CONNECTION_HEALTH, {
        // force=true skips the backend's 1-minute cache. Only the manual refresh sets it —
        // the 60s poll must stay cacheable, or every open dashboard would probe the
        // customer's LMS independently every minute.
        params: force ? { instituteId, force: true } : { instituteId },
    });
    return response.data;
}

// ── Presentation ──────────────────────────────────────────────────────────────

const statusIcon = (status: ConnectionStatus) => {
    switch (status) {
        case 'HEALTHY':
            return <CheckCircle weight="fill" className="size-4 shrink-0 text-success-500" />;
        case 'UNHEALTHY':
            return <XCircle weight="fill" className="size-4 shrink-0 text-danger-500" />;
        default:
            return <MinusCircle weight="fill" className="size-4 shrink-0 text-neutral-400" />;
    }
};

/**
 * "checked 1 min ago". `now` is passed in rather than read from Date.now() inside so the label
 * re-renders on a ticking clock — otherwise it would only change when the query refetched, and
 * a poll that is paused (backgrounded tab) or failing would keep claiming the data is fresh.
 */
const relativeTime = (iso: string, now: number): string => {
    try {
        const diffMs = now - new Date(iso).getTime();
        if (diffMs < 0) return 'just now';
        const secs = Math.floor(diffMs / 1000);
        if (secs < 30) return 'just now';
        const mins = Math.floor(secs / 60);
        if (mins < 1) return 'less than a min ago';
        if (mins === 1) return '1 min ago';
        if (mins < 60) return `${mins} mins ago`;
        const hours = Math.floor(mins / 60);
        return hours === 1 ? '1 hour ago' : `${hours} hours ago`;
    } catch {
        return '';
    }
};

function ConnectionRow({ connection }: { connection: ConnectionHealth }) {
    const isDown = connection.status === 'UNHEALTHY';
    return (
        <li
            className={cn(
                'flex items-start gap-2 rounded-md px-2 py-1.5',
                isDown && 'bg-danger-50'
            )}
        >
            {statusIcon(connection.status)}
            <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                    <span className="truncate text-caption font-semibold text-neutral-700">
                        {connection.name}
                    </span>
                    {connection.is_default && (
                        <span className="shrink-0 rounded bg-primary-50 px-1.5 py-0.5 text-2xs font-medium text-primary-700">
                            default
                        </span>
                    )}
                </div>
                {connection.target && (
                    <span className="block truncate text-2xs text-neutral-400">
                        {connection.target}
                    </span>
                )}
                {/* The message is written for admins by the backend's connection test —
                    show it verbatim, it already says what to do about a failure. */}
                {connection.message && (
                    <span
                        className={cn(
                            'mt-0.5 block text-2xs',
                            isDown ? 'text-danger-600' : 'text-neutral-500'
                        )}
                    >
                        {connection.message}
                    </span>
                )}
            </div>
            {connection.latency_ms != null && !isDown && (
                <span className="shrink-0 text-2xs tabular-nums text-neutral-400">
                    {connection.latency_ms}ms
                </span>
            )}
        </li>
    );
}

interface LmsConnectionHealthWidgetProps {
    instituteId: string;
}

const POLL_INTERVAL_MS = 60_000;

/**
 * Dashboard widget: are the institute's LMS connections actually reachable right now?
 *
 * The check runs server-side against the SAVED credentials (see
 * `/admin-core-service/lms/v1/connection-health`) — the browser never sees a key or token, and
 * the LMS hosts aren't CORS-open to this origin anyway.
 *
 * Renders nothing when the institute has no external LMS connected: an institute on the built-in
 * Vacademy LMS has no integration to be unhealthy, and an empty card would be noise on every
 * dashboard. Same self-hiding convention the sub-org widgets use.
 *
 * Renders first on the dashboard and full-bleed: a broken LMS connection silently breaks
 * enrolment for every course wired to it. It nonetheless ships hidden for every role — only an
 * institute that has actually connected an LMS wants it, and turning it on starts polling that
 * customer's site every minute.
 */
export const LmsConnectionHealthWidget = ({ instituteId }: LmsConnectionHealthWidgetProps) => {
    const router = useRouter();

    const queryClient = useQueryClient();
    const QUERY_KEY = ['LMS_CONNECTION_HEALTH', instituteId];
    const [isRefreshing, setIsRefreshing] = useState(false);

    // Ticking clock behind the "checked N ago" label. Without it the label would only change
    // when the query refetched, so a paused poll (backgrounded tab) or a failing one would go on
    // claiming the data was fresh. 15s is fine for a minute-granularity label.
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const id = setInterval(() => setNow(Date.now()), 15_000);
        return () => clearInterval(id);
    }, []);

    const { data, isLoading, isFetching, error, refetch } = useQuery({
        queryKey: QUERY_KEY,
        queryFn: () => fetchLmsConnectionHealth(instituteId),
        enabled: !!instituteId,
        // Poll every minute. Each poll is served by the backend's 1-minute per-institute cache,
        // so N open dashboards still cost the customer's LMS one probe per minute, not N.
        refetchInterval: POLL_INTERVAL_MS,
        // Left at the default (false): polling pauses while the tab is backgrounded. Nobody is
        // reading the widget then, and the ticking label above keeps the age honest on return.
        refetchIntervalInBackground: false,
        staleTime: POLL_INTERVAL_MS,
        refetchOnWindowFocus: false,
        retry: 1,
    });

    /**
     * Manual refresh: fetch with force=true (skipping the backend's 1-minute cache) and write the
     * result straight into the query cache.
     *
     * Not `refetch()` with a flag threaded through the queryFn — the force flag must NOT reach the
     * query key, or a forced fetch would populate a separate cache entry and the polled one would
     * keep showing the stale failure it was meant to replace.
     */
    const refreshNow = async () => {
        setIsRefreshing(true);
        try {
            const fresh = await fetchLmsConnectionHealth(instituteId, true);
            queryClient.setQueryData(QUERY_KEY, fresh);
        } catch {
            // Let the normal query surface the failure through its own error state.
            await refetch();
        } finally {
            setIsRefreshing(false);
        }
    };

    if (isLoading) {
        return (
            <Card className="w-full shadow-none">
                <CardHeader className="p-4">
                    <CardTitle className="flex items-center gap-2 text-body font-semibold text-neutral-700">
                        <CircleNotch className="size-4 animate-spin text-neutral-400" />
                        Checking LMS connections…
                    </CardTitle>
                </CardHeader>
            </Card>
        );
    }

    // A failed health *request* is not the same as an unhealthy LMS — don't imply the customer's
    // LMS is down because our own endpoint errored. Offer a retry and say what actually happened.
    if (error) {
        return (
            <Card className="w-full border-neutral-200 shadow-none">
                <CardHeader className="p-4">
                    <CardTitle className="flex items-center gap-2 text-body font-semibold text-neutral-700">
                        <WarningCircle weight="duotone" className="size-4 text-warning-500" />
                        LMS connection health
                    </CardTitle>
                    <CardDescription className="mt-1 text-caption text-neutral-600">
                        Couldn&apos;t run the connection check just now. This doesn&apos;t mean your
                        LMS is down.
                    </CardDescription>
                    <div className="mt-3">
                        <MyButton buttonType="secondary" scale="small" onClick={refreshNow}>
                            <span className="flex items-center gap-1.5">
                                <ArrowClockwise className="size-3.5" weight="bold" />
                                Try again
                            </span>
                        </MyButton>
                    </div>
                </CardHeader>
            </Card>
        );
    }

    // Self-hide when there is no health to report: either nothing is connected, or the only
    // connections are ones with no automated probe (the built-in Vacademy LMS, a custom LMS).
    // A card that can only say "we can't tell" is noise on every dashboard load.
    const tested = (data?.healthy ?? 0) + (data?.unhealthy ?? 0);
    if (!data || tested === 0) return null;

    const allHealthy = data.unhealthy === 0;

    return (
        <Card
            className={cn(
                'w-full shadow-none transition-all',
                allHealthy ? 'border-neutral-200' : 'border-danger-200 bg-danger-50/40'
            )}
        >
            <CardHeader className="p-4 pb-2">
                <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                        <CardTitle
                            className={cn(
                                'flex items-center gap-2 text-body font-semibold',
                                allHealthy ? 'text-neutral-700' : 'text-danger-800'
                            )}
                        >
                            <PlugsConnected
                                size={18}
                                weight={allHealthy ? 'duotone' : 'fill'}
                                className={allHealthy ? 'text-neutral-500' : 'text-danger-600'}
                            />
                            LMS connection health
                        </CardTitle>
                        <CardDescription
                            className={cn(
                                'mt-1 text-caption',
                                allHealthy ? 'text-neutral-600' : 'text-danger-700'
                            )}
                        >
                            {/* Count only the connections actually probed. Saying "all N
                                reachable" when some of the N have no automated test would
                                be claiming a check that never ran. */}
                            {allHealthy
                                ? `All ${tested} connection${tested === 1 ? '' : 's'} reachable`
                                : `${data.unhealthy} of ${tested} connection${
                                      tested === 1 ? '' : 's'
                                  } not reachable`}
                            {data.not_applicable > 0 && (
                                <span className="text-neutral-400">
                                    {' '}
                                    · {data.not_applicable} not checkable
                                </span>
                            )}
                            {data.checked_at && (
                                <span className="text-neutral-400">
                                    {' '}
                                    · checked {relativeTime(data.checked_at, now)}
                                </span>
                            )}
                        </CardDescription>
                    </div>
                    <button
                        type="button"
                        onClick={refreshNow}
                        disabled={isFetching || isRefreshing}
                        aria-label="Re-check LMS connections"
                        className="shrink-0 rounded-md p-1.5 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-600 disabled:cursor-not-allowed"
                    >
                        <ArrowClockwise
                            className={cn('size-4', (isFetching || isRefreshing) && 'animate-spin')}
                            weight="bold"
                        />
                    </button>
                </div>
            </CardHeader>

            <CardContent className="px-4 pb-4 pt-0">
                <ul className="flex flex-col gap-0.5">
                    {data.connections.map((connection, idx) => (
                        <ConnectionRow
                            key={connection.id ?? `${connection.type}:${idx}`}
                            connection={connection}
                        />
                    ))}
                </ul>

                {!allHealthy && (
                    <button
                        type="button"
                        // Deep-link straight to the LMS tab (SettingsTabs.Lms), not the
                        // settings root — the point of the link is the connection that broke.
                        onClick={() =>
                            router.navigate({ to: '/settings', search: { selectedTab: 'lms' } })
                        }
                        className="mt-2 flex items-center gap-1 text-2xs font-semibold text-danger-700 hover:underline"
                    >
                        Fix in LMS settings
                        <ArrowSquareOut className="size-3" />
                    </button>
                )}
            </CardContent>
        </Card>
    );
};

export default LmsConnectionHealthWidget;
