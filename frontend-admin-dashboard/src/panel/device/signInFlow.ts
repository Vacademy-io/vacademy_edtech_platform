/**
 * The QR sign-in state machine behind SignInCard, with no React in it.
 *
 * - The QR is up for 10 minutes after boot, input or sign-out, then dims and polling
 *   stops. It stays on while scanned.
 * - A challenge lives 5 minutes and is replaced 30 s before that, silently, and never
 *   while scanned: the panel polls first and renews only on PENDING. A 409
 *   APPROVED_PENDING means a teacher approved between that poll and the renewal: keep
 *   polling that challenge and redeem it.
 * - One poll at a time. Every async answer checks the run it belongs to, so an answer
 *   from an abandoned poll can never overwrite tokens from a newer one.
 * - Network failure, 5xx, BUSY and 429: one quiet retry, then the offline state,
 *   retrying every 15 s until the window ends.
 * - Phase 2: LICENCE_REQUIRED, AWAITING_APPROVAL and UPDATE_REQUIRED each have their own
 *   view (licence, awaiting, updateRequired). Like PANEL_DISABLED they keep the panel
 *   signed out, but they stay up past the window and recheck every 5 minutes; retry()
 *   ("Check again") rechecks at once.
 */
import type {
    ChallengePollResponse,
    ChallengeResponse,
    PanelChallengePurpose,
} from '@/classroom-shared/apiTypes';
import {
    CHALLENGE_RENEW_BEFORE_MS,
    FIRST_RETRY_MS,
    OFFLINE_RETRY_MS,
    PANEL_LICENCE_RECHECK_MS,
    SIGN_IN_WINDOW_MS,
} from '../config';
import { getRefreshToken, handleSessionEnded } from '../lib/api';
import { adoptRedeemedSession, type AdoptResult } from '../lib/session';
import { isPanelDateWrong } from './activity';
import { hasCode, isOfflineFailure, isPublicError, postPublic } from './publicApi';
import { deviceCredentials, readActiveDevice } from './store';

export type SignInView =
    | { view: 'starting' }
    | { view: 'qr'; qrUrl: string; userCode: string }
    | { view: 'scanned'; name: string | null; matchCode: number | null }
    /** A teacher approved; the panel is collecting the tokens. */
    | { view: 'approving' }
    | { view: 'dimmed' }
    | { view: 'offline' }
    | { view: 'wrongDate' }
    | { view: 'unavailable' }
    /** Phase 2: LICENCE_REQUIRED. This room has no seat. */
    | { view: 'licence' }
    /** Phase 2: AWAITING_APPROVAL. An installer set this panel up; the school has not approved it. */
    | { view: 'awaiting' }
    /** Phase 2: UPDATE_REQUIRED. This app build is below the minimum. */
    | { view: 'updateRequired' };

/** The views a refused sign-in maps to. Null for every other failure. */
export function refusalView(error: unknown): 'licence' | 'awaiting' | 'updateRequired' | null {
    if (hasCode(error, 'LICENCE_REQUIRED')) return 'licence';
    if (hasCode(error, 'AWAITING_APPROVAL')) return 'awaiting';
    if (hasCode(error, 'UPDATE_REQUIRED')) return 'updateRequired';
    return null;
}

export type SignInOutcome =
    | ({ kind: 'signedIn' } & AdoptResult)
    | { kind: 'attached' }
    | { kind: 'sessionEnded' };

export interface SignInFlowOptions {
    purpose: PanelChallengePurpose;
    onView: (view: SignInView) => void;
    onDone: (outcome: SignInOutcome) => void;
    /** The number did not match, or the teacher tapped Not me. */
    onNumberDead?: () => void;
}

export interface SignInFlow {
    start: () => void;
    stop: () => void;
    /** Any touch or key. Restarts the window, and the QR when it had dimmed. */
    noteInput: () => void;
    /** The Retry button. */
    retry: () => void;
}

const POLL_TIMEOUT_MS = 8000;
const DISABLED_RETRY_MS = 60 * 1000;
const MAX_OTHER_FAILURES = 3;

interface OpenChallenge {
    id: string;
    matchCode: number | null;
    expiresAtMono: number;
}

