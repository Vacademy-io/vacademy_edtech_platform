/**
 * Live AI Tutor — creation-time API (ai_service /tutor/v1).
 *
 * Every call carries the admin JWT and the institute `clientId`; the server
 * pins the caller to that institute and requires a staff role. Compile calls
 * stream Server-Sent Events, read here with fetch + a line reader (the same
 * transport the copilot uses), so the course page can show per-slide progress.
 */
import { AI_SERVICE_BASE_URL } from '@/constants/urls';
import { getTokenFromCookie } from '@/lib/auth/sessionUtility';
import { TokenKey } from '@/constants/auth/tokens';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { getInstituteId } from '@/constants/helper';
import { GET_INSTITUTE_SETTING_DATA } from '@/constants/urls';

const BASE = `${AI_SERVICE_BASE_URL}/tutor/v1`;

export type TutorPlanStatus =
    | 'NOT_COMPILED'
    | 'UNSUPPORTED'
    | 'NEEDS_DETAILS'
    | 'COMPILING'
    | 'READY'
    | 'FAILED'
    | 'STALE'
    | 'DELETED';

export interface TutorPlanStatusItem {
    slide_id: string;
    slide_title: string | null;
    source_type: string | null;
    chapter_id: string | null;
    chapter_name: string | null;
    plan_id: string | null;
    version: number | null;
    status: TutorPlanStatus;
    error: string | null;
    serving_plan_id: string | null;
    topics: number;
    concepts: number;
    updated_at: string | null;
    /** document | pdf | quiz | ai_video | youtube | video_upload | video_link | scorm | other */
    source_kind?: string | null;
    /** What the newest plan was compiled from: script | captions | transcript | pdf | scorm | scorm_ocr | null */
    text_kind?: string | null;
    /** Board-quality advice the compiler let go; the plan is READY and teachable. */
    quality_notes?: string[];
}

export interface TutorPackagePlans {
    package_id: string;
    counts: Record<string, number>;
    slides: TutorPlanStatusItem[];
}

export interface TutorConceptView {
    id: string;
    order: number;
    title: string;
    concept_tags: string[];
    board_ops: Array<Record<string, unknown>>;
    board_html: string;
    say: string;
    say_i18n: Record<string, string>;
    teach_notes: string | null;
    check: Record<string, unknown> | null;
}

export interface TutorTopicView {
    id: string;
    order: number;
    title: string;
    estimated_seconds: number | null;
    summary_html: string | null;
    concepts: TutorConceptView[];
}

export interface TutorPlanView {
    plan_id: string;
    slide_id: string;
    version: number;
    status: TutorPlanStatus;
    language: string;
    model: string | null;
    objectives: string[];
    key_terms: Array<{ term: string; meaning: string }>;
    source_description: string | null;
    error: string | null;
    quality_notes?: string[];
    topics: TutorTopicView[];
    media: Array<Record<string, unknown>>;
}

export interface TutorCompileOptions {
    language?: 'en' | 'hi';
    teacher_name?: string;
    generate_images?: boolean;
    kb_grounding?: { knowledge_base_id: string; mode?: 'STRICT' | 'BLENDED' } | null;
    /** Uploaded videos without a transcript: run speech-to-text (per-minute credits). */
    transcribe_videos?: boolean;
    /** Scanned PDFs: read with OCR (per-page credits). */
    ocr_pdfs?: boolean;
    compile_run_id?: string;
}

export type TutorEstimateAction =
    | 'compile'
    | 'up_to_date'
    | 'needs_details'
    | 'free'
    | 'skip'
    | 'unsupported'
    | 'unpublished';

export interface TutorCompileEstimate {
    package_id: string;
    slides: Array<{
        slide_id: string;
        title: string | null;
        kind: string;
        action: TutorEstimateAction;
        compile: number;
        transcription: number;
        minutes: number;
        ocr: number;
        pages: number;
        /** One-time voice preparation (per language) for this slide. */
        voice: number;
        images_max: number;
        total: number;
        note: string | null;
        text: string | null;
    }>;
    totals: {
        to_compile: number;
        up_to_date: number;
        needs_details: number;
        free: number;
        compile_credits: number;
        transcription_credits: number;
        transcription_minutes: number;
        ocr_credits: number;
        ocr_pages: number;
        voice_credits: number;
        voice_languages: number;
        images_max: number;
        images_max_credits: number;
        required: number;
        worst_case: number;
    };
    prices: {
        compile_slide: number;
        image: number;
        transcription_per_minute: number;
        transcription_minimum: number;
        ocr_per_page: number;
        voice_prepare_per_slide_language: number;
    };
    balance: number | null;
    sufficient: boolean | null;
    transcription_available: boolean;
    ocr_available: boolean;
}

