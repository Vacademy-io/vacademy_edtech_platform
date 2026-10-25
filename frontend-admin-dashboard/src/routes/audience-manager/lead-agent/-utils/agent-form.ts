/**
 * The Lead Agent create / edit form: zod schema, defaults, and the conversion
 * to and from the API shape (LEAD_AGENT_BUILD_SPEC.md §4 POST/PUT /agents).
 */
import { z } from 'zod';
import type { AgentPayload, LeadAgent } from '../-types';
import { DEFAULT_GATE, DEFAULT_WINDOW, emptyBrief } from './lead-agent-options';

const textList = z.array(z.string().trim().min(1));
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export const agentFormSchema = z
    .object({
        audience_id: z.string().min(1, 'Pick the lead list the agent fills'),
        name: z
            .string()
            .trim()
            .min(1, 'Give the agent a name')
            .max(200, 'Keep it under 200 characters'),
        products: z
            .array(z.enum(['complete_vacademy', 'crm', 'lms', 'ai_calling']))
            .min(1, 'Pick at least one product'),
        description: z
            .string()
            .trim()
            .min(10, 'Describe what you sell in a sentence or two')
            .max(4000, 'Keep it under 4000 characters'),
        product_url: z
            .string()
            .trim()
            .refine(
                (v) => v === '' || /^https?:\/\/\S+\.\S+/i.test(v),
                'Enter a full link, e.g. https://…'
            ),
        industries: z
            .array(
                z.object({
                    name: z.string().trim().min(1, 'Name the industry'),
                    search_term: z.string().trim().min(1, 'Add a search term'),
                })
            )
            .min(1, 'Add at least one industry')
            .max(6, 'Up to 6 industries'),
        buyer_roles: textList,
        hiring_roles: textList,
        keywords: textList,
        must_have: textList,
        deal_breakers: textList,
        exclude: textList,
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
        auto_score: z.number().int().min(1, '1 to 100').max(100, '1 to 100'),
        review_score: z.number().int().min(0, '0 to 100').max(100, '0 to 100'),
        min_contact: z.enum(['direct', 'likely', 'general']),
        require_intent: z.boolean(),
        monthly_credit_cap: z
            .string()
            .trim()
            .refine(
                (v) => v === '' || (Number.isFinite(Number(v)) && Number(v) > 0),
                'Leave empty for no cap, or enter a number above 0'
            ),
    })
    .superRefine((v, ctx) => {
        if (v.review_score >= v.auto_score) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['review_score'],
                message: 'The review score must be below the auto-deliver score',
            });
        }
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
    ['audience_id', 'name', 'products', 'description', 'product_url'],
    [
        'industries',
        'buyer_roles',
        'hiring_roles',
        'keywords',
        'must_have',
        'deal_breakers',
        'exclude',
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
        'auto_score',
        'review_score',
        'min_contact',
        'require_intent',
        'monthly_credit_cap',
    ],
];

export function defaultFormValues(audienceId = ''): AgentFormValues {
    const brief = emptyBrief();
    const window = DEFAULT_WINDOW();
    return {
        audience_id: audienceId,
        name: '',
        products: brief.products,
        description: '',
        product_url: '',
        industries: [],
        buyer_roles: [],
        hiring_roles: [],
        keywords: [],
        must_have: [],
        deal_breakers: [],
        exclude: [],
        sources: brief.sources,
        markets: [{ country: 'India', state: '', city: '' }],
        daily_quota: 10,
        tz: window.tz,
        start: window.start,
        end: window.end,
        days: window.days,
        mode: 'AUTO',
        auto_score: DEFAULT_GATE.auto_score,
        review_score: DEFAULT_GATE.review_score,
        min_contact: DEFAULT_GATE.min_contact,
        require_intent: DEFAULT_GATE.require_intent,
        monthly_credit_cap: '',
    };
}

export function formValuesFromAgent(agent: LeadAgent): AgentFormValues {
    const b = agent.brief;
    return {
        audience_id: agent.audience_id,
        name: agent.name,
        products: b.products.length ? b.products : ['complete_vacademy'],
        description: b.description,
        product_url: '',
        industries: b.industries,
        buyer_roles: b.buyer_roles,
        hiring_roles: b.hiring_roles,
        keywords: b.keywords,
        must_have: b.must_have,
        deal_breakers: b.deal_breakers,
        exclude: b.exclude,
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
        auto_score: agent.gate.auto_score,
        review_score: agent.gate.review_score,
        min_contact: agent.gate.min_contact,
        require_intent: agent.gate.require_intent,
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

export function payloadFromForm(v: AgentFormValues): AgentPayload {
    return {
        audience_id: v.audience_id,
        name: v.name.trim(),
        brief: {
            products: v.products,
            description: v.description.trim(),
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
            auto_score: v.auto_score,
            review_score: v.review_score,
            min_contact: v.min_contact,
            require_intent: v.require_intent,
        },
        window: { tz: v.tz, start: v.start, end: v.end, days: [...v.days].sort((a, b) => a - b) },
    };
}

export { dedupe };
