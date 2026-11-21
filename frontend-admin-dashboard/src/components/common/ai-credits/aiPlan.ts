/**
 * AI subscription plan — tenant read API (ai_service `GET /credits/v2/institutes/{id}/plan`).
 *
 * Display only: the server decides billing. Nothing here is shown unless the
 * institute has a plan that is actually in effect (status TRIAL / ACTIVE /
 * GRACE and enforcement LIVE). A SHADOW subscription is a platform dry-run that
 * still charges exactly as today, so tenants never see it, and an institute
 * without a plan sees no change at all. Any error (endpoint not deployed, 403,
 * network) also resolves to "no plan" — the query never retries.
 */
import { useQuery } from '@tanstack/react-query';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { AI_SERVICE_BASE_URL } from '@/constants/urls';

export type PlanFeatureMode = 'INCLUDED' | 'ALLOWANCE' | 'CHARGED';

export interface TenantPlanFeature {
    feature_key: string;
    label: string;
    mode: PlanFeatureMode;
    display_cap_text: string | null;
    /** Fair-use use so far, 0-100; null when the feature has no cap (or the viewer is not an admin). */
    usage_pct: number | null;
    /** True when any model is included (model policy ANY). */
    any_model: boolean;
    included_models: string[];
    /** Role classes the inclusion is limited to; null = everyone. */
    roles_included: string[] | null;
    /** Tool keys billed as this feature (for cost previews). */
    tool_keys: string[];
}

export interface TenantPlan {
    plan: {
        name: string;
        version_no: number | null;
        period_start: string | null;
        period_end: string | null;
        enforcement: string;
        status: string;
        /**
         * Sent to platform staff only, who also receive plans that are not in
         * effect (Shadow, not started, global switch off). False = hide.
         */
        effective: boolean | null;
        /** Paid plan whose current period is unpaid: benefits are paused, AI use is charged. */
        benefits_paused: boolean;
    };
    allowance: { credits: number; used: number; remaining: number };
    features: TenantPlanFeature[];
}

const LIVE_STATUSES = ['TRIAL', 'ACTIVE', 'GRACE'];
const MODES: PlanFeatureMode[] = ['INCLUDED', 'ALLOWANCE', 'CHARGED'];

const obj = (v: unknown): Record<string, unknown> =>
    v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const num = (v: unknown): number | null => {
    if (v === null || v === undefined || v === '') return null;
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n : null;
};

/** Tolerant parse; `null` when there is no plan block. */
export function normalizeTenantPlan(raw: unknown): TenantPlan | null {
    const r = obj(raw);
    const p = r.plan;
    if (!p || typeof p !== 'object') return null;
    const plan = obj(p);
    const allowance = obj(r.allowance);
    const credits = Math.max(0, num(allowance.credits) ?? 0);
    const used = Math.max(0, num(allowance.used) ?? 0);
    const features = (Array.isArray(r.features) ? r.features : [])
        .map((f): TenantPlanFeature | null => {
            const o = obj(f);
            const key = str(o.feature_key);
            if (!key) return null;
            const mode = (MODES as string[]).includes(String(o.mode))
                ? (o.mode as PlanFeatureMode)
                : 'CHARGED';
            const pct = num(o.usage_pct);
            return {
                feature_key: key,
                label: str(o.label) ?? key,
                mode,
                display_cap_text: str(o.display_cap_text),
                usage_pct: pct === null ? null : Math.min(100, Math.max(0, pct)),
                any_model: o.any_model === true,
                included_models: Array.isArray(o.included_models)
                    ? o.included_models.filter(
                          (m): m is string => typeof m === 'string' && m !== ''
                      )
                    : [],
                roles_included: Array.isArray(o.roles_included)
                    ? o.roles_included.filter((m): m is string => typeof m === 'string' && m !== '')
                    : null,
                tool_keys: Array.isArray(o.tool_keys)
                    ? o.tool_keys.filter((m): m is string => typeof m === 'string' && m !== '')
                    : [],
            };
        })
        .filter((f): f is TenantPlanFeature => f !== null);
    return {
        plan: {
            name: str(plan.name) ?? '',
            version_no: num(plan.version_no),
            period_start: str(plan.period_start),
            period_end: str(plan.period_end),
            enforcement: str(plan.enforcement) ?? 'SHADOW',
            status: str(plan.status) ?? '',
            effective: typeof plan.effective === 'boolean' ? plan.effective : null,
            benefits_paused: plan.benefits_paused === true,
        },
        allowance: {
            credits,
            used,
            remaining: Math.max(0, num(allowance.remaining) ?? credits - used),
        },
        features,
    };
}

/** True only for a plan that changes billing right now (LIVE and in a live status). */
export function isPlanInEffect(p: TenantPlan | null | undefined): p is TenantPlan {
    return (
        !!p &&
        p.plan.name !== '' &&
        p.plan.enforcement === 'LIVE' &&
        p.plan.effective !== false &&
        LIVE_STATUSES.includes(p.plan.status)
    );
}

