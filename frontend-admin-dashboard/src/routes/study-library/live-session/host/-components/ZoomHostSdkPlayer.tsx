import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { ZOOM_SDK_SIGNATURE_ENDPOINT } from '@/constants/urls';

/**
 * Hosts a Zoom meeting using the Web Meeting SDK **Client View** (the full-page
 * Zoom client), loaded from Zoom's CDN.
 *
 * Why Client View (not the embedded Component View): Client View renders the
 * complete Zoom UI into a fixed full-viewport `#zmmtg-root` — native gallery /
 * speaker toggle, a real fullscreen button, the full toolbar, and a clean Leave
 * flow. That is the "full screen + seamless" meeting experience. The previous
 * Component View build painted a fixed 400×225 canvas with a hand-positioned
 * popper, which is why the meeting looked tiny and off-centre.
 *
 * Why the CDN (vs the npm package): the SDK ships its own React 18 + ReactDOM +
 * Redux as separate scripts. Loading them as ordered <script> tags puts the SDK's
 * React on window.* without colliding with the host app's ESM React. Order
 * matters — vendor globals must exist before the SDK bundle runs.
 *
 * The host joins with role=1 + ZAK (when the server grants it) so the meeting
 * starts directly here instead of bouncing to Zoom's hosted start page.
 *
 * NOTE: this path can only be fully validated against a live Zoom meeting.
 */

// Pinned to the version both apps already load successfully from the CDN.
const ZOOM_SDK_VERSION = '3.13.2';
const ZOOM_LIB_BASE = `https://source.zoom.us/${ZOOM_SDK_VERSION}/lib`;
const ZOOM_CSS = [
    `https://source.zoom.us/${ZOOM_SDK_VERSION}/css/bootstrap.css`,
    `https://source.zoom.us/${ZOOM_SDK_VERSION}/css/react-select.css`,
];
// Client View needs react + react-dom + redux + redux-thunk vendor globals,
// then the main client bundle (note: NOT the "-embedded" Component View bundle).
const ZOOM_VENDOR_SCRIPTS: Array<[string, string]> = [
    [`${ZOOM_LIB_BASE}/vendor/react.min.js`, `react-${ZOOM_SDK_VERSION}`],
    [`${ZOOM_LIB_BASE}/vendor/react-dom.min.js`, `react-dom-${ZOOM_SDK_VERSION}`],
    [`${ZOOM_LIB_BASE}/vendor/redux.min.js`, `redux-${ZOOM_SDK_VERSION}`],
    [`${ZOOM_LIB_BASE}/vendor/redux-thunk.min.js`, `redux-thunk-${ZOOM_SDK_VERSION}`],
];
const ZOOM_MAIN_SCRIPT = `https://source.zoom.us/${ZOOM_SDK_VERSION}/zoom-meeting-${ZOOM_SDK_VERSION}.min.js`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ZoomMtgGlobal = any;

declare global {
    interface Window {
        ZoomMtg?: ZoomMtgGlobal;
    }
}

/** Idempotent, order-preserving <script src> insertion. */
function loadScriptOnce(src: string, key: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const existing = document.querySelector<HTMLScriptElement>(`script[data-zoom-cdn="${key}"]`);
        if (existing) {
            if (existing.dataset.loaded === 'true') return resolve();
            existing.addEventListener('load', () => resolve());
            existing.addEventListener('error', () => reject(new Error(`Failed to load ${src}`)));
            return;
        }
        const script = document.createElement('script');
        script.src = src;
        script.async = false;
        script.setAttribute('data-zoom-cdn', key);
        script.onload = () => {
            script.dataset.loaded = 'true';
            resolve();
        };
        script.onerror = () => reject(new Error(`Failed to load ${src}`));
        document.head.appendChild(script);
    });
}

let sdkLoadPromise: Promise<ZoomMtgGlobal> | null = null;

/** Loads Zoom Client View (CSS + vendor globals + main bundle) once per page. */
function loadZoomClientViewFromCdn(): Promise<ZoomMtgGlobal> {
    if (window.ZoomMtg) return Promise.resolve(window.ZoomMtg);
    if (sdkLoadPromise) return sdkLoadPromise;
    sdkLoadPromise = (async () => {
        for (const href of ZOOM_CSS) {
            if (!document.querySelector(`link[data-zoom-css="${href}"]`)) {
                const link = document.createElement('link');
                link.rel = 'stylesheet';
                link.href = href;
                link.setAttribute('data-zoom-css', href);
                document.head.appendChild(link);
            }
        }
        try {
            for (const [src, key] of ZOOM_VENDOR_SCRIPTS) {
                await loadScriptOnce(src, key);
            }
            await loadScriptOnce(ZOOM_MAIN_SCRIPT, `zoommtg-${ZOOM_SDK_VERSION}`);
        } catch (e) {
            sdkLoadPromise = null; // allow retry on next mount
            throw e;
        }
        if (!window.ZoomMtg) {
            sdkLoadPromise = null;
            throw new Error('Zoom Client View loaded but window.ZoomMtg is missing');
        }
        return window.ZoomMtg;
    })();
    return sdkLoadPromise;
}

