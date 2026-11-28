/**
 * Start buttons for the Today strip: one start at a time, and the dialog it leads to.
 * Everything ends with the component, so an answer that arrives after the teacher left
 * this screen or signed out does nothing.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { BASE_URL } from '@/constants/urls';
import { createHostActions, type HostHttpGet } from '@/classroom-shared/hostActions';
import type { TodayClass } from '@/classroom-shared/apiTypes';
import { PanelConfirmDialog } from '../components/PanelConfirmDialog';
import { isMeetingOpen, setMeetingOpen, setOpenedClassEnd } from '../device/activity';
import { getWebViewMajor, loadPanelDeviceInfo } from '../device/deviceInfo';
import { getPanelFlags, syncNow } from '../device/syncLoop';
import { panelApi } from '../lib/api';
import { getPanelDevice, openExternal, openMeeting } from '../lib/native';
import {
    DeviceStartDialog,
    RecreateBlockedDialog,
    StartFailedDialog,
    type DeviceDialogState,
} from './StartDialogs';
import {
    startClass,
    startNewRoom,
    type DeviceReason,
    type StartDeps,
    type StartOutcome,
} from './startClass';

const START_TIMEOUT_MS = 30000;
/**
 * Android TV ships a stub "browser" that takes the link and shows nothing, and native
 * cannot tell, so "opened" can be untrue. A second press this soon means it did not work.
 */
const EXTERNAL_RETRY_WINDOW_MS = 60 * 1000;

const panelHttp: HostHttpGet = (path, params) =>
    panelApi
        .get(`${BASE_URL}${path}`, { params, timeout: START_TIMEOUT_MS })
        .then((response) => ({ status: response.status, data: response.data }));

type OpenDialog =
    | { kind: 'device'; state: DeviceDialogState }
    | { kind: 'ended'; item: TodayClass }
    | { kind: 'blocked'; message: string | null }
    | { kind: 'failed'; item: TodayClass; noLink: boolean };

export interface ClassStarter {
    busyId: string | null;
    start: (item: TodayClass) => void;
    dialogs: ReactNode;
}

