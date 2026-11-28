import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useRouterState } from '@tanstack/react-router';
import {
    CaretLeft,
    CaretRight,
    Compass,
    DeviceMobile,
    PlayCircle,
    Question,
    RocketLaunch,
    Sparkle,
    VideoCamera,
} from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { getTokenFromCookie, isTokenExpired } from '@/lib/auth/sessionUtility';
import { TokenKey } from '@/constants/auth/tokens';
import { getActiveRoleDisplaySettingsKey } from '@/lib/auth/instituteUtils';
import {
    DISPLAY_SETTINGS_UPDATED_EVENT,
    getDisplaySettingsFromCache,
    getDisplaySettingsWithFallback,
} from '@/services/display-settings';
import { ADMIN_DISPLAY_SETTINGS_KEY, type DisplaySettingsData } from '@/types/display-settings';
import { useSupportConfig } from '@/services/support';
import { useRoadmap, useRoadmapMeta } from '@/services/roadmap';
import { useWebinarClock, useWebinars, webinarPhase } from '@/services/webinars';
import { SupportPanel } from '@/components/common/support/SupportPanel';
import { useAssistDock } from './store';
import { RoadmapViewer } from './RoadmapViewer';
import { ExploreViewer } from './ExploreViewer';
import { AdminAppViewer } from './AdminAppViewer';
import { TrainingViewer } from './TrainingViewer';
import { LiveDot, WebinarsPanel } from './WebinarsPanel';

// Keep in sync with routes/__root.tsx publicRoutes — the dock only shows inside
// the authenticated shell.
const PUBLIC_PREFIXES = [
    '/login',
    '/signup',
    '/landing',
    '/pricing',
    '/content',
    '/vim/onboarding',
    '/vim/login',
    '/plan-week',
    '/vim/waitlist',
];

const ROADMAP_SEEN_KEY = 'roadmapLastSeenAt';

function readRoadmapSeenAt(): string | null {
    try {
        return localStorage.getItem(ROADMAP_SEEN_KEY);
    } catch {
        return null;
    }
}

