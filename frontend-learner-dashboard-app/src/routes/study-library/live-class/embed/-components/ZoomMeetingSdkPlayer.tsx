import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Capacitor } from "@capacitor/core";
import { Browser } from "@capacitor/browser";
import { AppLauncher } from "@capacitor/app-launcher";
import { ArrowSquareOut } from "@phosphor-icons/react";
import authenticatedAxiosInstance from "@/lib/auth/axiosInstance";
import { ZOOM_SDK_SIGNATURE_ENDPOINT } from "@/constants/urls";
import { DashboardLoader } from "@/components/core/dashboard-loader";
import { Button } from "@/components/ui/button";
import { useTranslation } from "react-i18next";
import { getTerminology } from "@/components/common/layout-container/sidebar/utils";
import { ContentTerms, SystemTerms } from "@/types/naming-settings";

/**
 * Joins a live Zoom meeting using the Web Meeting SDK **Client View** (the
 * full-page Zoom client), loaded from Zoom's CDN.
 *
 * Why Client View (not the embedded Component View): Client View renders the full
 * Zoom UI into a fixed full-viewport `#zmmtg-root` — fullscreen, gallery/speaker,
 * the full toolbar. That is the "full screen + seamless" experience. The previous
 * Component View build painted a fixed 400×225 canvas with a hand-positioned
 * popper, which is why the meeting looked tiny and off-centre.
 *
 * Why the CDN (vs the npm package): the learner app is on React 19; the SDK ships
 * its own React 18 + ReactDOM + Redux as separate scripts. Loading them as ordered
 * <script> tags gives the SDK its own React on window.* without touching the host
 * app's ESM React. Order matters — vendor globals must exist before the SDK bundle.
 *
 * NOTE: this path can only be fully validated against a live Zoom meeting.
 */

const ZOOM_SDK_VERSION = "3.13.2";
const ZOOM_LIB_BASE = `https://source.zoom.us/${ZOOM_SDK_VERSION}/lib`;
const ZOOM_CSS = [
    `https://source.zoom.us/${ZOOM_SDK_VERSION}/css/bootstrap.css`,
    `https://source.zoom.us/${ZOOM_SDK_VERSION}/css/react-select.css`,
];
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
            if (existing.dataset.loaded === "true") return resolve();
            existing.addEventListener("load", () => resolve());
            existing.addEventListener("error", () => reject(new Error(`Failed to load ${src}`)));
            return;
        }
        const script = document.createElement("script");
        script.src = src;
        script.async = false;
        script.setAttribute("data-zoom-cdn", key);
        script.onload = () => {
            script.dataset.loaded = "true";
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
                const link = document.createElement("link");
                link.rel = "stylesheet";
                link.href = href;
                link.setAttribute("data-zoom-css", href);
                document.head.appendChild(link);
            }
        }
        try {
            for (const [src, key] of ZOOM_VENDOR_SCRIPTS) {
                await loadScriptOnce(src, key);
            }
            await loadScriptOnce(ZOOM_MAIN_SCRIPT, `zoommtg-${ZOOM_SDK_VERSION}`);
        } catch (e) {
            sdkLoadPromise = null;
            throw e;
        }
        if (!window.ZoomMtg) {
            sdkLoadPromise = null;
            throw new Error("Zoom Client View loaded but window.ZoomMtg is missing");
        }
        return window.ZoomMtg;
    })();
    return sdkLoadPromise;
}

/** Ensures the singleton #zmmtg-root exists OUTSIDE React's tree, shown. */
function ensureZmmtgRoot(): HTMLElement {
    let root = document.getElementById("zmmtg-root");
    if (!root) {
        root = document.createElement("div");
        root.id = "zmmtg-root";
        document.body.appendChild(root);
    }
    root.style.display = "block";
    return root;
}

/**
 * Hides the singleton #zmmtg-root. Zoom's bootstrap.css makes it a fixed,
 * full-viewport, high-z-index overlay, so it MUST be hidden on every error path
 * after ensureZmmtgRoot() ran — otherwise the (empty) Zoom shell covers our
 * error message and the "Open in Zoom" fallback button. The node is kept (not
 * removed) so a re-init can reuse it.
 */
