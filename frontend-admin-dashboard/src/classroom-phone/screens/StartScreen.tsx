/**
 * Start a class from the panel's "Start on your device" QR. The QR carries only a
 * schedule id and an institute id, so the provider comes from today's list.
 */
import { useEffect, useState } from 'react';
import type { TodayClass } from '@/classroom-shared/apiTypes';
import { SignedIn } from '../components/SignedIn';
import { StartClass } from '../components/StartClass';
import { ActionButton, FailureCard, Spinner, StateCard } from '../components/ui';
import { classroomToday, resolveInstitute } from '../lib/api';
import { errorKind, PhoneApiError } from '../lib/http';
import type { PhoneRoute } from '../lib/route';
import { applyTheme } from '../lib/theme';
import { useStrings } from '../strings';

type Route = Extract<PhoneRoute, { kind: 'start' }>;

/** The admin app's own list, where a class with an unknown provider can still be started. */
const LIVE_CLASSES_PATH = '/study-library/live-session';

type View =
    | { kind: 'loading' }
    | { kind: 'ready'; item: TodayClass | null }
    | { kind: 'forbidden' }
    | { kind: 'failed'; failure: 'network' | 'busy' | 'error' };

export function StartScreen({
    route,
    onSignOutRetry,
}: {
    route: Route;
    onSignOutRetry: () => void;
}) {
    const [instituteName, setInstituteName] = useState<string | null>(null);

    useEffect(() => {
        let live = true;
        void resolveInstitute(route.instituteId).then((branding) => {
            if (!live || !branding) return;
            setInstituteName(branding.instituteName ?? null);
            applyTheme(branding.instituteThemeCode);
        });
        return () => {
            live = false;
        };
    }, [route.instituteId]);

    return (
        <SignedIn instituteId={route.instituteId} instituteName={instituteName}>
            <StartFlow route={route} onSignOutRetry={onSignOutRetry} />
        </SignedIn>
    );
}

function StartFlow({ route, onSignOutRetry }: { route: Route; onSignOutRetry: () => void }) {
    const s = useStrings();
    const [view, setView] = useState<View>({ kind: 'loading' });
    const [attempt, setAttempt] = useState(0);

    useEffect(() => {
        let live = true;
        setView({ kind: 'loading' });
        classroomToday(route.instituteId, 'all')
            .then((response) => {
                if (!live) return;
                const item = response.classes.find((row) => row.schedule_id === route.scheduleId);
                setView({ kind: 'ready', item: item ?? null });
            })
            .catch((error: unknown) => {
                if (!live) return;
                const kind = errorKind(error);
                if (kind === 'sign-in') return;
                const refused = error instanceof PhoneApiError && error.status === 403;
                if (refused) setView({ kind: 'forbidden' });
                else if (kind === 'network' || kind === 'busy')
                    setView({ kind: 'failed', failure: kind });
                else setView({ kind: 'failed', failure: 'error' });
            });
        return () => {
            live = false;
        };
    }, [route.instituteId, route.scheduleId, attempt]);

    switch (view.kind) {
        case 'loading':
            return <Spinner />;
        case 'forbidden':
            return (
                <StateCard tone="danger" testId="start-forbidden" title={s.notStaffGeneric}>
                    <ActionButton onClick={onSignOutRetry}>{s.signOutTryAnother}</ActionButton>
                </StateCard>
            );
        case 'failed':
            return <FailureCard kind={view.failure} onRetry={() => setAttempt((n) => n + 1)} />;
        case 'ready':
            if (!view.item) {
                return (
                    <StateCard
                        tone="info"
                        testId="start-unknown"
                        title={s.startTitle}
                        body={s.startNotOnToday}
                    >
                        <ActionButton onClick={() => window.location.assign(LIVE_CLASSES_PATH)}>
                            {s.openLiveClasses}
                        </ActionButton>
                    </StateCard>
                );
            }
            return (
                <section
                    className="flex flex-col gap-4 rounded-lg border bg-card p-4"
                    data-state="start"
                >
                    <header className="flex flex-col gap-1">
                        <h1 className="text-h3 text-foreground">
                            {view.item.title ?? s.startTitle}
                        </h1>
                        <p className="text-body text-muted-foreground">
                            {[view.item.time_label, view.item.subject].filter(Boolean).join(' · ')}
                        </p>
                    </header>
                    <StartClass item={view.item} instituteId={route.instituteId} />
                </section>
            );
    }
}
