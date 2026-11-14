import { useQuery } from '@tanstack/react-query';
import { BASE_URL } from '@/constants/urls';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';

export interface ProductPlan {
    key: string;
    name: string;
    price_inr: number | null;
    credits: number | null;
    users: number | null;
}

/** What this Evalezy workspace bought, from admin-core plan-access. */
export interface PlanAccess {
    product: string | null;
    /** TRIAL, PLAN (a product plan is live), PAYMENT_PENDING (signed up to buy, not paid), MANAGED (set up by the team) or NONE. */
    status: 'TRIAL' | 'PLAN' | 'PAYMENT_PENDING' | 'MANAGED' | 'NONE';
    plan_key: string | null;
    plan_name: string | null;
    plan_credits: number | null;
    plan_price_inr: number | null;
    plan_ends_at: string | null;
    /** Users (owner included) the workspace may have; null = not limited. */
    seat_limit: number | null;
    trial_ends_at: string | null;
    trial_expired: boolean;
    plans: ProductPlan[] | null;
    plan_validity_months: number | null;
    extra_credit_price_inr: number | null;
}

export const PLAN_ACCESS_QUERY_KEY = 'EVALEZY_PLAN_ACCESS';

export const usePlanAccess = () => {
    const instituteId = getCurrentInstituteId();
    return useQuery({
        queryKey: [PLAN_ACCESS_QUERY_KEY, instituteId],
        queryFn: async () =>
            (
                await authenticatedAxiosInstance.get<PlanAccess>(
                    `${BASE_URL}/admin-core-service/product/v1/institutes/${instituteId}/plan-access`
                )
            ).data,
        enabled: !!instituteId,
        staleTime: 60_000,
        retry: false,
        // Waiting for a payment: notice the plan going live without a reload.
        refetchInterval: (query) =>
            query.state.data?.status === 'PAYMENT_PENDING' ? 15_000 : false,
    });
};

/** Paths a "Buy <plan>" account may open before it pays: the plan, its checkout, and the profile. */
export const PAYMENT_PENDING_PATHS = ['/evalezy/plan', '/evalezy/credits', '/evalezy/profile'];

export const isPaymentPending = (access: PlanAccess | undefined) =>
    access?.status === 'PAYMENT_PENDING';

/** More than one user allowed (or not limited): the workspace can add teachers. */
export const canAddTeachers = (access: PlanAccess | undefined) =>
    !!access && (access.seat_limit == null ? access.status === 'MANAGED' : access.seat_limit > 1);
