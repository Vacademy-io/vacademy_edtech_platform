/**
 * Typed Volt calls through the panel axios instance.
 *
 * Auth headers are sent on every community-service call; media-service needs the
 * token. A session made here has a presenter key (POST /engage/admin/v2/create):
 * control calls send it as X-Presenter-Token, presenter reads as the same header, and
 * the presenter stream as ?presenter_token= because EventSource cannot set headers.
 * Both names contain "token", so the server's log and Sentry redaction drops them. Do
 * not log the key or the stream URL.
 *
 * Endpoints and payloads are the ones the admin app uses:
 *   list   hooks/useGetPresntation.tsx:11-27
 *   deck   hooks/useGetSinglePresntation.tsx:13-124
 *   create SlideEditorComponent.tsx:530-548 (defaults SessionOptionModel.tsx:38-48),
 *          on the v2 path
 *   start  SlideEditorComponent.tsx:558-575
 *   move   ActualPresentationDisplay.tsx:41, 285-337
 *   finish SlideEditorComponent.tsx:733-760
 */
import axios from 'axios';
import i18next from 'i18next';
import {
    BASE_URL,
    FINISH_SESSION_API_URL,
    GET_PRESENTATION,
    GET_PRESENTATION_LIST,
    GET_PUBLIC_URL,
    START_SESSION_API_URL,
} from '@/constants/urls';
import type { VoltV2CreateResponse } from '@/classroom-shared/apiTypes';
import panelApi from '../lib/api';
import type { VoltDeckDetail, VoltDeckSummary, VoltLiveSession, VoltSessionOptions } from './types';

const PRESENTER_KEY_HEADER = 'X-Presenter-Token';
const PRESENTER_KEY_PARAM = 'presenter_token';

const ENGAGE_ADMIN = `${BASE_URL}/community-service/engage/admin`;
const ENGAGE_LEARNER = `${BASE_URL}/community-service/engage/learner`;
const CREATE_SESSION_V2_URL = `${ENGAGE_ADMIN}/v2/create`;
export const MOVE_SLIDE_API_URL = `${ENGAGE_ADMIN}/move`;
/** Presenter SSE base (ActualPresentationDisplay.tsx:43). */
export const PRESENTER_SSE_URL_BASE = `${ENGAGE_ADMIN}/`;

/** SessionOptionModel.tsx:38-48 defaults. */
export const DEFAULT_SESSION_OPTIONS: VoltSessionOptions = {
    can_join_in_between: true,
    show_results_at_last_slide: true,
    default_seconds_for_question: 60,
    student_attempts: 1,
    is_session_recorded: false,
    allow_chat: false,
    points_per_correct_answer: 10,
    negative_marking_enabled: false,
    negative_marks_per_wrong_answer: 0,
};

export async function listDecks(
    instituteId: string,
    signal?: AbortSignal
): Promise<VoltDeckSummary[]> {
    const response = await panelApi.get<VoltDeckSummary[] | null>(GET_PRESENTATION_LIST, {
        params: { instituteId },
        signal,
    });
    const rows = Array.isArray(response.data) ? response.data : [];
    return rows.filter((deck) => deck && deck.id && deck.status !== 'DELETED');
}

export async function getDeck(
    presentationId: string,
    signal?: AbortSignal
): Promise<VoltDeckDetail> {
    const response = await panelApi.get<VoltDeckDetail>(GET_PRESENTATION, {
        params: { presentationId },
        signal,
    });
    if (!response.data || !response.data.id) throw new Error('Presentation not found');
    return response.data;
}

/**
 * Signed URL for a stored file (services/upload_file.ts getPublicUrl, minus its
 * swallow-all catch: a failure here must surface as a failed slide).
 */
