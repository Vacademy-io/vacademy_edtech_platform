/**
 * Device facts the panel reports and the class screens branch on. The native answer
 * is read once at boot; until then, and in a browser, the page's own Chrome version
 * stands in.
 */
import type { PanelReportedDevice } from '@/classroom-shared/apiTypes';
import { getDeviceInfo, getWebDeviceInfo, type PanelDeviceInfo } from '../lib/native';

let info: PanelDeviceInfo | null = null;
let loading: Promise<PanelDeviceInfo | null> | null = null;

export function loadPanelDeviceInfo(): Promise<PanelDeviceInfo | null> {
    if (!loading) {
        loading = getDeviceInfo().then((value) => {
            info = value;
            return value;
        });
    }
    return loading;
}

export function getCachedDeviceInfo(): PanelDeviceInfo | null {
    return info;
}

/** The WebView's major version, at click time. 0 when it cannot be told. */
export function getWebViewMajor(): number {
    if (info && info.webViewMajor > 0) return info.webViewMajor;
    return getWebDeviceInfo().chromeMajor ?? 0;
}

export function getAppVersionCode(): number | null {
    return info ? info.appVersionCode : null;
}

function clip(value: string | null | undefined, max: number): string | undefined {
    return value ? value.slice(0, max) : undefined;
}

/** What /pair/start reports. The server refuses anything over its length limits. */
export function reportedDevice(): PanelReportedDevice {
    return {
        manufacturer: clip(info?.manufacturer, 120),
        model: clip(info?.model, 120),
        sdk_int: info?.sdkInt,
        webview_major: getWebViewMajor() || undefined,
        app_version_code: info?.appVersionCode,
    };
}