export function AssistDock() {
    const { t } = useTranslation('assistDock');
    const pathname = useRouterState({ select: (s) => s.location.pathname });
    const panel = useAssistDock((s) => s.panel);
    const togglePanel = useAssistDock((s) => s.togglePanel);
    const setPanel = useAssistDock((s) => s.setPanel);
    const minimized = useAssistDock((s) => s.minimized);
    const setMinimized = useAssistDock((s) => s.setMinimized);
    // Non-admin roles get a 403 here (retry disabled on the hook); the badge is simply omitted then.
    const supportConfig = useSupportConfig();
    // The dock mounts on every admin page, so it may only fetch the timestamp here.
    // The ~1MB body is deferred until the panel is actually opened.
    const roadmapMeta = useRoadmapMeta();
    const roadmap = useRoadmap(panel === 'roadmap');
    const [roadmapSeenAt, setRoadmapSeenAt] = useState<string | null>(readRoadmapSeenAt);

    const token = getTokenFromCookie(TokenKey.accessToken);
    const isAuthed = !!token && !isTokenExpired(token);
    const onPublicRoute = PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));

    // Per-role visibility from Display Settings (ui.showAssistDock). Admin sees
    // the dock by default; teacher/custom roles are hidden unless an admin opts
    // that role in from Settings → Display Settings → UI Options. The cache is
    // usually warm (mySidebar fetches on mount); the async fetch covers cold
    // starts and roles whose left sidebar is hidden.
    const roleKey = isAuthed ? getActiveRoleDisplaySettingsKey() : null;
    const cachedDS = roleKey ? getDisplaySettingsFromCache(roleKey) : null;
    const [fetchedDS, setFetchedDS] = useState<DisplaySettingsData | null>(null);
    const needsSettingsFetch = isAuthed && !onPublicRoute && !cachedDS;
    useEffect(() => {
        if (!needsSettingsFetch || !roleKey) return;
        let cancelled = false;
        getDisplaySettingsWithFallback(roleKey).then((ds) => {
            if (!cancelled) setFetchedDS(ds);
        });
        return () => {
            cancelled = true;
        };
    }, [needsSettingsFetch, roleKey]);

    // Re-read the cache whenever any settings blob is (re)cached — e.g. the
    // admin flips the toggle on the settings page (saveDisplaySettings) or
    // another surface refreshes this role's settings.
    const [, setSettingsVersion] = useState(0);
    useEffect(() => {
        const bump = () => setSettingsVersion((v) => v + 1);
        window.addEventListener(DISPLAY_SETTINGS_UPDATED_EVENT, bump);
        return () => window.removeEventListener(DISPLAY_SETTINGS_UPDATED_EVENT, bump);
    }, []);

    const roleDS = cachedDS ?? fetchedDS;
    const showDock = roleDS?.ui?.showAssistDock ?? roleKey === ADMIN_DISPLAY_SETTINGS_KEY;

    // Fetched whenever the rail shows (not just when the panel opens): the rail lights up on
    // every page while a webinar is live.
    const webinars = useWebinars(isAuthed && !onPublicRoute && showDock);
    const webinarNow = useWebinarClock(webinars.data);
    const webinarLive = (webinars.data ?? []).some((w) => webinarPhase(w, webinarNow) === 'live');

    // Publish the resolved visibility so gutter-reserving components
    // (LayoutContainer, student side views) stay in lockstep with the rail.
    const setDockVisible = useAssistDock((s) => s.setDockVisible);
    useEffect(() => {
        if (isAuthed && !onPublicRoute) setDockVisible(showDock);
    }, [showDock, isAuthed, onPublicRoute, setDockVisible]);

    if (!isAuthed || onPublicRoute || !showDock) return null;

    const hasNewRoadmap =
        !!roadmapMeta.data?.updatedAt && roadmapMeta.data.updatedAt !== roadmapSeenAt;
    const totalBadge = supportConfig.data?.openTicketCount ?? 0;

    const openRoadmap = () => {
        togglePanel('roadmap');
        if (roadmapMeta.data?.updatedAt) {
            try {
                localStorage.setItem(ROADMAP_SEEN_KEY, roadmapMeta.data.updatedAt);
            } catch {
                // private mode / storage disabled — the "new" badge just won't persist
            }
            setRoadmapSeenAt(roadmapMeta.data.updatedAt);
        }
    };

    return (
        <>
            {minimized ? (
                /* Collapsed pull-tab. Same edge/vertical anchor as the full rail so it
                   doesn't jump around when toggled. */
                <button
                    type="button"
                    aria-label={t('expandGuidesAndSupport')}
                    onClick={() => setMinimized(false)}
                    className="fixed right-0 top-24 z-30 hidden items-center gap-1 rounded-l-lg border border-r-0 border-neutral-200 bg-white py-2 pl-2 pr-1.5 text-neutral-500 shadow-sm transition-colors hover:bg-neutral-100 md:flex"
                >
                    <CaretLeft size={14} />
                    {totalBadge > 0 ? (
                        <span className="flex size-4 items-center justify-center rounded-full bg-primary-500 text-caption font-semibold text-white">
                            {totalBadge}
                        </span>
                    ) : null}
                    {hasNewRoadmap ? (
                        <span className="absolute -right-1 -top-1 size-2.5 rounded-full bg-primary-500 ring-2 ring-white" />
                    ) : null}
                    {webinarLive ? <LiveDot className="absolute -left-1 -top-1" /> : null}
                </button>
            ) : (
                /* Thin fixed rail — a full-height column flush to the right edge. The
                    layout (LayoutContainer main content) reserves w-14 so content never
                    slides under it. pt-20 clears the top navbar. Hidden by default on
                    mobile (< md): a right rail wastes horizontal space on phones, and
                    the layout drops its right gutter to match. */
                <aside className="fixed inset-y-0 right-0 z-30 hidden w-14 flex-col items-center gap-1 border-l border-neutral-200 bg-white pb-4 pt-20 md:flex">
                    <button
                        type="button"
                        aria-label={t('minimize')}
                        onClick={() => setMinimized(true)}
                        className="mb-1 flex size-6 items-center justify-center rounded-md text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-600"
                    >
                        <CaretRight size={14} />
                    </button>

                    <RailButton
                        label={t('training')}
                        active={panel === 'training'}
                        onClick={() => togglePanel('training')}
                    >
                        <PlayCircle size={20} weight={panel === 'training' ? 'fill' : 'duotone'} />
                    </RailButton>

                    <RailButton
                        label={webinarLive ? t('webinarLive') : t('webinars')}
                        ariaLabel={webinarLive ? t('webinarLiveAria') : undefined}
                        active={panel === 'webinars'}
                        onClick={() => togglePanel('webinars')}
                        live={webinarLive}
                    >
                        <VideoCamera
                            size={20}
                            weight={panel === 'webinars' || webinarLive ? 'fill' : 'duotone'}
                        />
                    </RailButton>

                    <RailButton
                        label={t('assist')}
                        active={panel === 'assistant'}
                        onClick={() => togglePanel('assistant')}
                    >
                        <Sparkle size={20} weight={panel === 'assistant' ? 'fill' : 'regular'} />
                    </RailButton>

                    <RailButton
                        label={t('issues')}
                        active={panel === 'support'}
                        onClick={() => togglePanel('support')}
                        badge={supportConfig.data?.openTicketCount || undefined}
                    >
                        <Question size={20} weight={panel === 'support' ? 'fill' : 'regular'} />
                    </RailButton>

                    <div className="my-1 h-px w-8 bg-neutral-100" />

                    <RailButton
                        label={t('whatsNew')}
                        active={panel === 'roadmap'}
                        onClick={openRoadmap}
                        dot={hasNewRoadmap}
                    >
                        <RocketLaunch size={20} weight={panel === 'roadmap' ? 'fill' : 'duotone'} />
                    </RailButton>

                    <RailButton
                        label={t('explore')}
                        active={panel === 'explore'}
                        onClick={() => togglePanel('explore')}
                    >
                        <Compass size={20} weight={panel === 'explore' ? 'fill' : 'duotone'} />
                    </RailButton>

                    <RailButton
                        label={t('adminApp')}
                        active={panel === 'adminApp'}
                        onClick={() => togglePanel('adminApp')}
                    >
                        <DeviceMobile
                            size={20}
                            weight={panel === 'adminApp' ? 'fill' : 'duotone'}
                        />
                    </RailButton>
                </aside>
            )}

            <SupportPanel
                open={panel === 'support'}
                onOpenChange={(v) => setPanel(v ? 'support' : 'none')}
            />

            <RoadmapViewer
                open={panel === 'roadmap'}
                html={roadmap.data?.htmlContent ?? ''}
                loading={roadmap.isPending || roadmap.isFetching}
                onClose={() => setPanel('none')}
            />

            <ExploreViewer open={panel === 'explore'} onClose={() => setPanel('none')} />

            <AdminAppViewer open={panel === 'adminApp'} onClose={() => setPanel('none')} />

            <TrainingViewer open={panel === 'training'} onClose={() => setPanel('none')} />

            <WebinarsPanel
                open={panel === 'webinars'}
                onClose={() => setPanel('none')}
                webinars={webinars.data}
                // isFetching too: after an error, Retry shows the skeleton instead of a frozen error.
                loading={webinars.isPending || webinars.isFetching}
                error={webinars.isError}
                onRetry={() => webinars.refetch()}
                now={webinarNow}
            />
        </>
    );
}

