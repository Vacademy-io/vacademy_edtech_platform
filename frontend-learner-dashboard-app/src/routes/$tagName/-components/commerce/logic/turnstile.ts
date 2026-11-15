/**
 * Cloudflare Turnstile, the bot check of /otp/request and /checkout (contract P2 §9). The
 * script is loaded once on demand; every call gets a fresh token, because a token is good for
 * one request only.
 */
import { loadScriptOnce } from './scripts';

export const TURNSTILE_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

interface TurnstileApi {
    render(container: HTMLElement, options: Record<string, unknown>): string;
    execute(widgetId: string): void;
    reset(widgetId: string): void;
    remove(widgetId: string): void;
}

const api = (): TurnstileApi | undefined =>
    typeof window === 'undefined' ? undefined : (window as unknown as { turnstile?: TurnstileApi }).turnstile;

export const loadTurnstile = (): Promise<void> => loadScriptOnce(TURNSTILE_SRC, () => !!api());

export class ChallengeError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ChallengeError';
    }
}

/** How long a shopper has to answer the check once Cloudflare asks for an interaction. */
export const INTERACTIVE_TIMEOUT_MS = 120_000;

/**
 * A fresh token from an invisible widget in `host` (a box near the pay bar). The widget is
 * removed after use, so the next call renders a new one and never reuses a token. When Cloudflare
 * asks for an interaction, the box is scrolled into view (the sticky pay bar may sit over it) and
 * the shopper gets longer to answer.
 */
export const challengeToken = async (siteKey: string, host: HTMLElement, timeoutMs = 30_000): Promise<string> => {
    await loadTurnstile();
    const turnstile = api();
    if (!turnstile) throw new ChallengeError('turnstile missing');
    return new Promise<string>((resolve, reject) => {
        let widgetId = '';
        let timer: ReturnType<typeof setTimeout>;
        const cleanup = () => {
            clearTimeout(timer);
            try {
                if (widgetId) turnstile.remove(widgetId);
            } catch {
                // Already gone.
            }
        };
        const startTimer = (ms: number) => {
            clearTimeout(timer);
            timer = setTimeout(() => {
                cleanup();
                reject(new ChallengeError('timeout'));
            }, ms);
        };
        startTimer(timeoutMs);
        try {
            widgetId = turnstile.render(host, {
                sitekey: siteKey,
                execution: 'execute',
                appearance: 'interaction-only',
                'before-interactive-callback': () => {
                    try {
                        host.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
                    } catch {
                        // Scrolling is a help, never a failure.
                    }
                    startTimer(Math.max(timeoutMs, INTERACTIVE_TIMEOUT_MS));
                },
                callback: (token: string) => {
                    cleanup();
                    resolve(token);
                },
                'error-callback': () => {
                    cleanup();
                    reject(new ChallengeError('failed'));
                },
                'expired-callback': () => {
                    cleanup();
                    reject(new ChallengeError('expired'));
                },
            });
            turnstile.execute(widgetId);
        } catch {
            cleanup();
            reject(new ChallengeError('render'));
        }
    });
};
