// Per-institute learner-activity tracking configuration.
//
// Stored under the institute settings blob as key LEARNER_TRACKING_SETTING
// (GenericSettingStrategy on the backend — no backend code involved). Admins
// edit it in Settings → Learner Activity in the admin dashboard. Every value
// here used to be a hardcoded constant scattered across the slide viewers.
//
// Consumption pattern: `loadLearnerTrackingSettings()` is called on app entry
// (and after login) to refresh the localStorage cache; viewers then read
// synchronously via `getLearnerTrackingSettings()` so tracking thresholds are
// available without async plumbing in render paths.
import authenticatedAxiosInstance from "@/lib/auth/axiosInstance";
import { BASE_URL } from "@/constants/urls";
import { getInstituteId } from "@/constants/helper";

export const LEARNER_TRACKING_SETTING_KEY = "LEARNER_TRACKING_SETTING";
const LS_KEY = `${LEARNER_TRACKING_SETTING_KEY}_CACHE_V1`;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export interface LearnerTrackingSettings {
    completion: {
        /** Percentage at which the UI shows a slide/chapter as "done" (green tick). */
        slideCompletionThresholdPercent: number;
    };
    documents: {
        /** Seconds a learner must dwell on a PDF/document page for it to count as viewed. */
        pageDwellSeconds: number;
        /** Seconds a distinct action (Jupyter/Scratch/Code editor) must be held to count. */
        actionDwellSeconds: number;
        /**
         * Content-aware completion for single-page rich-text/HTML documents.
         * Required read time = clamp(wordCount / wordsPerMinute, min, max).
         * Fixes the "one giant HTML page counts as read after 10 seconds"
         * problem without penalising short notes.
         */
        readingTime: {
            enabled: boolean;
            wordsPerMinute: number;
            minSeconds: number;
            maxSeconds: number;
        };
    };
    focus: {
        /**
         * Whether the "are you still there?" check and the pause screen are shown
         * for documents. Off by default: reading without touching the screen, or
         * writing on paper, must not get a learner interrupted. With it off,
         * idle time still stops counting, silently.
         */
        idlePopupEnabled: boolean;
        /** Seconds of inactivity before the check appears. */
        idlePopupDelaySeconds: number;
        /** Minutes of inactivity before tracking hard-pauses regardless of the popup. */
        hardPauseMinutes: number;
    };
}

export const DEFAULT_LEARNER_TRACKING_SETTINGS: LearnerTrackingSettings = {
    completion: {
        slideCompletionThresholdPercent: 80,
    },
    documents: {
        pageDwellSeconds: 10,
        actionDwellSeconds: 5,
        readingTime: {
            enabled: true,
            wordsPerMinute: 200,
            minSeconds: 10,
            maxSeconds: 600,
        },
    },
    focus: {
        idlePopupEnabled: false,
        idlePopupDelaySeconds: 60,
        hardPauseMinutes: 5,
    },
};

type CacheEnvelope = {
    instituteId: string | null;
    fetchedAt: number;
    data: Partial<LearnerTrackingSettings>;
};

const clampNumber = (v: unknown, fallback: number, min: number, max: number) => {
    const n = typeof v === "number" && isFinite(v) ? v : fallback;
    return Math.min(max, Math.max(min, n));
};

