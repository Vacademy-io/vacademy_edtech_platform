/**
 * Institute branding for the panel: cached in localStorage `panel.branding`,
 * applied before first render, refreshed in the background after sign-in.
 *
 * The theme itself is applied by the reused ThemeProvider: we write the same
 * localStorage keys it reads ('theme-code' / 'theme-custom-color' and
 * THEME_ROLE_SETTINGS_KEY), and <PanelBrandingSync/> forwards live changes to
 * useTheme().setPrimaryColor. Copied (not imported) from getInstituteDetails.ts
 * L242-262, which pulls 54 files including settings UI.
 */
import { useSyncExternalStore } from 'react';
import { HOLISTIC_INSTITUTE_ID, INIT_INSTITUTE_SETUP } from '@/constants/urls';
import { getPublicUrl, resolveInstituteById } from '@/services/domain-routing';
import { THEME_ROLE_SETTINGS_KEY } from '@/types/theme-role-settings';
import { resolveFontStack } from '@/utils/font';
import { BRANDING_TIMEOUT_MS, DEFAULT_THEME_CODE, PANEL_STORAGE_KEYS } from '../config';
import panelApi from './api';
import { getPanelInstituteId, isSignedIn } from './session';
import { readJson, readString, removeKey, writeJson, writeString } from './storage';

export interface PanelBranding {
    instituteId: string;
    name?: string;
    logoUrl?: string | null;
    themeCode?: string;
    fontFamily?: string | null;
}

const listeners = new Set<() => void>();
let cachedRaw: string | null = null;
let cachedValue: PanelBranding | null = null;

export function getCachedBranding(): PanelBranding | null {
    const raw = readString(PANEL_STORAGE_KEYS.branding);
    if (raw !== cachedRaw) {
        cachedRaw = raw;
        cachedValue = readJson<PanelBranding>(PANEL_STORAGE_KEYS.branding);
    }
    return cachedValue;
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

/** Cached branding for the current device (name / logo for the top bar). */
export function usePanelBranding(): PanelBranding | null {
    return useSyncExternalStore(subscribe, getCachedBranding, getCachedBranding);
}

/** Theme code changes for <PanelBrandingSync/> (it calls useTheme().setPrimaryColor). */
const themeListeners = new Set<(themeCode: string) => void>();
export function subscribeThemeCode(listener: (themeCode: string) => void): () => void {
    themeListeners.add(listener);
    return () => {
        themeListeners.delete(listener);
    };
}

function writeThemeKeys(themeCode: string): void {
    // Mirrors ThemeProvider: a preset code lives in 'theme-code', a hex in 'theme-custom-color'.
    if (themeCode.charAt(0) === '#') {
        writeString('theme-custom-color', themeCode);
        removeKey('theme-code');
    } else {
        writeString('theme-code', themeCode);
    }
}

function applyFont(fontFamily: string | null | undefined): void {
    const stack = resolveFontStack(fontFamily);
    if (!stack) return;
    document.documentElement.style.setProperty('--app-font-family', stack);
}

/** Apply the cached branding synchronously (before the first React render). */
export function applyCachedBranding(): void {
    const branding = getCachedBranding();
    if (!branding) return;
    if (branding.themeCode) writeThemeKeys(branding.themeCode);
    applyFont(branding.fontFamily);
}

/**
 * Signed-out branding comes from what /sync already returned, with no Bearer call.
 * The logo and font stay until the institute changes; they come from refreshBranding
 * once a teacher signs in.
 */
export function applyDeviceBranding(device: {
    institute_id: string;
    institute_name: string | null;
    theme_code: string | null;
}): void {
    const cached = getCachedBranding();
    const sameInstitute = cached?.instituteId === device.institute_id;
    const next: PanelBranding = {
        instituteId: device.institute_id,
        name: device.institute_name ?? (sameInstitute ? cached?.name : undefined),
        logoUrl: sameInstitute ? cached?.logoUrl : null,
        themeCode:
            device.theme_code ||
            (sameInstitute ? cached?.themeCode : undefined) ||
            DEFAULT_THEME_CODE,
        fontFamily: sameInstitute ? cached?.fontFamily : null,
    };
    if (sameInstitute && cached?.name === next.name && cached?.themeCode === next.themeCode) return;
    if (!sameInstitute) removeKey(THEME_ROLE_SETTINGS_KEY);
    storeAndApply(next);
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = window.setTimeout(() => reject(new Error('branding timeout')), ms);
        promise.then(
            (value) => {
                window.clearTimeout(timer);
                resolve(value);
            },
            (error) => {
                window.clearTimeout(timer);
                reject(error);
            }
        );
    });
}

