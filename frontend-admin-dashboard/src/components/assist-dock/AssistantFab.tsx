import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useRouterState } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Sparkle, X } from '@phosphor-icons/react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { getTokenDecodedData, getTokenFromCookie, isTokenExpired } from '@/lib/auth/sessionUtility';
import { TokenKey } from '@/constants/auth/tokens';
import { getInstituteId } from '@/constants/helper';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { ASSISTANT_CAPABILITIES } from '@/constants/urls';
import type { AssistantCapabilities } from '@/components/vacademy-assistant/types';
import { useInstituteChatbotName } from '@/components/vacademy-assistant/useInstituteChatbotName';
import { AssistantTip } from '@/components/vacademy-assistant/AssistantTip';
import { useAssistantWelcome } from '@/components/vacademy-assistant/useAssistantWelcome';
import { useAssistDock } from './store';
import { useAssistDockVisible } from './visibility';

// Keep in sync with routes/__root.tsx publicRoutes: the button only appears
// inside the signed-in shell.
const PUBLIC_PREFIXES = [
    '/login',
    '/signup',
    '/demo',
    '/landing',
    '/pricing',
    '/content',
    '/vim/onboarding',
    '/vim/login',
    '/vim/waitlist',
    '/mcp/authorize',
];

/** Same cache key and freshness as the dashboard launch bar and the chat panel. */
const CAPABILITIES_QUERY_KEY = ['assistant-capabilities'];
const CAPABILITIES_STALE_MS = 5 * 60 * 1000;

/** Last known on/off answer per institute and user, so a reload does not ask again. */
const AVAILABILITY_KEY = 'assistantFabAvailability';
const HINT_SEEN_KEY = 'assistantFabHintSeen';

interface AvailabilitySnapshot {
    scope: string;
    at: number;
    available: boolean;
}

function availabilityScope(token: string): string | null {
    const userId = getTokenDecodedData(token)?.user;
    const instituteId = getInstituteId();
    return userId && instituteId ? `${instituteId}:${userId}` : null;
}