export const estimateTutorCompile = async (
    packageId: string,
    options: TutorCompileOptions & { slide_ids?: string[]; force?: boolean }
): Promise<TutorCompileEstimate> => {
    const res = await authenticatedAxiosInstance.post<TutorCompileEstimate>(
        `${BASE}/compile/estimate`,
        { package_id: packageId, ...options }
    );
    return res.data;
};

export interface TutorCompileEvent {
    type:
        | 'INFO'
        | 'PLAN_STARTED'
        | 'PLAN_READY'
        | 'PLAN_STALE'
        | 'PLAN_SKIPPED'
        | 'PLAN_NEEDS_DETAILS'
        | 'PLAN_UP_TO_DATE'
        | 'PLAN_IN_PROGRESS'
        | 'PLAN_ERROR'
        | 'ERROR'
        | 'DONE';
    slide_id?: string;
    plan_id?: string;
    message?: string;
    reason?: string;
    error?: string;
    topics?: number;
    concepts?: number;
    total?: number;
    code?: number;
}

/** Per-course Tutor Mode settings (package course_setting key TUTOR_MODE_SETTING). */
export interface TutorModeSetting {
    enabled?: boolean;
    defaultOn?: boolean;
    teacherName?: string;
    ttsProvider?: 'smallest' | 'sarvam' | 'google';
    ttsModel?: string;
    ttsVoice?: string;
    languages?: string[];
    sessionLanguage?: 'course' | 'learner';
    llmModel?: string;
    compileModel?: string;
    strictness?: 'gentle' | 'normal' | 'strict';
    /** Let the compiler generate AI images (about 1 credit each plus tokens; at most 4 per slide). */
    generateImages?: boolean;
    /** Knowledge base the course was grounded on at creation; recompiles stay grounded. */
    kbGrounding?: { knowledge_base_id: string; mode?: 'STRICT' | 'BLENDED' } | null;
    /** Teacher voice speed, 0.7–1.3 (1 = the engine's natural pace). Learners can still ask for slower/faster. */
    voicePace?: number;
    /** Media file id of the teacher's face; blank = the built-in illustrated face. */
    teacherAvatarFileId?: string;
    /** Premium: an animated teacher avatar (Spatius) built from the face photo. */
    avatarProvider?: 'none' | 'spatius';
    avatarId?: string;
}

/** A registered teacher asset: platform stock (stock=true) or this institute's own. */
export interface TutorAsset {
    id: string;
    kind: 'voice' | 'avatar';
    provider: string;
    external_id: string | null;
    display_name: string;
    status: 'requested' | 'processing' | 'ready' | 'failed' | 'disabled';
    stock: boolean;
    gender?: string | null;
    languages?: string[];
    preview_url?: string | null;
    credits_charged?: number;
    error?: string | null;
    created_at?: string;
}

export interface TutorAvatarRequestStatus {
    asset_id: string;
    status: TutorAsset['status'];
    avatar_id: string | null;
    error: string | null;
    display_name: string;
    credits_charged: number;
}

/** Ask for a custom avatar built from the teacher's photo (consent confirmed in the UI). */
export const requestTutorAvatar = async (
    fileId: string,
    name?: string
): Promise<TutorAvatarRequestStatus> => {
    const res = await authenticatedAxiosInstance.post<TutorAvatarRequestStatus>(
        `${BASE}/avatar/create`,
        { file_id: fileId, name, consent: true }
    );
    optionsCache = null;
    return res.data;
};

export const getTutorAvatarRequest = async (assetId: string): Promise<TutorAvatarRequestStatus> => {
    const res = await authenticatedAxiosInstance.get<TutorAvatarRequestStatus>(
        `${BASE}/avatar/assets/${assetId}`
    );
    if (res.data.status === 'ready') optionsCache = null;
    return res.data;
};

/** Voices and avatars this institute may use (platform stock + its own). */
export const listTutorAssets = async (kind?: 'voice' | 'avatar'): Promise<TutorAsset[]> => {
    const res = await authenticatedAxiosInstance.get<{ assets: TutorAsset[] }>(`${BASE}/assets`, {
        params: kind ? { kind } : undefined,
    });
    return res.data.assets;
};

/** Stop using one of this institute's own voices or avatars. */
export const disableTutorAsset = async (assetId: string): Promise<void> => {
    await authenticatedAxiosInstance.delete(`${BASE}/assets/${assetId}`);
    optionsCache = null;
};

/** Voice speed choices offered in both Tutor Mode cards. */
export const TUTOR_VOICE_PACES: Array<{ value: number; label: string }> = [
    { value: 0.8, label: 'Slower (0.8×)' },
    { value: 0.9, label: 'A little slower (0.9×)' },
    { value: 1.0, label: 'Normal (1×)' },
    { value: 1.1, label: 'A little faster (1.1×)' },
    { value: 1.25, label: 'Faster (1.25×)' },
];

