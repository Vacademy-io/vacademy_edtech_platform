/**
 * Client side of the AI usage-limit contract (N3).
 *
 *  - A blocked AI call answers HTTP 429 with `{"error":"AI_USAGE_LIMIT", ...}`
 *    and a Retry-After header. The shared axios instance hands such errors to
 *    `handleAiUsageLimitError`, which opens one modal (feature, used/limit,
 *    reset time, who set it; a link to the Limits tab for admins). The error is
 *    still rejected to the caller, so spinners stop as they do for any failure.
 *    Every other 429 is left alone.
 *  - A successful AI response may carry `X-AI-Usage-Warning: <use_case>;pct=<n>`
 *    (comma-separated when several apply). That becomes a non-blocking toast,
 *    at most once per use case per browser session.
 *
 * Everything here is wrapped so that it can never break the request it rides
 * on: a parse error simply means no modal / no toast.
 */
import i18next from 'i18next';
import { toast } from 'sonner';

export const AI_USAGE_LIMIT_ERROR = 'AI_USAGE_LIMIT';
export const AI_USAGE_WARNING_HEADER = 'x-ai-usage-warning';
export const AI_LIMITS_SETTINGS_PATH = '/settings?selectedTab=aiSettings&aiSection=grp-limits';

const NAMESPACE = 'aiUsageLimit';
const SESSION_KEY = 'vacademy-ai-usage-warnings-shown';

export interface AiUsageLimitBody {
    error: typeof AI_USAGE_LIMIT_ERROR;
    use_case: string | null;
    use_case_label: string | null;
    scope: string | null;
    period: string | null;
    limit: number | null;
    used: number | null;
    unit: string | null;
    resets_at: string | null;
    set_by: string | null;
    message: string | null;
    retry_after_seconds: number | null;
}

export interface AiUsageWarning {
    useCase: string;
    pct: number | null;
}

type Raw = Record<string, unknown>;
const isObj = (v: unknown): v is Raw => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): string | null =>
    v === null || v === undefined || v === '' ? null : String(v);
const numOrNull = (v: unknown): number | null => {
    if (v === null || v === undefined || v === '') return null;
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n : null;
};

/**
 * The N3 body from a response payload, or null when it is not one. Accepts the
 * body at the top level (the FastAPI exception handler) or wrapped in
 * `detail` (an HTTPException raised with the body as its detail).
 */
export function parseAiUsageLimitBody(
    data: unknown,
    retryAfterHeader?: unknown
): AiUsageLimitBody | null {
    let d: unknown = data;
    if (typeof d === 'string') {
        try {
            d = JSON.parse(d);
        } catch {
            return null;
        }
    }
    if (!isObj(d)) return null;
    const body = d.error === AI_USAGE_LIMIT_ERROR ? d : isObj(d.detail) ? d.detail : null;
    if (!body || body.error !== AI_USAGE_LIMIT_ERROR) return null;
    return {
        error: AI_USAGE_LIMIT_ERROR,
        use_case: str(body.use_case),
        use_case_label: str(body.use_case_label),
        scope: str(body.scope),
        period: str(body.period),
        limit: numOrNull(body.limit),
        used: numOrNull(body.used),
        unit: str(body.unit),
        resets_at: str(body.resets_at),
        set_by: str(body.set_by),
        message: str(body.message),
        retry_after_seconds: numOrNull(retryAfterHeader),
    };
}

/** `"tutor_chat;pct=85, lesson_video;pct=92"` → [{useCase, pct}, ...]. */
export function parseUsageWarningHeader(value: unknown): AiUsageWarning[] {
    if (typeof value !== 'string' || !value.trim()) return [];
    const out: AiUsageWarning[] = [];
    for (const part of value.split(',')) {
        const [rawUseCase, ...params] = part.split(';').map((s) => s.trim());
        if (!rawUseCase) continue;
        let pct: number | null = null;
        for (const p of params) {
            const m = /^pct\s*=\s*(\d+(?:\.\d+)?)$/i.exec(p);
            if (m) pct = Math.round(Number(m[1]));
        }
        out.push({ useCase: rawUseCase, pct });
    }
    return out;
}

/** "lesson_video" → "Lesson video" (the header carries the key only). */
export function prettifyUseCase(useCase: string | null | undefined): string {
    if (!useCase) return '';
    const s = useCase.replace(/[_-]+/g, ' ').trim();
    return s.charAt(0).toUpperCase() + s.slice(1);
}

