import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useRouterState } from '@tanstack/react-router';
import {
    BookOpen,
    CaretLeft,
    CaretRight,
    Compass,
    DeviceMobile,
    GraduationCap,
    PlayCircle,
    Question,
    RocketLaunch,
    Sparkle,
    X,
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
import { SupportPanel } from '@/components/common/support/SupportPanel';
import { useAssistDock } from './store';
import { tutorialsForRoute } from './tutorials';
import { TutorialViewer } from './TutorialViewer';
import { RoadmapViewer } from './RoadmapViewer';
import { ExploreViewer } from './ExploreViewer';
import { AdminAppViewer } from './AdminAppViewer';
import { TrainingViewer } from './TrainingViewer';

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
    // Subscribes the dock to language-change events: buildTutorials()/
    // tutorialsForRoute() resolve tutorial titles via the `t` passed in below,
    // but without this hook call here the component itself would never
    // re-render when the language changes (see tutorials.ts header comment).
    const { t: tTutorials } = useTranslation('tutorials');
    const { t } = useTranslation('assistDock');
    const pathname = useRouterState({ select: (s) => s.location.pathname });
    const search = useRouterState({ select: (s) => s.location.search }) as { selectedTab?: string };
    const panel = useAssistDock((s) => s.panel);
    const togglePanel = useAssistDock((s) => s.togglePanel);
    const setPanel = useAssistDock((s) => s.setPanel);
    const openTutorial = useAssistDock((s) => s.openTutorial);
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

    // Publish the resolved visibility so gutter-reserving components
    // (LayoutContainer, student side views) stay in lockstep with the rail.
    const setDockVisible = useAssistDock((s) => s.setDockVisible);
    useEffect(() => {
        if (isAuthed && !onPublicRoute) setDockVisible(showDock);
    }, [showDock, isAuthed, onPublicRoute, setDockVisible]);

    if (!isAuthed || onPublicRoute || !showDock) return null;

    const tutorials = tutorialsForRoute(tTutorials, pathname, search?.selectedTab);
    const hasNewRoadmap =
        !!roadmapMeta.data?.updatedAt && roadmapMeta.data.updatedAt !== roadmapSeenAt;
    const totalBadge = tutorials.length + (supportConfig.data?.openTicketCount ?? 0);

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
                        label={t('guides')}
                        active={panel === 'tutorials'}
                        onClick={() => togglePanel('tutorials')}
                        badge={tutorials.length || undefined}
                    >
                        <BookOpen size={20} weight={panel === 'tutorials' ? 'fill' : 'regular'} />
                    </RailButton>

                    <RailButton
                        label={t('training')}
                        active={panel === 'training'}
                        onClick={() => togglePanel('training')}
                    >
                        <PlayCircle size={20} weight={panel === 'training' ? 'fill' : 'duotone'} />
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

            {/* Tutorials panel (slides out left of the rail) */}
            {panel === 'tutorials' && (
                <div className="fixed bottom-4 right-16 top-20 z-40 flex w-72 flex-col overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-xl">
                    <div className="flex shrink-0 items-center justify-between border-b border-neutral-200 px-4 py-3">
                        <div className="flex items-center gap-2">
                            <GraduationCap size={18} className="text-primary-500" />
                            <p className="text-body font-semibold text-neutral-800">
                                {t('tutorials')}
                            </p>
                        </div>
                        <button
                            type="button"
                            aria-label={t('closeTutorials')}
                            onClick={() => setPanel('none')}
                            className="flex size-7 items-center justify-center rounded-md text-neutral-500 transition-colors hover:bg-neutral-100"
                        >
                            <X size={16} />
                        </button>
                    </div>

                    <div className="flex-1 overflow-y-auto p-2">
                        {tutorials.length === 0 ? (
                            <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
                                <BookOpen size={26} className="text-neutral-300" />
                                <p className="text-caption text-neutral-500">
                                    {t('noTutorialsForThisPage')}
                                </p>
                            </div>
                        ) : (
                            <ul className="flex flex-col gap-1">
                                {tutorials.map((t) => (
                                    <li key={t.id}>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                openTutorial(t.file, t.title);
                                                setPanel('none');
                                            }}
                                            className="group flex w-full items-center gap-2 rounded-md px-3 py-2 text-left transition-colors hover:bg-primary-50"
                                        >
                                            <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary-50 text-primary-500 group-hover:bg-primary-100">
                                                <BookOpen size={15} weight="duotone" />
                                            </span>
                                            <span className="flex-1 truncate text-caption text-neutral-700">
                                                {t.title}
                                            </span>
                                            <CaretRight
                                                size={14}
                                                className="shrink-0 text-neutral-300 group-hover:text-primary-400"
                                            />
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                </div>
            )}

            {/* Big walkthrough player */}
            <TutorialViewer />
        </>
    );
}

function RailButton({
    label,
    children,
    onClick,
    active,
    badge,
    dot,
}: {
    label: string;
    children: React.ReactNode;
    onClick: () => void;
    active?: boolean;
    badge?: number;
    /** A small unread indicator, for when there's something new but no count to show. */
    dot?: boolean;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            aria-label={label}
            className={cn(
                'relative flex w-full flex-col items-center gap-0.5 rounded-md px-1 py-2 transition-colors',
                active ? 'bg-primary-50 text-primary-600' : 'text-neutral-500 hover:bg-neutral-100'
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
        </button>
    );
}
