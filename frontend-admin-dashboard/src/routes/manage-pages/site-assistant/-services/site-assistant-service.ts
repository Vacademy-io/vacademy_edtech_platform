import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { AI_SERVICE_BASE_URL } from '@/constants/urls';
import { normalizeCards, type SiteAssistantCard } from '../-utils/cards';
import { readSiteAssistantStream, type SiteAssistantStreamEvent } from '../-utils/sse';

/**
 * Site Assistant staff API (ai_service, SPEC §4.6) and the admin preview chat
 * (SPEC §4.1). Staff calls go through authenticatedAxiosInstance, which adds
 * the staff JWT and the institute `clientId`: the server takes the institute
 * from those, never from a parameter. The preview's message stream is read
 * with fetch and the preview session's own token (SPEC §4.1: every later call
 * needs `Bearer <session token>`).
 *
 *   GET/POST   /admin/knowledge?site_tag=&kind=      PUT/DELETE /admin/knowledge/{id}
 *   GET        /admin/conversations?site_tag=&lead=&page=&size=   GET /admin/conversations/{id}
 *   GET        /admin/unanswered?site_tag=&days=30
 *   GET        /admin/status?site_tag=               POST /admin/reindex?site_tag=
 *   POST       /sessions (staff JWT = preview)      POST /sessions/{id}/messages (SSE)
 *
 * Responses are snake_case and read defensively (a bare array or a wrapper),
 * so a field the server leaves out shows as empty rather than breaking a tab.
 */
export const SITE_ASSISTANT_BASE = `${AI_SERVICE_BASE_URL}/site-assistant/v1`;
export const SITE_ASSISTANT_QUERY_KEY = 'SITE_ASSISTANT';

type Raw = Record<string, unknown>;
const isObject = (v: unknown): v is Raw => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (row: Raw, ...keys: string[]): string | null => {
    for (const key of keys) {
        const v = row[key];
        if (typeof v === 'string' && v.trim() !== '') return v;
        if (typeof v === 'number') return String(v);
    }
    return null;
};
const num = (row: Raw, ...keys: string[]): number | null => {
    for (const key of keys) {
        const v = row[key];
        if (typeof v === 'number' && Number.isFinite(v)) return v;
        if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)))
            return Number(v);
    }
    return null;
};
/** A bare array, or the first array under one of the usual wrapper keys. */
const rowsOf = (data: unknown, ...keys: string[]): Raw[] => {
    if (Array.isArray(data)) return data.filter(isObject);
    if (!isObject(data)) return [];
    for (const key of [...keys, 'items', 'data', 'content', 'results']) {
        if (Array.isArray(data[key])) return (data[key] as unknown[]).filter(isObject);
    }
    return [];
};

// ── Knowledge: FAQs and notices ──────────────────────────────────────────────

export type KnowledgeKind = 'FAQ' | 'NOTICE';

export interface KnowledgeItem {
    id: string;
    kind: KnowledgeKind;
    /** null = shared by every site of the institute. */
    siteTag: string | null;
    /** FAQ question / notice title. */
    title: string;
    /** FAQ answer / notice text. */
    body: string;
    active: boolean;
    startsAt: string | null;
    endsAt: string | null;
    updatedAt: string | null;
}

export function normalizeKnowledgeItem(raw: unknown): KnowledgeItem | null {
    if (!isObject(raw)) return null;
    const id = str(raw, 'id');
    if (!id) return null;
    return {
        id,
        kind: str(raw, 'kind')?.toUpperCase() === 'NOTICE' ? 'NOTICE' : 'FAQ',
        siteTag: str(raw, 'site_tag'),
        title: str(raw, 'title', 'question') ?? '',
        body: str(raw, 'body', 'answer') ?? '',
        active: raw.active !== false,
        startsAt: str(raw, 'starts_at'),
        endsAt: str(raw, 'ends_at'),
        updatedAt: str(raw, 'updated_at', 'created_at'),
    };
}

export interface KnowledgeInput {
    kind: KnowledgeKind;
    title: string;
    body: string;
    active: boolean;
    /** true = every site of the institute (site_tag null). */
    allSites: boolean;
    /** yyyy-mm-dd from a date input; empty = no start / no end. */
    startDate: string;
    endDate: string;
}

