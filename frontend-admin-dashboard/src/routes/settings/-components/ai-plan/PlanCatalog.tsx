/**
 * Plan cards, the comparison table and the plan detail dialog. Purely a view
 * of the storefront catalog: which plans appear, their prices and the action
 * on each card (subscribe / upgrade / switch at renewal / current / contact)
 * all come from the server.
 */
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Info, SealCheck } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { cn } from '@/lib/utils';
import { formatNumber } from '@/lib/formatters';
import { usePlatformBrand } from '@/lib/platform-brand';
import { priceLines } from '@/services/ai-plans/format';
import type {
    PlanAction,
    PlanFeatureMode,
    Storefront,
    StorefrontFeature,
    StorefrontPlan,
} from '@/services/ai-plans/storefront';
import { ModeBadge } from './plan-ui';

interface PlanCatalogProps {
    storefront: Storefront;
    onChoose: (plan: StorefrontPlan, action: PlanAction) => void;
    busy?: boolean;
}

const ACTION_KEY: Record<PlanAction, string> = {
    SUBSCRIBE: 'actions.subscribe',
    UPGRADE: 'actions.upgrade',
    DOWNGRADE: 'actions.downgrade',
    CURRENT: 'actions.current',
    CONTACT_SALES: 'actions.contact',
};

function PlanActionButton({
    plan,
    onChoose,
    busy,
    full = true,
}: {
    plan: StorefrontPlan;
    onChoose: (plan: StorefrontPlan, action: PlanAction) => void;
    busy?: boolean;
    full?: boolean;
}) {
    const { t } = useTranslation('aiPlans');
    const brand = usePlatformBrand();
    const isCurrent = plan.action === 'CURRENT';
    return (
        <MyButton
            buttonType={
                plan.action === 'SUBSCRIBE' || plan.action === 'UPGRADE' ? 'primary' : 'secondary'
            }
            scale="medium"
            className={cn(full && 'w-full')}
            disable={isCurrent || busy}
            onClick={() => onChoose(plan, plan.action)}
        >
            {t(ACTION_KEY[plan.action], brand.vars)}
        </MyButton>
    );
}

function PlanCard({
    plan,
    onChoose,
    onDetails,
    busy,
}: {
    plan: StorefrontPlan;
    onChoose: (plan: StorefrontPlan, action: PlanAction) => void;
    onDetails: () => void;
    busy?: boolean;
}) {
    const { t } = useTranslation('aiPlans');
    const brand = usePlatformBrand();
    const lines = priceLines(plan.price, plan.period_months, t);
    return (
        <article
            className={cn(
                'relative flex flex-col rounded-xl border bg-white p-4 shadow-sm',
                plan.is_current
                    ? 'border-primary-400 ring-2 ring-primary-100'
                    : 'border-neutral-200'
            )}
        >
            <div className="flex flex-wrap items-center gap-2">
                <h4 className="text-subtitle font-semibold text-neutral-900">
                    {brand.scrubText(plan.name)}
                </h4>
                {plan.is_current && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-primary-50 px-2 py-0.5 text-2xs font-semibold text-primary-600">
                        <SealCheck className="size-3" weight="fill" />
                        {t('card.yourPlan')}
                    </span>
                )}
                {!plan.is_current && plan.badge && (
                    <span className="rounded-full bg-primary-500 px-2 py-0.5 text-2xs font-semibold text-white">
                        {brand.scrubText(plan.badge)}
                    </span>
                )}
            </div>
            {plan.tagline && (
                <p className="mt-1 text-caption text-neutral-500">
                    {brand.scrubText(plan.tagline)}
                </p>
            )}
            <p className="mt-3 text-h3 font-bold text-neutral-900">{lines.headline}</p>
            <p className="text-caption text-neutral-500">{lines.inclusive}</p>
            {plan.allowance_credits > 0 && (
                <p className="mt-3 rounded-md bg-primary-50 px-2.5 py-1.5 text-caption text-primary-600">
                    {t('card.allowance', {
                        credits: formatNumber(plan.allowance_credits, { maximumFractionDigits: 0 }),
                        period: lines.period,
                    })}
                </p>
            )}
            {plan.highlights.length > 0 && (
                <ul className="mt-3 space-y-1.5">
                    {plan.highlights.map((h, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm text-neutral-700">
                            <Check
                                className="mt-0.5 size-4 shrink-0 text-success-600"
                                weight="bold"
                            />
                            <span>{brand.scrubText(h)}</span>
                        </li>
                    ))}
                </ul>
            )}
            <div className="mt-auto flex flex-col gap-2 pt-4">
                <PlanActionButton plan={plan} onChoose={onChoose} busy={busy} />
                <button
                    type="button"
                    onClick={onDetails}
                    className="inline-flex items-center justify-center gap-1 text-caption font-medium text-primary-500 hover:underline"
                >
                    <Info className="size-3.5" />
                    {t('card.details')}
                </button>
            </div>
        </article>
    );
}