export function mergeTrackingSettings(
    partial: Partial<LearnerTrackingSettings> | null | undefined
): LearnerTrackingSettings {
    const d = DEFAULT_LEARNER_TRACKING_SETTINGS;
    const p = partial ?? {};
    return {
        completion: {
            slideCompletionThresholdPercent: clampNumber(
                p.completion?.slideCompletionThresholdPercent,
                d.completion.slideCompletionThresholdPercent,
                1,
                100
            ),
        },
        documents: {
            pageDwellSeconds: clampNumber(
                p.documents?.pageDwellSeconds,
                d.documents.pageDwellSeconds,
                1,
                600
            ),
            actionDwellSeconds: clampNumber(
                p.documents?.actionDwellSeconds,
                d.documents.actionDwellSeconds,
                1,
                600
            ),
            readingTime: {
                enabled:
                    p.documents?.readingTime?.enabled ??
                    d.documents.readingTime.enabled,
                wordsPerMinute: clampNumber(
                    p.documents?.readingTime?.wordsPerMinute,
                    d.documents.readingTime.wordsPerMinute,
                    50,
                    1000
                ),
                minSeconds: clampNumber(
                    p.documents?.readingTime?.minSeconds,
                    d.documents.readingTime.minSeconds,
                    1,
                    3600
                ),
                maxSeconds: clampNumber(
                    p.documents?.readingTime?.maxSeconds,
                    d.documents.readingTime.maxSeconds,
                    10,
                    7200
                ),
            },
        },
        focus: {
            idlePopupEnabled:
                p.focus?.idlePopupEnabled ?? d.focus.idlePopupEnabled,
            idlePopupDelaySeconds: clampNumber(
                p.focus?.idlePopupDelaySeconds,
                d.focus.idlePopupDelaySeconds,
                10,
                3600
            ),
            hardPauseMinutes: clampNumber(
                p.focus?.hardPauseMinutes,
                d.focus.hardPauseMinutes,
                1,
                120
            ),
        },
    };
}

function readCache(): CacheEnvelope | null {
    try {
        const raw = localStorage.getItem(LS_KEY);
        return raw ? (JSON.parse(raw) as CacheEnvelope) : null;
    } catch {
        return null;
    }
}

/**
 * Synchronous accessor for render/tracking paths. Returns the cached
 * institute values merged over defaults; plain defaults before the first
 * successful load.
 */
export function getLearnerTrackingSettings(): LearnerTrackingSettings {
    return mergeTrackingSettings(readCache()?.data);
}

/** The threshold at which the learner UI treats a slide/chapter as complete. */
export function getSlideCompletionThreshold(): number {
    return getLearnerTrackingSettings().completion.slideCompletionThresholdPercent;
}

/**
 * Refreshes the cache from the server. Call on app entry / after login.
 * Never throws — tracking must work offline on cached or default values.
 */
export async function loadLearnerTrackingSettings(
    forceRefresh = false
): Promise<LearnerTrackingSettings> {
    const instituteId = (await getInstituteId()) ?? null;
    const cached = readCache();
    const fresh =
        cached &&
        cached.instituteId === instituteId &&
        Date.now() - cached.fetchedAt < CACHE_TTL_MS;
    if (fresh && !forceRefresh) return mergeTrackingSettings(cached.data);
    if (!instituteId) return mergeTrackingSettings(cached?.data);

    try {
        const res = await authenticatedAxiosInstance.get<{
            data: Partial<LearnerTrackingSettings> | null;
        }>(`${BASE_URL}/admin-core-service/institute/setting/v1/get`, {
            params: {
                instituteId,
                settingKey: LEARNER_TRACKING_SETTING_KEY,
            },
        });
        const data = res.data?.data ?? {};
        const envelope: CacheEnvelope = {
            instituteId,
            fetchedAt: Date.now(),
            data,
        };
        localStorage.setItem(LS_KEY, JSON.stringify(envelope));
        return mergeTrackingSettings(data);
    } catch {
        return mergeTrackingSettings(cached?.data);
    }
}

/**
 * Required read seconds for a document given its visible word count.
 * Single-page rich-text/HTML docs use expected reading time; everything else
 * falls back to the per-page dwell.
 */
export function getRequiredReadSeconds(
    wordCount: number,
    totalPages: number
): number {
    const s = getLearnerTrackingSettings();
    const { readingTime, pageDwellSeconds } = s.documents;
    if (!readingTime.enabled || totalPages > 1 || wordCount <= 0) {
        return pageDwellSeconds;
    }
    const estimated = (wordCount / readingTime.wordsPerMinute) * 60;
    return Math.min(
        readingTime.maxSeconds,
        Math.max(readingTime.minSeconds, Math.round(estimated))
    );
}
