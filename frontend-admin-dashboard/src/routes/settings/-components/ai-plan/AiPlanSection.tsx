/**
 * Settings → AI → Plan (admins only, and only while the institute has an AI
 * plan in effect — AiSettings hides the tab otherwise). Read-only: what the
 * plan includes, what it pays from the monthly allowance, what still uses
 * credits, and how much of each fair-use cap is used this period. The plan is
 * assigned and changed by the platform team; nothing here edits it. When the
 * self-serve storefront is on, AiPlanBilling embeds this as "what's included".
 */
import { useTranslation } from 'react-i18next';
import { Coins, SealCheck, Wallet } from '@phosphor-icons/react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { formatDate, formatNumber } from '@/lib/formatters';
import { getInstituteId } from '@/constants/helper';
import { usePlatformBrand } from '@/lib/platform-brand';
import {
    allowancePct,
    featuresByMode,
    isPlanInEffect,
    useAiPlanQuery,
    type PlanFeatureMode,
    type TenantPlanFeature,
} from '@/components/common/ai-credits/aiPlan';

const MODE_ORDER: PlanFeatureMode[] = ['INCLUDED', 'ALLOWANCE', 'CHARGED'];

const MODE_BADGE: Record<PlanFeatureMode, string> = {
    INCLUDED: 'bg-success-50 text-success-700',
    ALLOWANCE: 'bg-purple-50 text-purple-700',
    CHARGED: 'bg-neutral-100 text-neutral-600',
};

const MODE_KEY: Record<PlanFeatureMode, string> = {
    INCLUDED: 'mode.included',
    ALLOWANCE: 'mode.allowance',
    CHARGED: 'mode.charged',
};

function barClass(pct: number): string {
    if (pct >= 100) return '[&>div]:bg-danger-500';
    if (pct >= 80) return '[&>div]:bg-warning-500';
    return '[&>div]:bg-success-500';
}

function FeatureRow({ feature }: { feature: TenantPlanFeature }) {
    const { t } = useTranslation('settingsAiPlan');
    const brand = usePlatformBrand();
    const pct = feature.usage_pct;
    return (
        <li className="space-y-1.5 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-medium text-neutral-800">
                    {brand.scrubText(feature.label)}
                </span>
                <span
                    className={cn(
                        'rounded px-1.5 py-0.5 text-2xs font-semibold',
                        MODE_BADGE[feature.mode]
                    )}
                >
                    {t(MODE_KEY[feature.mode])}
                </span>
            </div>
            {feature.display_cap_text && (
                <p className="text-caption text-neutral-500">
                    {brand.scrubText(feature.display_cap_text)}
                </p>
            )}
            {feature.mode === 'INCLUDED' && pct !== null && (
                <div className="space-y-1">
                    <Progress value={pct} className={cn('h-1.5 bg-neutral-100', barClass(pct))} />
                    <p className="text-2xs text-neutral-500">
                        {pct >= 100
                            ? t('fairUse.reached')
                            : t('fairUse.used', {
                                  pct: formatNumber(pct, { maximumFractionDigits: 0 }),
                              })}
                    </p>
                </div>
            )}
            {feature.mode === 'INCLUDED' && feature.any_model && (
                <p className="text-2xs text-neutral-500">{t('models.any')}</p>
            )}
            {feature.mode === 'INCLUDED' && !feature.any_model && feature.included_models.length > 0 && (
                <p className="text-2xs text-neutral-500">
                    {t('models.included', { models: feature.included_models.join(', ') })}
                </p>
            )}
        </li>
    );
}

export function AiPlanSection({ embedded = false }: { embedded?: boolean } = {}) {
    const { t } = useTranslation('settingsAiPlan');
    const instituteId = getInstituteId() ?? '';
    const brand = usePlatformBrand(instituteId);
    const { data, isLoading } = useAiPlanQuery(instituteId);

    if (isLoading) return <p className="text-sm text-neutral-500">{t('loading')}</p>;
    if (!isPlanInEffect(data)) {
        return (
            <div className="rounded-lg border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-500">
                {t('none')}
            </div>
        );
    }

    const grouped = featuresByMode(data);
    const pct = allowancePct(data);
    const start = data.plan.period_start ? formatDate(data.plan.period_start) : null;
    const end = data.plan.period_end ? formatDate(data.plan.period_end) : null;

    return (
        <div className="space-y-4">
            {embedded ? (
                <h4 className="text-subtitle font-semibold text-neutral-800">{t('heading')}</h4>
            ) : (
                <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                        <SealCheck className="size-5 text-primary-500" weight="fill" />
                        <h3 className="text-h3 font-semibold text-neutral-700">{t('heading')}</h3>
                    </div>
                    <p className="text-body text-neutral-500">{t('description', brand.vars)}</p>
                </div>
            )}

            <Card className="border-neutral-200 shadow-sm">
                <CardHeader>
                    <div className="flex flex-wrap items-center gap-2">
                        <CardTitle className="text-base">
                            {brand.scrubText(data.plan.name)}
                        </CardTitle>
                        {data.plan.status === 'TRIAL' && (
                            <span className="rounded bg-info-50 px-1.5 py-0.5 text-2xs font-semibold text-info-700">
                                {t('status.trial')}
                            </span>
                        )}
                        {data.plan.status === 'GRACE' && (
                            <span className="rounded bg-warning-50 px-1.5 py-0.5 text-2xs font-semibold text-warning-700">
                                {t('status.grace')}
                            </span>
                        )}
                    </div>
                    {start && end && (
                        <CardDescription>{t('period', { start, end })}</CardDescription>
                    )}
                </CardHeader>
                <CardContent className="space-y-2">
                    {data.allowance.credits > 0 ? (
                        <>
                            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                                <span className="flex items-center gap-1.5 font-medium text-neutral-700">
                                    <Wallet className="size-4 text-purple-500" />
                                    {t('allowance.title')}
                                </span>
                                <span className="text-caption text-neutral-600">
                                    {t('allowance.line', {
                                        used: formatNumber(data.allowance.used, {
                                            maximumFractionDigits: 1,
                                        }),
                                        total: formatNumber(data.allowance.credits, {
                                            maximumFractionDigits: 0,
                                        }),
                                        remaining: formatNumber(data.allowance.remaining, {
                                            maximumFractionDigits: 1,
                                        }),
                                    })}
                                </span>
                            </div>
                            <Progress
                                value={pct ?? 0}
                                className={cn('h-2 bg-neutral-100', barClass(pct ?? 0))}
                            />
                            <p className="text-caption text-neutral-500">{t('allowance.hint')}</p>
                        </>
                    ) : (
                        <p className="text-caption text-neutral-500">{t('allowance.none')}</p>
                    )}
                </CardContent>
            </Card>

            {MODE_ORDER.map((mode) =>
                grouped[mode].length === 0 ? null : (
                    <Card key={mode} className="border-neutral-200 shadow-sm">
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2 text-base">
                                {mode === 'CHARGED' ? (
                                    <Coins className="size-4 text-neutral-500" />
                                ) : (
                                    <SealCheck className="size-4 text-success-600" />
                                )}
                                {t(`groups.${mode}.title`)}
                            </CardTitle>
                            <CardDescription>{t(`groups.${mode}.description`)}</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <ul className="divide-y divide-neutral-100">
                                {grouped[mode].map((f) => (
                                    <FeatureRow key={f.feature_key} feature={f} />
                                ))}
                            </ul>
                        </CardContent>
                    </Card>
                )
            )}
        </div>
    );
}
