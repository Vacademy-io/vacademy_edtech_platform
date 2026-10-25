/**
 * Lead Agent types: mirror docs/crm/LEAD_AGENT_BUILD_SPEC.md §2 (tables) and §4 (the
 * ai_service API at /ai-service/lead-agent/v1). All payloads are snake_case.
 */

export type ProductKey = 'complete_vacademy' | 'crm' | 'lms' | 'ai_calling';
export type SourceKey =
    | 'organisation_search'
    | 'maps'
    | 'hiring'
    | 'keyword'
    | 'software_request'
    | 'new_centre';
export type AgentStatus = 'ACTIVE' | 'PAUSED' | 'ARCHIVED';
export type AgentMode = 'LOCAL' | 'REMOTE' | 'AUTO';
export type MinContact = 'direct' | 'likely' | 'general';

export type CandidateStatus =
    | 'DISCOVERED'
    | 'FETCHING'
    | 'READY'
    | 'RESEARCHING'
    | 'REVIEW'
    | 'APPROVED'
    | 'DELIVERED'
    | 'REJECTED'
    | 'SKIPPED'
    | 'FAILED';
export type CandidateDecision = 'AUTO' | 'REVIEW' | 'REJECT';

export interface Industry {
    name: string;
    search_term: string;
}

/** brief_json, §2.1 */
export interface AgentBrief {
    products: ProductKey[];
    description: string;
    industries: Industry[];
    buyer_roles: string[];
    hiring_roles: string[];
    keywords: string[];
    must_have: string[];
    deal_breakers: string[];
    exclude: string[];
    sources: SourceKey[];
    find_contacts: boolean;
}

export interface Market {
    country: string;
    state?: string | null;
    city?: string | null;
}

export interface AgentGate {
    auto_score: number;
    review_score: number;
    min_contact: MinContact;
    require_intent: boolean;
}

export interface AgentWindow {
    tz: string;
    /** "HH:MM" */
    start: string;
    end: string;
    /** ISO weekdays, 1 = Monday … 7 = Sunday. */
    days: number[];
}

export interface AgentToday {
    delivered: number;
    review: number;
    rejected: number;
}

/** The lead_agent row (JSON columns as objects) + audience_name, §4. */
export interface LeadAgent {
    id: string;
    institute_id: string;
    audience_id: string;
    audience_name?: string | null;
    name: string;
    status: AgentStatus;
    brief: AgentBrief;
    markets: Market[];
    daily_quota: number;
    monthly_credit_cap: number | null;
    mode: AgentMode;
    gate: AgentGate;
    window: AgentWindow;
    plan_built_at?: string | null;
    last_tick_at?: string | null;
    last_error?: string | null;
    created_by?: string | null;
    created_at?: string | null;
    updated_at?: string | null;
    /** GET /agents only. */
    today?: AgentToday;
    workers_online?: number;
    /** Size of the review queue (status=REVIEW). Not in §4; read when the server sends it. */
    review_waiting?: number;
}

/** POST /agents body; PUT /agents/{id} takes any subset. */
export interface AgentPayload {
    audience_id: string;
    name: string;
    brief: AgentBrief;
    markets: Market[];
    daily_quota: number;
    monthly_credit_cap: number | null;
    mode: AgentMode;
    gate: AgentGate;
    window: AgentWindow;
}

export interface BestContact {
    kind: string;
    value: string;
    quality: string;
    label: string;
}

export interface CandidateOrg {
    name: string;
    domain: string;
    website: string | null;
    city: string | null;
}

export interface CandidateSummary {
    id: string;
    status: CandidateStatus;
    decision: CandidateDecision | null;
    score: number | null;
    stage: string | null;
    org: CandidateOrg;
    top_reason: string | null;
    flags: string[];
    best_contact: BestContact | null;
    created_at: string | null;
    delivered_at: string | null;
    /** Not in the §4 summary; shown when the server includes it. */
    reject_reason?: string | null;
    /** Score parts. Not in the §4 summary; read from `score_json` or top-level fit/intent/reach/risk when sent. */
    parts?: ScoreParts | null;
}

export interface ScoreParts {
    fit: number;
    intent: number;
    reach: number;
    risk: number;
}

export interface CandidatePage {
    items: CandidateSummary[];
    total: number;
}

export interface ScoreBreakdown {
    score: number;
    fit: number;
    intent: number;
    reach: number;
    risk: number;
    products?: { key: string; name: string; score: number | null; why: string[] | string }[];
    has_intent?: boolean;
    flags?: string[];
    reasons?: string[];
}

export interface EvidenceItem {
    field: string;
    quote: string;
    url: string | null;
}

/** GET /candidates/{id} — the summary plus lead_json, score_json and evidence. */
export interface Candidate extends CandidateSummary {
    score_json: ScoreBreakdown | null;
    lead_json: Record<string, unknown> | null;
    evidence: EvidenceItem[];
    reject_reason?: string | null;
    reviewed_at?: string | null;
    delivered_response_id?: string | null;
}

export type DecisionAction = 'APPROVE' | 'REJECT';

export interface AgentStatsDay {
    day: string;
    discovered: number;
    researched: number;
    delivered: number;
    review: number;
    rejected: number;
    searches: number;
    pages: number;
    cost_usd: number;
    credits: number;
}

export interface SuggestRequest {
    products: ProductKey[];
    description?: string;
    url?: string;
}

export interface SuggestedIndustry {
    name: string;
    search_term: string;
    fit?: string | number | null;
    why?: string | null;
    products?: string[];
    buyer_roles?: string[];
    hiring_phrases?: string[];
    need_phrases?: string[];
}

export interface SuggestResponse {
    summary: string;
    keywords: string[];
    industries: SuggestedIndustry[];
}

export interface LeadAgentWorker {
    id: string;
    label: string | null;
    user_id: string | null;
    last_seen_at: string | null;
    online: boolean;
    version: string | null;
    pages_today: number;
}

export interface PairResponse {
    token: string;
    worker_id: string;
}