/** The stored answer for this scope, or null when missing, unreadable or stale. */
function readFreshAvailability(scope: string | null): AvailabilitySnapshot | null {
    if (!scope) return null;
    try {
        const raw = localStorage.getItem(AVAILABILITY_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as Partial<AvailabilitySnapshot> | null;
        if (
            parsed?.scope !== scope ||
            typeof parsed.at !== 'number' ||
            typeof parsed.available !== 'boolean'
        ) {
            return null;
        }
        if (Date.now() - parsed.at >= CAPABILITIES_STALE_MS) return null;
        return parsed as AvailabilitySnapshot;
    } catch {
        return null;
    }
}

function writeAvailability(snapshot: AvailabilitySnapshot) {
    try {
        localStorage.setItem(AVAILABILITY_KEY, JSON.stringify(snapshot));
    } catch {
        // storage disabled: the next page load simply asks again
    }
}

function readHintSeen(): boolean {
    try {
        return localStorage.getItem(HINT_SEEN_KEY) === '1';
    } catch {
        return false;
    }
}

/**
 * Floating button, bottom right of every signed-in admin page, that opens the
 * assistant panel in one click.
 *
 * It follows the assistant's own on/off rules: signed in, not a public route,
 * the Assist Dock enabled for this role (Display Settings), and at least one
 * assistant capability for this user (the same check the dashboard launch bar
 * makes). It steps aside while any dock panel or walkthrough is open, and
 * while an element marked data-assistant-fab="avoid" (or "avoid-phone", below
 * md) is on the page; see index.css.
 *
 * On md+ it sits in the Assist Dock's reserved right gutter, below the rail's
 * buttons, so it never covers page content. Below md (no rail) it sits in the
 * corner, and LayoutContainer adds bottom padding so content scrolls clear of it.
 */
export function AssistantFab() {
    const { t } = useTranslation('assistDock');
    // The same name the assistant panel's header shows (from the loaded institute details).
    const chatbotName = useInstituteChatbotName();
    const pathname = useRouterState({ select: (s) => s.location.pathname });
    const panel = useAssistDock((s) => s.panel);
    const tutorialOpen = useAssistDock((s) => s.activeTutorial !== null);
    const setPanel = useAssistDock((s) => s.setPanel);
    const setAssistantFabEnabled = useAssistDock((s) => s.setAssistantFabEnabled);
    const dockVisible = useAssistDockVisible();
    const [hintSeen, setHintSeen] = useState(readHintSeen);

    const token = getTokenFromCookie(TokenKey.accessToken);
    const isAuthed = !!token && !isTokenExpired(token);
    const onPublicRoute = PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));
    const eligible = isAuthed && !onPublicRoute && dockVisible;

    const scope = eligible && token ? availabilityScope(token) : null;
    const stored = useMemo(() => readFreshAvailability(scope), [scope]);

    // Shares the launch bar's and panel's query, so it is fetched once and only
    // when no fresh answer is stored. A disabled observer still receives data
    // whenever the launch bar or the panel refetches.
    const { data: capabilities, dataUpdatedAt } = useQuery<AssistantCapabilities>({
        queryKey: CAPABILITIES_QUERY_KEY,
        queryFn: async () => (await authenticatedAxiosInstance.get(ASSISTANT_CAPABILITIES)).data,
        enabled: eligible && !stored,
        staleTime: CAPABILITIES_STALE_MS,
        refetchOnWindowFocus: false,
    });

    const available = capabilities
        ? (capabilities.groups?.length ?? 0) > 0
        : stored?.available ?? false;

    useEffect(() => {
        if (!scope || !capabilities || !dataUpdatedAt) return;
        writeAvailability({
            scope,
            at: dataUpdatedAt,
            available: (capabilities.groups?.length ?? 0) > 0,
        });
    }, [scope, capabilities, dataUpdatedAt]);

    const enabled = eligible && available;
    useEffect(() => {
        setAssistantFabEnabled(enabled);
    }, [enabled, setAssistantFabEnabled]);

    // Opens the panel once for a new admin (see useAssistantWelcome).
    useAssistantWelcome(enabled, scope);
    const tipShown = useAssistDock((s) => s.tipTopic !== null);

    if (!enabled || panel !== 'none' || tutorialOpen) return null;

    const dismissHint = () => {
        setHintSeen(true);
        try {
            localStorage.setItem(HINT_SEEN_KEY, '1');
        } catch {
            // storage disabled: the hint may show again next session
        }
    };

    const openAssistant = () => {
        dismissHint();
        setPanel('assistant');
    };

    return (
        <div className="assistant-fab pointer-events-none fixed bottom-0 end-0 z-40">
            <div className="relative me-4 flex items-center md:me-2">
                <AssistantTip />
                {!hintSeen && !tipShown && (
                    <div className="pointer-events-auto absolute end-full top-1/2 me-3 hidden -translate-y-1/2 items-center gap-1 whitespace-nowrap rounded-lg border border-neutral-200 bg-white py-1 pe-1 ps-3 shadow-lg md:flex">
                        <button
                            type="button"
                            onClick={openAssistant}
                            className="text-caption font-medium text-neutral-700 transition-colors hover:text-primary-500"
                        >
                            {t('assistantFab.hint')}
                        </button>
                        <button
                            type="button"
                            aria-label={t('assistantFab.dismissHint')}
                            onClick={dismissHint}
                            className="flex size-6 items-center justify-center rounded-md text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-600"
                        >
                            <X size={12} />
                        </button>
                    </div>
                )}
                <TooltipProvider delayDuration={300}>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <button
                                type="button"
                                aria-label={t('assistantFab.label', { chatbotName })}
                                onClick={openAssistant}
                                className="pointer-events-auto flex size-12 items-center justify-center rounded-full bg-primary-500 text-white shadow-lg transition-colors hover:bg-primary-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300 focus-visible:ring-offset-2 md:size-10"
                            >
                                <Sparkle size={22} weight="fill" />
                            </button>
                        </TooltipTrigger>
                        <TooltipContent side="left">
                            {t('assistantFab.tooltip', { chatbotName })}
                        </TooltipContent>
                    </Tooltip>
                </TooltipProvider>
            </div>
        </div>
    );
}