export async function getPublicUrl(fileId: string, signal?: AbortSignal): Promise<string> {
    let clean = fileId.trim();
    if (
        (clean.startsWith('"') && clean.endsWith('"')) ||
        (clean.startsWith("'") && clean.endsWith("'"))
    ) {
        clean = clean.slice(1, -1);
    }
    if (clean.startsWith('http://') || clean.startsWith('https://')) return clean;
    const response = await panelApi.get<string>(GET_PUBLIC_URL, {
        params: { fileId: clean, expiryDays: 1 },
        signal,
    });
    if (typeof response.data !== 'string' || !response.data) {
        throw new Error('No URL for slide file');
    }
    return response.data;
}

// ---------------------------------------------------------- presenter key ---

/**
 * The key for the session this panel is running. One slot: a panel runs one session.
 * It outlives the stored record on purpose, because the leaderboard shown after finish
 * still needs it. Replaced by the next session, emptied at sign-out.
 */
let presenterKey: { sessionId: string; key: string } | null = null;

export function rememberPresenterKey(sessionId: string, key: string | undefined): void {
    presenterKey = key ? { sessionId, key } : null;
}

export function forgetPresenterKey(): void {
    presenterKey = null;
}

function keyFor(sessionId: string): string | null {
    return presenterKey && presenterKey.sessionId === sessionId ? presenterKey.key : null;
}

function presenterHeaders(sessionId: string): Record<string, string> {
    const key = keyFor(sessionId);
    return key ? { [PRESENTER_KEY_HEADER]: key } : {};
}

/**
 * The response overlay and the reused admin leaderboard modal make these reads through
 * this same axios instance (vite.panel.config.ts redirects the admin instance here), so
 * the header is added at this one place rather than in each of them.
 */