export const MAX_KNOWLEDGE_TITLE = 300;
export const MAX_KNOWLEDGE_BODY = 4000;

export type KnowledgeInputError =
    | 'title_required'
    | 'title_too_long'
    | 'body_required'
    | 'body_too_long'
    | 'date_invalid'
    | 'end_before_start';

export const KNOWLEDGE_ERROR_TEXT: Record<KnowledgeInputError, string> = {
    title_required: 'Write the question (or the notice title).',
    title_too_long: `Keep the question under ${MAX_KNOWLEDGE_TITLE} characters.`,
    body_required: 'Write the answer (or the notice text).',
    body_too_long: `Keep the answer under ${MAX_KNOWLEDGE_BODY} characters.`,
    date_invalid: 'One of the dates is not a real date.',
    end_before_start: 'The end date is before the start date.',
};

/** Local calendar day → ISO instant: the start of the start day, the end of the end day. */
const dayToIso = (day: string, end: boolean): string | null => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day.trim());
    if (!m) return null;
    const date = end
        ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59, 999)
        : new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0, 0);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

/** ISO instant → yyyy-mm-dd in local time, for the date inputs. */
export const isoToDay = (iso: string | null | undefined): string => {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

export const validateKnowledgeInput = (input: KnowledgeInput): KnowledgeInputError | null => {
    const title = input.title.trim();
    const body = input.body.trim();
    if (!title) return 'title_required';
    if (title.length > MAX_KNOWLEDGE_TITLE) return 'title_too_long';
    if (!body) return 'body_required';
    if (body.length > MAX_KNOWLEDGE_BODY) return 'body_too_long';
    const start = input.startDate.trim() ? dayToIso(input.startDate, false) : null;
    const end = input.endDate.trim() ? dayToIso(input.endDate, true) : null;
    if ((input.startDate.trim() && !start) || (input.endDate.trim() && !end)) return 'date_invalid';
    if (start && end && end < start) return 'end_before_start';
    return null;
};

export interface KnowledgePayload {
    site_tag: string | null;
    kind: KnowledgeKind;
    title: string;
    body: string;
    active: boolean;
    starts_at: string | null;
    ends_at: string | null;
}

/** Form → POST/PUT body. Throws the KnowledgeInputError code when the form is not valid. */
export function buildKnowledgePayload(siteTag: string, input: KnowledgeInput): KnowledgePayload {
    const error = validateKnowledgeInput(input);
    if (error) throw new Error(error);
    return {
        site_tag: input.allSites ? null : siteTag,
        kind: input.kind,
        title: input.title.trim(),
        body: input.body.trim(),
        active: input.active,
        starts_at: input.startDate.trim() ? dayToIso(input.startDate, false) : null,
        ends_at: input.endDate.trim() ? dayToIso(input.endDate, true) : null,
    };
}

export const knowledgeToInput = (item: KnowledgeItem): KnowledgeInput => ({
    kind: item.kind,
    title: item.title,
    body: item.body,
    active: item.active,
    allSites: item.siteTag === null,
    startDate: isoToDay(item.startsAt),
    endDate: isoToDay(item.endsAt),
});

/** This site's FAQs/notices and the ones shared by every site. */
export const fetchKnowledge = async (
    siteTag: string,
    kind?: KnowledgeKind
): Promise<KnowledgeItem[]> => {
    const { data } = await authenticatedAxiosInstance.get(
        `${SITE_ASSISTANT_BASE}/admin/knowledge`,
        {
            params: kind ? { site_tag: siteTag, kind } : { site_tag: siteTag },
        }
    );
    return rowsOf(data, 'knowledge')
        .map(normalizeKnowledgeItem)
        .filter((k): k is KnowledgeItem => !!k);
};

export const createKnowledge = async (
    siteTag: string,
    input: KnowledgeInput
): Promise<KnowledgeItem | null> => {
    const { data } = await authenticatedAxiosInstance.post(
        `${SITE_ASSISTANT_BASE}/admin/knowledge`,
        buildKnowledgePayload(siteTag, input)
    );
    return normalizeKnowledgeItem(data);
};

export const updateKnowledge = async (
    siteTag: string,
    id: string,
    input: KnowledgeInput
): Promise<KnowledgeItem | null> => {
    const { data } = await authenticatedAxiosInstance.put(
        `${SITE_ASSISTANT_BASE}/admin/knowledge/${encodeURIComponent(id)}`,
        buildKnowledgePayload(siteTag, input)
    );
    return normalizeKnowledgeItem(data);
};

export const deleteKnowledge = async (id: string): Promise<void> => {
    await authenticatedAxiosInstance.delete(
        `${SITE_ASSISTANT_BASE}/admin/knowledge/${encodeURIComponent(id)}`
    );
};

// ── Conversations ────────────────────────────────────────────────────────────

export type LeadStatus = 'SALES' | 'SUPPORT';
export type LeadFilter = 'ALL' | LeadStatus;
export type Channel = 'HOSTED' | 'EMBED' | 'PREVIEW';

const lead = (v: string | null): LeadStatus | null => {
    const s = (v ?? '').toUpperCase();
    return s === 'SALES' || s === 'SUPPORT' ? s : null;
};
const channel = (v: string | null): Channel => {
    const s = (v ?? '').toUpperCase();
    return s === 'EMBED' || s === 'PREVIEW' ? s : 'HOSTED';
};
/** The started page as stored (text or a {url, route, title} object). */
const pageLabel = (v: unknown): string | null => {
    if (typeof v === 'string') return v.trim() || null;
    if (isObject(v)) return str(v, 'title', 'route', 'url');
    return null;
};

export interface ConversationSummary {
    id: string;
    channel: Channel;
    startedAt: string | null;
    lastActiveAt: string | null;
    startedPage: string | null;
    messageCount: number;
    leadStatus: LeadStatus | null;
    thumbsUp: number;
    thumbsDown: number;
    preview: string | null;
}

export interface ConversationPage {
    items: ConversationSummary[];
    total: number;
    /** Zero-indexed. */
    page: number;
    size: number;
    totalPages: number;
}

export function normalizeConversation(raw: unknown): ConversationSummary | null {
    if (!isObject(raw)) return null;
    const id = str(raw, 'id', 'conversation_id');
    if (!id) return null;
    return {
        id,
        channel: channel(str(raw, 'channel')),
        startedAt: str(raw, 'created_at', 'started_at'),
        lastActiveAt: str(raw, 'last_active_at'),
        startedPage: pageLabel(raw.started_page ?? raw.page),
        messageCount: num(raw, 'message_count') ?? 0,
        leadStatus: lead(str(raw, 'lead_status')),
        thumbsUp: num(raw, 'thumbs_up', 'feedback_up') ?? 0,
        thumbsDown: num(raw, 'thumbs_down', 'feedback_down') ?? 0,
        preview: str(raw, 'first_message', 'preview', 'first_question'),
    };
}

export function normalizeConversationPage(
    data: unknown,
    page: number,
    size: number
): ConversationPage {
    const items = rowsOf(data, 'conversations')
        .map(normalizeConversation)
        .filter((c): c is ConversationSummary => !!c);
    const obj = isObject(data) ? data : {};
    const total = num(obj, 'total', 'total_elements', 'totalElements') ?? items.length;
    const pageSize = num(obj, 'size', 'page_size') ?? size;
    const totalPages =
        num(obj, 'total_pages', 'totalPages') ??
        Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
    return { items, total, page: num(obj, 'page', 'number') ?? page, size: pageSize, totalPages };
}

export const fetchConversations = async (params: {
    siteTag: string;
    lead: LeadFilter;
    page: number;
    size: number;
}): Promise<ConversationPage> => {
    const { data } = await authenticatedAxiosInstance.get(
        `${SITE_ASSISTANT_BASE}/admin/conversations`,
        {
            params: {
                site_tag: params.siteTag,
                ...(params.lead !== 'ALL' ? { lead: params.lead } : {}),
                page: params.page,
                size: params.size,
            },
        }
    );
    return normalizeConversationPage(data, params.page, params.size);
};

export interface TranscriptMessage {
    id: string;
    role: 'user' | 'assistant' | 'tool';
    content: string;
    cards: SiteAssistantCard[];
    answered: boolean | null;
    feedback: 1 | -1 | null;
    createdAt: string | null;
}

export interface ConversationDetail extends ConversationSummary {
    messages: TranscriptMessage[];
}

export function normalizeMessage(raw: unknown, index: number): TranscriptMessage | null {
    if (!isObject(raw)) return null;
    const roleRaw = (str(raw, 'role') ?? '').toLowerCase();
    const role = roleRaw === 'user' || roleRaw === 'tool' ? roleRaw : 'assistant';
    const feedback = num(raw, 'feedback');
    return {
        id: str(raw, 'id') ?? `m-${index}`,
        role,
        content: typeof raw.content === 'string' ? raw.content : '',
        cards: normalizeCards(raw.cards),
        answered: typeof raw.answered === 'boolean' ? raw.answered : null,
        feedback: feedback === 1 || feedback === -1 ? feedback : null,
        createdAt: str(raw, 'created_at'),
    };
}

export const fetchConversation = async (id: string): Promise<ConversationDetail> => {
    const { data } = await authenticatedAxiosInstance.get(
        `${SITE_ASSISTANT_BASE}/admin/conversations/${encodeURIComponent(id)}`
    );
    const obj: Raw =
        isObject(data) && isObject(data.conversation)
            ? data.conversation
            : isObject(data)
              ? data
              : {};
    const summary = normalizeConversation({ id, ...obj });
    const messages = rowsOf(isObject(data) ? data.messages ?? obj.messages : [], 'messages')
        .map(normalizeMessage)
        .filter((m): m is TranscriptMessage => !!m);
    return { ...(summary as ConversationSummary), messages };
};

// ── Unanswered ───────────────────────────────────────────────────────────────

export interface UnansweredGroup {
    question: string;
    count: number;
    lastAskedAt: string | null;
    /** Other ways visitors asked the same thing. */
    examples: string[];
}

export function normalizeUnanswered(data: unknown): UnansweredGroup[] {
    return rowsOf(data, 'groups', 'questions')
        .map((r) => {
            const question = str(r, 'question', 'text', 'sample');
            if (!question) return null;
            const examples = Array.isArray(r.examples ?? r.variants)
                ? ((r.examples ?? r.variants) as unknown[]).filter(
                      (x): x is string => typeof x === 'string' && x !== question
                  )
                : [];
            return {
                question,
                count: num(r, 'count', 'times') ?? 1,
                lastAskedAt: str(r, 'last_asked_at', 'last_asked'),
                examples,
            };
        })
        .filter((g): g is UnansweredGroup => !!g)
        .sort((a, b) => b.count - a.count);
}

export const fetchUnanswered = async (siteTag: string, days = 30): Promise<UnansweredGroup[]> => {
    const { data } = await authenticatedAxiosInstance.get(
        `${SITE_ASSISTANT_BASE}/admin/unanswered`,
        {
            params: { site_tag: siteTag, days },
        }
    );
    return normalizeUnanswered(data);
};

// ── Status ───────────────────────────────────────────────────────────────────

export type IndexStatus = 'READY' | 'INDEXING' | 'FAILED' | 'NOT_INDEXED';

export interface SiteAssistantStatus {
    index: {
        status: IndexStatus;
        chunks: number | null;
        updatedAt: string | null;
        error: string | null;
    };
    answersToday: number;
    dailyCap: number | null;
    /** The server's own wording when credits are low or out; null when fine. */
    creditsWarning: string | null;
    creditsLow: boolean;
    enabled: boolean | null;
}

export function normalizeStatus(data: unknown): SiteAssistantStatus {
    const obj = isObject(data) ? data : {};
    const index = isObject(obj.index)
        ? obj.index
        : isObject(obj.index_state)
          ? obj.index_state
          : obj;
    const statusRaw = (str(index, 'status', 'index_status') ?? '').toUpperCase();
    const status: IndexStatus =
        statusRaw === 'READY' || statusRaw === 'INDEXING' || statusRaw === 'FAILED'
            ? statusRaw
            : 'NOT_INDEXED';
    const today = isObject(obj.today) ? obj.today : obj;
    const credits = isObject(obj.credits) ? obj.credits : {};
    const warning = str(obj, 'credits_warning') ?? str(credits, 'warning', 'message') ?? null;
    return {
        index: {
            status,
            chunks: num(index, 'chunks'),
            updatedAt: str(index, 'updated_at'),
            error: str(index, 'error'),
        },
        answersToday: num(today, 'answers', 'answers_today') ?? 0,
        dailyCap: num(today, 'cap', 'daily_cap', 'daily_answers'),
        creditsWarning: warning,
        creditsLow: !!warning || credits.low === true || obj.credits_low === true,
        enabled: typeof obj.enabled === 'boolean' ? obj.enabled : null,
    };
}

export const fetchStatus = async (siteTag: string): Promise<SiteAssistantStatus> => {
    const { data } = await authenticatedAxiosInstance.get(`${SITE_ASSISTANT_BASE}/admin/status`, {
        params: { site_tag: siteTag },
    });
    return normalizeStatus(data);
};

export const reindexSite = async (siteTag: string): Promise<void> => {
    await authenticatedAxiosInstance.post(`${SITE_ASSISTANT_BASE}/admin/reindex`, null, {
        params: { site_tag: siteTag },
    });
};

// ── Preview chat ─────────────────────────────────────────────────────────────

export interface PreviewSession {
    sessionId: string;
    token: string;
    expiresAt: string | null;
    assistant: {
        name: string;
        avatarUrl: string | null;
        greeting: string;
        suggestions: string[];
    };
}

export interface PagePayload {
    url: string;
    route: string;
    title: string;
}

/** The page the preview pretends the visitor is on: the site's home page. */
export const previewPage = (siteTag: string): PagePayload => ({
    url: `/${siteTag}`,
    route: '/',
    title: 'Admin preview',
});

export function normalizePreviewSession(data: unknown): PreviewSession {
    const obj = isObject(data) ? data : {};
    const sessionId = str(obj, 'session_id', 'id');
    const token = str(obj, 'token');
    if (!sessionId || !token) throw new Error('session_response_invalid');
    const a = isObject(obj.assistant) ? obj.assistant : {};
    return {
        sessionId,
        token,
        expiresAt: str(obj, 'expires_at'),
        assistant: {
            name: str(a, 'name') ?? 'Site Assistant',
            avatarUrl: str(a, 'avatar_url'),
            greeting: str(a, 'greeting') ?? '',
            suggestions: Array.isArray(a.suggestions)
                ? a.suggestions.filter((x): x is string => typeof x === 'string')
                : [],
        },
    };
}

/**
 * POST /sessions with the staff JWT and `preview: true` = a PREVIEW session (works while the
 * assistant is off). The flag matters: without it the server first tries the request's Origin
 * as a hosted site, and an admin app on an institute domain that also serves the site would get
 * a HOSTED (billed, capped, counted) conversation instead of a preview.
 */
export const startPreviewSession = async (siteTag: string): Promise<PreviewSession> => {
    const { data } = await authenticatedAxiosInstance.post(`${SITE_ASSISTANT_BASE}/sessions`, {
        site_tag: siteTag,
        page: previewPage(siteTag),
        preview: true,
    });
    return normalizePreviewSession(data);
};

export const newClientMessageId = (): string =>
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `msg-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;

export const MAX_MESSAGE_LENGTH = 1000;

/** Sends one visitor message and streams the reply events (token/card/done/error). */
export async function sendPreviewMessage(
    session: PreviewSession,
    siteTag: string,
    text: string,
    onEvent: (event: SiteAssistantStreamEvent) => void,
    signal?: AbortSignal
): Promise<void> {
    const body = {
        text: text.trim().slice(0, MAX_MESSAGE_LENGTH),
        page: previewPage(siteTag),
        client_msg_id: newClientMessageId(),
    };
    const res = await fetch(
        `${SITE_ASSISTANT_BASE}/sessions/${encodeURIComponent(session.sessionId)}/messages`,
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Accept: 'text/event-stream',
                Authorization: `Bearer ${session.token}`,
            },
            body: JSON.stringify(body),
            signal,
        }
    );
    if (!res.ok || !res.body) {
        let detail = `HTTP ${res.status}`;
        try {
            const j = (await res.json()) as Raw;
            detail = str(j, 'detail', 'message') ?? detail;
        } catch {
            /* body was not JSON */
        }
        const err = new Error(detail) as Error & { status?: number };
        err.status = res.status;
        throw err;
    }
    await readSiteAssistantStream(res.body, onEvent);
}
