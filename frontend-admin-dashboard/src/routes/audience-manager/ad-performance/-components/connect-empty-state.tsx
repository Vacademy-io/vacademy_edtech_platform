/**
 * First-run state (no ad accounts yet) and the inline "needs reconnecting" alert.
 */
import { useTranslation } from 'react-i18next';
import { ChartLineUp, CheckCircle, WarningCircle } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { Card } from '@/components/ui/card';
import { PlatformIcon, adProviderFor, platformLabel } from '../../-marketing/platform-meta';
import { useStartMarketingOAuth } from '../../-marketing/use-marketing';
import type { AdAccount, AdAccountPlatform } from '../../-marketing/types';
import { accountExternalLabel } from './account-chips';

const CONNECT_CARDS: { platform: AdAccountPlatform; points: string[] }[] = [
    { platform: 'META', points: ['ads.empty.meta.point1', 'ads.empty.meta.point2'] },
    { platform: 'GOOGLE', points: ['ads.empty.google.point1', 'ads.empty.google.point2'] },
];

export function ConnectEmptyState() {
    const { t } = useTranslation('marketingAds');
    const start = useStartMarketingOAuth();
    // After a successful initiate the tab is leaving for the provider; keep buttons busy.
    const leaving = start.isPending || (start.isSuccess && !!start.data?.oauth_url);

    return (
        <Card className="flex flex-col items-center gap-8 px-6 py-12 shadow-none">
            <div className="flex max-w-xl flex-col items-center gap-3 text-center">
                <span className="flex size-12 items-center justify-center rounded-xl bg-primary-50 text-primary-500">
                    <ChartLineUp size={26} weight="duotone" />
                </span>
                <h2 className="text-h3 font-semibold text-neutral-900">{t('ads.empty.title')}</h2>
                <p className="text-body text-neutral-600">{t('ads.empty.body')}</p>
            </div>
            <div className="grid w-full max-w-3xl grid-cols-1 gap-4 md:grid-cols-2">
                {CONNECT_CARDS.map(({ platform, points }) => {
                    const provider = adProviderFor(platform);
                    const pending = start.isPending && start.variables === provider;
                    return (
                        <div
                            key={platform}
                            className="flex flex-col gap-4 rounded-xl border border-neutral-200 bg-white p-5"
                        >
                            <div className="flex items-center gap-3">
                                <PlatformIcon platform={platform} size="lg" />
                                <div className="flex flex-col">
                                    <span className="text-subtitle font-semibold text-neutral-800">
                                        {platformLabel(platform, t, 'ads')}
                                    </span>
                                    <span className="text-caption text-neutral-500">
                                        {t(
                                            `ads.empty.${platform === 'META' ? 'meta' : 'google'}.hint`
                                        )}
                                    </span>
                                </div>
                            </div>
                            <ul className="flex flex-col gap-2">
                                {points.map((key) => (
                                    <li
                                        key={key}
                                        className="flex items-start gap-2 text-caption text-neutral-600"
                                    >
                                        <CheckCircle
                                            size={16}
                                            weight="fill"
                                            className="mt-0.5 shrink-0 text-success-500"
                                        />
                                        {t(key)}
                                    </li>
                                ))}
                            </ul>
                            <MyButton
                                type="button"
                                buttonType="primary"
                                scale="medium"
                                className="mt-auto w-full"
                                disable={leaving}
                                onClick={() => start.mutate(provider)}
                            >
                                {pending
                                    ? t('ads.empty.opening')
                                    : t('ads.empty.connect', {
                                          platform: platformLabel(platform, t, 'ads'),
                                      })}
                            </MyButton>
                        </div>
                    );
                })}
            </div>
            <p className="flex items-center gap-2 text-caption text-neutral-500">
                <PlatformIcon platform="YOUTUBE" size="sm" />
                {t('ads.empty.youtubeNote')}
            </p>
        </Card>
    );
}

/** Accounts that need a fresh sign-in, grouped by provider with one Reconnect each. */
export function ReconnectAlert({ accounts }: { accounts: AdAccount[] }) {
    const { t } = useTranslation('marketingAds');
    const start = useStartMarketingOAuth();
    const leaving = start.isPending || (start.isSuccess && !!start.data?.oauth_url);
    const platforms = (['META', 'GOOGLE'] as const).filter((p) =>
        accounts.some((a) => a.platform === p)
    );
    if (platforms.length === 0) return null;

    return (
        <div
            role="alert"
            className="flex flex-col gap-3 rounded-xl border border-warning-200 bg-warning-50 px-4 py-3"
        >
            {platforms.map((platform) => {
                const list = accounts.filter((a) => a.platform === platform);
                const detail = list.find((a) => a.status_detail)?.status_detail;
                return (
                    <div
                        key={platform}
                        className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
                    >
                        <div className="flex min-w-0 items-start gap-3">
                            <WarningCircle
                                size={20}
                                weight="fill"
                                className="mt-0.5 shrink-0 text-warning-600"
                            />
                            <div className="flex min-w-0 flex-col gap-0.5">
                                <p className="text-body font-semibold text-warning-700">
                                    {t('ads.reconnect.title', {
                                        count: list.length,
                                        platform: platformLabel(platform, t, 'ads'),
                                    })}
                                </p>
                                <p className="text-caption text-warning-700">
                                    {list.map((a) => a.name || accountExternalLabel(a)).join(', ')}
                                    {detail ? ` — ${detail}` : ''}
                                </p>
                                <p className="text-caption text-neutral-600">
                                    {t('ads.reconnect.hint')}
                                </p>
                            </div>
                        </div>
                        <MyButton
                            type="button"
                            buttonType="secondary"
                            scale="small"
                            className="shrink-0 bg-white"
                            disable={leaving}
                            onClick={() => start.mutate(adProviderFor(platform))}
                        >
                            {t('ads.reconnect.button')}
                        </MyButton>
                    </div>
                );
            })}
        </div>
    );
}