const PRESENTER_READ_PATH =
    /^\/([^/?#]+)\/(?:leaderboard(?:\/csv)?|slide\/[^/?#]+\/responses)(?:[?#]|$)/;

panelApi.interceptors.request.use((config) => {
    const url = config.url ?? '';
    if (!presenterKey || url.indexOf(`${ENGAGE_ADMIN}/`) !== 0) return config;
    const match = PRESENTER_READ_PATH.exec(url.slice(ENGAGE_ADMIN.length));
    if (match && match[1] === encodeURIComponent(presenterKey.sessionId)) {
        config.headers[PRESENTER_KEY_HEADER] = presenterKey.key;
    }
    return config;
});

/** EventSource cannot set headers, so the stream carries the key in its query. */
export function presenterStreamUrl(sessionId: string): string {
    const key = keyFor(sessionId);
    const base = `${PRESENTER_SSE_URL_BASE}${encodeURIComponent(sessionId)}`;
    return key ? `${base}?${PRESENTER_KEY_PARAM}=${encodeURIComponent(key)}` : base;
}

/** The server turned the presenter key down: wrong, or not sent. Retrying cannot help. */
export function isPresenterKeyRefused(error: unknown): boolean {
    if (!axios.isAxiosError(error) || error.response?.status !== 403) return false;
    return (error.response.data as { code?: unknown } | undefined)?.code === 'FORBIDDEN';
}

/**
 * EventSource hides the status of a failed stream, so ask a read gated the same way.
 * Only a clear refusal counts; anything else leaves the stream retrying.
 */
export async function isStreamKeyRefused(sessionId: string): Promise<boolean> {
    try {
        await panelApi.get(`${ENGAGE_ADMIN}/${encodeURIComponent(sessionId)}/leaderboard`);
        return false;
    } catch (error) {
        return isPresenterKeyRefused(error);
    }
}

/** Shown on the deck screen and in toasts. Same two languages as volt/strings.ts. */
const KEY_REFUSED_COPY = {
    en: {
        title: 'This panel can no longer run that live session',
        body: 'The server no longer accepts this panel for that session, so its slides and answers cannot be controlled from here. Start a new live session, or present without one.',
    },
    hi: {
        title: 'यह पैनल अब उस लाइव सेशन को नहीं चला सकता',
        body: 'सर्वर अब उस सेशन के लिए इस पैनल को स्वीकार नहीं करता, इसलिए उसकी स्लाइड और जवाब यहाँ से नियंत्रित नहीं हो सकते। नया लाइव सेशन शुरू करें, या बिना लाइव सेशन के दिखाएँ।',
    },
};

export function presenterKeyRefusedCopy(): { title: string; body: string } {
    return i18next.language === 'hi' ? KEY_REFUSED_COPY.hi : KEY_REFUSED_COPY.en;
}

// ---------------------------------------------------------------- session ---

export interface CreatedSession {
    session: VoltLiveSession;
    presenterKey: string;
}

export async function createSession(
    presentationId: string,
    options: Partial<VoltSessionOptions> = {}
): Promise<CreatedSession> {
    const merged = { ...DEFAULT_SESSION_OPTIONS, ...options };
    const response = await panelApi.post<VoltV2CreateResponse<VoltLiveSession>>(
        CREATE_SESSION_V2_URL,
        {
            source: 'PRESENTATION',
            source_id: presentationId,
            ...merged,
            default_seconds_for_question: Number(merged.default_seconds_for_question),
            student_attempts: Number(merged.student_attempts),
        }
    );
    const session = response.data?.session;
    const key = response.data?.presenter_key;
    if (!session?.session_id || !session.invite_code || !key) {
        throw new Error('Invalid response from server');
    }
    return { session, presenterKey: key };
}

export async function startSession(
    sessionId: string,
    firstSlideOrder: number
): Promise<VoltLiveSession> {
    const response = await panelApi.post<VoltLiveSession>(
        START_SESSION_API_URL,
        { session_id: sessionId, move_to: firstSlideOrder },
        { headers: presenterHeaders(sessionId) }
    );
    return response.data;
}

/**
 * Move the class to a slide. The backend treats move_to as an index into the
 * session's slide list (LiveSessionService.moveTo); like the admin presenter we
 * send slide_order, which equals that index for a deck saved by the editor.
 */
export async function moveSession(sessionId: string, slideOrder: number): Promise<VoltLiveSession> {
    const response = await panelApi.post<VoltLiveSession>(
        MOVE_SLIDE_API_URL,
        { session_id: sessionId, move_to: slideOrder },
        { headers: presenterHeaders(sessionId) }
    );
    return response.data;
}

export async function finishSession(sessionId: string): Promise<void> {
    await panelApi.post(
        FINISH_SESSION_API_URL,
        { session_id: sessionId, move_to: null },
        { headers: presenterHeaders(sessionId) }
    );
}

/**
 * Current server copy of a live session (learner endpoint, used for presenter
 * resume). Rejects when the session is unknown or FINISHED (VacademyException,
 * HTTP 510).
 */
export async function getUpdatedDetails(sessionId: string): Promise<VoltLiveSession> {
    const response = await panelApi.get<VoltLiveSession>(
        `${ENGAGE_LEARNER}/get-updated-details/${encodeURIComponent(sessionId)}`
    );
    if (!response.data?.session_id) throw new Error('Session not found');
    return response.data;
}

/**
 * True when the server answered that the session is gone, false for network errors.
 * 401 and 403 say nothing about the session, which may well still be running.
 */
export function isServerRejection(error: unknown): boolean {
    if (!axios.isAxiosError(error) || !error.response) return false;
    const { status } = error.response;
    return status >= 400 && status !== 401 && status !== 403;
}

/** Best human-readable message for a failed Volt call (ErrorInfo.ex or message). */
export function voltErrorMessage(error: unknown): string | undefined {
    if (isPresenterKeyRefused(error)) return presenterKeyRefusedCopy().title;
    if (axios.isAxiosError(error)) {
        const data = error.response?.data as { ex?: string; message?: string } | undefined;
        return data?.ex || data?.message || error.message;
    }
    return error instanceof Error ? error.message : undefined;
}
