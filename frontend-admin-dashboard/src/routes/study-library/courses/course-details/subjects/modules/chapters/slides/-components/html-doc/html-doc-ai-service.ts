import i18next from 'i18next';
import type { TFunction } from 'i18next';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { GENERATE_HTML_DOCUMENT_URL } from '@/constants/urls';
import { getInstituteId } from '@/constants/helper';
import { getTokenFromCookie } from '@/lib/auth/sessionUtility';
import { TokenKey } from '@/constants/auth/tokens';

function requestBody(p: GenerateHtmlParams) {
    const brand =
        p.brand && (p.brand.primaryColor || p.brand.logoUrl || p.brand.name)
            ? {
                  primary_color: p.brand.primaryColor || null,
                  logo_url: p.brand.logoUrl || null,
                  name: p.brand.name || null,
              }
            : null;
    return {
        prompt: p.prompt,
        current_html: p.currentHtml || null,
        brand,
        content_types: p.contentTypes?.length ? p.contentTypes : null,
        key_points: p.keyPoints?.length ? p.keyPoints : null,
        image_urls: p.imageUrls?.length ? p.imageUrls : null,
        reference_file_ids: p.referenceFileIds?.length ? p.referenceFileIds : null,
        institute_id: getInstituteId() || null,
        idempotency_key: p.idempotencyKey || null,
    };
}

/** Content sections the page can include, in order. */
export function buildHtmlContentTypes(t: TFunction) {
    return [
        { key: 'notes', label: t('contentTypes.notes') },
        { key: 'summary', label: t('contentTypes.summary') },
        { key: 'flashcards', label: t('contentTypes.flashcards') },
        { key: 'quiz', label: t('contentTypes.quiz') },
        { key: 'practical_examples', label: t('contentTypes.practicalExamples') },
        { key: 'interactive_games', label: t('contentTypes.interactiveGames') },
    ] as const;
}

export type BrandKit = {
    primaryColor?: string;
    logoUrl?: string;
    name?: string;
};

export type GenerateHtmlParams = {
    /** What the document should be (create) or how to change it (edit). */
    prompt: string;
    /** When present, this is an EDIT: apply the prompt to this existing HTML. */
    currentHtml?: string | null;
    /** Institute brand kit for a consistent look. */
    brand?: BrandKit | null;
    /** Sections to include (create), e.g. ['notes','quiz']. */
    contentTypes?: string[];
    /** Optional key points/topics the page must cover. */
    keyPoints?: string[];
    /** Uploaded image URLs to embed. */
    imageUrls?: string[];
    /** Uploaded PDF file ids — grounded via MathPix. */
    referenceFileIds?: string[];
    /** Dedup key so a retry can't double-charge credits. */
    idempotencyKey?: string;
};

/**
 * Ask ai-service to generate (or edit) the creative, self-contained HTML for an
 * HTML Document slide. Returns the raw HTML string to store in
 * document_slide.data and render inside the sandboxed iframe preview.
 */
export async function generateHtmlDocument({
    prompt,
    currentHtml,
    contentTypes,
    keyPoints,
    imageUrls,
    referenceFileIds,
    idempotencyKey,
}: GenerateHtmlParams): Promise<string> {
    const res = await authenticatedAxiosInstance.post<{ html: string; model: string }>(
        GENERATE_HTML_DOCUMENT_URL,
        requestBody({
            prompt,
            currentHtml,
            contentTypes,
            keyPoints,
            imageUrls,
            referenceFileIds,
            idempotencyKey,
        }),
        // Grounding + a rich page can take a while; give it room.
        { timeout: 180000 }
    );
    const html = res.data?.html || '';
    if (!html.trim())
        throw new Error(i18next.t('studyLibraryHtmlDocAiService:errors.emptyDocument'));
    return html;
}

export type StreamHandlers = {
    /** Called with the accumulated HTML so far as tokens arrive. */
    onDelta?: (accumulated: string) => void;
    /**
     * Progress of the illustration pass that runs after the text is written
     * (the page's textbook images are generated, then patched into the final
     * document). `completed` of `total` pictures are done.
     */
    onImageProgress?: (completed: number, total: number) => void;
    /** Abort to cancel generation. */
    signal?: AbortSignal;
};

/**
 * Streaming variant — the page HTML arrives token-by-token (SSE) so the author
 * watches it build live and can cancel. Resolves with the final HTML.
 */
