/**
 * Reads the marketing OAuth return off the URL. The backend callback redirects to the
 * feature route with `?mkt_session=<state>&mkt_provider=<provider>` on success or
 * `?mkt_error=<code>&mkt_provider=<provider>` on failure. The params are read once,
 * synchronously on first render (so a router search rewrite cannot drop them first),
 * then stripped from the address bar so a reload does not reopen the dialog.
 * Same read-and-strip pattern as settings/-components/IntegrationSettings.tsx.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import type { MarketingProvider } from './types';

const PARAMS = ['mkt_session', 'mkt_provider', 'mkt_error'] as const;

const PROVIDERS: ReadonlySet<string> = new Set<MarketingProvider>([
    'META_ADS',
    'META_SOCIAL',
    'GOOGLE_ADS',
    'GOOGLE_BUSINESS',
]);

export interface OAuthReturn {
    /** Authorised session to pick accounts from; null when there was none (or after clear()). */
    sessionKey: string | null;
    provider: MarketingProvider | null;
    /** Error code from the callback (e.g. access_denied, no_refresh_token). */
    error: string | null;
    /** Forget the session once the connect dialog is done with it. */
    clear: () => void;
}

function readReturn(): Omit<OAuthReturn, 'clear'> {
    if (typeof window === 'undefined') return { sessionKey: null, provider: null, error: null };
    const params = new URLSearchParams(window.location.search);
    const rawProvider = params.get('mkt_provider');
    return {
        sessionKey: params.get('mkt_session') || null,
        provider:
            rawProvider && PROVIDERS.has(rawProvider) ? (rawProvider as MarketingProvider) : null,
        error: params.get('mkt_error') || null,
    };
}

export function useOAuthReturn(): OAuthReturn {
    const { t } = useTranslation('marketing');
    const [state, setState] = useState(readReturn);
    const handled = useRef(false);

    useEffect(() => {
        if (handled.current) return;
        handled.current = true;
        if (state.error) {
            toast.error(
                state.error === 'access_denied'
                    ? t('connect.cancelled')
                    : t(`connect.errors.${state.error}`, {
                          defaultValue: t('connect.errors.default', { code: state.error }),
                      })
            );
        }
        const url = new URL(window.location.href);
        if (PARAMS.some((p) => url.searchParams.has(p))) {
            PARAMS.forEach((p) => url.searchParams.delete(p));
            window.history.replaceState(window.history.state, '', url.toString());
        }
        // Runs once per mount: the params are consumed on first render.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const clear = useCallback(() => setState((s) => ({ ...s, sessionKey: null, error: null })), []);

    return { ...state, clear };
}
