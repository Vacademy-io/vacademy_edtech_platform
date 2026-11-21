/**
 * The pairing state machine behind PairScreen, with no React in it.
 *
 * The panel asks for a code and shows it; an admin claims it from a phone or the
 * console; the panel then asks for one Confirm tap, naming who claimed it. The code
 * lives 15 minutes and is replaced when it expires. It stays up for 60 minutes after
 * boot or input, then dims and stops polling.
 *
 * One poll at a time, and a late answer from an abandoned poll is dropped: a retried
 * poll at CLAIMED re-mints the device secret, so only the newest answer works.
 */
import type {
    PairConfirmResponse,
    PairPollResponse,
    PairStartResponse,
} from '@/classroom-shared/apiTypes';
import { FIRST_RETRY_MS, OFFLINE_RETRY_MS, PAIR_WINDOW_MS } from '../config';
import { getDeviceId } from '../lib/storage';
import { isPanelDateWrong } from './activity';
import { reportedDevice } from './deviceInfo';
import { hasCode, isOfflineFailure, isPublicError, postPublic } from './publicApi';
import {
    clearPairing,
    notifyPairingCancelled,
    readPairing,
    savePairedDevice,
    writePairing,
    type PanelClaim,
} from './store';

export type PairView =
    | { view: 'starting' }
    | { view: 'code'; code: string; matchCode: number; qrUrl: string }
    | { view: 'dimmed' }
    | { view: 'claimed'; claim: PanelClaim }
    | { view: 'offline' }
    | { view: 'wrongDate' }
    | { view: 'disabled' };

export interface PairingFlowOptions {
    onView: (view: PairView) => void;
    /** Confirm succeeded and the device is saved. */
    onPaired: () => void;
    /** Confirm or Cancel could not reach the server. */
    onConfirmFailed?: () => void;
}

export interface PairingFlow {
    start: () => void;
    stop: () => void;
    noteInput: () => void;
    retry: () => void;
    confirm: (accept: boolean) => Promise<void>;
}

const POLL_TIMEOUT_MS = 8000;
const DISABLED_RETRY_MS = 60 * 1000;
const FALLBACK_POLL_MS = 3000;

