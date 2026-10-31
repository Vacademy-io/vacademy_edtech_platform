/**
 * Labels, presets and defaults for the Lead Agent screens. Keys match the engine
 * (LEAD_AGENT_BUILD_SPEC.md §2.1); labels are what admins read.
 */
import { FALLBACK_TIMEZONE, getBrowserTimezone } from '@/utils/timezone';
import type {
    AgentBrief,
    AgentGate,
    AgentMode,
    AgentOffer,
    AgentWindow,
    CandidateStatus,
    CompetitorKind,
    FitWeight,
    MinContact,
    SourceKey,
    ValidationEffort,
} from '../-types';

export const COMPETITOR_KIND_OPTIONS: { value: CompetitorKind; label: string }[] = [
    { value: 'lms', label: 'LMS / course app' },
    { value: 'crm', label: 'CRM' },
    { value: 'whatsapp', label: 'WhatsApp tool' },
    { value: 'chat', label: 'Chat widget' },
    { value: 'payments', label: 'Payments' },
    { value: 'website', label: 'Website builder' },
];

export const isCompetitorKind = (v: string): v is CompetitorKind =>
    COMPETITOR_KIND_OPTIONS.some((o) => o.value === v);

export const FIT_WEIGHT_OPTIONS: { value: FitWeight; label: string }[] = [
    { value: 1, label: 'Low' },
    { value: 2, label: 'Medium' },
    { value: 3, label: 'High' },
];

/** Server limits for the offer (brief.offer). */
export const MAX_FIT_SIGNALS = 8;
export const MAX_COMPETITORS = 10;

/** Server limits for the brief's lists (ai_service models.LIST_LIMITS). */
export const LIST_LIMITS = {
    buyer_roles: 10,
    hiring_roles: 6,
    keywords: 10,
    must_have: 10,
    deal_breakers: 10,
    exclude: 5,
} as const;

export const SOURCE_OPTIONS: { value: SourceKey; label: string; hint: string }[] = [
    {
        value: 'organisation_search',
        label: 'Organisation search',
        hint: 'Web search for organisations in your industries and markets.',
    },
    { value: 'maps', label: 'Google Maps', hint: 'Map listings, often with the owner’s mobile.' },
    { value: 'hiring', label: 'Hiring posts', hint: 'Organisations hiring the roles you list.' },
    { value: 'keyword', label: 'Keyword posts', hint: 'Pages that use your keywords.' },
    {
        value: 'software_request',
        label: 'Buying requests',
        hint: 'People asking for something like what you sell.',
    },
    { value: 'new_centre', label: 'New centres', hint: 'Organisations opening a new branch.' },
];

export const ALL_SOURCES: SourceKey[] = SOURCE_OPTIONS.map((s) => s.value);

/** Common kinds to leave out when selling into education; admins can type their own too. */
export const EXCLUDE_PRESETS = ['Schools & playschools', 'Colleges & universities'];

export const MODE_OPTIONS: { value: AgentMode; label: string; note: string }[] = [
    {
        value: 'LOCAL',
        label: 'Local extension',
        note: 'Uses the Chrome extension on your team’s computers, fewer credits.',
    },
    {
        value: 'REMOTE',
        label: 'Server',
        note: 'Runs on our servers, more credits.',
    },
    {
        value: 'AUTO',
        label: 'Auto',
        note: 'Uses the extension when one is online, otherwise the servers.',
    },
];

export const MODE_LABEL: Record<AgentMode, string> = {
    LOCAL: 'Local extension',
    REMOTE: 'Server',
    AUTO: 'Auto',
};

export type GatePresetKey = 'strict' | 'balanced' | 'volume';
/** Presets for the minimum score to send. */
export const GATE_PRESETS: {
    value: GatePresetKey;
    label: string;
    score: number;
}[] = [
    { value: 'strict', label: 'Strict', score: 60 },
    { value: 'balanced', label: 'Balanced', score: 50 },
    { value: 'volume', label: 'Volume', score: 45 },
];

export const presetFor = (sendScore: number): GatePresetKey | 'custom' =>
    GATE_PRESETS.find((p) => p.score === sendScore)?.value ?? 'custom';

export const MIN_CONTACT_OPTIONS: { value: MinContact; label: string; hint: string }[] = [
    { value: 'direct', label: 'Direct', hint: 'A decision maker’s own number or email.' },
    {
        value: 'likely',
        label: 'Likely',
        hint: 'A desk line with a name to ask for.',
    },
    { value: 'general', label: 'General', hint: 'Any public number or email.' },
];

export const EFFORT_OPTIONS: { value: ValidationEffort; label: string; note: string }[] = [
    {
        value: 'BASIC',
        label: 'Basic',
        note: 'Reads the organisation’s website and uses the phone on its Google Maps listing. No extra searches.',
    },
    {
        value: 'STANDARD',
        label: 'Standard (recommended)',
        note: 'Also looks the organisation up on Google Maps, opens job posts to confirm who is hiring, and runs one extra search for a phone or email when none can be confirmed.',
    },
    {
        value: 'DEEP',
        label: 'Deep',
        note: 'Reads more pages of each website, checks the organisation’s social pages, and runs up to three extra searches for contact details.',
    },
];

export const isValidationEffort = (v: string | null): v is ValidationEffort =>
    EFFORT_OPTIONS.some((o) => o.value === v);

export const CONTACT_QUALITY_LABEL: Record<string, string> = {
    direct: 'Direct',
    likely: 'Likely',
    general: 'General',
    none: 'No contact',
};