interface CompareRow {
    key: string;
    label: string;
}

/** Union of features across plans, in first-seen order. */
export function compareRows(plans: StorefrontPlan[]): CompareRow[] {
    const seen = new Map<string, CompareRow>();
    for (const p of plans) {
        for (const f of p.features) {
            if (!seen.has(f.feature_key))
                seen.set(f.feature_key, { key: f.feature_key, label: f.label });
        }
    }
    return [...seen.values()];
}

function featureOf(plan: StorefrontPlan, key: string): StorefrontFeature | null {
    return plan.features.find((f) => f.feature_key === key) ?? null;
}

function CompareTable({ plans }: { plans: StorefrontPlan[] }) {
    const { t } = useTranslation('aiPlans');
    const brand = usePlatformBrand();
    const rows = useMemo(() => compareRows(plans), [plans]);
    if (plans.length === 0 || rows.length === 0) return null;
    return (
        <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white">
            <table className="w-full min-w-max border-collapse text-sm">
                <caption className="sr-only">{t('compare.caption')}</caption>
                <thead>
                    <tr className="bg-neutral-50">
                        <th
                            scope="col"
                            className="sticky start-0 z-10 bg-neutral-50 px-3 py-2 text-start text-caption font-semibold text-neutral-600"
                        >
                            {t('compare.feature')}
                        </th>
                        {plans.map((p) => (
                            <th
                                key={p.plan_version_id}
                                scope="col"
                                className={cn(
                                    'px-3 py-2 text-start text-caption font-semibold',
                                    p.is_current ? 'text-primary-600' : 'text-neutral-700'
                                )}
                            >
                                {brand.scrubText(p.name)}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    <tr className="border-t border-neutral-100">
                        <th
                            scope="row"
                            className="sticky start-0 z-10 bg-white px-3 py-2 text-start font-medium text-neutral-700"
                        >
                            {t('compare.price')}
                        </th>
                        {plans.map((p) => (
                            <td key={p.plan_version_id} className="px-3 py-2 text-neutral-800">
                                {priceLines(p.price, p.period_months, t).headline}
                            </td>
                        ))}
                    </tr>
                    <tr className="border-t border-neutral-100">
                        <th
                            scope="row"
                            className="sticky start-0 z-10 bg-white px-3 py-2 text-start font-medium text-neutral-700"
                        >
                            {t('compare.allowance')}
                        </th>
                        {plans.map((p) => (
                            <td key={p.plan_version_id} className="px-3 py-2 text-neutral-800">
                                {p.allowance_credits > 0
                                    ? t('compare.allowanceValue', {
                                          credits: formatNumber(p.allowance_credits, {
                                              maximumFractionDigits: 0,
                                          }),
                                      })
                                    : t('compare.none')}
                            </td>
                        ))}
                    </tr>
                    {rows.map((r) => (
                        <tr key={r.key} className="border-t border-neutral-100">
                            <th
                                scope="row"
                                className="sticky start-0 z-10 bg-white px-3 py-2 text-start font-medium text-neutral-700"
                            >
                                {brand.scrubText(r.label)}
                            </th>
                            {plans.map((p) => {
                                const f = featureOf(p, r.key);
                                const mode: PlanFeatureMode = f?.mode ?? 'CHARGED';
                                return (
                                    <td key={p.plan_version_id} className="px-3 py-2 align-top">
                                        <ModeBadge mode={mode} />
                                        {f?.display_cap_text && mode === 'INCLUDED' && (
                                            <p className="mt-1 max-w-48 text-2xs text-neutral-500">
                                                {brand.scrubText(f.display_cap_text)}
                                            </p>
                                        )}
                                    </td>
                                );
                            })}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

export function PlanDetailDialog({
    plan,
    onClose,
    onChoose,
}: {
    plan: StorefrontPlan | null;
    onClose: () => void;
    onChoose: (plan: StorefrontPlan, action: PlanAction) => void;
}) {
    const { t } = useTranslation('aiPlans');
    const brand = usePlatformBrand();
    if (!plan) return null;
    const lines = priceLines(plan.price, plan.period_months, t);
    const groups: PlanFeatureMode[] = ['INCLUDED', 'ALLOWANCE', 'CHARGED'];
    return (
        <MyDialog
            open
            onOpenChange={(o) => !o && onClose()}
            heading={brand.scrubText(plan.name)}
            dialogWidth="max-w-lg"
            footer={
                <div className="flex w-full justify-end gap-2">
                    <MyButton buttonType="secondary" scale="medium" onClick={onClose}>
                        {t('actions.close')}
                    </MyButton>
                    {plan.action !== 'CURRENT' && (
                        <PlanActionButton
                            plan={plan}
                            full={false}
                            onChoose={(p, a) => {
                                onClose();
                                onChoose(p, a);
                            }}
                        />
                    )}
                </div>
            }
        >
            <div className="space-y-4 p-4 sm:p-6">
                {plan.tagline && (
                    <p className="text-body text-neutral-600">{brand.scrubText(plan.tagline)}</p>
                )}
                <div>
                    <p className="text-h3 font-bold text-neutral-900">{lines.headline}</p>
                    <p className="text-caption text-neutral-500">{lines.inclusive}</p>
                </div>
                {plan.allowance_credits > 0 && (
                    <p className="text-caption text-neutral-600">
                        {t('card.allowance', {
                            credits: formatNumber(plan.allowance_credits, {
                                maximumFractionDigits: 0,
                            }),
                            period: lines.period,
                        })}{' '}
                        {t('detail.allowanceNoCarry')}
                    </p>
                )}
                {groups.map((mode) => {
                    const items = plan.features.filter((f) => f.mode === mode);
                    if (items.length === 0) return null;
                    return (
                        <section key={mode}>
                            <h5 className="mb-1 text-caption font-semibold text-neutral-700">
                                {t(`detail.group.${mode}`)}
                            </h5>
                            <ul className="divide-y divide-neutral-100 rounded-lg border border-neutral-100">
                                {items.map((f) => (
                                    <li key={f.feature_key} className="px-3 py-2">
                                        <div className="flex items-center justify-between gap-2">
                                            <span className="text-sm text-neutral-800">
                                                {brand.scrubText(f.label)}
                                            </span>
                                            <ModeBadge mode={f.mode} />
                                        </div>
                                        {f.display_cap_text && (
                                            <p className="mt-0.5 text-2xs text-neutral-500">
                                                {brand.scrubText(f.display_cap_text)}
                                            </p>
                                        )}
                                    </li>
                                ))}
                            </ul>
                        </section>
                    );
                })}
                <p className="text-2xs text-neutral-500">{t('footnotes.fairUse')}</p>
            </div>
        </MyDialog>
    );
}

export function PlanCatalog({ storefront, onChoose, busy }: PlanCatalogProps) {
    const { t } = useTranslation('aiPlans');
    const [detail, setDetail] = useState<StorefrontPlan | null>(null);
    const [showCompare, setShowCompare] = useState(false);
    const plans = storefront.plans;

    if (plans.length === 0) {
        return (
            <div className="rounded-lg border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-500">
                {t('catalog.empty')}
            </div>
        );
    }

    return (
        <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                {plans.map((p) => (
                    <PlanCard
                        key={p.plan_version_id}
                        plan={p}
                        onChoose={onChoose}
                        onDetails={() => setDetail(p)}
                        busy={busy}
                    />
                ))}
            </div>

            <div className="space-y-1">
                <p className="text-2xs text-neutral-500">{t('footnotes.fairUse')}</p>
                <p className="text-2xs text-neutral-500">{t('footnotes.uncovered')}</p>
            </div>

            {compareRows(plans).length > 0 && (
                <div className="space-y-2">
                    <button
                        type="button"
                        onClick={() => setShowCompare((v) => !v)}
                        aria-expanded={showCompare}
                        className="text-caption font-medium text-primary-500 hover:underline"
                    >
                        {showCompare ? t('compare.hide') : t('compare.show')}
                    </button>
                    {showCompare && <CompareTable plans={plans} />}
                </div>
            )}

            <PlanDetailDialog plan={detail} onClose={() => setDetail(null)} onChoose={onChoose} />
        </div>
    );
}
