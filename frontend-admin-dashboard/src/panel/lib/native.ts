/**
 * Bridge to the in-app native Capacitor plugin `PanelDevice` (Java side:
 * android/app/src/main/java/io/vacademy/admin/app/panel/PanelDevicePlugin.java,
 * registered only in the vacademy-classroom flavor).
 *
 * Imports '@/native/platform' only — never '@/native' (it statically pulls the
 * status-bar, privacy-screen, updater and firebase plugins). Every call degrades
 * gracefully when the plugin is absent (web, admin APK, older classroom APK).
 */
import { Capacitor, registerPlugin } from '@capacitor/core';
import { isNative } from '@/native/platform';

export interface PanelDeviceInfo {
    webViewPackage: string | null;
    webViewVersion: string | null;
    webViewMajor: number;
    minWebViewMajor: number;
    sdkInt: number;
    release: string;
    manufacturer: string;
    brand: string;
    model: string;
    board: string;
    hardware: string;
    abis: string[];
    isDefaultHome: boolean;
    panelMode: boolean;
    appId: string;
    appVersionName: string;
    appVersionCode: number;
    /** Phase 2 builds: PLAY, DIRECT or DEV. Absent on phase 1 APKs. */
    channel?: string;
    /** Phase 2 builds: true only where the in-app updater exists. */
    selfUpdate?: boolean;
    /** Phase 2 builds, diagnostics only. */
    packageName?: string;
    installerPackage?: string | null;
    totalRamMb: number;
    screenWidthPx: number;
    screenHeightPx: number;
    densityDpi: number;
}

export type PanelSettingsTarget = 'home' | 'settings' | 'developer' | 'wifi' | 'date';

export interface PanelSaveImageOptions {
    /** Base64 WITHOUT a `data:` prefix. */
    base64: string;
    fileName: string;
    mimeType: 'image/png';
}

export interface PanelSaveImageResult {
    uri: string;
    displayPath: string;
}

/**
 * Why a URL did not open. NO_PLUGIN comes from this file (web, admin APK, or an APK older
 * than 0.2.0); the rest come from native.
 */
export type PanelOpenFailure =
    | 'NO_PLUGIN'
    | 'INVALID_URL'
    | 'NO_HANDLER'
    | 'ALREADY_OPEN'
    | 'ERROR';

export interface PanelOpenResult {
    opened: boolean;
    /** Set when `opened` is false. */
    reason?: PanelOpenFailure;
}

export interface PanelDevicePlugin {
    getInfo(): Promise<PanelDeviceInfo>;
    /** Rejects with code 'NO_ACTIVITY' when the device has no such settings screen. */
    openSettings(options: { target: PanelSettingsTarget }): Promise<Record<string, never>>;
    saveImage(options: PanelSaveImageOptions): Promise<PanelSaveImageResult>;
    /** https only. Hands the URL to another app on the panel; never rejects. */
    openExternal(options: { url: string }): Promise<PanelOpenResult>;
    /**
     * https only, and only to a meeting host the APK was built with. Resolves when the
     * meeting screen closes; never rejects.
     */
    openMeeting(options: { url: string }): Promise<PanelOpenResult>;
    /** Closes the meeting screen if one is open. An APK without it rejects with UNIMPLEMENTED. */
    closeMeeting(): Promise<Record<string, never>>;
}

const PanelDevice = registerPlugin<PanelDevicePlugin>('PanelDevice');

/** Running inside the classroom APK with the PanelDevice plugin registered. */
export function isNativePanel(): boolean {
    try {
        return isNative() && Capacitor.isPluginAvailable('PanelDevice');
    } catch {
        return false;
    }
}

/** Alias kept for the spec's name. */
export const isPanelApp = isNativePanel;

/** The typed plugin, or null when it is not available (web / admin APK). */
export function getPanelDevice(): PanelDevicePlugin | null {
    return isNativePanel() ? PanelDevice : null;
}

/** Native device info, or null on web / when the call fails. */
export async function getDeviceInfo(): Promise<PanelDeviceInfo | null> {
    const device = getPanelDevice();
    if (!device) return null;
    try {
        return await device.getInfo();
    } catch (error) {
        console.warn('[panel/native] getInfo failed', error);
        return null;
    }
}