/** ISO weekdays, 1 = Monday. */
export const WEEKDAYS: { value: number; label: string }[] = [
    { value: 1, label: 'Mon' },
    { value: 2, label: 'Tue' },
    { value: 3, label: 'Wed' },
    { value: 4, label: 'Thu' },
    { value: 5, label: 'Fri' },
    { value: 6, label: 'Sat' },
    { value: 7, label: 'Sun' },
];

export const DEFAULT_GATE: AgentGate = {
    send_score: 50,
    require_approval: false,
    // Legacy: no longer decide anything, but the payload still carries them.
    auto_score: 70,
    review_score: 45,
    min_contact: 'likely',
    require_intent: false,
    auto_competitor_users: false,
    effort: 'STANDARD',
};

/** The spec default window (09:30–19:00, Mon–Sat), in the admin's own time zone. */
export const DEFAULT_WINDOW = (): AgentWindow => ({
    tz: getBrowserTimezone(FALLBACK_TIMEZONE),
    start: '09:30',
    end: '19:00',
    days: [1, 2, 3, 4, 5, 6],
});

export const emptyOffer = (): AgentOffer => ({
    name: '',
    seller: '',
    website: null,
    fit_signals: [],
    competitors: [],
    competitor_kinds: [],
    education: false,
    discovery_question: '',
});

export const emptyBrief = (): AgentBrief => ({
    products: [],
    description: '',
    offer: emptyOffer(),
    industries: [],
    buyer_roles: [],
    hiring_roles: [],
    keywords: [],
    must_have: [],
    deal_breakers: [],
    exclude: [],
    sources: [...ALL_SOURCES],
    find_contacts: true,
});

export const REJECT_REASONS = [
    'Not our market',
    'Too big',
    'Too small',
    'Already a customer',
    'Competitor',
    'Wrong contact',
    'Other',
];

/** Statuses shown under "In progress". */
export const IN_PROGRESS_STATUSES: CandidateStatus[] = [
    'DISCOVERED',
    'FETCHING',
    'READY',
    'RESEARCHING',
    'APPROVED',
];

/** The Rejected tab also lists SKIPPED leads (the same organisation as another lead, already in your
 * leads, nothing to send): none of them is delivered or charged. */
export const REJECTED_TAB_STATUSES: readonly CandidateStatus[] = ['REJECTED', 'SKIPPED'];

/** "Skipped — duplicate of a.in", else "Skipped — <the note>". */
export const skippedLabel = (duplicateOf: string | null, note: string | null | undefined) =>
    duplicateOf
        ? `Skipped — duplicate of ${duplicateOf}`
        : note
          ? `Skipped — ${note}`
          : CANDIDATE_STATUS_LABEL.SKIPPED;

export const CANDIDATE_STATUS_LABEL: Record<CandidateStatus, string> = {
    DISCOVERED: 'Found',
    FETCHING: 'Reading website',
    READY: 'Ready to research',
    RESEARCHING: 'Researching',
    REVIEW: 'Waiting for approval',
    APPROVED: 'Ready to send',
    DELIVERED: 'Delivered',
    REJECTED: 'Rejected',
    SKIPPED: 'Skipped',
    FAILED: 'Failed',
};

const PLATFORM_NAMES: Record<string, string> = {
    appx: 'Appx',
    classplus: 'Classplus',
    teachmint: 'Teachmint',
    graphy: 'Graphy',
    edmingle: 'Edmingle',
    spayee: 'Spayee',
    leadsquared: 'LeadSquared',
    meritto: 'Meritto',
    npf: 'Meritto',
    extraaedge: 'ExtraaEdge',
    zoho: 'Zoho',
    hubspot: 'HubSpot',
    wati: 'WATI',
    interakt: 'Interakt',
    aisensy: 'AiSensy',
};

const humanize = (s: string) => {
    const spaced = s.replace(/[_:-]+/g, ' ').trim();
    return spaced.charAt(0).toUpperCase() + spaced.slice(1);
};

const plural = (role: string) => (/s$/i.test(role) ? role : `${role}s`);

/** "competitor_platform:appx" → "Uses Appx", "enterprise" → "Very large", "hiring:telecaller" → "Hiring telecallers". */
export function flagLabel(flag: string): string {
    const [kind = '', rest = ''] = flag.split(/:(.*)/s);
    const key = kind.toLowerCase();
    if (key === 'competitor_platform' || key === 'platform' || key === 'uses') {
        return `Uses ${PLATFORM_NAMES[rest.toLowerCase()] ?? humanize(rest)}`;
    }
    if (key === 'hiring' && rest) return `Hiring ${plural(rest.replace(/_/g, ' '))}`;
    if (key === 'enterprise' || key === 'very_large' || key === 'large') return 'Very large';
    if (key === 'micro' || key === 'single_tutor') return 'Very small';
    if (key === 'no_contact') return 'No contact found';
    if (key === 'general_contact_only') return 'Only a general contact';
    if (key === 'dead_site' || key === 'parked') return 'Site looks dead';
    if (key === 'outside_market') return 'Outside your markets';
    if (key === 'known_lead' || key === 'existing_lead') return 'Already in your leads';
    // The website could not be read, so research judged the lead from its Google Maps listing.
    if (key === 'maps_only') return 'Judged from Google Maps';
    // Same name and city as another lead, but no shared phone or email: a person decides.
    if (key === 'possible_duplicate')
        return rest ? `Possible duplicate of ${rest}` : 'Possible duplicate';
    return humanize(flag);
}

/** Flags that should read as a warning (risk), the rest as neutral. */
export const isRiskFlag = (flag: string) =>
    /^(competitor|platform|uses|enterprise|very_large|large|no_contact|dead|parked|outside|known|existing|micro|single)/i.test(
        flag
    );
