import { AI_SERVICE_BASE_URL } from '@/constants/urls';
import type { TFunction } from 'i18next';

const NS = 'videoApiStudioInputVideo';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type InputVideoMode = 'podcast' | 'demo';

export type InputVideoStatus = 'PENDING' | 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED';

export interface InputVideoRecord {
    id: string;
    institute_id: string;
    name: string;
    mode: InputVideoMode;
    status: InputVideoStatus;
    source_url: string;
    duration_seconds: number | null;
    resolution: string | null;
    context_json_url: string | null;
    spatial_db_url: string | null;
    assets_urls: Record<string, string> | null;
    render_job_id: string | null;
    progress: number;
    error_message: string | null;
    metadata: Record<string, unknown> | null;
    created_at: string | null;
    updated_at: string | null;
}

export interface InputVideoStatusResponse {
    id: string;
    status: InputVideoStatus;
    progress: number;
    error_message: string | null;
}

export interface CreateInputVideoPayload {
    name: string;
    mode: InputVideoMode;
    source_url: string;
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

const BASE = `${AI_SERVICE_BASE_URL}/input-video`;

function headers(apiKey: string): Record<string, string> {
    return {
        'Content-Type': 'application/json',
        'X-Institute-Key': apiKey,
    };
}

/**
 * Create a new input video record and start indexing. `t` is optional —
 * real callers thread their bound `t` through so the thrown message (often
 * surfaced verbatim via a toast's `err.message` fallback) is translated;
 * older/untranslated call sites keep working with the English message.
 */
export async function createInputVideo(
    apiKey: string,
    payload: CreateInputVideoPayload,
    t?: TFunction
): Promise<InputVideoRecord> {
    const resp = await fetch(`${BASE}/create`, {
        method: 'POST',
        headers: headers(apiKey),
        body: JSON.stringify(payload),
    });
    if (!resp.ok) {
        const err = await resp.text();
        throw new Error(
            t
                ? t(`${NS}:errors.createFailed`, { status: resp.status, detail: err })
                : `Create failed (${resp.status}): ${err}`
        );
    }
    return resp.json();
}

/** List all input videos for the institute (newest first).
 *
 * Filter explicitly to kind=video. The backend route is now polymorphic
 * (videos + images) and the legacy /input-video/* alias serves the same
 * handler — without this filter, image rows would leak into UIs (like
 * InputVideosPage) that don't know how to render them.
 */
export async function listInputVideos(apiKey: string): Promise<InputVideoRecord[]> {
    const resp = await fetch(`${BASE}/list?kind=video`, {
        method: 'GET',
        headers: headers(apiKey),
    });
    if (!resp.ok) {
        throw new Error(`List failed (${resp.status})`);
    }
    return resp.json();
}

/** Get full details for a single input video. */
export async function getInputVideo(apiKey: string, id: string): Promise<InputVideoRecord> {
    const resp = await fetch(`${BASE}/${id}`, {
        method: 'GET',
        headers: headers(apiKey),
    });
    if (!resp.ok) {
        throw new Error(`Get failed (${resp.status})`);
    }
    return resp.json();
}

/** Lightweight status check for polling. */
export async function getInputVideoStatus(
    apiKey: string,
    id: string
): Promise<InputVideoStatusResponse> {
    const resp = await fetch(`${BASE}/${id}/status`, {
        method: 'GET',
        headers: headers(apiKey),
    });
    if (!resp.ok) {
        throw new Error(`Status check failed (${resp.status})`);
    }
    return resp.json();
}

/** Delete an input video record. */
export async function deleteInputVideo(apiKey: string, id: string): Promise<void> {
    const resp = await fetch(`${BASE}/${id}`, {
        method: 'DELETE',
        headers: headers(apiKey),
    });
    if (!resp.ok) {
        throw new Error(`Delete failed (${resp.status})`);
    }
}
