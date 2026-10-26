/**
 * Lead Agent admin API (ai_service, LEAD_AGENT_BUILD_SPEC.md §4).
 *
 * Calls go through authenticatedAxiosInstance, which adds the staff JWT and the
 * institute `clientId`; the server takes the institute from those, never from a
 * parameter. Responses are read defensively: the Agent row may carry its JSON
 * columns as `brief` or `brief_json` (the spec says "the row, JSON columns as
 * objects"), lists may be bare arrays or wrapped, numbers may arrive as strings.
 */
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { AI_SERVICE_BASE_URL } from '@/constants/urls';
import type {
    AgentBrief,
    AgentGate,
    AgentOffer,
    AgentMode,
    AgentPayload,
    AgentStatsDay,
    AgentStatus,
    AgentWindow,
    Candidate,
    CandidatePage,
    CandidateStatus,
    CandidateSummary,
    Competitor,
    DecisionAction,
    EvidenceItem,
    FitSignal,
    FitWeight,
    LeadAgent,
    LeadAgentWorker,
    Market,
    PairResponse,
    ScoreBreakdown,
    ScoreParts,
    SuggestRequest,
    SuggestResponse,
    SuggestedIndustry,
    SuggestedOffer,
} from '../-types';
import {
    DEFAULT_GATE,
    DEFAULT_WINDOW,
    emptyBrief,
    isCompetitorKind,
    MAX_COMPETITORS,
    MAX_FIT_SIGNALS,
} from '../-utils/lead-agent-options';

export const LEAD_AGENT_BASE = `${AI_SERVICE_BASE_URL}/lead-agent/v1`;

/** /brief/suggest is synchronous and can take up to a minute on the server. */
const SUGGEST_TIMEOUT_MS = 90_000;

