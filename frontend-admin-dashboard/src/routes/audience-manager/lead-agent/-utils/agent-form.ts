/**
 * The Lead Agent create / edit form: zod schema, defaults, and the conversion
 * to and from the API shape (LEAD_AGENT_BUILD_SPEC.md §4 POST/PUT /agents).
 */
import { z } from 'zod';
import type { AgentPayload, Competitor, FitWeight, LeadAgent } from '../-types';
import {
    DEFAULT_GATE,
    DEFAULT_WINDOW,
    emptyBrief,
    LIST_LIMITS,
    MAX_COMPETITORS,
    MAX_FIT_SIGNALS,
} from './lead-agent-options';

const textList = z.array(z.string().trim().min(1));
const limitedList = (max: number) => textList.max(max, `Keep up to ${max}; remove some`);
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
/** A link with or without the scheme; https:// is added on save. */
const WEBSITE = /^(https?:\/\/)?[^\s/]+\.[^\s]+$/i;

const cleanDomain = (raw: string) =>
    raw
        .trim()
        .replace(/^https?:\/\//i, '')
        .replace(/^www\./i, '')
        .replace(/[/?#].*$/, '')
        .toLowerCase();
const looksLikeDomain = (raw: string) =>
    /^(https?:\/\/)?(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(raw.trim());

/** "Name", "name.com" or "Name (name.com)" → {name, domain}. A bare domain is also the name. */
export function parseCompetitor(raw: string): Competitor | null {
    const text = raw.trim();
    if (!text) return null;
    const paren = /^(.*?)\s*\(([^()]+)\)\s*$/.exec(text);
    if (paren && looksLikeDomain(paren[2] ?? '')) {
        const domain = cleanDomain(paren[2] ?? '').slice(0, 120);
        const name = (paren[1] ?? '').trim() || domain;
        return { name: name.slice(0, 80), domain: domain || null };
    }
    if (looksLikeDomain(text)) {
        const domain = cleanDomain(text).slice(0, 120);
        return { name: domain.slice(0, 80), domain };
    }
    return { name: text.slice(0, 80), domain: null };
}

/** The chip text for a competitor, the reverse of parseCompetitor. */
export const formatCompetitor = (c: Competitor): string =>
    c.domain && c.domain !== c.name ? `${c.name} (${c.domain})` : c.name;

export const agentFormSchema = z
    .object({
        audience_id: z.string().min(1, 'Pick the lead list the agent fills'),
        name: z
            .string()
            .trim()
            .min(1, 'Give the agent a name')
            .max(200, 'Keep it under 200 characters'),
        offer_name: z
            .string()
            .trim()
            .min(1, 'Say what you sell in a few words')
            .max(80, 'Keep it under 80 characters'),
        offer_seller: z.string().trim().max(120, 'Keep it under 120 characters'),
        description: z
            .string()
            .trim()
            .min(10, 'Describe what you sell in a sentence or two')
            .max(3000, 'Keep it under 3000 characters'),
        website: z
            .string()
            .trim()
            .max(1000, 'Keep it under 1000 characters')
            .refine((v) => v === '' || WEBSITE.test(v), 'Enter a link, e.g. https://…'),
        industries: z
            .array(
                z.object({
                    name: z
                        .string()
                        .trim()
                        .min(1, 'Name the industry')
                        .max(80, 'Keep it under 80 characters'),
                    search_term: z
                        .string()
                        .trim()
                        .min(1, 'Add a search term')
                        .max(60, 'Keep it under 60 characters, e.g. "coaching institute"'),
                })
            )
            .min(1, 'Add at least one industry')
            .max(6, 'Up to 6 industries'),
        buyer_roles: limitedList(LIST_LIMITS.buyer_roles),
        hiring_roles: limitedList(LIST_LIMITS.hiring_roles),
        keywords: limitedList(LIST_LIMITS.keywords),
        must_have: limitedList(LIST_LIMITS.must_have),
        deal_breakers: limitedList(LIST_LIMITS.deal_breakers),
        exclude: limitedList(LIST_LIMITS.exclude),
        fit_signals: z
            .array(
                z.object({
                    /** Server-assigned (fit_1 …); '' for a new row. */
                    key: z.string(),
                    label: z
                        .string()
                        .trim()
                        .min(1, 'Name the signal')
                        .max(60, 'Keep it under 60 characters'),
                    description: z.string().trim().max(200, 'Keep it under 200 characters'),
                    weight: z.enum(['1', '2', '3']),
                })
            )
            .max(MAX_FIT_SIGNALS, `Up to ${MAX_FIT_SIGNALS} signals`),
        /** Chip text: "Name", "name.com" or "Name (name.com)". */
        competitors: z
            .array(z.string().trim().min(1).max(200, 'Keep each one short'))
            .max(MAX_COMPETITORS, `Up to ${MAX_COMPETITORS} competitors`),
        competitor_kinds: z.array(
            z.enum(['lms', 'crm', 'whatsapp', 'chat', 'payments', 'website'])
        ),
        education: z.boolean(),
        discovery_question: z.string().trim().max(200, 'Keep it under 200 characters'),
        sources: z
            .array(
                z.enum([
                    'organisation_search',
                    'maps',
                    'hiring',
                    'keyword',
                    'software_request',
                    'new_centre',
                ])
            )
            .min(1, 'Turn on at least one source'),
        markets: z
            .array(
                z.object({
                    country: z.string().trim().min(1, 'Country is required'),
                    state: z.string().trim(),
                    city: z.string().trim(),
                })
            )
            .min(1, 'Add at least one market')
            .max(5, 'Up to 5 markets'),
        daily_quota: z
            .number({ invalid_type_error: 'Enter a number from 1 to 200' })
            .int('Whole numbers only')
            .min(1, 'At least 1 a day')
            .max(200, 'At most 200 a day'),
        tz: z.string().min(1, 'Pick a time zone'),
        start: z.string().regex(HHMM, 'Pick a start time'),
        end: z.string().regex(HHMM, 'Pick an end time'),
        days: z.array(z.number().int().min(1).max(7)).min(1, 'Pick at least one day'),
        mode: z.enum(['LOCAL', 'REMOTE', 'AUTO']),
        send_score: z
            .number({ invalid_type_error: 'Enter a number from 0 to 100' })
            .int('Whole numbers only')
            .min(0, 'Enter a number from 0 to 100')
            .max(100, 'Enter a number from 0 to 100'),
        require_approval: z.boolean(),
        /** Legacy: no field edits these. They carry an agent's saved values through a save untouched,
         * so they are never validated (an old agent's pair must not block saving). */
        auto_score: z.number(),
        review_score: z.number(),
        min_contact: z.enum(['direct', 'likely', 'general']),
        require_intent: z.boolean(),
        auto_competitor_users: z.boolean(),
        effort: z.enum(['BASIC', 'STANDARD', 'DEEP']),
        monthly_credit_cap: z
            .string()
            .trim()
            .refine(
                (v) => v === '' || (Number.isFinite(Number(v)) && Number(v) > 0),
                'Leave empty for no cap, or enter a number above 0'
            ),
    })
    .superRefine((v, ctx) => {
        if (v.start >= v.end) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['end'],
                message: 'End time must be after the start time',
            });
        }
    });

export type AgentFormValues = z.infer<typeof agentFormSchema>;

/** Fields validated by each step of the create stepper. */
export const STEP_FIELDS: (keyof AgentFormValues)[][] = [
    ['audience_id', 'name', 'offer_name', 'offer_seller', 'description', 'website'],
    [
        'industries',
        'buyer_roles',
        'hiring_roles',
        'keywords',
        'must_have',
        'deal_breakers',
        'exclude',
        'fit_signals',
        'competitors',
        'competitor_kinds',
        'education',
        'discovery_question',
        'markets',
        'sources',
    ],
    [
        'daily_quota',
        'tz',
        'start',
        'end',
        'days',
        'mode',
        'send_score',
        'require_approval',
        'min_contact',
        'require_intent',
        'auto_competitor_users',
        'effort',
        'monthly_credit_cap',
    ],
];

export function defaultFormValues(audienceId = ''): AgentFormValues {
    const brief = emptyBrief();
    const window = DEFAULT_WINDOW();
    return {
        audience_id: audienceId,
        name: '',
        offer_name: '',
        offer_seller: '',
        description: '',
        website: '',
        industries: [],
        buyer_roles: [],
        hiring_roles: [],
        keywords: [],
        must_have: [],
        deal_breakers: [],
        exclude: [],
        fit_signals: [],
        competitors: [],
        competitor_kinds: [],
        education: brief.offer.education,
        discovery_question: '',
        sources: brief.sources,
        markets: [{ country: 'India', state: '', city: '' }],
        daily_quota: 10,
        tz: window.tz,
        start: window.start,
        end: window.end,
        days: window.days,
        mode: 'AUTO',
        send_score: DEFAULT_GATE.send_score,
        require_approval: DEFAULT_GATE.require_approval,
        auto_score: DEFAULT_GATE.auto_score,
        review_score: DEFAULT_GATE.review_score,
        min_contact: DEFAULT_GATE.min_contact,
        require_intent: DEFAULT_GATE.require_intent,
        auto_competitor_users: DEFAULT_GATE.auto_competitor_users,
        effort: DEFAULT_GATE.effort,
        monthly_credit_cap: '',
    };
}

export function formValuesFromAgent(agent: LeadAgent): AgentFormValues {
    const b = agent.brief;
    const o = b.offer;
    return {
        audience_id: agent.audience_id,
        name: agent.name,
        offer_name: o.name,
        offer_seller: o.seller,
        description: b.description,
        website: o.website ?? '',
        industries: b.industries,
        buyer_roles: b.buyer_roles,
        hiring_roles: b.hiring_roles,
        keywords: b.keywords,
        must_have: b.must_have,
        deal_breakers: b.deal_breakers,
        exclude: b.exclude,
        fit_signals: o.fit_signals.map((f) => ({
            key: f.key ?? '',
            label: f.label,
            description: f.description,
            weight: String(f.weight) as '1' | '2' | '3',
        })),
        competitors: o.competitors.map(formatCompetitor),
        competitor_kinds: o.competitor_kinds,
        education: o.education,
        discovery_question: o.discovery_question,
        sources: b.sources,
        markets: agent.markets.length
            ? agent.markets.map((m) => ({
                  country: m.country,
                  state: m.state ?? '',
                  city: m.city ?? '',
              }))
            : [{ country: 'India', state: '', city: '' }],
        daily_quota: agent.daily_quota,
        tz: agent.window.tz,
        start: agent.window.start,
        end: agent.window.end,
        days: agent.window.days,
        mode: agent.mode,
        send_score: agent.gate.send_score,
        require_approval: agent.gate.require_approval,
        auto_score: agent.gate.auto_score,
        review_score: agent.gate.review_score,
        min_contact: agent.gate.min_contact,
        require_intent: agent.gate.require_intent,
        auto_competitor_users: agent.gate.auto_competitor_users,
        effort: agent.gate.effort,
        monthly_credit_cap:
            agent.monthly_credit_cap === null ? '' : String(agent.monthly_credit_cap),
    };
}

const dedupe = (list: string[]) => {
    const seen = new Set<string>();
    return list.filter((x) => {
        const k = x.trim().toLowerCase();
        if (!k || seen.has(k)) return false;
        seen.add(k);
        return true;
    });
};

const competitorsFromForm = (chips: string[]): Competitor[] => {
    const seen = new Set<string>();
    return chips
        .map(parseCompetitor)
        .filter((c): c is Competitor => {
            if (!c) return false;
            const k = (c.domain ?? c.name).toLowerCase();
            if (seen.has(k)) return false;
            seen.add(k);
            return true;
        })
        .slice(0, MAX_COMPETITORS);
};

const websiteFromForm = (raw: string): string | null => {
    const v = raw.trim();
    if (!v) return null;
    return /^https?:\/\//i.test(v) ? v : `https://${v}`;
};

export function payloadFromForm(v: AgentFormValues): AgentPayload {
    return {
        audience_id: v.audience_id,
        name: v.name.trim(),
        brief: {
            // Legacy product keys: always empty, the offer says what is sold.
            products: [],
            description: v.description.trim(),
            offer: {
                name: v.offer_name.trim(),
                seller: v.offer_seller.trim(),
                website: websiteFromForm(v.website),
                fit_signals: v.fit_signals.slice(0, MAX_FIT_SIGNALS).map((f) => ({
                    // Only the server assigns keys; a new row goes without one.
                    ...(f.key ? { key: f.key } : {}),
                    label: f.label.trim(),
                    description: f.description.trim(),
                    weight: Number(f.weight) as FitWeight,
                })),
                competitors: competitorsFromForm(v.competitors),
                competitor_kinds: v.competitor_kinds,
                education: v.education,
                discovery_question: v.discovery_question.trim(),
            },
            industries: v.industries.map((i) => ({
                name: i.name.trim(),
                search_term: i.search_term.trim(),
            })),
            buyer_roles: dedupe(v.buyer_roles),
            hiring_roles: dedupe(v.hiring_roles),
            keywords: dedupe(v.keywords),
            must_have: dedupe(v.must_have),
            deal_breakers: dedupe(v.deal_breakers),
            exclude: dedupe(v.exclude),
            sources: v.sources,
            find_contacts: true,
        },
        markets: v.markets.map((m) => ({
            country: m.country.trim(),
            state: m.state.trim() || null,
            city: m.city.trim() || null,
        })),
        daily_quota: v.daily_quota,
        monthly_credit_cap: v.monthly_credit_cap === '' ? null : Number(v.monthly_credit_cap),
        mode: v.mode,
        gate: {
            send_score: v.send_score,
            require_approval: v.require_approval,
            // Untouched: they came from the agent (or the defaults) and no field edits them.
            auto_score: v.auto_score,
            review_score: v.review_score,
            min_contact: v.min_contact,
            require_intent: v.require_intent,
            auto_competitor_users: v.auto_competitor_users,
            effort: v.effort,
        },
        window: { tz: v.tz, start: v.start, end: v.end, days: [...v.days].sort((a, b) => a - b) },
    };
}

export { dedupe };