export async function generateHtmlDocumentStream(
    params: GenerateHtmlParams,
    { onDelta, onImageProgress, signal }: StreamHandlers = {}
): Promise<string> {
    // NOTE: this uses raw fetch (SSE), so it must replicate what
    // authenticatedAxiosInstance injects — crucially the `clientId` header:
    // ai-service verifies the user against the Auth Service using
    // `${clientId}@${username}`, so without it auth fails ("Could not validate
    // credentials"). Bearer + clientId together mirror the axios interceptor.
    const token = getTokenFromCookie(TokenKey.accessToken);
    const instituteId = getInstituteId();
    const res = await fetch(`${GENERATE_HTML_DOCUMENT_URL}/stream`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(instituteId ? { clientId: instituteId } : {}),
        },
        body: JSON.stringify(requestBody(params)),
        signal,
    });
    if (!res.ok || !res.body) {
        let detail = i18next.t('studyLibraryHtmlDocAiService:errors.requestFailed', {
            status: res.status,
        });
        try {
            const j = await res.json();
            detail = j?.detail || detail;
        } catch {
            /* non-JSON error body */
        }
        throw new Error(detail);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let acc = '';
    let finalHtml = '';
    let errorDetail = '';

    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split('\n\n');
        buffer = events.pop() || '';
        for (const evt of events) {
            const line = evt.split('\n').find((l) => l.startsWith('data:'));
            if (!line) continue;
            let obj: {
                delta?: string;
                done?: boolean;
                html?: string;
                error?: string;
                status?: string;
                completed?: number;
                total?: number;
            };
            try {
                obj = JSON.parse(line.slice(5).trim());
            } catch {
                continue;
            }
            if (obj.delta) {
                acc += obj.delta;
                onDelta?.(acc);
            } else if (obj.status === 'images') {
                onImageProgress?.(obj.completed ?? 0, obj.total ?? 0);
            } else if (obj.done) {
                finalHtml = obj.html || acc;
            } else if (obj.error) {
                errorDetail = obj.error;
            }
        }
    }

    if (errorDetail) throw new Error(errorDetail);
    const html = finalHtml || acc;
    if (!html.trim())
        throw new Error(i18next.t('studyLibraryHtmlDocAiService:errors.emptyDocument'));
    return html;
}

// ---------------------------------------------------------------------------
// Background jobs — generation keeps running on the server if the author
// leaves the page or closes the tab; the editor polls for progress and, when
// they come back to the slide, re-attaches and applies the finished page.
// ---------------------------------------------------------------------------

export type HtmlDocJobPhase = 'reading_pdf' | 'planning' | 'writing' | 'images';

export type HtmlDocJob = {
    task_id: string;
    slide_id: string;
    /** INTERRUPTED = the server stopped heartbeating (deploy/restart) — offer a retry. */
    status: 'PROGRESS' | 'COMPLETED' | 'FAILED' | 'CANCELLED' | 'INTERRUPTED';
    progress: {
        phase?: HtmlDocJobPhase;
        section?: string;
        content_chars?: number;
        images_done?: number;
        images_total?: number;
        is_edit?: boolean;
        has_pdf?: boolean;
        /** Parallel mode: sections are written at the same time. */
        sections_total?: number | null;
        sections_done?: number | null;
        /** Rough final size (edits: the current page's length) for the progress bar. */
        expected_chars?: number | null;
    };
    /** Tail of the page after `since` while running; the full page when COMPLETED. */
    html: string;
    html_length: number;
    error: string;
    is_edit: boolean;
    elapsed_seconds: number;
};

const JOBS_URL = `${GENERATE_HTML_DOCUMENT_URL.replace(/\/generate$/, '')}/jobs`;

export async function startHtmlDocJob(
    params: GenerateHtmlParams & { slideId: string }
): Promise<HtmlDocJob> {
    const res = await authenticatedAxiosInstance.post<HtmlDocJob>(JOBS_URL, {
        ...requestBody(params),
        slide_id: params.slideId,
    });
    return res.data;
}

export async function pollHtmlDocJob(taskId: string, since: number): Promise<HtmlDocJob> {
    const res = await authenticatedAxiosInstance.get<HtmlDocJob>(`${JOBS_URL}/${taskId}`, {
        params: { since },
    });
    return res.data;
}

export async function getActiveHtmlDocJob(slideId: string): Promise<HtmlDocJob | null> {
    const res = await authenticatedAxiosInstance.get<{ job: HtmlDocJob | null }>(
        `${JOBS_URL}/active`,
        { params: { slide_id: slideId } }
    );
    return res.data?.job ?? null;
}

export async function cancelHtmlDocJob(taskId: string): Promise<void> {
    await authenticatedAxiosInstance.post(`${JOBS_URL}/${taskId}/cancel`);
}

export async function ackHtmlDocJob(taskId: string): Promise<void> {
    await authenticatedAxiosInstance.post(`${JOBS_URL}/${taskId}/ack`);
}
