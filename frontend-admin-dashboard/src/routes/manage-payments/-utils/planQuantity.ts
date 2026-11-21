import type { UserPlan } from '@/types/payment-logs';

/**
 * How many copies a plan covers. The server stores one user_plan per title and records the number
 * of copies on it; rows from before quantity existed (or a server that has not shipped it yet) come
 * back without the field and are one copy by definition.
 */
export const getPlanQuantity = (plan?: Pick<UserPlan, 'quantity'> | null): number => {
    const quantity = plan?.quantity;
    return typeof quantity === 'number' && Number.isFinite(quantity) && quantity >= 1
        ? Math.floor(quantity)
        : 1;
};

/** `payment_plan_dto.actual_price` is the price of ONE copy; null when the plan carries none. */
export const getPlanUnitPrice = (plan?: Pick<UserPlan, 'payment_plan_dto'> | null): number | null => {
    const price = plan?.payment_plan_dto?.actual_price;
    return typeof price === 'number' && Number.isFinite(price) ? price : null;
};

/** Unit price x quantity; null when the plan carries no unit price. */
export const getPlanLineTotal = (
    plan?: Pick<UserPlan, 'quantity' | 'payment_plan_dto'> | null
): number | null => {
    const unit = getPlanUnitPrice(plan);
    return unit === null ? null : unit * getPlanQuantity(plan);
};