// ---- once-per-session warning toasts ----

const shownWarnings = new Set<string>();
let sessionLoaded = false;

function loadShownWarnings() {
    if (sessionLoaded) return;
    sessionLoaded = true;
    try {
        const raw = window.sessionStorage.getItem(SESSION_KEY);
        const list = raw ? (JSON.parse(raw) as unknown) : [];
        if (Array.isArray(list)) list.forEach((k) => typeof k === 'string' && shownWarnings.add(k));
    } catch {
        // storage unavailable: the in-memory set still de-duplicates this tab
    }
}

function rememberWarning(useCase: string) {
    shownWarnings.add(useCase);
    try {
        window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(Array.from(shownWarnings)));
    } catch {
        // ignore
    }
}

/** Test hook: forget which warnings were shown. */
export function resetAiUsageWarningsForTests() {
    shownWarnings.clear();
    sessionLoaded = false;
    try {
        window.sessionStorage.removeItem(SESSION_KEY);
    } catch {
        // ignore
    }
}

function translate(key: string, options: Record<string, unknown>, fallback: string): string {
    try {
        const out = i18next.t(`${NAMESPACE}:${key}`, options);
        return typeof out === 'string' && out && out !== key ? out : fallback;
    } catch {
        return fallback;
    }
}

function showWarningToast(w: AiUsageWarning) {
    const feature = prettifyUseCase(w.useCase);
    const fallback =
        w.pct !== null
            ? `You have used ${w.pct}% of the AI limit for ${feature}.`
            : `You are close to the AI limit for ${feature}.`;
    const message =
        w.pct !== null
            ? translate('warning.withPct', { feature, pct: w.pct }, fallback)
            : translate('warning.noPct', { feature }, fallback);
    toast.warning(message, {
        id: `ai-usage-warning-${w.useCase}`,
        description: translate('warning.description', {}, ''),
        duration: 8000,
    });
}

/**
 * Success-path hook: reads X-AI-Usage-Warning and toasts each use case once
 * per session. Never throws.
 */
export function handleAiUsageWarningResponse(headers: unknown): void {
    try {
        if (!headers || typeof headers !== 'object') return;
        const h = headers as Record<string, unknown> & { get?: (k: string) => unknown };
        const value =
            h[AI_USAGE_WARNING_HEADER] ??
            (typeof h.get === 'function' ? h.get(AI_USAGE_WARNING_HEADER) : undefined);
        const warnings = parseUsageWarningHeader(value);
        if (!warnings.length) return;
        loadShownWarnings();
        const fresh = warnings.filter((w) => !shownWarnings.has(w.useCase));
        if (!fresh.length) return;
        fresh.forEach((w) => rememberWarning(w.useCase));
        const show = () => {
            try {
                fresh.forEach(showWarningToast);
            } catch {
                // ignore
            }
        };
        // Dev serves catalogs lazily; make sure the namespace is there first.
        Promise.resolve(i18next.loadNamespaces?.(NAMESPACE))
            .catch(() => undefined)
            .then(show, show);
    } catch {
        // ignore
    }
}

async function readBody(data: unknown): Promise<unknown> {
    if (typeof Blob !== 'undefined' && data instanceof Blob) {
        try {
            return JSON.parse(await data.text());
        } catch {
            return null;
        }
    }
    return data;
}

/**
 * Error-path hook. Returns the parsed body when the error was an
 * AI_USAGE_LIMIT 429 (after opening the modal), else null. Never throws, and
 * never changes anything about other 429s.
 */
export async function handleAiUsageLimitError(error: unknown): Promise<AiUsageLimitBody | null> {
    try {
        const response = (
            error as { response?: { status?: number; data?: unknown; headers?: unknown } }
        )?.response;
        if (response?.status !== 429) return null;
        const headers = isObj(response.headers) ? response.headers : {};
        const body = parseAiUsageLimitBody(await readBody(response.data), headers['retry-after']);
        if (!body) return null;
        try {
            // Callers that surface `err.message` get the server's sentence.
            if (body.message && error && typeof error === 'object') {
                (error as { message?: string }).message = body.message;
            }
            (error as { aiUsageLimit?: AiUsageLimitBody }).aiUsageLimit = body;
        } catch {
            // ignore
        }
        void import('@/components/common/ai-usage-limit/AiUsageLimitDialog')
            .then((m) => m.openAiUsageLimitDialog(body))
            .catch(() => undefined);
        return body;
    } catch {
        return null;
    }
}