type Raw = Record<string, unknown>;
const isObject = (v: unknown): v is Raw => !!v && typeof v === 'object' && !Array.isArray(v);
const asObject = (v: unknown): Raw => {
    if (isObject(v)) return v;
    if (typeof v === 'string' && v.trim().startsWith('{')) {
        try {
            const parsed: unknown = JSON.parse(v);
            return isObject(parsed) ? parsed : {};
        } catch {
            return {};
        }
    }
    return {};
};
const asArray = (v: unknown): unknown[] => {
    if (Array.isArray(v)) return v;
    if (typeof v === 'string' && v.trim().startsWith('[')) {
        try {
            const parsed: unknown = JSON.parse(v);
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    }
    return [];
};
const str = (v: unknown): string | null => {
    if (typeof v === 'string' && v.trim() !== '') return v;
    if (typeof v === 'number') return String(v);
    return null;
};
const num = (v: unknown): number | null => {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
    return null;
};
const strList = (v: unknown): string[] =>
    asArray(v)
        .map((x) => str(x))
        .filter((x): x is string => !!x);
/** The value under the first of the given keys that is present. */
const pick = (row: Raw, ...keys: string[]): unknown => {
    for (const k of keys) if (row[k] !== undefined && row[k] !== null) return row[k];
    return undefined;
};
const rowsOf = (data: unknown, ...keys: string[]): Raw[] => {
    if (Array.isArray(data)) return data.filter(isObject);
    if (!isObject(data)) return [];
    for (const key of [...keys, 'items', 'data', 'content', 'results']) {
        if (Array.isArray(data[key])) return (data[key] as unknown[]).filter(isObject);
    }
    return [];
};

// ─── Normalizers ─────────────────────────────────────────────────────────────

/** 1–3; anything else reads as medium. */
const weightOf = (v: unknown): FitWeight => {
    const n = Math.round(num(v) ?? 2);
    return (n <= 1 ? 1 : n >= 3 ? 3 : 2) as FitWeight;
};

const normalizeFitSignals = (raw: unknown): FitSignal[] =>
    asArray(raw)
        .filter(isObject)
        .map((f) => {
            const key = str(f.key);
            return {
                ...(key ? { key } : {}),
                label: str(f.label) ?? '',
                description: str(f.description) ?? '',
                weight: weightOf(f.weight),
            };
        })
        .filter((f) => f.label)
        .slice(0, MAX_FIT_SIGNALS);

/** Competitors may be `{name, domain}` objects or bare names. */
const normalizeCompetitors = (raw: unknown): Competitor[] =>
    asArray(raw)
        .map((c) =>
            isObject(c)
                ? { name: str(c.name) ?? str(c.domain) ?? '', domain: str(c.domain) }
                : { name: str(c) ?? '', domain: null }
        )
        .filter((c) => c.name)
        .slice(0, MAX_COMPETITORS);

const normalizeOffer = (raw: unknown): AgentOffer => {
    const o = asObject(raw);
    return {
        name: str(o.name) ?? '',
        seller: str(o.seller) ?? '',
        website: str(o.website),
        fit_signals: normalizeFitSignals(o.fit_signals),
        competitors: normalizeCompetitors(o.competitors),
        competitor_kinds: strList(o.competitor_kinds).filter(isCompetitorKind),
        education: o.education === true,
        discovery_question: str(o.discovery_question) ?? '',
    };
};

export const normalizeBrief = (raw: unknown): AgentBrief => {
    const b = asObject(raw);
    const base = emptyBrief();
    return {
        products: strList(b.products),
        description: str(b.description) ?? '',
        offer: normalizeOffer(b.offer),
        industries: asArray(b.industries)
            .filter(isObject)
            .map((i) => ({ name: str(i.name) ?? '', search_term: str(i.search_term) ?? '' }))
            .filter((i) => i.name || i.search_term),
        buyer_roles: strList(b.buyer_roles),
        hiring_roles: strList(b.hiring_roles),
        keywords: strList(b.keywords),
        must_have: strList(b.must_have),
        deal_breakers: strList(b.deal_breakers),
        exclude: strList(b.exclude),
        sources: (Array.isArray(b.sources)
            ? strList(b.sources)
            : base.sources) as AgentBrief['sources'],
        find_contacts: b.find_contacts === false ? false : true,
    };
};

const normalizeGate = (raw: unknown): AgentGate => {
    const g = asObject(raw);
    const minContact = str(g.min_contact);
    return {
        auto_score: num(g.auto_score) ?? DEFAULT_GATE.auto_score,
        review_score: num(g.review_score) ?? DEFAULT_GATE.review_score,
        min_contact:
            minContact === 'direct' || minContact === 'likely' || minContact === 'general'
                ? minContact
                : DEFAULT_GATE.min_contact,
        require_intent: g.require_intent === true,
    };
};

const normalizeWindow = (raw: unknown): AgentWindow => {
    const w = asObject(raw);
    const days = asArray(w.days)
        .map((d) => num(d))
        .filter((d): d is number => d !== null && d >= 1 && d <= 7);
    return {
        tz: str(w.tz) ?? DEFAULT_WINDOW().tz,
        start: str(w.start) ?? DEFAULT_WINDOW().start,
        end: str(w.end) ?? DEFAULT_WINDOW().end,
        days: Array.isArray(w.days) ? days : DEFAULT_WINDOW().days,
    };
};

const normalizeMarkets = (raw: unknown): Market[] =>
    asArray(raw)
        .filter(isObject)
        .map((m) => ({ country: str(m.country) ?? '', state: str(m.state), city: str(m.city) }))
        .filter((m) => m.country);

const STATUSES: AgentStatus[] = ['ACTIVE', 'PAUSED', 'ARCHIVED'];
const MODES: AgentMode[] = ['LOCAL', 'REMOTE', 'AUTO'];

export const normalizeAgent = (raw: unknown): LeadAgent => {
    const a = asObject(raw);
    const status = str(a.status)?.toUpperCase() as AgentStatus | undefined;
    const mode = str(a.mode)?.toUpperCase() as AgentMode | undefined;
    const today = asObject(a.today);
    return {
        id: str(a.id) ?? '',
        institute_id: str(a.institute_id) ?? '',
        audience_id: str(a.audience_id) ?? '',
        audience_name: str(a.audience_name),
        name: str(a.name) ?? 'Lead Agent',
        status: status && STATUSES.includes(status) ? status : 'PAUSED',
        brief: normalizeBrief(pick(a, 'brief', 'brief_json')),
        markets: normalizeMarkets(pick(a, 'markets', 'markets_json')),
        daily_quota: num(a.daily_quota) ?? 10,
        monthly_credit_cap: num(a.monthly_credit_cap),
        mode: mode && MODES.includes(mode) ? mode : 'AUTO',
        gate: normalizeGate(pick(a, 'gate', 'gate_json')),
        window: normalizeWindow(pick(a, 'window', 'window_json')),
        plan_built_at: str(a.plan_built_at),
        last_tick_at: str(a.last_tick_at),
        last_error: str(a.last_error),
        created_by: str(a.created_by),
        created_at: str(a.created_at),
        updated_at: str(a.updated_at),
        today: isObject(a.today)
            ? {
                  delivered: num(today.delivered) ?? 0,
                  review: num(today.review) ?? 0,
                  rejected: num(today.rejected) ?? 0,
              }
            : undefined,
        workers_online: num(a.workers_online) ?? undefined,
        review_waiting:
            num(pick(a, 'review_waiting', 'review_count', 'waiting_review')) ?? undefined,
    };
};

const normalizeSummary = (raw: Raw): CandidateSummary => {
    const org = asObject(raw.org);
    const contact = asObject(raw.best_contact);
    const contactValue = str(contact.value);
    return {
        id: str(raw.id) ?? '',
        status: (str(raw.status)?.toUpperCase() ?? 'DISCOVERED') as CandidateStatus,
        decision: (str(raw.decision)?.toUpperCase() ?? null) as CandidateSummary['decision'],
        score: num(raw.score),
        stage: str(raw.stage),
        org: {
            name: str(org.name) ?? str(org.domain) ?? 'Unknown organisation',
            domain: str(org.domain) ?? '',
            website: str(org.website),
            city: str(org.city),
        },
        top_reason: str(raw.top_reason),
        flags: strList(raw.flags),
        best_contact: contactValue
            ? {
                  kind: str(contact.kind) ?? '',
                  value: contactValue,
                  quality: str(contact.quality) ?? '',
                  label: str(contact.label) ?? '',
              }
            : null,
        created_at: str(raw.created_at),
        delivered_at: str(raw.delivered_at),
        reject_reason: str(raw.reject_reason),
        parts: partsOf(raw),
    };
};

/** fit / intent / reach / risk from `score_parts` (the list summary), `score_json` (the detail) or the
 * row itself; null when none is sent. */
const partsOf = (raw: Raw): ScoreParts | null => {
    const s = isObject(raw.score_parts) ? raw.score_parts : isObject(raw.score_json) ? raw.score_json : raw;
    const fit = num(s.fit);
    const intent = num(s.intent);
    const reach = num(s.reach);
    const risk = num(s.risk);
    if (fit === null && intent === null && reach === null && risk === null) return null;
    return { fit: fit ?? 0, intent: intent ?? 0, reach: reach ?? 0, risk: risk ?? 0 };
};

const normalizeScore = (raw: unknown): ScoreBreakdown | null => {
    const s = asObject(raw);
    if (Object.keys(s).length === 0) return null;
    return {
        score: num(s.score) ?? 0,
        fit: num(s.fit) ?? 0,
        intent: num(s.intent) ?? 0,
        reach: num(s.reach) ?? 0,
        risk: num(s.risk) ?? 0,
        has_intent: s.has_intent === true,
        flags: strList(s.flags),
        reasons: strList(s.reasons),
        products: asArray(s.products)
            .filter(isObject)
            .map((p) => ({
                key: str(p.key) ?? '',
                // New briefs score one "offer" product; it may come without a name.
                name: str(p.name) ?? (str(p.key) === 'offer' ? 'Offer fit' : str(p.key)) ?? '',
                score: num(p.score),
                why: Array.isArray(p.why) ? strList(p.why) : str(p.why) ?? '',
            })),
    };
};

/** Evidence may be top-level or inside lead_json; items may say `field`/`signal`, `quote`, `url`/`source_url`. */
const normalizeEvidence = (raw: Raw): EvidenceItem[] => {
    const lead = asObject(pick(raw, 'lead_json', 'lead'));
    const list = asArray(pick(raw, 'evidence') ?? pick(lead, 'evidence'));
    return list
        .filter(isObject)
        .map((e) => ({
            field: str(pick(e, 'field', 'signal', 'kind', 'label')) ?? '',
            quote: str(pick(e, 'quote', 'text', 'value')) ?? '',
            url: str(pick(e, 'url', 'source_url', 'source')),
        }))
        .filter((e) => e.quote || e.field);
};

export const normalizeCandidate = (raw: unknown): Candidate => {
    const c = asObject(raw);
    return {
        ...normalizeSummary(c),
        score_json: normalizeScore(pick(c, 'score_json', 'score_breakdown')),
        lead_json: isObject(pick(c, 'lead_json', 'lead'))
            ? (pick(c, 'lead_json', 'lead') as Raw)
            : null,
        evidence: normalizeEvidence(c),
        reject_reason: str(c.reject_reason),
        reviewed_at: str(c.reviewed_at),
        delivered_response_id: str(c.delivered_response_id),
    };
};

const normalizeWorker = (w: Raw): LeadAgentWorker => ({
    id: str(w.id) ?? '',
    label: str(w.label),
    user_id: str(w.user_id),
    last_seen_at: str(w.last_seen_at),
    online: w.online === true,
    version: str(w.version),
    pages_today: num(w.pages_today) ?? 0,
});

const normalizeSuggestedIndustry = (i: Raw): SuggestedIndustry => ({
    name: str(i.name) ?? '',
    search_term: str(i.search_term) ?? str(i.name) ?? '',
    fit: (str(i.fit) ?? num(i.fit)) as SuggestedIndustry['fit'],
    why: str(i.why),
    products: strList(i.products),
    buyer_roles: strList(i.buyer_roles),
    hiring_phrases: strList(i.hiring_phrases),
    need_phrases: strList(i.need_phrases),
});

// ─── Agents ──────────────────────────────────────────────────────────────────

export async function listAgents(): Promise<LeadAgent[]> {
    const res = await authenticatedAxiosInstance.get(`${LEAD_AGENT_BASE}/agents`);
    return rowsOf(res.data, 'agents').map(normalizeAgent);
}

export async function getAgent(agentId: string): Promise<LeadAgent> {
    const res = await authenticatedAxiosInstance.get(
        `${LEAD_AGENT_BASE}/agents/${encodeURIComponent(agentId)}`
    );
    return normalizeAgent(res.data);
}

export async function createAgent(payload: AgentPayload): Promise<LeadAgent> {
    const res = await authenticatedAxiosInstance.post(`${LEAD_AGENT_BASE}/agents`, payload);
    return normalizeAgent(res.data);
}

export async function updateAgent(
    agentId: string,
    payload: Partial<AgentPayload>
): Promise<LeadAgent> {
    const res = await authenticatedAxiosInstance.put(
        `${LEAD_AGENT_BASE}/agents/${encodeURIComponent(agentId)}`,
        payload
    );
    return normalizeAgent(res.data);
}

export async function setAgentStatus(agentId: string, status: AgentStatus): Promise<LeadAgent> {
    const res = await authenticatedAxiosInstance.post(
        `${LEAD_AGENT_BASE}/agents/${encodeURIComponent(agentId)}/status`,
        { status }
    );
    return normalizeAgent(res.data);
}

export async function runAgentNow(agentId: string): Promise<{ queued: boolean }> {
    const res = await authenticatedAxiosInstance.post(
        `${LEAD_AGENT_BASE}/agents/${encodeURIComponent(agentId)}/run-now`
    );
    return { queued: asObject(res.data).queued !== false };
}

export async function getAgentStats(agentId: string, days = 14): Promise<AgentStatsDay[]> {
    const res = await authenticatedAxiosInstance.get(
        `${LEAD_AGENT_BASE}/agents/${encodeURIComponent(agentId)}/stats`,
        { params: { days } }
    );
    return rowsOf(res.data, 'days', 'stats').map((d) => ({
        day: str(d.day) ?? '',
        discovered: num(d.discovered) ?? 0,
        researched: num(d.researched) ?? 0,
        delivered: num(d.delivered) ?? 0,
        review: num(d.review) ?? 0,
        rejected: num(d.rejected) ?? 0,
        searches: num(d.searches) ?? 0,
        pages: num(d.pages) ?? 0,
        cost_usd: num(d.cost_usd) ?? 0,
        credits: num(d.credits) ?? 0,
    }));
}

// ─── Candidates ──────────────────────────────────────────────────────────────

export async function listCandidates(
    agentId: string,
    params: { status: CandidateStatus; page: number; size: number }
): Promise<CandidatePage> {
    const res = await authenticatedAxiosInstance.get(
        `${LEAD_AGENT_BASE}/agents/${encodeURIComponent(agentId)}/candidates`,
        { params }
    );
    const items = rowsOf(res.data, 'items').map(normalizeSummary);
    const total = num(asObject(res.data).total) ?? items.length;
    return { items, total };
}

export async function getCandidate(candidateId: string): Promise<Candidate> {
    const res = await authenticatedAxiosInstance.get(
        `${LEAD_AGENT_BASE}/candidates/${encodeURIComponent(candidateId)}`
    );
    return normalizeCandidate(res.data);
}

export async function decideCandidate(
    candidateId: string,
    action: DecisionAction,
    reason?: string
): Promise<Candidate> {
    const res = await authenticatedAxiosInstance.post(
        `${LEAD_AGENT_BASE}/candidates/${encodeURIComponent(candidateId)}/decision`,
        reason ? { action, reason } : { action }
    );
    return normalizeCandidate(res.data);
}

export async function bulkDecideCandidates(
    ids: string[],
    action: DecisionAction,
    reason?: string
): Promise<{ updated: number }> {
    const res = await authenticatedAxiosInstance.post(
        `${LEAD_AGENT_BASE}/candidates/bulk-decision`,
        reason ? { ids, action, reason } : { ids, action }
    );
    return { updated: num(asObject(res.data).updated) ?? 0 };
}

// ─── Brief suggestion ────────────────────────────────────────────────────────

export async function suggestBrief(body: SuggestRequest): Promise<SuggestResponse> {
    const res = await authenticatedAxiosInstance.post(`${LEAD_AGENT_BASE}/brief/suggest`, body, {
        timeout: SUGGEST_TIMEOUT_MS,
    });
    const d = asObject(res.data);
    let offer: SuggestedOffer | null = null;
    if (isObject(d.offer)) {
        const o = normalizeOffer(d.offer);
        offer = {
            name: o.name,
            fit_signals: o.fit_signals.map(({ label, description, weight }) => ({
                label,
                description,
                weight,
            })),
            competitors: o.competitors,
            competitor_kinds: o.competitor_kinds,
            education: o.education,
            discovery_question: o.discovery_question,
        };
    }
    return {
        summary: str(d.summary) ?? '',
        keywords: strList(d.keywords),
        industries: rowsOf(d.industries)
            .map(normalizeSuggestedIndustry)
            .filter((i) => i.name),
        note: str(d.note),
        offer,
    };
}

// ─── Extension workers ───────────────────────────────────────────────────────

export async function listWorkers(): Promise<LeadAgentWorker[]> {
    const res = await authenticatedAxiosInstance.get(`${LEAD_AGENT_BASE}/workers`);
    return rowsOf(res.data, 'workers').map(normalizeWorker);
}

export async function pairWorker(label?: string): Promise<PairResponse> {
    const res = await authenticatedAxiosInstance.post(
        `${LEAD_AGENT_BASE}/workers/pair`,
        label ? { label } : {}
    );
    const d = asObject(res.data);
    return { token: str(d.token) ?? '', worker_id: str(d.worker_id) ?? '' };
}

export async function revokeWorker(workerId: string): Promise<void> {
    await authenticatedAxiosInstance.delete(
        `${LEAD_AGENT_BASE}/workers/${encodeURIComponent(workerId)}`
    );
}

/** A readable message from an axios error (FastAPI `detail`, a string body, or the error). */
export function apiErrorMessage(error: unknown, fallback: string): string {
    const e = error as { response?: { status?: number; data?: unknown }; message?: string };
    const data = e?.response?.data;
    if (isObject(data)) {
        const detail = data.detail;
        if (typeof detail === 'string' && detail.trim()) return detail;
        if (Array.isArray(detail) && isObject(detail[0]) && typeof detail[0].msg === 'string') {
            // FastAPI validation error: name the field ("brief → buyer roles: …").
            const loc = Array.isArray(detail[0].loc)
                ? detail[0].loc
                      .filter((p: unknown) => typeof p === 'string' && p !== 'body')
                      .map((p: string) => p.replace(/_/g, ' '))
                      .join(' → ')
                : '';
            return loc ? `${loc}: ${detail[0].msg}` : detail[0].msg;
        }
        if (typeof data.message === 'string' && data.message.trim()) return data.message;
    }
    if (typeof data === 'string' && data.trim() && data.length < 300) return data;
    return fallback;
}

/** HTTP status of an axios error, if any. */
export const apiErrorStatus = (error: unknown): number | undefined =>
    (error as { response?: { status?: number } })?.response?.status;