function hideZmmtgRoot(): void {
    const root = document.getElementById("zmmtg-root");
    if (root) root.style.display = "none";
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

type Phase = "loading" | "joining" | "joined" | "error";

/**
 * Native escape hatch when the in-WebView Client View can't run: open the meeting
 * in the Zoom APP via the zoommtg:// deep link (built from the signature payload),
 * falling back to the web join URL in an in-app browser if the Zoom app isn't
 * installed. canOpenUrl needs the zoommtg scheme declared (Android manifest
 * <queries>, iOS LSApplicationQueriesSchemes) — both are present.
 */
async function launchZoomExternally(
    data: ZoomSdkSignature | undefined,
    webUrl: string
): Promise<void> {
    try {
        if (data?.meetingNumber) {
            const { value } = await AppLauncher.canOpenUrl({ url: "zoommtg://" });
            if (value) {
                const deepLink =
                    "zoommtg://zoom.us/join?action=join" +
                    `&confno=${encodeURIComponent(data.meetingNumber)}` +
                    `&pwd=${encodeURIComponent(data.passcode ?? "")}` +
                    `&uname=${encodeURIComponent(data.userName ?? "")}` +
                    "&zc=0";
                await AppLauncher.openUrl({ url: deepLink });
                return;
            }
        }
    } catch {
        /* Zoom app not installed / scheme not queryable → fall through to browser */
    }
    await Browser.open({ url: webUrl, presentationStyle: "fullscreen" });
}

export default function ZoomMeetingSdkPlayer({
    scheduleId,
    leaveUrl,
    nativeFallbackUrl,
}: {
    scheduleId: string;
    /** Where Zoom's "Leave" sends the browser. Defaults to the app origin. */
    leaveUrl?: string;
    /** On Capacitor, if the Zoom Client View hits a load/init/join/signature error,
     *  offer to open the meeting in the Zoom app (zoommtg:// deep link), falling back
     *  to this web join URL in a browser. (Camera/mic denial is handled inside the SDK
     *  and does NOT route here.) */
    nativeFallbackUrl?: string;
}) {
    const { t } = useTranslation("study");
    const liveClass = getTerminology(ContentTerms.LiveSession, SystemTerms.LiveSession).toLowerCase();
    const startedRef = useRef(false);
    const [phase, setPhase] = useState<Phase>("loading");
    const [errorMsg, setErrorMsg] = useState<string | null>(null);

    const { data, error } = useQuery<ZoomSdkSignature>({
        queryKey: ["zoom-sdk-signature", scheduleId],
        queryFn: async () => {
            const res = await authenticatedAxiosInstance.get(ZOOM_SDK_SIGNATURE_ENDPOINT, {
                params: { scheduleId, role: 0 },
            });
            return res.data;
        },
        // The signature is a ONE-SHOT join credential (valid ~2h). It must NOT
        // auto-refetch while the meeting is live: a refetch returns a new object,
        // which changes the join effect's `data` dependency and fires its cleanup —
        // ZoomMtg.leaveMeeting() — killing the meeting mid-call (WebSocket close 1006).
        // Fetch once; never refetch on focus/reconnect.
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
                ? serverMsg ?? t("liveClass.zoomSdk.stillSettingUp", { liveClass })
                : t("liveClass.zoomSdk.couldNotLoad", { liveClass })
        );
        setPhase("error");
    }, [error]);

    useEffect(() => {
        if (!data) return;
        if (startedRef.current) return; // StrictMode / re-render guard
        // The Zoom SDK calls meetingNumber.toString() unguarded, so a missing meeting number
        // (the meeting was never provisioned → provider_meeting_id is null and the signature
        // response omits it) crashes with an opaque "reading 'toString'" TypeError. Surface a
        // clear message instead of booting the SDK with bad params.
        if (!data.meetingNumber || !data.signature || !data.sdkKey) {
            setErrorMsg(
                t("liveClass.zoomSdk.notReadyToJoin", { liveClass })
            );
            setPhase("error");
            return;
        }
        startedRef.current = true;
        let cancelled = false;
        const resolvedLeaveUrl = leaveUrl || window.location.origin;

        (async () => {
            try {
                setPhase("joining");
                const ZoomMtg = await loadZoomClientViewFromCdn();
                if (cancelled) return;

                ZoomMtg.setZoomJSLib(ZOOM_LIB_BASE, "/av");
                ZoomMtg.preLoadWasm();
                if (typeof ZoomMtg.prepareWebSDK === "function") ZoomMtg.prepareWebSDK();
                else if (typeof ZoomMtg.prepareJssdk === "function") ZoomMtg.prepareJssdk();
                ensureZmmtgRoot();

                ZoomMtg.init({
                    leaveUrl: resolvedLeaveUrl,
                    patchJsMedia: true,
                    success: () => {
                        // Omit optional keys whose value is absent. The Zoom SDK does
                        // `"userEmail" in config ? config.userEmail.toString() : ""` — `in` is true
                        // even for `userEmail: undefined`, so it then calls undefined.toString() and
                        // crashes ("reading 'toString'"). A learner without an email hit this. Only
                        // attach userEmail / zak when they actually have a value.
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        const joinConfig: Record<string, any> = {
                            sdkKey: data.sdkKey,
                            signature: data.signature,
                            meetingNumber: data.meetingNumber,
                            passWord: data.passcode ?? "",
                            userName: data.userName,
                            success: () => {
                                if (!cancelled) setPhase("joined");
                            },
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            error: (err: any) => {
                                console.error("[Zoom Learner ClientView] join failed:", err);
                                if (!cancelled) {
                                    hideZmmtgRoot(); // else the empty Zoom shell covers the error UI
                                    setErrorMsg(t("liveClass.zoomSdk.couldNotJoin", { code: err?.errorCode ?? t("liveClass.zoomSdk.joinError") }));
                                    setPhase("error");
                                }
                            },
                        };
                        if (data.userEmail) joinConfig.userEmail = data.userEmail;
                        if (data.zakToken) joinConfig.zak = data.zakToken;
                        ZoomMtg.join(joinConfig);
                    },
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    error: (err: any) => {
                        console.error("[Zoom Learner ClientView] init failed:", err);
                        if (!cancelled) {
                            hideZmmtgRoot();
                            setErrorMsg(t("liveClass.zoomSdk.couldNotInit", { code: err?.errorCode ?? t("liveClass.zoomSdk.initError") }));
                            setPhase("error");
                        }
                    },
                });
            } catch (err: unknown) {
                if (cancelled) return;
                console.error("[Zoom Learner ClientView] load failed:", err);
                hideZmmtgRoot();
                setErrorMsg(t("liveClass.zoomSdk.couldNotLoadCheckConnection"));
                setPhase("error");
            }
        })();

        return () => {
            cancelled = true;
            try {
                window.ZoomMtg?.leaveMeeting?.({});
            } catch {
                /* ignore */
            }
            hideZmmtgRoot();
            startedRef.current = false;
        };
    }, [data, leaveUrl]);

    if (error || phase === "error") {
        // Capture the URL so TS narrows it (no non-null assertion in the handler).
        const fallbackUrl = Capacitor.isNativePlatform() ? nativeFallbackUrl : undefined;
        return (
            <div className="flex h-full w-full flex-col items-center justify-center gap-stack p-8 text-center">
                <p className="text-red-600">{errorMsg ?? t("liveClass.zoomSdk.failedToLoad")}</p>
                <p className="text-sm text-neutral-500">{t("liveClass.zoomSdk.refreshOrRejoin")}</p>
                {fallbackUrl && (
                    <Button
                        className="mt-2 gap-2"
                        onClick={() => void launchZoomExternally(data, fallbackUrl)}
                    >
                        <ArrowSquareOut size={18} />
                        {t("liveClass.zoomSdk.openInZoomApp")}
                    </Button>
                )}
            </div>
        );
    }

    if (phase === "joined") return null; // Zoom's full-screen #zmmtg-root covers the page

    return (
        <div className="relative flex h-full w-full items-center justify-center bg-black">
            <div className="flex flex-col items-center gap-stack text-white">
                <DashboardLoader />
                <span className="text-sm">
                    {phase === "loading" ? t("liveClass.zoomSdk.preparingMeeting") : t("liveClass.zoomSdk.joiningMeeting")}
                </span>
            </div>
        </div>
    );
}