/** Ensures the singleton #zmmtg-root exists OUTSIDE React's tree (Zoom injects its
 *  own DOM here; letting React reconcile it would conflict). Returns it, shown. */
function ensureZmmtgRoot(): HTMLElement {
    let root = document.getElementById('zmmtg-root');
    if (!root) {
        root = document.createElement('div');
        root.id = 'zmmtg-root';
        document.body.appendChild(root);
    }
    root.style.display = 'block';
    return root;
}

/**
 * Hides the singleton #zmmtg-root. Zoom's bootstrap.css makes it a fixed,
 * full-viewport, high-z-index overlay, so it MUST be hidden on every error path
 * after ensureZmmtgRoot() ran — otherwise the empty Zoom shell covers our error
 * message. The node is kept (not removed) so a re-init can reuse it.
 */
function hideZmmtgRoot(): void {
    const root = document.getElementById('zmmtg-root');
    if (root) root.style.display = 'none';
}

interface ZoomSdkSignature {
    signature: string;
    sdkKey: string;
    meetingNumber: string;
    passcode: string;
    userName: string;
    userEmail?: string;
    role: number;
    zakToken?: string | null;
    tokenExp: number;
}

type Phase = 'loading' | 'joining' | 'joined' | 'error';

export default function ZoomHostSdkPlayer({
    scheduleId,
    leaveUrl,
}: {
    scheduleId: string;
    /** Where Zoom's "Leave" sends the browser. Defaults to the app origin. */
    leaveUrl?: string;
}) {
    const { t } = useTranslation('studyLibraryZoomHostSdkPlayer');
    const startedRef = useRef(false);
    const [phase, setPhase] = useState<Phase>('loading');
    const [errorMsg, setErrorMsg] = useState<string | null>(null);

    const { data, error } = useQuery<ZoomSdkSignature>({
        queryKey: ['zoom-host-sdk-signature', scheduleId],
        queryFn: async () => {
            const res = await authenticatedAxiosInstance.get(ZOOM_SDK_SIGNATURE_ENDPOINT, {
                params: { scheduleId, role: 1 },
            });
            return res.data;
        },
        // The signature is a ONE-SHOT join credential (valid ~2h). It must NOT
        // auto-refetch while the meeting is live: a refetch returns a new object,
        // which changes the join effect's `data` dependency and fires its cleanup —
        // ZoomMtg.leaveMeeting() — killing the meeting mid-call (WebSocket close 1006,
        // "mainTaskType is not exist"). Fetch once; never refetch on focus/reconnect.
        staleTime: Infinity,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        retry: 1,
    });

    // Surface the signature-fetch error (409 = meeting still being provisioned on Zoom)
    // as a clear message rather than a blank spinner / generic failure.
    useEffect(() => {
        if (!error) return;
        const status = (error as { response?: { status?: number } })?.response?.status;
        const serverMsg = (error as { response?: { data?: { message?: string } } })?.response?.data
            ?.message;
        setErrorMsg(
            status === 409
                ? serverMsg ?? t('stillProvisioning')
                : t('loadFailed')
        );
        setPhase('error');
    }, [error, t]);

    useEffect(() => {
        if (!data) return;
        // StrictMode / re-render guard — Client View init+join must run once.
        if (startedRef.current) return;
        // The Zoom SDK calls meetingNumber.toString() unguarded, so a missing meeting number
        // (the meeting was never provisioned → provider_meeting_id is null and the signature
        // response omits it) crashes with an opaque "reading 'toString'" TypeError. Surface a
        // clear message instead of booting the SDK with bad params.
        if (!data.meetingNumber || !data.signature || !data.sdkKey) {
            setErrorMsg(t('notReadyToHost'));
            setPhase('error');
            return;
        }
        // Starting a meeting AS HOST (role 1) requires a ZAK. Without it the Zoom
        // Client View SDK crashes internally on meetingNumber.toString() (its
        // host-start path dereferences an undefined value) rather than calling the
        // error callback. The ZAK is null when the connected Zoom account's OAuth
        // token lacks the ZAK scope (classic: user_zak:read, granular: user:read:zak).
        // Surface that as an actionable message instead of booting the SDK to crash.
        if (data.role === 1 && !data.zakToken) {
            setErrorMsg(t('missingZak'));
            setPhase('error');
            return;
        }
        startedRef.current = true;
        let cancelled = false;
        const resolvedLeaveUrl = leaveUrl || window.location.origin;

        (async () => {
            try {
                setPhase('joining');
                const ZoomMtg = await loadZoomClientViewFromCdn();
                if (cancelled) return;

                ZoomMtg.setZoomJSLib(ZOOM_LIB_BASE, '/av');
                ZoomMtg.preLoadWasm();
                // 3.x exposes prepareWebSDK; older builds used prepareJssdk.
                if (typeof ZoomMtg.prepareWebSDK === 'function') ZoomMtg.prepareWebSDK();
                else if (typeof ZoomMtg.prepareJssdk === 'function') ZoomMtg.prepareJssdk();
                ensureZmmtgRoot();

                ZoomMtg.init({
                    leaveUrl: resolvedLeaveUrl,
                    patchJsMedia: true,
                    success: () => {
                        // Build the join config WITHOUT optional keys whose value is absent.
                        // The Zoom SDK does `"userEmail" in config ? config.userEmail.toString() : ""`
                        // — `in` is true even for an explicit `userEmail: undefined`, so the SDK then
                        // calls undefined.toString() and crashes (the opaque "reading 'toString'"
                        // TypeError). Any host without an email in the DB hit this. Only attach
                        // optional keys (userEmail, zak) when they actually have a value.
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        const joinConfig: Record<string, any> = {
                            sdkKey: data.sdkKey,
                            signature: data.signature,
                            meetingNumber: data.meetingNumber,
                            passWord: data.passcode ?? '',
                            userName: data.userName,
                            success: () => {
                                if (!cancelled) setPhase('joined');
                            },
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            error: (err: any) => {
                                console.error('[Zoom Host ClientView] join failed:', err);
                                if (!cancelled) {
                                    hideZmmtgRoot(); // else the empty Zoom shell covers the error UI
                                    setErrorMsg(
                                        t('joinFailed', { code: err?.errorCode ?? t('joinErrorFallback') })
                                    );
                                    setPhase('error');
                                }
                            },
                        };
                        if (data.userEmail) joinConfig.userEmail = data.userEmail;
                        // ZAK (present only when the server grants HOST) starts the meeting.
                        if (data.zakToken) joinConfig.zak = data.zakToken;
                        ZoomMtg.join(joinConfig);
                    },
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    error: (err: any) => {
                        console.error('[Zoom Host ClientView] init failed:', err);
                        if (!cancelled) {
                            hideZmmtgRoot();
                            setErrorMsg(
                                t('initFailed', { code: err?.errorCode ?? t('initErrorFallback') })
                            );
                            setPhase('error');
                        }
                    },
                });
            } catch (err: unknown) {
                if (cancelled) return;
                console.error('[Zoom Host ClientView] load failed:', err);
                hideZmmtgRoot();
                setErrorMsg(t('loadFailed'));
                setPhase('error');
            }
        })();

        return () => {
            cancelled = true;
            // Clean teardown — leave the meeting and hide Zoom's root so the SPA
            // is usable after navigating away. No window.location.reload hacks.
            try {
                window.ZoomMtg?.leaveMeeting?.({});
            } catch {
                /* ignore */
            }
            hideZmmtgRoot();
            startedRef.current = false;
        };
    }, [data, leaveUrl, t]);

    // Client View renders full-screen into #zmmtg-root (outside this tree). We only
    // render the pre-join loading / error overlay; once joined, Zoom's UI covers it.
    if (error || phase === 'error') {
        return (
            <div className="flex h-full w-full flex-col items-center justify-center gap-2 p-8 text-center">
                <p className="text-red-600">{errorMsg ?? t('startFailed')}</p>
                <p className="text-sm text-neutral-500">{t('refreshOrRetry')}</p>
            </div>
        );
    }

    if (phase === 'joined') return null;

    return (
        <div className="flex h-full w-full items-center justify-center bg-black">
            <div className="flex flex-col items-center gap-3 text-white">
                <div className="size-8 animate-spin rounded-full border-2 border-white border-t-transparent" />
                <span className="text-sm">
                    {phase === 'loading' ? t('preparingMeeting') : t('startingAsHost')}
                </span>
            </div>
        </div>
    );
}
