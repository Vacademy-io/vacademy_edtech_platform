import { AI_SERVICE_BASE_URL } from '@/constants/urls';
import type { TFunction } from 'i18next';

const NS = 'videoApiStudioInputAsset';

// ---------------------------------------------------------------------------
// Types — DB record shape
// ---------------------------------------------------------------------------

export type InputAssetKind = 'video' | 'image';

export type InputVideoMode = 'podcast' | 'demo';
export type InputImageMode = 'photo' | 'screenshot' | 'diagram';
export type InputAssetMode = InputVideoMode | InputImageMode;

export type InputAssetStatus = 'PENDING' | 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED';

export interface InputAssetRecord {
    id: string;
    institute_id: string;
    name: string;
    kind: InputAssetKind;
    mode: InputAssetMode;
    status: InputAssetStatus;
    source_url: string;
    duration_seconds: number | null;
    resolution: string | null;
    width: number | null;
    height: number | null;
    context_json_url: string | null;
    spatial_db_url: string | null;
    image_metadata_url: string | null;
    assets_urls: Record<string, string> | null;
    render_job_id: string | null;
    progress: number;
    error_message: string | null;
    metadata: Record<string, unknown> | null;
    created_at: string | null;
    updated_at: string | null;
}

export interface CreateInputAssetPayload {
    name: string;
    kind: InputAssetKind;
    mode: InputAssetMode;
    source_url: string;
}

export interface InputAssetStatusResponse {
    id: string;
    status: InputAssetStatus;
    progress: number;
    error_message: string | null;
}

// ---------------------------------------------------------------------------
// Types — extracted metadata
//
// These mirror the Pydantic models in extractor/schemas.py. We type the
// minimum a UI needs; the actual JSON has more fields but TypeScript will
// tolerate extras when we read them as `unknown` blobs.
// ---------------------------------------------------------------------------

export interface VideoContextData {
    meta: {
        mode: InputVideoMode;
        duration_s: number;
        resolution: [number, number];
        fps_original: number;
        fps_sampled_visual: number;
        highlight_window: { t_start: number; t_end: number; reason: string };
        audio?: {
            present: boolean;
            total_words: number;
            words_per_minute: number;
            speech_coverage: number;
        } | null;
    };
    transcript?: Array<{
        text: string;
        start: number;
        end: number;
        energy_mean?: number | null;
        pitch_mean_hz?: number | null;
        pitch_std_hz?: number | null;
        speech_rate_wps?: number | null;
    }>;
    emphasis?: Array<{ t: number; word: string; reason: string }>;
    prosody?: {
        mean_rms: number;
        peak_rms: number;
        mean_pitch_hz: number;
        pause_count: number;
    } | null;
    scenes?: Array<{ t: number; frame_num: number }>;
    foreground?: {
        asset_path: string;
        has_alpha: boolean;
        typical_bbox_norm?: number[] | null;
        free_regions?: string[];
    } | null;
    face_segments?: Array<{
        t_start: number;
        t_end: number;
        bbox_norm: number[];
        free_regions?: string[];
        sample_count?: number;
        detection_rate?: number;
    }>;
}

export interface ImageMetadataData {
    meta: {
        mode: InputImageMode;
        width: number;
        height: number;
        format: string;
        file_size_bytes: number;
    };
    colors: { dominant: Array<{ hex: string; weight: number }> };
    ocr: {
        blocks: Array<{ text: string; bbox_norm: number[]; confidence: number }>;
        full_text: string;
    };
    faces?: {
        detected: boolean;
        primary_bbox_norm?: number[] | null;
        free_regions?: string[];
        face_count: number;
    } | null;
    foreground?: { asset_path: string; has_alpha: boolean } | null;
    caption?: {
        short: string;
        long: string;
        tags: string[];
        ui_elements?: string[];
    } | null;
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

const BASE = `${AI_SERVICE_BASE_URL}/input-asset`;

function headers(apiKey: string): Record<string, string> {
    return {
        'Content-Type': 'application/json',
        'X-Institute-Key': apiKey,
    };
}

/**
 * Create an input-asset record. `t` is optional — real callers thread their
 * bound `t` through so the thrown message (often surfaced verbatim via a
 * toast's `err.message` fallback) is translated; older/untranslated call
 * sites keep working with the English message.
 */
export async function createInputAsset(
    apiKey: string,
    payload: CreateInputAssetPayload,
    t?: TFunction
): Promise<InputAssetRecord> {
    const resp = await fetch(`${BASE}/create`, {
        method: 'POST',
        headers: headers(apiKey),
        body: JSON.stringify(payload),
    });
    if (!resp.ok) {
        const detail = await resp.text();
        throw new Error(
            t
                ? t(`${NS}:errors.createFailed`, { status: resp.status, detail })
                : `Create failed (${resp.status}): ${detail}`
        );
    }
    return resp.json();
}

export async function listInputAssets(
    apiKey: string,
    kind?: InputAssetKind
): Promise<InputAssetRecord[]> {
    const url = kind ? `${BASE}/list?kind=${kind}` : `${BASE}/list`;
    const resp = await fetch(url, { method: 'GET', headers: headers(apiKey) });
    if (!resp.ok) throw new Error(`List failed (${resp.status})`);
    return resp.json();
}

export async function getInputAsset(apiKey: string, id: string): Promise<InputAssetRecord> {
    const resp = await fetch(`${BASE}/${id}`, { method: 'GET', headers: headers(apiKey) });
    if (!resp.ok) throw new Error(`Get failed (${resp.status})`);
    return resp.json();
}

/** See {@link createInputAsset} re: the optional `t`. */
export async function deleteInputAsset(apiKey: string, id: string, t?: TFunction): Promise<void> {
    const resp = await fetch(`${BASE}/${id}`, { method: 'DELETE', headers: headers(apiKey) });
    if (!resp.ok) {
        throw new Error(
            t
                ? t(`${NS}:errors.deleteFailed`, { status: resp.status })
                : `Delete failed (${resp.status})`
        );
    }
}

/** Fetch the externally-hosted video_context.json artifact. No auth — S3 is public. */
export async function fetchVideoContext(url: string): Promise<VideoContextData> {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Failed to load video context (${resp.status})`);
    return resp.json();
}

/** Fetch the externally-hosted image_metadata.json artifact. No auth — S3 is public. */
export async function fetchImageMetadata(url: string): Promise<ImageMetadataData> {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Failed to load image metadata (${resp.status})`);
    return resp.json();
}