/** How the institute's AI plan pays for one priced action. */
export interface PlanCoverage {
    /** INCLUDED: free under the plan; ALLOWANCE: from the monthly allowance; SPLIT: allowance then wallet. */
    mode: 'INCLUDED' | 'ALLOWANCE' | 'SPLIT';
    /** Credits the wallet is expected to pay (0 unless SPLIT). */
    walletCredits: number;
    planName: string;
}

/**
 * What the plan is expected to do with an action priced at `credits` for `toolKey`, or null
 * when the wallet pays as usual (no plan in effect, benefits paused, tool not in the plan,
 * charged, fair-use cap reached, role-limited inclusion, allowance used up). An estimate only:
 * the server decides at charge time (a model the user picked themselves is charged, for one).
 */
export function planCoverageForTool(
    plan: TenantPlan | null | undefined,
    toolKey: string,
    credits: number | null
): PlanCoverage | null {
    if (!isPlanInEffect(plan) || plan.plan.benefits_paused || credits == null || credits <= 0)
        return null;
    const feature = plan.features.find((f) => f.tool_keys.includes(toolKey));
    if (!feature) return null;
    if (feature.mode === 'INCLUDED') {
        if (feature.roles_included && feature.roles_included.length > 0) return null;
        if (feature.usage_pct != null && feature.usage_pct >= 100) return null;
        return { mode: 'INCLUDED', walletCredits: 0, planName: plan.plan.name };
    }
    if (feature.mode === 'ALLOWANCE') {
        const left = plan.allowance.remaining;
        if (left <= 0) return null;
        if (left >= credits)
            return { mode: 'ALLOWANCE', walletCredits: 0, planName: plan.plan.name };
        return { mode: 'SPLIT', walletCredits: credits - left, planName: plan.plan.name };
    }
    return null;
}

/** One short line for a cost preview: "Included in your AI plan", "From your plan allowance"... */
export function coverageLabel(c: PlanCoverage): string {
    if (c.mode === 'INCLUDED') return 'Included in your AI plan';
    if (c.mode === 'ALLOWANCE') return 'From your plan allowance';
    return `Allowance, then ${Math.ceil(c.walletCredits)} credits from your balance`;
}

/** Allowance used as 0-100, or null when the plan has no allowance. */
export function allowancePct(p: TenantPlan): number | null {
    if (p.allowance.credits <= 0) return null;
    return Math.min(100, (p.allowance.used / p.allowance.credits) * 100);
}

/** Features in display order: included, then allowance, then charged. */
export function featuresByMode(p: TenantPlan): Record<PlanFeatureMode, TenantPlanFeature[]> {
    const out: Record<PlanFeatureMode, TenantPlanFeature[]> = {
        INCLUDED: [],
        ALLOWANCE: [],
        CHARGED: [],
    };
    for (const f of p.features) out[f.mode].push(f);
    return out;
}

export const fetchTenantPlan = async (instituteId: string): Promise<TenantPlan | null> => {
    const response = await authenticatedAxiosInstance.get<unknown>(
        `${AI_SERVICE_BASE_URL}/credits/v2/institutes/${encodeURIComponent(instituteId)}/plan`
    );
    return normalizeTenantPlan(response.data);
};

export const aiPlanQueryKey = (instituteId: string | undefined | null) =>
    ['GET_AI_PLAN', instituteId ?? null] as const;

/** Resolves to the plan, or null on "no plan" and on ANY error (so nothing renders). */
export const useAiPlanQuery = (instituteId: string | undefined | null, enabled = true) => {
    return useQuery({
        queryKey: aiPlanQueryKey(instituteId),
        queryFn: async () => {
            try {
                return await fetchTenantPlan(instituteId as string);
            } catch {
                return null;
            }
        },
        enabled: enabled && !!instituteId,
        staleTime: 5 * 60 * 1000,
        retry: false,
    });
};

/** History v2: which plan wording a usage row gets (null = none). */
export type PlanRowBadge = 'includedInPlan' | 'fromAllowance' | 'splitAllowance' | null;

export function planRowBadge(
    billingMode: string | null | undefined,
    creditsCharged: number
): PlanRowBadge {
    const mode = (billingMode || '').toUpperCase();
    if (mode === 'INCLUDED' && creditsCharged <= 0) return 'includedInPlan';
    if (mode === 'ALLOWANCE' && creditsCharged <= 0) return 'fromAllowance';
    // SPLIT: the allowance paid part, the wallet the rest. Also an ALLOWANCE row that still debited.
    if ((mode === 'SPLIT' || mode === 'ALLOWANCE') && creditsCharged > 0) return 'splitAllowance';
    return null;
}

/** Credits the plan allowance paid on a row (list minus what the wallet paid), never negative. */
export function allowancePart(listCredits: number, creditsCharged: number): number {
    return Math.max(0, listCredits - creditsCharged);
}
