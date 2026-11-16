/**
 * Third-party scripts of the buying pages (Razorpay Checkout, Cloudflare Turnstile), added to
 * the page once and only when needed. A failed load is forgotten, so the next try adds the
 * script again instead of waiting on a dead promise.
 */
const pending = new Map<string, Promise<void>>();

export class ScriptLoadError extends Error {
    constructor(public readonly src: string) {
        super(`script not loaded: ${src}`);
        this.name = 'ScriptLoadError';
    }
}

export const loadScriptOnce = (src: string, ready: () => boolean, doc: Document | undefined = typeof document === 'undefined' ? undefined : document): Promise<void> => {
    if (ready()) return Promise.resolve();
    const known = pending.get(src);
    if (known) return known;
    if (!doc) return Promise.reject(new ScriptLoadError(src));
    const promise = new Promise<void>((resolve, reject) => {
        const script = doc.createElement('script');
        script.src = src;
        script.async = true;
        script.dataset.cmx = 'buy';
        script.onload = () => (ready() ? resolve() : reject(new ScriptLoadError(src)));
        script.onerror = () => {
            script.remove();
            reject(new ScriptLoadError(src));
        };
        doc.head.appendChild(script);
    }).catch((error: unknown) => {
        pending.delete(src);
        throw error;
    });
    pending.set(src, promise);
    return promise;
};

/** For tests: forget every script this module added. */
export const resetScriptsForTests = (): void => pending.clear();
