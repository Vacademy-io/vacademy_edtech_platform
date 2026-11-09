/**
 * "+ Add account" menu for the marketing screens. Picking a provider starts OAuth and
 * sends the tab to the provider's consent screen; the backend brings it back to the
 * same screen with ?mkt_session=… (handled by use-oauth-return + ConnectAccountsDialog).
 * YouTube is connected under Settings → YouTube Integration, so that item navigates there.
 */
import { useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { CaretDown, Plus } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { PlatformIcon } from './platform-meta';
import { useStartMarketingOAuth } from './use-marketing';
import type { MarketingPlatform, MarketingProvider } from './types';

interface MenuEntry {
    /** null = YouTube (Settings), not an OAuth provider. */
    provider: MarketingProvider | null;
    icons: MarketingPlatform[];
    labelKey: string;
    hintKey: string;
}

const ADS_ENTRIES: MenuEntry[] = [
    {
        provider: 'META_ADS',
        icons: ['META'],
        labelKey: 'connect.menu.metaAds',
        hintKey: 'connect.menu.metaAdsHint',
    },
    {
        provider: 'GOOGLE_ADS',
        icons: ['GOOGLE'],
        labelKey: 'connect.menu.googleAds',
        hintKey: 'connect.menu.googleAdsHint',
    },
];

const SOCIAL_ENTRIES: MenuEntry[] = [
    {
        provider: 'META_SOCIAL',
        icons: ['FACEBOOK', 'INSTAGRAM'],
        labelKey: 'connect.menu.metaSocial',
        hintKey: 'connect.menu.metaSocialHint',
    },
    {
        provider: 'GOOGLE_BUSINESS',
        icons: ['GOOGLE_BUSINESS'],
        labelKey: 'connect.menu.googleBusiness',
        hintKey: 'connect.menu.googleBusinessHint',
    },
    {
        provider: null,
        icons: ['YOUTUBE'],
        labelKey: 'connect.menu.youtube',
        hintKey: 'connect.menu.youtubeHint',
    },
];

export interface ConnectProviderMenuProps {
    kind: 'ads' | 'social';
    /** Trigger text; defaults to "Add account". */
    label?: string;
    buttonType?: 'primary' | 'secondary' | 'text';
    scale?: 'large' | 'medium' | 'small';
    align?: 'start' | 'center' | 'end';
    className?: string;
}

export function ConnectProviderMenu({
    kind,
    label,
    buttonType = 'secondary',
    scale = 'medium',
    align = 'start',
    className,
}: ConnectProviderMenuProps) {
    const { t } = useTranslation('marketing');
    const navigate = useNavigate();
    const start = useStartMarketingOAuth();
    const entries = kind === 'ads' ? ADS_ENTRIES : SOCIAL_ENTRIES;

    const choose = (entry: MenuEntry) => {
        if (entry.provider) {
            start.mutate(entry.provider);
        } else {
            navigate({ to: '/settings', search: { selectedTab: 'youtube' } });
        }
    };

    // After a successful initiate the tab is navigating away; keep the button busy.
    const busy = start.isPending || (start.isSuccess && !!start.data?.oauth_url);

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <MyButton
                    buttonType={buttonType}
                    scale={scale}
                    disable={busy}
                    className={cn('gap-1.5', className)}
                >
                    <Plus size={16} weight="bold" />
                    {busy ? t('connect.redirecting') : label ?? t('connect.addAccount')}
                    <CaretDown size={14} />
                </MyButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align={align} className="w-72">
                <DropdownMenuLabel className="text-caption font-medium text-neutral-500">
                    {kind === 'ads' ? t('connect.menu.adsTitle') : t('connect.menu.socialTitle')}
                </DropdownMenuLabel>
                {entries.map((entry) => (
                    <DropdownMenuItem
                        key={entry.labelKey}
                        className="cursor-pointer items-start gap-3 py-2"
                        onSelect={() => choose(entry)}
                    >
                        <span className="flex shrink-0">
                            {entry.icons.map((platform, index) => (
                                <span key={platform} className={index > 0 ? '-ms-1.5' : undefined}>
                                    <PlatformIcon platform={platform} size="sm" />
                                </span>
                            ))}
                        </span>
                        <span className="flex min-w-0 flex-col">
                            <span className="text-body font-medium text-neutral-800">
                                {t(entry.labelKey)}
                            </span>
                            <span className="text-caption text-neutral-500">
                                {t(entry.hintKey)}
                            </span>
                        </span>
                    </DropdownMenuItem>
                ))}
                {kind === 'ads' && (
                    <>
                        <DropdownMenuSeparator />
                        <div className="flex items-start gap-3 p-2">
                            <PlatformIcon platform="YOUTUBE" size="sm" />
                            <span className="text-caption text-neutral-500">
                                {t('connect.menu.youtubeAdsIncluded')}
                            </span>
                        </div>
                    </>
                )}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