export function createPairingFlow(options: PairingFlowOptions): PairingFlow {
    let run = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let windowEndMono = 0;
    let dimmed = false;
    let networkFailures = 0;
    let codeShown = false;
    let pollEveryMs = FALLBACK_POLL_MS;
    let claim: PanelClaim | null = null;
    let shownCode: Extract<PairView, { view: 'code' }> | null = null;
    let offlineShown = false;

    const mono = () => performance.now();

    function clearTimer(): void {
        if (timer !== null) clearTimeout(timer);
        timer = null;
    }

    function after(ms: number, fn: () => void): void {
        clearTimer();
        timer = setTimeout(fn, ms);
    }

    function dim(): void {
        run += 1;
        clearTimer();
        dimmed = true;
        options.onView({ view: 'dimmed' });
    }

    function fail(error: unknown, again: () => void): void {
        if (mono() >= windowEndMono) {
            dim();
            return;
        }
        if (hasCode(error, 'PANEL_DISABLED')) {
            options.onView({ view: 'disabled' });
            after(DISABLED_RETRY_MS, again);
            return;
        }
        if (isOfflineFailure(error) || !isPublicError(error)) {
            networkFailures += 1;
            if (networkFailures >= 2) {
                offlineShown = true;
                options.onView({ view: isPanelDateWrong() ? 'wrongDate' : 'offline' });
            }
            const retryAfter = isPublicError(error) ? error.retryAfterMs : 0;
            const base = networkFailures >= 2 ? OFFLINE_RETRY_MS : FIRST_RETRY_MS;
            after(Math.max(base, retryAfter), again);
            return;
        }
        // A 4xx on start means this request itself is wrong; keep trying slowly.
        options.onView({ view: 'disabled' });
        after(OFFLINE_RETRY_MS, again);
    }

    function showClaim(found: PanelClaim): void {
        claim = found;
        run += 1;
        clearTimer();
        options.onView({ view: 'claimed', claim: found });
    }

    async function startCode(): Promise<void> {
        const me = run;
        clearTimer();
        if (isPanelDateWrong()) {
            options.onView({ view: 'wrongDate' });
            after(OFFLINE_RETRY_MS, () => void startCode());
            return;
        }
        codeShown = false;
        try {
            const body = await postPublic<PairStartResponse>('/pair/start', {
                install_id: getDeviceId(),
                device: reportedDevice(),
            });
            if (me !== run) return;
            networkFailures = 0;
            writePairing({ pair_secret: body.pair_secret });
            pollEveryMs = body.poll_after_ms;
            codeShown = true;
            offlineShown = false;
            shownCode = {
                view: 'code',
                code: body.code,
                matchCode: body.match_code,
                qrUrl: body.qr_url,
            };
            options.onView(shownCode);
            after(pollEveryMs, () => void pollOnce());
        } catch (error) {
            if (me !== run) return;
            fail(error, () => void startCode());
        }
    }

    async function pollOnce(): Promise<void> {
        const me = run;
        clearTimer();
        if (mono() >= windowEndMono) {
            dim();
            return;
        }
        const record = readPairing();
        if (!record) {
            void startCode();
            return;
        }
        let answer: PairPollResponse;
        try {
            answer = await postPublic<PairPollResponse>(
                '/pair/poll',
                { pair_secret: record.pair_secret },
                { timeout: POLL_TIMEOUT_MS }
            );
        } catch (error) {
            if (me !== run) return;
            fail(error, () => void pollOnce());
            return;
        }
        if (me !== run) return;
        networkFailures = 0;
        if (answer.state === 'PENDING' && codeShown) {
            pollEveryMs = answer.poll_after_ms;
            // Back from offline with the same code still good.
            if (offlineShown && shownCode) {
                offlineShown = false;
                options.onView(shownCode);
            }
            after(pollEveryMs, () => void pollOnce());
            return;
        }
        if (answer.state === 'CLAIMED') {
            const { poll_after_ms: nextPollMs, ...found } = answer;
            pollEveryMs = nextPollMs;
            writePairing({ pair_secret: record.pair_secret, claim: found });
            showClaim(found);
            return;
        }
        // Expired, cancelled (wrong number) or nothing left to resume: a new code.
        clearPairing();
        void startCode();
    }

    function start(): void {
        run += 1;
        clearTimer();
        dimmed = false;
        networkFailures = 0;
        codeShown = false;
        windowEndMono = mono() + PAIR_WINDOW_MS;
        const record = readPairing();
        if (record?.claim) {
            showClaim(record.claim);
            return;
        }
        options.onView({ view: 'starting' });
        // A code from before a restart cannot be shown again, but it may have been claimed.
        if (record) void pollOnce();
        else void startCode();
    }

    return {
        start,
        stop() {
            run += 1;
            clearTimer();
        },
        noteInput() {
            if (claim) return;
            windowEndMono = mono() + PAIR_WINDOW_MS;
            if (dimmed) start();
        },
        retry() {
            // Abandons any poll still out: only one at a time, and its late answer is dropped.
            run += 1;
            windowEndMono = mono() + PAIR_WINDOW_MS;
            clearTimer();
            if (claim) return;
            if (readPairing() && codeShown) void pollOnce();
            else void startCode();
        },
        async confirm(accept: boolean) {
            if (!claim) return;
            const found = claim;
            try {
                const body = await postPublic<PairConfirmResponse>('/pair/confirm', {
                    device_id: found.device_id,
                    device_secret: found.device_secret,
                    accept,
                });
                if (accept && body.status === 'ACTIVE') {
                    claim = null;
                    savePairedDevice(found);
                    options.onPaired();
                    return;
                }
            } catch (error) {
                // An admin replaced or revoked it while the question was up: start over.
                const gone = isPublicError(error) && error.kind === 'revoked';
                const refused = hasCode(error, 'DEVICE_NOT_ACTIVE');
                if (!gone && !refused) {
                    options.onConfirmFailed?.();
                    return;
                }
            }
            claim = null;
            clearPairing();
            notifyPairingCancelled();
            start();
        },
    };
}
