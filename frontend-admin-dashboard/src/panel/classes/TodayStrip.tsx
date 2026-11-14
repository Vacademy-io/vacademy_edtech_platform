/**
 * Today's classes, above the Home tiles, on a signed-in panel. Every state: skeleton,
 * Mine, the automatic fallback to All, empty, error with the last list kept, offline
 * with the stored list. The first class takes focus so OK on a remote starts it.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { CalendarBlank, CalendarX, WifiHigh, WifiSlash } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import type { TodayScope } from '@/classroom-shared/apiTypes';
import { isPanelDateWrong } from '../device/activity';
import { getWebViewMajor } from '../device/deviceInfo';
import { isBackendReachable, subscribeReachability } from '../device/publicApi';
import { useSyncSnapshot } from '../device/syncLoop';
import { isNativePanel, openDeviceSettings, type PanelSettingsTarget } from '../lib/native';
import { classCapability } from './capability';
import { providerOfClass } from './startClass';
import { TodayCard } from './TodayCard';
import { fetchToday, isNetworkFailure } from './todayApi';
import { createTodayFlow, type TodayChoice, type TodayFlow, type TodayView } from './todayFlow';
import { TodaySkeleton } from './TodaySkeleton';
import { classStatus } from './todayStatus';
import { ARROW_ROW_ATTRIBUTE } from './useArrowFocus';
import { useClassStarter } from './useClassStarter';

/** Labels move on their own between refreshes. */
const STATUS_TICK_MS = 30 * 1000;

/** Which list a teacher last asked for, while the panel stays on. Not kept for the next teacher. */
let rememberedChoice: { userId: string; choice: TodayChoice } | null = null;

const LOADING_VIEW: TodayView = {
    phase: 'loading',
    scope: 'mine',
    choice: 'auto',
    classes: [],
    fellBack: false,
    truncated: false,
    problem: null,
    asOf: null,
    serverOffsetMs: 0,
};

export interface TodayStripProps {
    userId: string;
    instituteId: string;
}

