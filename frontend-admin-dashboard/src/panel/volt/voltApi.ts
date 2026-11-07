/**
 * Typed Volt calls through the panel axios instance.
 *
 * Every engage/** and presentation/** endpoint is permitAll on community-service
 * (CommunityApplicationSecurityConfig.java:33-35); auth headers are sent anyway
 * so nothing breaks the day that is locked down. media-service needs the token.
 *
 * Endpoints and payloads are the ones the admin app uses:
 *   list   hooks/useGetPresntation.tsx:11-27
 *   deck   hooks/useGetSinglePresntation.tsx:13-124
 *   create SlideEditorComponent.tsx:530-548 (defaults SessionOptionModel.tsx:38-48)
 *   start  SlideEditorComponent.tsx:558-575
 *   move   ActualPresentationDisplay.tsx:41, 285-337
 *   finish SlideEditorComponent.tsx:733-760
 */
import axios from 'axios';
import {
    BASE_URL,
    CREATE_SESSION_API_URL,
    FINISH_SESSION_API_URL,
    GET_PRESENTATION,
    GET_PRESENTATION_LIST,
    GET_PUBLIC_URL,
    START_SESSION_API_URL,
} from '@/constants/urls';
import panelApi from '../lib/api';
import type { VoltDeckDetail, VoltDeckSummary, VoltLiveSession, VoltSessionOptions } from './types';

const ENGAGE_ADMIN = `${BASE_URL}/community-service/engage/admin`;
const ENGAGE_LEARNER = `${BASE_URL}/community-service/engage/learner`;
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

export async function createSession(
    presentationId: string,
    options: Partial<VoltSessionOptions> = {}
): Promise<VoltLiveSession> {
    const merged = { ...DEFAULT_SESSION_OPTIONS, ...options };
    const response = await panelApi.post<VoltLiveSession>(CREATE_SESSION_API_URL, {
        source: 'PRESENTATION',
        source_id: presentationId,
        ...merged,
        default_seconds_for_question: Number(merged.default_seconds_for_question),
        student_attempts: Number(merged.student_attempts),
    });
    if (!response.data?.session_id || !response.data.invite_code) {
        throw new Error('Invalid response from server');
    }
    return response.data;
}

export async function startSession(
    sessionId: string,
    firstSlideOrder: number
): Promise<VoltLiveSession> {
    const response = await panelApi.post<VoltLiveSession>(START_SESSION_API_URL, {
        session_id: sessionId,
        move_to: firstSlideOrder,
    });
    return response.data;
}

/**
 * Move the class to a slide. The backend treats move_to as an index into the
 * session's slide list (LiveSessionService.moveTo); like the admin presenter we
 * send slide_order, which equals that index for a deck saved by the editor.
 */
export async function moveSession(sessionId: string, slideOrder: number): Promise<VoltLiveSession> {
    const response = await panelApi.post<VoltLiveSession>(MOVE_SLIDE_API_URL, {
        session_id: sessionId,
        move_to: slideOrder,
    });
    return response.data;
}

export async function finishSession(sessionId: string): Promise<void> {
    await panelApi.post(FINISH_SESSION_API_URL, { session_id: sessionId, move_to: null });
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

/** True when the server answered (so the session really is gone), false for network errors. */
export function isServerRejection(error: unknown): boolean {
    return axios.isAxiosError(error) && !!error.response && error.response.status >= 400;
}

/** Best human-readable message for a failed Volt call (ErrorInfo.ex or message). */
export function voltErrorMessage(error: unknown): string | undefined {
    if (axios.isAxiosError(error)) {
        const data = error.response?.data as { ex?: string; message?: string } | undefined;
        return data?.ex || data?.message || error.message;
    }
    return error instanceof Error ? error.message : undefined;
}