export const TUTOR_MODE_SETTING_KEY = 'TUTOR_MODE_SETTING';

/** Voice providers the runtime can speak with today; Smallest.ai lands with the browser path (WP7). */
export const TUTOR_TTS_PROVIDERS: Array<{
    value: NonNullable<TutorModeSetting['ttsProvider']>;
    label: string;
}> = [
    { value: 'smallest', label: 'Smallest.ai (voice cloning)' },
    { value: 'sarvam', label: 'Sarvam' },
    { value: 'google', label: 'Google' },
];

/** Clone a teacher's voice from a 5-15 s sample; returns the Smallest.ai voice id. */
export const cloneTutorVoice = async (
    file: File,
    displayName: string
): Promise<{ voice_id: string; asset_id?: string; credits_charged?: number }> => {
    const form = new FormData();
    form.append('file', file);
    form.append('display_name', displayName);
    form.append('consent', 'true');
    const res = await authenticatedAxiosInstance.post<{ voice_id: string; asset_id?: string; credits_charged?: number }>(
        `${BASE}/voice/clone`,
        form,
        {
            headers: { 'Content-Type': 'multipart/form-data' },
        }
    );
    optionsCache = null;
    return res.data;
};

/**
 * Institute-wide Tutor Mode defaults (institute setting key TUTOR_MODE_SETTING).
 * saveInstituteSettingKey stores { data: {...} }; both shapes are tolerated.
 * Resolves to null when the key was never saved.
 */
export const getInstituteTutorDefaults = async (): Promise<TutorModeSetting | null> => {
    const instituteId = getInstituteId();
    if (!instituteId) return null;
    const res = await authenticatedAxiosInstance.get<
        { data?: TutorModeSetting } | TutorModeSetting | null
    >(GET_INSTITUTE_SETTING_DATA, { params: { instituteId, settingKey: TUTOR_MODE_SETTING_KEY } });
    const raw = res.data;
    const data =
        raw && typeof raw === 'object' && 'data' in raw
            ? (raw as { data?: TutorModeSetting }).data
            : (raw as TutorModeSetting | null);
    return data && typeof data === 'object' ? data : null;
};

export const getTutorPlans = async (packageId: string): Promise<TutorPackagePlans> => {
    const res = await authenticatedAxiosInstance.get<TutorPackagePlans>(
        `${BASE}/packages/${packageId}/plans`
    );
    return res.data;
};

export const getTutorSlidePlan = async (
    slideId: string,
    latest = false
): Promise<TutorPlanView> => {
    const res = await authenticatedAxiosInstance.get<TutorPlanView>(
        `${BASE}/slides/${slideId}/plan`,
        {
            params: latest ? { latest: true } : undefined,
        }
    );
    return res.data;
};

export const putTutorSourceDescription = async (
    slideId: string,
    description: string
): Promise<{ slide_id: string; plan_id: string; status: string }> => {
    const res = await authenticatedAxiosInstance.put(
        `${BASE}/slides/${slideId}/source-description`,
        {
            description,
        }
    );
    return res.data;
};

const authHeaders = (): Record<string, string> => {
    const token = getTokenFromCookie(TokenKey.accessToken) || '';
    const instituteId = getCurrentInstituteId() || '';
    return {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        Authorization: `Bearer ${token}`,
        clientId: instituteId,
    };
};

/**
 * Read a `data:` SSE stream with fetch. Resolves when the server sends DONE or
 * closes; rejects on a non-2xx status (402 = not enough credits, 403 = not
 * staff) with the server's detail message.
 */
async function readSse(
    url: string,
    body: unknown,
    onEvent: (ev: TutorCompileEvent) => void,
    signal?: AbortSignal
): Promise<void> {
    const res = await fetch(url, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(body ?? {}),
        signal,
    });
    if (!res.ok || !res.body) {
        let detail = `HTTP ${res.status}`;
        try {
            const j = await res.json();
            detail = j?.detail || j?.message || detail;
        } catch {
            /* body was not JSON */
        }
        throw new Error(detail);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, idx).trimEnd();
            buffer = buffer.slice(idx + 1);
            if (!line.startsWith('data:')) continue;
            try {
                onEvent(JSON.parse(line.slice(5).trim()) as TutorCompileEvent);
            } catch {
                /* keepalive or partial frame */
            }
        }
    }
}

export const compileTutorPlans = (
    packageId: string,
    options: TutorCompileOptions & { slide_ids?: string[]; force?: boolean },
    onEvent: (ev: TutorCompileEvent) => void,
    signal?: AbortSignal
): Promise<void> =>
    readSse(`${BASE}/compile`, { package_id: packageId, ...options }, onEvent, signal);