export default function TodayStrip({ userId, instituteId }: TodayStripProps) {
    const { t } = useTranslation('classes');
    const sync = useSyncSnapshot();
    const [view, setView] = useState<TodayView>(LOADING_VIEW);
    const [, setTick] = useState(0);
    const firstCardRef = useRef<HTMLButtonElement | null>(null);
    const focusedList = useRef('');

    const flow: TodayFlow = useMemo(
        () =>
            createTodayFlow({
                userId,
                instituteId,
                initialChoice:
                    rememberedChoice?.userId === userId ? rememberedChoice.choice : 'auto',
                fetchToday: (scope) => fetchToday(instituteId, scope),
                isOffline: (error) => isNetworkFailure(error) || !isBackendReachable(),
                onView: setView,
            }),
        [userId, instituteId]
    );

    useEffect(() => {
        flow.start();
        const onVisibility = () => {
            if (document.visibilityState === 'visible') flow.noteReturned();
        };
        document.addEventListener('visibilitychange', onVisibility);
        const offReachable = subscribeReachability(() => {
            if (isBackendReachable()) flow.noteOnline();
        });
        const ticker = window.setInterval(() => setTick((n) => n + 1), STATUS_TICK_MS);
        return () => {
            flow.stop();
            document.removeEventListener('visibilitychange', onVisibility);
            offReachable();
            window.clearInterval(ticker);
        };
    }, [flow]);

    const { busyId, start, dialogs } = useClassStarter(() => flow.refresh());

    const serverNow = Date.now() + view.serverOffsetMs;
    const major = getWebViewMajor();
    const cards = view.classes.map((item) => {
        const provider = providerOfClass(item);
        return {
            item,
            provider,
            status: classStatus(item, serverNow),
            capability: classCapability(provider, major, sync.flags.bbb_in_app_min_webview),
        };
    });
    const focusIndex = (() => {
        const live = cards.findIndex((c) => c.capability !== 'none' && c.status.kind !== 'done');
        return live >= 0 ? live : cards.findIndex((c) => c.capability !== 'none');
    })();

    // A new list can replace the card that had focus, so this runs per list, not once. It
    // never takes focus from anything else, and a refresh with the same classes does nothing.
    const listKey = view.phase === 'list' ? view.classes.map((c) => c.schedule_id).join() : '';
    useEffect(() => {
        if (!listKey || listKey === focusedList.current || !firstCardRef.current) return;
        focusedList.current = listKey;
        const active = document.activeElement;
        if (!active || active === document.body) firstCardRef.current.focus();
    }, [listKey]);

    const choose = (scope: TodayScope) => {
        rememberedChoice = { userId, choice: scope };
        flow.choose(scope);
    };

    const openSettings = async (target: PanelSettingsTarget) => {
        const ok = await openDeviceSettings(target);
        if (!ok) toast.error(t('today.settingsUnavailable'));
    };

    const dateWrong = view.problem !== null && isPanelDateWrong();
    const problemText =
        view.problem === null
            ? null
            : dateWrong
              ? t('today.wrongDate')
              : view.phase === 'failed'
                ? t(view.problem === 'offline' ? 'today.offlineNoList' : 'today.errorNoList')
                : t(view.problem === 'offline' ? 'today.offline' : 'today.error');

    return (
        <section aria-label={t('today.label')} className="space-y-3">
            <div className="flex items-center justify-between">
                <div className="min-w-0">
                    <h2 className="truncate text-h2 font-semibold text-neutral-800">
                        {view.scope === 'all' ? t('today.headingAll') : t('today.headingMine')}
                    </h2>
                    {view.fellBack && (
                        <p className="truncate text-subtitle text-neutral-500">
                            {t('today.noneOfYours')}
                        </p>
                    )}
                </div>
                <div className="flex shrink-0 items-center space-x-2 pl-4">
                    {(['mine', 'all'] as const).map((scope) => (
                        <MyButton
                            key={scope}
                            buttonType={view.scope === scope ? 'primary' : 'secondary'}
                            scale="large"
                            className="h-16 px-6 sm:min-w-0"
                            aria-pressed={view.scope === scope}
                            onClick={() => choose(scope)}
                        >
                            {scope === 'mine' ? t('today.scopeMine') : t('today.scopeAll')}
                        </MyButton>
                    ))}
                </div>
            </div>

            {problemText && (
                <div
                    role="status"
                    className="flex flex-wrap items-center justify-between rounded-lg border border-border bg-neutral-50 px-4 py-2"
                >
                    <span className="flex min-w-0 items-center space-x-3 text-title text-neutral-700">
                        {view.problem === 'offline' ? (
                            <WifiSlash size={28} className="shrink-0" aria-hidden />
                        ) : (
                            <CalendarX size={28} className="shrink-0" aria-hidden />
                        )}
                        <span>{problemText}</span>
                        {view.asOf && (
                            <span className="font-semibold">
                                {t('today.asOf', { time: view.asOf })}
                            </span>
                        )}
                    </span>
                    <span className="flex shrink-0 items-center space-x-2">
                        {isNativePanel() && (dateWrong || view.problem === 'offline') && (
                            <MyButton
                                buttonType="secondary"
                                scale="large"
                                className="h-16 px-6 sm:min-w-0"
                                onClick={() => void openSettings(dateWrong ? 'date' : 'wifi')}
                            >
                                <span className="flex items-center space-x-2">
                                    {dateWrong ? (
                                        <CalendarX size={24} aria-hidden />
                                    ) : (
                                        <WifiHigh size={24} aria-hidden />
                                    )}
                                    <span>
                                        {dateWrong ? t('today.dateSettings') : t('today.wifi')}
                                    </span>
                                </span>
                            </MyButton>
                        )}
                        <MyButton
                            buttonType="primary"
                            scale="large"
                            className="h-16 px-6 sm:min-w-0"
                            onClick={() => flow.refresh()}
                        >
                            {t('today.retry')}
                        </MyButton>
                    </span>
                </div>
            )}

            {view.phase === 'loading' && <TodaySkeleton />}

            {view.phase === 'empty' && (
                <div className="flex items-center justify-between rounded-lg border border-border bg-card p-4">
                    <span className="flex min-w-0 items-center space-x-3 text-title text-neutral-600">
                        <CalendarBlank size={32} className="shrink-0" aria-hidden />
                        <span>
                            {view.choice === 'mine' ? t('today.emptyMine') : t('today.emptyAll')}
                        </span>
                    </span>
                    {view.choice === 'mine' && (
                        <MyButton
                            buttonType="secondary"
                            scale="large"
                            className="h-16 shrink-0 px-6 sm:min-w-0"
                            onClick={() => choose('all')}
                        >
                            {t('today.showAll')}
                        </MyButton>
                    )}
                </div>
            )}

            {view.phase === 'list' && (
                <div
                    {...{ [ARROW_ROW_ATTRIBUTE]: '' }}
                    className="flex space-x-4 overflow-x-auto p-1"
                >
                    {cards.map(({ item, provider, status, capability }, index) => (
                        <TodayCard
                            key={item.schedule_id}
                            ref={index === focusIndex ? firstCardRef : undefined}
                            item={item}
                            provider={provider}
                            status={status}
                            capability={capability}
                            busy={busyId === item.schedule_id}
                            onStart={() => start(item)}
                        />
                    ))}
                </div>
            )}

            {view.phase === 'list' && view.truncated && (
                <p className="text-subtitle text-neutral-500">
                    {t('today.truncated', { count: view.classes.length })}
                </p>
            )}

            {dialogs}
        </section>
    );
}