interface InstituteSetupResponse {
    institute_info_dto?: {
        institute_name?: string;
        institute_logo_file_id?: string | null;
        institute_theme_code?: string;
        setting?: string;
    };
}

async function fetchBranding(instituteId: string): Promise<PanelBranding> {
    const [setupResult, routingResult] = await Promise.allSettled([
        panelApi.get<InstituteSetupResponse>(`${INIT_INSTITUTE_SETUP}/${instituteId}`),
        resolveInstituteById(instituteId),
    ]);
    const info =
        setupResult.status === 'fulfilled' ? setupResult.value.data?.institute_info_dto : undefined;
    const routing = routingResult.status === 'fulfilled' ? routingResult.value : null;
    if (!info && !routing) throw new Error('branding unavailable');

    // THEME_SETTING roles (nav, background, font) as getInstituteDetails.ts stores them.
    let fontFamily: string | null = routing?.fontFamily ?? null;
    if (info?.setting) {
        try {
            const settings = JSON.parse(info.setting);
            const themeRoleData = settings?.setting?.THEME_SETTING?.data;
            if (themeRoleData?.roles) {
                writeString(THEME_ROLE_SETTINGS_KEY, JSON.stringify(themeRoleData));
                fontFamily = themeRoleData.roles.fontFamily ?? fontFamily;
            } else {
                removeKey(THEME_ROLE_SETTINGS_KEY);
            }
        } catch {
            /* malformed institute settings: keep defaults */
        }
    }

    const logoFileId = info?.institute_logo_file_id ?? routing?.instituteLogoFileId ?? null;
    const logoUrl = await getPublicUrl(logoFileId);
    const themeCode =
        instituteId === HOLISTIC_INSTITUTE_ID
            ? 'holistic'
            : info?.institute_theme_code || routing?.instituteThemeCode || DEFAULT_THEME_CODE;
    return {
        instituteId,
        name: info?.institute_name || routing?.instituteName || undefined,
        logoUrl,
        themeCode,
        fontFamily,
    };
}

function storeAndApply(branding: PanelBranding): void {
    writeJson(PANEL_STORAGE_KEYS.branding, branding);
    if (branding.themeCode) {
        writeThemeKeys(branding.themeCode);
        const code = branding.themeCode;
        themeListeners.forEach((listener) => listener(code));
    }
    applyFont(branding.fontFamily);
    listeners.forEach((listener) => listener());
}

/**
 * Refresh branding for the panel institute (signed in only). Never throws;
 * stops WAITING after BRANDING_TIMEOUT_MS and returns the cached values. A
 * request that lands after the timeout is still applied (same teacher and
 * institute): on panel_api33 the ~700 KB institute-setup response took longer
 * than 3 s right after sign-in, and the whole session kept the default brand.
 */
export async function refreshBranding(): Promise<PanelBranding | null> {
    if (!isSignedIn()) return getCachedBranding();
    const instituteId = getPanelInstituteId();
    if (!instituteId) return getCachedBranding();
    const pending = fetchBranding(instituteId);
    try {
        const branding = await withTimeout(pending, BRANDING_TIMEOUT_MS);
        storeAndApply(branding);
        return branding;
    } catch (error) {
        console.warn('[panel/branding] refresh failed (cached branding kept)', error);
        pending.then(
            (late) => {
                if (isSignedIn() && getPanelInstituteId() === instituteId) storeAndApply(late);
            },
            () => {
                /* already reported above */
            }
        );
        return getCachedBranding();
    }
}
