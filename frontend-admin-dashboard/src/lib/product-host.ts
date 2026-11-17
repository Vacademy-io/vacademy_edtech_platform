import { isEvalezyMode } from './evalezy-mode';

/**
 * A product dashboard opened on its own host (evalezy.vacademy.io, telleo.vacademy.io). No institute
 * owns such a host: every client's admin signs in there and lands in their own institute, so the
 * host wears the product's brand instead of an institute's (the same rule Evalezy has used since
 * it shipped). Each host is an extra domain of the dashboard deployment: DNS only, no routing row.
 */
export interface HostProduct {
    /** The product key the sign-up and the product settings use. */
    key: string;
    name: string;
    logo: string;
    favicon: string;
    /** A preset theme code (preset-themes.ts) the host's login and sign-up wear; none keeps the default. */
    theme?: string;
}

const EVALEZY: HostProduct = {
    key: 'evalezy',
    name: 'Evalezy',
    logo: '/evalezy-logo.svg',
    favicon: '/evalezy-favicon.svg',
};

const TELLEO: HostProduct = {
    key: 'telleo',
    name: 'Telleo',
    logo: '/telleo-logo.svg',
    favicon: '/telleo-favicon.svg',
    // The same preset new Telleo workspaces get (TelleoDisplaySettings.THEME_CODE).
    theme: 'green',
};

const firstLabel = (hostname?: string): string => {
    const host = hostname ?? (typeof window !== 'undefined' ? window.location.hostname : '');
    return host.toLowerCase().split('.')[0] ?? '';
};

/** First host label is `telleo` (telleo.vacademy.io, or a stage copy of it). */
export const isTelleoHost = (hostname?: string): boolean => firstLabel(hostname) === 'telleo';

/** The product this host (or the Evalezy app) belongs to; null on an institute's or the platform's host. */
export const hostProduct = (hostname?: string): HostProduct | null => {
    // No hostname: the current page, where the Evalezy app (native flavor) also counts.
    const evalezy = hostname === undefined ? isEvalezyMode() : firstLabel(hostname) === 'evalezy';
    if (evalezy) return EVALEZY;
    if (isTelleoHost(hostname)) return TELLEO;
    return null;
};

/** No institute owns a product's login, so it always wears the product's logo. */
export const loginLogo = (instituteLogo: string): string => hostProduct()?.logo ?? instituteLogo;