export interface WebDeviceInfo {
    userAgent: string;
    chromeMajor: number | null;
    viewportWidth: number;
    viewportHeight: number;
    devicePixelRatio: number;
    maxTouchPoints: number;
    screenWidth: number;
    screenHeight: number;
    classroomUserAgent: boolean;
}

/** What the page itself can tell (works everywhere). */
export function getWebDeviceInfo(): WebDeviceInfo {
    const ua = navigator.userAgent || '';
    const match = /Chrome\/(\d+)/.exec(ua);
    return {
        userAgent: ua,
        chromeMajor: match?.[1] ? parseInt(match[1], 10) : null,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        devicePixelRatio: window.devicePixelRatio || 1,
        maxTouchPoints: navigator.maxTouchPoints || 0,
        screenWidth: window.screen?.width ?? 0,
        screenHeight: window.screen?.height ?? 0,
        // Native appends ' VacademyClassroom' to the UA: shown in Diagnostics only, never gated on.
        classroomUserAgent: ua.indexOf('VacademyClassroom') >= 0,
    };
}

/** Open an Android settings screen. Resolves false when unavailable. */
export async function openDeviceSettings(target: PanelSettingsTarget): Promise<boolean> {
    const device = getPanelDevice();
    if (!device) return false;
    try {
        await device.openSettings({ target });
        return true;
    } catch (error) {
        console.warn(`[panel/native] openSettings(${target}) failed`, error);
        return false;
    }
}

/** The call failed in the JS layer: a plugin without the method rejects with UNIMPLEMENTED. */
function openFailure(error: unknown): PanelOpenResult {
    const code = (error as { code?: unknown } | null)?.code;
    return { opened: false, reason: code === 'UNIMPLEMENTED' ? 'NO_PLUGIN' : 'ERROR' };
}

/**
 * Open an https URL in another app on the panel, such as a browser. On `opened:false` the
 * caller offers the "start on your device" QR instead.
 */
export async function openExternal(url: string): Promise<PanelOpenResult> {
    const device = getPanelDevice();
    if (!device) return { opened: false, reason: 'NO_PLUGIN' };
    try {
        return await device.openExternal({ url });
    } catch (error) {
        console.warn('[panel/native] openExternal failed', error);
        return openFailure(error);
    }
}

/**
 * Open a live class in the native meeting screen. With `opened:true` the promise settles only
 * when that screen closes. Do not log `url`: it can be a moderator join link.
 */
export async function openMeeting(url: string): Promise<PanelOpenResult> {
    const device = getPanelDevice();
    if (!device) return { opened: false, reason: 'NO_PLUGIN' };
    try {
        return await device.openMeeting({ url });
    } catch (error) {
        console.warn('[panel/native] openMeeting failed', error);
        return openFailure(error);
    }
}

/**
 * Closes the native meeting screen, if one is open, when the panel's session ends. Never
 * rejects: on the web, or with an APK that lacks the method, there is nothing to close.
 */
export async function closeMeeting(): Promise<void> {
    const device = getPanelDevice();
    if (!device) return;
    try {
        await device.closeMeeting();
    } catch (error) {
        console.warn('[panel/native] closeMeeting failed', error);
    }
}

function blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const result = String(reader.result || '');
            const comma = result.indexOf(',');
            resolve(comma >= 0 ? result.slice(comma + 1) : result);
        };
        reader.onerror = () => reject(reader.error || new Error('FileReader failed'));
        reader.readAsDataURL(blob);
    });
}

export type SaveImageOutcome =
    | { where: 'device'; uri: string; displayPath: string }
    | { where: 'download'; fileName: string };

/**
 * Save a PNG: APK → PanelDevice.saveImage (Pictures/Vacademy Classroom);
 * web → a normal browser download.
 */
export async function saveImage(blob: Blob, fileName: string): Promise<SaveImageOutcome> {
    const device = getPanelDevice();
    if (device) {
        const base64 = await blobToBase64(blob);
        const result = await device.saveImage({ base64, fileName, mimeType: 'image/png' });
        return { where: 'device', uri: result.uri, displayPath: result.displayPath };
    }
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    anchor.rel = 'noopener';
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    window.setTimeout(() => URL.revokeObjectURL(url), 30000);
    return { where: 'download', fileName };
}
