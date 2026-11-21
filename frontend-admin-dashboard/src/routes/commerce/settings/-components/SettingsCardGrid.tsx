import { useTranslation } from 'react-i18next';
import { Link } from '@tanstack/react-router';
import { ArrowRight } from '@phosphor-icons/react';
import { StatusChip } from '@/components/design-system/status-chips';
import { useCommerceAccess } from '@/lib/commerce/use-commerce-access';
import { cn } from '@/lib/utils';
import { SETTINGS_CARDS, type SettingsCard } from './settings-cards';

type CardState = 'open' | 'comingSoon' | 'featureOff';

/** `/commerce/settings`: a card grid; each live card opens its page. */
export function SettingsCardGrid() {
    const { t } = useTranslation('commerce');
    const access = useCommerceAccess();

    const stateOf = (card: SettingsCard): CardState => {
        if (!card.to) return 'comingSoon';
        if (card.anyFeature && !card.anyFeature.some(access.isFeatureOn)) return 'featureOff';
        return 'open';
    };

    return (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {SETTINGS_CARDS.map((card) => {
                const state = stateOf(card);
                const Icon = card.icon;
                const body = (
                    <div
                        className={cn(
                            'flex h-full flex-col gap-3 rounded-lg border border-border bg-card p-4',
                            state === 'open'
                                ? 'hover:border-primary-300 hover:bg-neutral-50'
                                : 'opacity-70'
                        )}
                    >
                        <div className="flex items-start justify-between gap-3">
                            <span className="flex size-10 items-center justify-center rounded-md bg-primary-50 text-primary-500">
                                <Icon size={20} />
                            </span>
                            {state === 'comingSoon' && (
                                <StatusChip
                                    text={t('comingSoon.badge')}
                                    textSize="text-caption"
                                    status="INFO"
                                    showIcon={false}
                                />
                            )}
                            {state === 'featureOff' && (
                                <StatusChip
                                    text={t('settings.featureOffBadge')}
                                    textSize="text-caption"
                                    status="WARNING"
                                    showIcon={false}
                                />
                            )}
                            {state === 'open' && (
                                <ArrowRight
                                    size={16}
                                    className="mt-1 text-muted-foreground rtl:rotate-180"
                                />
                            )}
                        </div>
                        <div className="flex flex-col gap-1">
                            <span className="text-subtitle font-medium text-foreground">
                                {t(`settings.cards.${card.id}.title`)}
                            </span>
                            <span className="text-caption text-muted-foreground">
                                {t(`settings.cards.${card.id}.description`)}
                            </span>
                        </div>
                    </div>
                );
                return (
                    <li key={card.id}>
                        {state === 'open' && card.to ? (
                            <Link
                                to={card.to as never}
                                className="block h-full rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300"
                            >
                                {body}
                            </Link>
                        ) : (
                            <div aria-disabled="true" className="h-full">
                                {body}
                            </div>
                        )}
                    </li>
                );
            })}
        </ul>
    );
}
