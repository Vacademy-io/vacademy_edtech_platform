/**
 * Everything the marketing screens need to draw a platform consistently: the icon tile,
 * the translated label, the chart colour, the provider that (re)connects it and the
 * platform's own manager URL.
 */
import type { TFunction } from 'i18next';
import {
    FacebookLogo,
    GoogleLogo,
    InstagramLogo,
    MetaLogo,
    YoutubeLogo,
    type Icon,
} from '@phosphor-icons/react';
import type { ChartConfig } from '@/components/ui/chart';
import { cn } from '@/lib/utils';
import type { AdPlatform, MarketingPlatform, MarketingProvider, SocialPlatform } from './types';

/** Report order: Meta, Google, YouTube (also the stack order in charts). */
export const AD_PLATFORMS: readonly AdPlatform[] = ['META', 'GOOGLE', 'YOUTUBE'];
export const SOCIAL_PLATFORMS: readonly SocialPlatform[] = [
    'FACEBOOK',
    'INSTAGRAM',
    'GOOGLE_BUSINESS',
    'YOUTUBE',
];

/** Which list a platform is drawn for; only YOUTUBE exists in both. */
export type PlatformKind = 'ads' | 'social';

const AD_ONLY = new Set<string>(['META', 'GOOGLE']);

function resolveKind(platform: MarketingPlatform, kind?: PlatformKind): PlatformKind {
    if (AD_ONLY.has(platform)) return 'ads';
    if (platform !== 'YOUTUBE') return 'social';
    return kind ?? 'ads';
}

interface IconStyle {
    icon: Icon;
    /** Token colour for the glyph; the tile itself stays neutral. */
    tone: string;
}

const ICONS: Record<MarketingPlatform, IconStyle> = {
    META: { icon: MetaLogo, tone: 'text-info-600' },
    GOOGLE: { icon: GoogleLogo, tone: 'text-neutral-700' },
    YOUTUBE: { icon: YoutubeLogo, tone: 'text-danger-600' },
    FACEBOOK: { icon: FacebookLogo, tone: 'text-info-600' },
    INSTAGRAM: { icon: InstagramLogo, tone: 'text-danger-500' },
    GOOGLE_BUSINESS: { icon: GoogleLogo, tone: 'text-neutral-700' },
};

export type PlatformIconSize = 'sm' | 'md' | 'lg';

const TILE: Record<PlatformIconSize, { box: string; glyph: number }> = {
    sm: { box: 'size-6 rounded-md', glyph: 14 },
    md: { box: 'size-8 rounded-md', glyph: 18 },
    lg: { box: 'size-10 rounded-lg', glyph: 22 },
};

/** Brand glyph inside a rounded neutral tile, as in the marketing screens. */
export function PlatformIcon({
    platform,
    size = 'md',
    className,
    title,
}: {
    platform: MarketingPlatform;
    size?: PlatformIconSize;
    className?: string;
    /** Accessible name; omit when a visible label sits next to the tile. */
    title?: string;
}) {
    const style = ICONS[platform] ?? ICONS.GOOGLE;
    const tile = TILE[size];
    const Glyph = style.icon;
    return (
        <span
            className={cn(
                'inline-flex shrink-0 items-center justify-center border border-neutral-200 bg-neutral-50',
                tile.box,
                className
            )}
            role={title ? 'img' : undefined}
            aria-label={title}
            aria-hidden={title ? undefined : true}
            title={title}
        >
            <Glyph size={tile.glyph} weight="fill" className={style.tone} />
        </span>
    );
}

/**
 * Translated platform name. Pass the `marketing` namespace's `t`. YOUTUBE reads
 * "YouTube Ads" for kind 'ads' (the default) and "YouTube" for kind 'social'.
 */
export function platformLabel(
    platform: MarketingPlatform,
    t: TFunction,
    kind?: PlatformKind
): string {
    return t(`platform.${resolveKind(platform, kind)}.${platform}`, {
        ns: 'marketing',
        defaultValue: platform,
    });
}

const CHART_VAR: Record<MarketingPlatform, string> = {
    META: 'hsl(var(--chart-3))',
    GOOGLE: 'hsl(var(--chart-2))',
    YOUTUBE: 'hsl(var(--chart-1))',
    FACEBOOK: 'hsl(var(--chart-3))',
    INSTAGRAM: 'hsl(var(--chart-5))',
    GOOGLE_BUSINESS: 'hsl(var(--chart-2))',
};

/** Series colour for a platform (chart CSS variables, theme-aware). */
export function platformChartColor(platform: MarketingPlatform): string {
    return CHART_VAR[platform] ?? 'hsl(var(--chart-4))';
}

/**
 * recharts config keyed by AdPlatform (META / GOOGLE / YOUTUBE), for
 * `<ChartContainer config={...}>`; bars use `fill="var(--color-META)"` etc.
 */
export function adPlatformChartConfig(t: TFunction): ChartConfig {
    const config: ChartConfig = {};
    for (const platform of AD_PLATFORMS) {
        config[platform] = {
            label: platformLabel(platform, t, 'ads'),
            color: platformChartColor(platform),
        };
    }
    return config;
}

/** The OAuth provider that connects (or reconnects) an ad platform. YouTube rides on Google Ads. */
export function adProviderFor(platform: AdPlatform): MarketingProvider {
    return platform === 'META' ? 'META_ADS' : 'GOOGLE_ADS';
}

/**
 * The OAuth provider that connects a social platform, or null for YouTube, which is
 * connected under Settings → YouTube Integration (see YOUTUBE_SETTINGS_PATH).
 */
export function socialProviderFor(platform: SocialPlatform): MarketingProvider | null {
    if (platform === 'FACEBOOK' || platform === 'INSTAGRAM') return 'META_SOCIAL';
    if (platform === 'GOOGLE_BUSINESS') return 'GOOGLE_BUSINESS';
    return null;
}

/** Where YouTube is connected; the social screen links here instead of running OAuth. */
export const YOUTUBE_SETTINGS_PATH = '/settings?selectedTab=youtube';

/** The platform's own ads manager, for the "Open … Ads Manager" advice link. */
export function adsManagerUrl(platform: AdPlatform): string {
    return platform === 'META' ? 'https://adsmanager.facebook.com/' : 'https://ads.google.com/';
}

/** True when the provider's accounts are ad accounts (vs social profiles). */
export function isAdsProvider(provider: MarketingProvider): boolean {
    return provider === 'META_ADS' || provider === 'GOOGLE_ADS';
}

/** Short provider name for dialog titles and toasts. Pass the `marketing` namespace's `t`. */
export function providerLabel(provider: MarketingProvider, t: TFunction): string {
    return t(`connect.provider.${provider}`, { ns: 'marketing', defaultValue: provider });
}
