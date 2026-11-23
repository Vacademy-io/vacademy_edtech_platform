import { useEffect } from 'react';
import { useRouterState } from '@tanstack/react-router';
import { useAssistDock } from '@/components/assist-dock/store';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { isUserAdmin } from '@/utils/userDetails';
import { useRecentChats } from './AssistantHistoryList';
import { markWelcomeSeen, welcomeSeen } from './page-ask';

/** Wait for the dashboard to draw before the panel slides in. */
export const WELCOME_DELAY_MS = 1500;

function wideEnough(): boolean {
    try {
        return window.matchMedia?.('(min-width: 640px)').matches ?? false;
    } catch {
        return false;
    }
}

/**
 * Opens the assistant once, as a welcome, for an admin of an institute that is
 * still being set up: on the dashboard, no batches yet, no assistant chats yet,
 * never welcomed on this browser, and a screen wide enough that the panel does
 * not cover the page. `scope` is institute:user; `enabled` is the floating
 * button's own on/off answer.
 */
export function useAssistantWelcome(enabled: boolean, scope: string | null) {
    const pathname = useRouterState({ select: (s) => s.location.pathname });
    const panel = useAssistDock((s) => s.panel);
    const openWelcome = useAssistDock((s) => s.openWelcome);
    const instituteDetails = useInstituteDetailsStore((s) => s.instituteDetails);
    const batches = instituteDetails?.batches_for_sessions;

    const candidate =
        enabled &&
        !!scope &&
        panel === 'none' &&
        pathname.replace(/\/+$/, '') === '/dashboard' &&
        Array.isArray(batches) &&
        batches.length === 0 &&
        isUserAdmin() &&
        !welcomeSeen(scope) &&
        wideEnough();

    const recent = useRecentChats(candidate);
    const ready = candidate && recent.isSuccess;
    const hasChats = (recent.data?.length ?? 0) > 0;

    useEffect(() => {
        if (!ready || !scope) return undefined;
        if (hasChats) {
            markWelcomeSeen(scope);
            return undefined;
        }
        const timer = window.setTimeout(() => {
            markWelcomeSeen(scope);
            openWelcome();
        }, WELCOME_DELAY_MS);
        return () => window.clearTimeout(timer);
    }, [ready, hasChats, scope, openWelcome]);
}
