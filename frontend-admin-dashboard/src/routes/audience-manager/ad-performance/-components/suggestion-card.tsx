/**
 * "Agent suggestion": which platform turns spend into admissions most cheaply and how
 * much to consider moving to it. Advice only — the button opens the platform's own ads
 * manager; nothing here changes a budget.
 */
import { useTranslation } from 'react-i18next';
import { ArrowSquareOut, Lightbulb, Sparkle } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { Card } from '@/components/ui/card';
import { StatusPill } from '@/components/shared/crm-enhance/screen-header';
import { PlatformIcon, adsManagerUrl, platformLabel } from '../../-marketing/platform-meta';
import type { AdPerformancePlatform, AdPerformanceSuggestion } from '../../-marketing/types';
import { formatMoney } from './ad-performance-utils';

function PlatformCostList({
    platforms,
    suggestion,
    currency,
}: {
    platforms: AdPerformancePlatform[];
    suggestion: AdPerformanceSuggestion | null;
    currency: string;
}) {
    const { t } = useTranslation('marketingAds');
    const spending = platforms.filter((p) => p.spend > 0);
    if (spending.length === 0) return null;
    return (
        <ul className="flex flex-col divide-y divide-neutral-100 rounded-lg border border-neutral-100">
            {spending.map((row) => (
                <li key={row.platform} className="flex items-center gap-3 px-3 py-2">
                    <PlatformIcon platform={row.platform} size="sm" />
                    <span className="min-w-0 flex-1 truncate text-caption font-medium text-neutral-700">
                        {platformLabel(row.platform, t, 'ads')}
                    </span>
                    {suggestion?.best_platform === row.platform && (
                        <StatusPill tone="success">{t('ads.suggestion.best')}</StatusPill>
                    )}
                    {suggestion?.worst_platform === row.platform && (
                        <StatusPill tone="warning">{t('ads.suggestion.worst')}</StatusPill>
                    )}
                    <span className="text-end text-caption tabular-nums text-neutral-800">
                        {row.cost_per_admission !== null
                            ? t('ads.suggestion.perAdmission', {
                                  amount: formatMoney(row.cost_per_admission, currency),
                              })
                            : t('ads.suggestion.noAdmissions')}
                    </span>
                </li>
            ))}
        </ul>
    );
}

export function SuggestionCard({
    suggestion,
    platforms,
    currency,
}: {
    suggestion: AdPerformanceSuggestion | null;
    platforms: AdPerformancePlatform[];
    currency: string;
}) {
    const { t } = useTranslation('marketingAds');

    return (
        <Card className="flex flex-col gap-4 p-5 shadow-none">
            <div className="flex items-center gap-2">
                <span className="flex size-8 items-center justify-center rounded-lg bg-primary-50 text-primary-500">
                    <Sparkle size={18} weight="fill" />
                </span>
                <h2 className="text-subtitle font-semibold text-neutral-800">
                    {t('ads.suggestion.title')}
                </h2>
            </div>

            {suggestion ? (
                <>
                    <p className="text-body text-neutral-700">
                        {t('ads.suggestion.sentence', {
                            best: platformLabel(suggestion.best_platform, t, 'ads'),
                            bestCost: formatMoney(suggestion.best_cost_per_admission, currency),
                            amount: formatMoney(suggestion.suggested_amount, currency),
                            worst: platformLabel(suggestion.worst_platform, t, 'ads'),
                        })}
                    </p>
                    <PlatformCostList
                        platforms={platforms}
                        suggestion={suggestion}
                        currency={currency}
                    />
                    <p className="flex items-start gap-1.5 text-caption text-neutral-500">
                        <Lightbulb size={14} className="mt-0.5 shrink-0" />
                        {t('ads.suggestion.trackedNote')}
                    </p>
                    <div className="mt-auto flex flex-col gap-1.5">
                        <MyButton
                            type="button"
                            buttonType="secondary"
                            scale="medium"
                            className="w-full gap-2"
                            onClick={() =>
                                window.open(
                                    adsManagerUrl(suggestion.worst_platform),
                                    '_blank',
                                    'noopener,noreferrer'
                                )
                            }
                        >
                            {t(`ads.suggestion.openManager.${suggestion.worst_platform}`)}
                            <ArrowSquareOut size={16} />
                        </MyButton>
                        <span className="text-center text-caption text-neutral-400">
                            {t('ads.suggestion.adviceOnly')}
                        </span>
                    </div>
                </>
            ) : (
                <div className="flex flex-1 flex-col gap-3">
                    <p className="text-body text-neutral-600">{t('ads.suggestion.empty')}</p>
                    <PlatformCostList platforms={platforms} suggestion={null} currency={currency} />
                    <p className="mt-auto flex items-start gap-1.5 text-caption text-neutral-500">
                        <Lightbulb size={14} className="mt-0.5 shrink-0" />
                        {t('ads.suggestion.trackedNote')}
                    </p>
                </div>
            )}
        </Card>
    );
}