export function createSignInFlow(options: SignInFlowOptions): SignInFlow {
    let run = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let windowEndMono = 0;
    let challenge: OpenChallenge | null = null;
    let scanned = false;
    let approving = false;
    let networkFailures = 0;
    let otherFailures = 0;
    let dimmed = false;
    let shownQr: Extract<SignInView, { view: 'qr' }> | null = null;
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

    function restartWindow(): void {
        windowEndMono = mono() + SIGN_IN_WINDOW_MS;
    }

    function dim(): void {
        run += 1;
        clearTimer();
        dimmed = true;
        challenge = null;
        options.onView({ view: 'dimmed' });
    }

    function windowOver(): boolean {
        return mono() >= windowEndMono && !scanned && !approving;
    }

    function fail(error: unknown, again: () => void): void {
        if (isPublicError(error) && error.kind === 'revoked') {
            // The store has it; the router is already leaving this screen.
            stop();
            return;
        }
        const refused = refusalView(error);
        if (refused) {
            // Not dimmed when the window ends: the card says why nobody can sign in.
            networkFailures = 0;
            otherFailures = 0;
            options.onView({ view: refused });
            after(PANEL_LICENCE_RECHECK_MS, again);
            return;
        }
        if (windowOver()) {
            dim();
            return;
        }
        if (hasCode(error, 'PANEL_DISABLED')) {
            options.onView({ view: 'unavailable' });
            after(DISABLED_RETRY_MS, again);
            return;
        }
        if (isOfflineFailure(error) || !isPublicError(error)) {
            networkFailures += 1;
            const retryAfter = isPublicError(error) ? error.retryAfterMs : 0;
            if (networkFailures >= 2) {
                offlineShown = true;
                options.onView({ view: isPanelDateWrong() ? 'wrongDate' : 'offline' });
            }
            const base = networkFailures >= 2 ? OFFLINE_RETRY_MS : FIRST_RETRY_MS;
            after(Math.max(base, retryAfter), again);
            return;
        }
        otherFailures += 1;
        if (otherFailures >= MAX_OTHER_FAILURES) options.onView({ view: 'unavailable' });
        after(OFFLINE_RETRY_MS, again);
    }

    async function createChallenge(): Promise<void> {
        const me = run;
        clearTimer();
        const device = readActiveDevice();
        if (!device) return;
        if (isPanelDateWrong()) {
            options.onView({ view: 'wrongDate' });
            after(OFFLINE_RETRY_MS, () => void createChallenge());
            return;
        }
        scanned = false;
        const sessionToken = options.purpose === 'ATTACH_REMOTE' ? getRefreshToken() : null;
        try {
            const body = await postPublic<ChallengeResponse>('/challenge', {
                ...deviceCredentials(device),
                purpose: options.purpose,
                ...(sessionToken ? { session_token: sessionToken } : {}),
            });
            if (me !== run) return;
            networkFailures = 0;
            otherFailures = 0;
            approving = false;
            challenge = {
                id: body.challenge_id,
                matchCode: body.match_code,
                expiresAtMono: mono() + body.expires_in_s * 1000,
            };
            shownQr = { view: 'qr', qrUrl: body.qr_url, userCode: body.user_code };
            offlineShown = false;
            options.onView(shownQr);
            after(body.poll_after_ms, () => void pollOnce());
        } catch (error) {
            if (me !== run) return;
            if (
                isPublicError(error) &&
                error.code === 'APPROVED_PENDING' &&
                error.body?.challenge_id
            ) {
                networkFailures = 0;
                approving = true;
                challenge = {
                    id: error.body.challenge_id,
                    matchCode: null,
                    expiresAtMono: Infinity,
                };
                options.onView({ view: 'approving' });
                after(0, () => void pollOnce());
                return;
            }
            if (hasCode(error, 'SESSION_ENDED')) {
                stop();
                handleSessionEnded('challenge refused');
                options.onDone({ kind: 'sessionEnded' });
                return;
            }
            fail(error, () => void createChallenge());
        }
    }

    function freshChallenge(): void {
        challenge = null;
        scanned = false;
        approving = false;
        void createChallenge();
    }

    async function pollOnce(): Promise<void> {
        const me = run;
        clearTimer();
        if (windowOver()) {
            dim();
            return;
        }
        const device = readActiveDevice();
        if (!device) return;
        if (!challenge) {
            void createChallenge();
            return;
        }
        const open = challenge;
        let answer: ChallengePollResponse;
        try {
            answer = await postPublic<ChallengePollResponse>(
                '/challenge/poll',
                { ...deviceCredentials(device), challenge_id: open.id },
                { timeout: POLL_TIMEOUT_MS }
            );
        } catch (error) {
            if (me !== run) return;
            if (hasCode(error, 'NOT_FOUND')) {
                freshChallenge();
                return;
            }
            fail(error, () => void pollOnce());
            return;
        }
        if (me !== run) return;
        networkFailures = 0;
        otherFailures = 0;

        switch (answer.state) {
            case 'PENDING':
                // Renew only on a fresh answer, so a scan in the last poll interval is seen first.
                if (!approving && mono() >= open.expiresAtMono - CHALLENGE_RENEW_BEFORE_MS) {
                    void createChallenge();
                    return;
                }
                // Back from offline with the same challenge still good.
                if (offlineShown) {
                    offlineShown = false;
                    options.onView(approving || !shownQr ? { view: 'approving' } : shownQr);
                }
                after(answer.poll_after_ms, () => void pollOnce());
                return;
            case 'SCANNED':
                scanned = true;
                offlineShown = false;
                options.onView({
                    view: 'scanned',
                    name: answer.scanned_by_name,
                    matchCode: open.matchCode,
                });
                after(answer.poll_after_ms, () => void pollOnce());
                return;
            case 'EXPIRED':
                freshChallenge();
                return;
            case 'DEAD':
                if (scanned) options.onNumberDead?.();
                freshChallenge();
                return;
            case 'ATTACHED':
                stop();
                options.onDone({ kind: 'attached' });
                return;
            case 'REDEEMED': {
                stop();
                const result = await adoptRedeemedSession(answer);
                options.onDone({ kind: 'signedIn', ...result });
                return;
            }
        }
    }

    function start(): void {
        run += 1;
        clearTimer();
        dimmed = false;
        scanned = false;
        approving = false;
        challenge = null;
        networkFailures = 0;
        otherFailures = 0;
        restartWindow();
        options.onView({ view: 'starting' });
        void createChallenge();
    }

    function stop(): void {
        run += 1;
        clearTimer();
    }

    return {
        start,
        stop,
        noteInput() {
            restartWindow();
            if (dimmed) start();
        },
        retry() {
            // Abandons any poll still out: only one at a time, and its late answer is dropped.
            run += 1;
            restartWindow();
            clearTimer();
            if (challenge) void pollOnce();
            else void createChallenge();
        },
    };
}