function RailButton({
    label,
    ariaLabel,
    children,
    onClick,
    active,
    badge,
    dot,
    live,
}: {
    label: string;
    /** Longer screen-reader label when the visible one is a single word like "Live". */
    ariaLabel?: string;
    children: React.ReactNode;
    onClick: () => void;
    active?: boolean;
    badge?: number;
    /** A small unread indicator, for when there's something new but no count to show. */
    dot?: boolean;
    /** Something is happening right now (a webinar is live): red tint + pulsing dot. */
    live?: boolean;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            aria-label={ariaLabel ?? label}
            className={cn(
                'relative flex w-full flex-col items-center gap-0.5 rounded-md px-1 py-2 transition-colors',
                live
                    ? 'bg-danger-50 text-danger-600 hover:bg-danger-100'
                    : active
                      ? 'bg-primary-50 text-primary-600'
                      : 'text-neutral-500 hover:bg-neutral-100'
            )}
        >
            {children}
            <span className="text-caption font-medium leading-none">{label}</span>
            {badge ? (
                <span className="absolute right-1 top-1 flex size-4 items-center justify-center rounded-full bg-primary-500 text-caption font-semibold text-white">
                    {badge}
                </span>
            ) : null}
            {dot ? (
                <span className="absolute right-2 top-1.5 size-2 rounded-full bg-primary-500 ring-2 ring-white" />
            ) : null}
            {live ? <LiveDot className="absolute right-2 top-1.5" /> : null}
        </button>
    );
}
