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

export interface PanelDevicePlugin {
    getInfo(): Promise<PanelDeviceInfo>;
    /** Rejects with code 'NO_ACTIVITY' when the device has no such settings screen. */
    openSettings(options: { target: PanelSettingsTarget }): Promise<Record<string, never>>;
    saveImage(options: PanelSaveImageOptions): Promise<PanelSaveImageResult>;
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