export const recompileTutorSlide = (
    slideId: string,
    options: TutorCompileOptions,
    onEvent: (ev: TutorCompileEvent) => void,
    signal?: AbortSignal
): Promise<void> => readSse(`${BASE}/slides/${slideId}/recompile`, options, onEvent, signal);

export const newCompileRunId = (): string =>
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `run-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

// ── option catalogues (voices per provider, models) ──────────────────────────

export interface TutorVoiceOption {
    id: string;
    name: string;
    gender?: 'male' | 'female' | null;
    languages?: string[];
    age?: string | null;
    accent?: string | null;
    /** This institute's own cloned voice (never another institute's). */
    cloned?: boolean;
    stock?: boolean;
    asset_id?: string;
}

export interface TutorModelOption {
    model_id: string;
    name: string;
    provider: string;
    tier?: string | null;
    is_free?: boolean;
}

export interface TutorOptions {
    voices: Record<string, TutorVoiceOption[]>;
    models: TutorModelOption[];
    smallest_available: boolean;
    /** The premium teacher avatar (Spatius) is configured on the server. */
    avatar_available?: boolean;
    /** Avatars this institute may use: platform stock + its own (any status). */
    avatars?: TutorAsset[];
    /** Credit rates that matter on the settings cards. */
    fees?: { voice: number; avatar: number; avatar_minute: number; live_minute: number };
}

let optionsCache: { at: number; value: TutorOptions } | null = null;

/** Voices per provider and chat-capable models for the settings dropdowns (cached for the session). */
export const getTutorOptions = async (): Promise<TutorOptions> => {
    if (optionsCache && Date.now() - optionsCache.at < 10 * 60 * 1000) return optionsCache.value;
    const res = await authenticatedAxiosInstance.get<TutorOptions>(`${BASE}/options`);
    optionsCache = { at: Date.now(), value: res.data };
    return res.data;
};

// ── teacher insights ─────────────────────────────────────────────────────────

export interface TutorInsights {
    package_id: string | null;
    package_session_id: string | null;
    days: number;
    batches: Array<{ package_session_id: string; name: string; course: string; sessions: number }>;
    totals: {
        sessions: number;
        learners: number;
        minutes: number;
        voice_sessions: number;
        abandoned: number;
        courses: number;
        /** Session-average activeness 0-100 from the learner's opt-in camera; null when none turned it on. */
        activeness?: number | null;
        activeness_sessions?: number;
    };
    courses: Array<{
        package_id: string;
        name: string;
        sessions: number;
        learners: number;
        minutes: number;
        attempts: number;
        avg_score: number | null;
        weak_attempts: number;
        last_active: string | null;
        activeness?: number | null;
        activeness_sessions?: number;
    }>;
    learners: Array<{
        user_id: string;
        name: string | null;
        sessions: number;
        minutes: number;
        attempts: number;
        avg_score: number | null;
        weak_attempts: number;
        last_active: string | null;
        courses: number;
        /** The teacher's latest note about this learner (model-written rolling summary). */
        note: string | null;
        activeness?: number | null;
        activeness_sessions?: number;
    }>;
    concepts: Array<{
        concept_id: string;
        concept: string;
        topic: string;
        slide: string;
        slide_id: string;
        course: string;
        attempts: number;
        learners: number;
        avg_score: number | null;
        weak_attempts: number;
        weak_learners: number;
        cleared_learners: number;
        misconceptions: string[];
    }>;
}

export interface TutorInsightsParams {
    /** One course; omit for the whole institute. */
    packageId?: string;
    packageSessionId?: string;
    days?: number;
}

const insightsQuery = (params: TutorInsightsParams) => ({
    package_id: params.packageId || undefined,
    package_session_id: params.packageSessionId || undefined,
    days: params.days ?? 90,
});

export const getTutorInsights = async (
    params: TutorInsightsParams = {}
): Promise<TutorInsights> => {
    const res = await authenticatedAxiosInstance.get<TutorInsights>(`${BASE}/insights`, {
        params: insightsQuery(params),
    });
    return res.data;
};

export type TutorInsightsSheet = 'learners' | 'concepts' | 'courses';

/** Downloads one insights sheet as CSV (row caps 5000 / 2000 / 500). */
export const downloadTutorInsightsCsv = async (
    sheet: TutorInsightsSheet,
    params: TutorInsightsParams = {}
): Promise<void> => {
    const res = await authenticatedAxiosInstance.get<Blob>(`${BASE}/insights/export.csv`, {
        params: { ...insightsQuery(params), sheet },
        responseType: 'blob',
    });
    const url = URL.createObjectURL(res.data);
    const link = document.createElement('a');
    link.href = url;
    link.download = `tutor-insights-${sheet}-${params.days ?? 90}d.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
};