export function useClassStarter(onMeetingClosed: () => void): ClassStarter {
    const { t } = useTranslation('classes');
    const [busyId, setBusyId] = useState<string | null>(null);
    const [dialog, setDialog] = useState<OpenDialog | null>(null);
    const inFlight = useRef(false);
    const lastExternal = useRef<{ scheduleId: string; atMs: number } | null>(null);
    /** Where focus was when the teacher pressed Start, for a remote after a dialog closes. */
    const returnFocus = useRef<HTMLElement | null>(null);
    const mounted = useRef(true);
    const onClosedRef = useRef(onMeetingClosed);
    onClosedRef.current = onMeetingClosed;

    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
        };
    }, []);

    // Radix hands focus to a dialog's trigger when it closes, and these have none.
    const hadDialog = useRef(false);
    useEffect(() => {
        if (dialog) {
            hadDialog.current = true;
            return;
        }
        if (!hadDialog.current) return;
        hadDialog.current = false;
        const timer = window.setTimeout(() => {
            const active = document.activeElement;
            if (!active || active === document.body) returnFocus.current?.focus();
        }, 50);
        return () => window.clearTimeout(timer);
    }, [dialog]);

    const showDevice = (item: TodayClass, reason: DeviceReason) => {
        setDialog({ kind: 'device', state: { item, reason } });
    };

    const deps: StartDeps = useMemo(
        () => ({
            host: createHostActions(panelHttp),
            webViewMajor: () => loadPanelDeviceInfo().then(() => getWebViewMajor()),
            bbbInAppMinWebview: () => getPanelFlags().bbb_in_app_min_webview,
            hasMeetingScreen: () => getPanelDevice() !== null,
            isMeetingOpen,
            // The next sync tells the server, which then polls often enough that a sign-out
            // from the phone or a revoke closes the meeting screen within seconds.
            setMeetingOpen: (open: boolean) => {
                setMeetingOpen(open);
                syncNow();
            },
            setOpenedClassEnd,
            openMeeting,
            openExternal,
            isCancelled: () => !mounted.current,
            onMeetingSettled: (result, item) => {
                if (!mounted.current) return;
                if (result.opened) {
                    onClosedRef.current();
                } else if (result.reason === 'ALREADY_OPEN') {
                    toast.info(t('toast.alreadyOpen'));
                } else {
                    showDevice(item, 'no-meeting-screen');
                }
            },
        }),
        // showDevice only uses setDialog.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [t]
    );

    const apply = (item: TodayClass, outcome: StartOutcome) => {
        switch (outcome.kind) {
            case 'device':
                showDevice(item, outcome.reason);
                break;
            case 'meeting-ended':
                setDialog({ kind: 'ended', item });
                break;
            case 'recreate-blocked':
                setDialog({ kind: 'blocked', message: outcome.message });
                break;
            case 'failed':
                setDialog({ kind: 'failed', item, noLink: false });
                break;
            case 'no-url':
                setDialog({ kind: 'failed', item, noLink: true });
                break;
            case 'already-open':
                toast.info(t('toast.alreadyOpen'));
                break;
            case 'no-link':
                toast.error(t('toast.noLink'));
                break;
            case 'external':
                lastExternal.current = { scheduleId: item.schedule_id, atMs: performance.now() };
                toast.info(t(outcome.noHostLink ? 'toast.noHostLink' : 'toast.externalOpened'));
                break;
            case 'meeting':
            case 'cancelled':
                break;
        }
    };

    const start = (item: TodayClass) => {
        if (inFlight.current) return;
        const previous = lastExternal.current;
        lastExternal.current = null;
        if (
            previous?.scheduleId === item.schedule_id &&
            performance.now() - previous.atMs < EXTERNAL_RETRY_WINDOW_MS
        ) {
            if (document.activeElement instanceof HTMLElement) {
                returnFocus.current = document.activeElement;
            }
            setOpenedClassEnd(item.ends_at_ms);
            showDevice(item, 'no-browser');
            return;
        }
        inFlight.current = true;
        // A retry from inside a dialog keeps the card it started from.
        if (!dialog && document.activeElement instanceof HTMLElement) {
            returnFocus.current = document.activeElement;
        }
        setBusyId(item.schedule_id);
        setDialog(null);
        void startClass(item, deps)
            .then((outcome) => {
                if (mounted.current) apply(item, outcome);
            })
            .catch((error) => {
                console.error('[panel/classes] start failed', error);
                if (mounted.current) setDialog({ kind: 'failed', item, noLink: false });
            })
            .then(() => {
                inFlight.current = false;
                if (mounted.current) setBusyId(null);
            });
    };

    const close = () => setDialog(null);

    let dialogs: ReactNode = null;
    if (dialog?.kind === 'device') {
        dialogs = <DeviceStartDialog state={dialog.state} onClose={close} />;
    } else if (dialog?.kind === 'blocked') {
        dialogs = <RecreateBlockedDialog message={dialog.message} onClose={close} />;
    } else if (dialog?.kind === 'failed') {
        const { item, noLink } = dialog;
        dialogs = (
            <StartFailedDialog
                noLink={noLink}
                onClose={close}
                onRetry={() => start(item)}
                onUseDevice={() => {
                    setOpenedClassEnd(item.ends_at_ms);
                    showDevice(item, 'chosen');
                }}
            />
        );
    } else if (dialog?.kind === 'ended') {
        const { item } = dialog;
        dialogs = (
            <PanelConfirmDialog
                open
                onOpenChange={(open) => {
                    if (!open) setDialog((current) => (current === dialog ? null : current));
                }}
                title={t('ended.title')}
                description={t('ended.body')}
                confirmLabel={t('ended.confirm')}
                onConfirm={async () => {
                    let outcome: StartOutcome;
                    try {
                        outcome = await startNewRoom(item, deps);
                    } catch (error) {
                        console.error('[panel/classes] new room failed', error);
                        outcome = { kind: 'failed' };
                    }
                    if (!mounted.current) return;
                    setDialog(null);
                    apply(item, outcome);
                }}
            />
        );
    }

    return { busyId, start, dialogs };
}
