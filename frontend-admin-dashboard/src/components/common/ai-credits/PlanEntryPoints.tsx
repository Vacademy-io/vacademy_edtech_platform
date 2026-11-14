/**
 * Ways into Settings → AI → Plan & billing from the credits surfaces. Every
 * one of them renders NOTHING unless the storefront GET succeeded for this
 * admin (it is off by default, admin-only and hidden on native iOS), so
 * institutes without the storefront see no change.
 */
import { useEffect, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowRight, SealPercent } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import { usePlatformBrand } from '@/lib/platform-brand';
import { formatMinor, periodKey } from '@/services/ai-plans/format';
import {
    PLANS_SETTINGS_PATH,
    canRequestStorefront,
    getStorefrontSnapshot,
    loadStorefront,
    subscribeStorefront,
    useStorefrontQuery,
    type Storefront,
} from '@/services/ai-plans/storefront';

export function goToPlans() {
    window.location.assign(PLANS_SETTINGS_PATH);
}

/** The cheapest offered plan's base price per its period, for "Plans from …". */
export function cheapestPlan(sf: Storefront | null | undefined) {
    const plans = (sf?.plans ?? []).filter((p) => p.price.base_minor > 0);
    if (plans.length === 0) return null;
    return plans.reduce((min, p) => (p.price.base_minor < min.price.base_minor ? p : min));
}

/**
 * A sonner toast action ("See AI plans") for out-of-credit errors, only when
 * this session already knows the storefront is visible for this admin (cached
 * by the credits popover or the settings tab). Never fetches; undefined = no
 * button, so the toast stays exactly as before.
 */
export function plansToastAction(
    label: string,
    instituteId: string | null | undefined = safeInstituteId()
): { label: string; onClick: () => void } | undefined {
    if (!canRequestStorefront(instituteId)) return undefined;
    return getStorefrontSnapshot(instituteId) ? { label, onClick: goToPlans } : undefined;
}

function safeInstituteId(): string | null {
    try {
        return getCurrentInstituteId() ?? null;
    } catch {
        return null;
    }
}

/** In-tree (QueryClient available): the storefront or null. */
export function useStorefrontVisible(instituteId: string | null | undefined, enabled = true) {
    const q = useStorefrontQuery(instituteId, enabled);
    return q.data ?? null;
}

/**
 * Out-of-tree (no QueryClient, e.g. the limit dialog's own React root): read
 * the shared cache and fetch once if this session never asked.
 */
export function useStorefrontProbe(
    instituteId: string | null | undefined,
    enabled = true
): Storefront | null {
    const snapshot = useSyncExternalStore(
        subscribeStorefront,
        () => getStorefrontSnapshot(instituteId),
        () => null
    );
    const allowed = enabled && canRequestStorefront(instituteId);
    const needsLoad = allowed && snapshot === undefined;
    useEffect(() => {
        if (needsLoad && instituteId) void loadStorefront(instituteId);
    }, [needsLoad, instituteId]);
    return allowed ? snapshot ?? null : null;
}

export function SeePlansButton({ className, label }: { className?: string; label?: string }) {
    const { t } = useTranslation('aiPlans');
    return (
        <button
            type="button"
            onClick={goToPlans}
            className={cn(
                'inline-flex items-center gap-1 text-caption font-semibold text-primary-500 hover:underline',
                className
            )}
        >
            {label ?? t('entry.seePlans')}
            <ArrowRight className="size-3 rtl:rotate-180" weight="bold" />
        </button>
    );
}

/** Popover overview, no plan yet: "Use AI every day? Plans from ₹5,000 / month + GST". */
export function PlanPromoCard({ storefront }: { storefront: Storefront }) {
    const { t } = useTranslation('aiPlans');
    const brand = usePlatformBrand();
    const cheapest = cheapestPlan(storefront);
    return (
        <div className="rounded-xl border border-primary-100 bg-white p-2.5">
            <div className="flex items-start gap-2">
                <SealPercent className="mt-0.5 size-4 shrink-0 text-primary-500" weight="fill" />
                <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-neutral-800">
                        {t('entry.promoTitle')}
                    </p>
                    <p className="mt-0.5 text-2xs text-neutral-500">
                        {cheapest
                            ? t('entry.promoFrom', {
                                  price: formatMinor(
                                      cheapest.price.base_minor,
                                      cheapest.price.currency
                                  ),
                                  period: t(`period.${periodKey(cheapest.period_months)}`, {
                                      months: cheapest.period_months,
                                  }),
                              })
                            : t('entry.promoBody', brand.vars)}
                    </p>
                    <SeePlansButton className="mt-1.5" />
                </div>
            </div>
        </div>
    );
}

/** Popover overview, low balance or ≤ 7 days left: "Compare plans" next to the top-up. */
export function LowCreditPlansNudge() {
    const { t } = useTranslation('aiPlans');
    return (
        <div className="rounded-lg border border-warning-200 bg-warning-50 px-3 py-2">
            <p className="text-2xs leading-relaxed text-warning-700">{t('entry.lowCredit')}</p>
            <SeePlansButton className="mt-1" label={t('entry.comparePlans')} />
        </div>
    );
}

/** True when the overview should nudge towards plans instead of only a top-up. */
export function shouldNudgePlans(
    isLowBalance: boolean,
    daysRemaining: number | string | null | undefined
) {
    if (isLowBalance) return true;
    if (daysRemaining === null || daysRemaining === undefined || daysRemaining === '') return false;
    const d = typeof daysRemaining === 'number' ? daysRemaining : Number(daysRemaining);
    return Number.isFinite(d) && d <= 7;
}
