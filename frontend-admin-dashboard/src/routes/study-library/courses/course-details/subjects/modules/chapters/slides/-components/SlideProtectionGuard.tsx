import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { getInstituteId } from '@/constants/helper';
import { GET_INSITITUTE_SETTINGS } from '@/constants/urls';
import { getRolesForCurrentInstitute } from '@/lib/auth/instituteUtils';
import { effectiveRoleKey, normalizeRoleKey } from '@/constants/slide-download-permission';

const SETTING_KEY = 'SLIDE_CONTENT_PROTECTION_SETTING';

interface ContentProtectionData {
    roles?: Record<string, boolean>;
    enabled?: boolean; // legacy institute-wide
}

/**
 * Dev escape hatch: an `access=dev` token anywhere in the URL (tolerant of a
 * stray extra "?") disables the protection. URL-only and NOT sticky —
 * protection returns the instant the param is gone from the URL.
 */
function isDevBypass(): boolean {
    try {
        return window.location.href.split(/[?&#]/).some((token) => {
            const [key, value] = token.split('=');
            return key === 'access' && value === 'dev';
        });
    } catch {
        return false;
    }
}

const fetchProtection = async (): Promise<ContentProtectionData | null> => {
    const instituteId = getInstituteId();
    try {
        const response = await authenticatedAxiosInstance({
            method: 'GET',
            url: GET_INSITITUTE_SETTINGS,
            params: { instituteId, settingKey: SETTING_KEY },
            timeout: 8000,
        });
        const data = response.data?.data;
        return data && typeof data === 'object' ? data : null;
    } catch {
        return null;
    }
};

/**
 * Applies Slide Content Protection inside the ADMIN slides view: while it is
 * mounted and the setting is on for one of the current user's roles, block
 * right-click and the common view-source / DevTools shortcuts. Per-role, so
 * admins are exempt unless an admin explicitly enabled it for the Admin role.
 * Bypassed with `?access=dev`. Best-effort deterrent — not a real lock.
 *
 * Renders nothing; it only attaches document listeners.
 */
export function SlideProtectionGuard() {
    const { data } = useQuery({
        queryKey: ['slide-content-protection'],
        queryFn: fetchProtection,
        staleTime: 30 * 1000,
    });

    const roles = getRolesForCurrentInstitute();

    let enabled = false;
    if (!isDevBypass() && data) {
        if (data.roles && typeof data.roles === 'object') {
            // Highest role wins (ADMIN > TEACHER > LEARNER), same rule as the
            // download permission, so staff who are also enrolled as students
            // get one consistent answer across both settings.
            const canonicalRoles = roles.map(normalizeRoleKey).filter(Boolean);
            const effectiveRole = effectiveRoleKey(canonicalRoles);
            enabled = effectiveRole
                ? data.roles[effectiveRole] === true
                : canonicalRoles.some((r) => data.roles![r] === true);
        } else {
            enabled = !!data.enabled; // legacy institute-wide
        }
    }

    useEffect(() => {
        if (!enabled) return;
        const blockContextMenu = (e: MouseEvent) => e.preventDefault();
        const blockKeys = (e: KeyboardEvent) => {
            // Match on e.code (layout-independent physical key), not e.key: on
            // macOS holding Option/Alt mangles e.key (Cmd+Option+I is not "i").
            const code = e.code;
            const cmdOrCtrl = e.ctrlKey || e.metaKey;
            const isF12 = e.key === 'F12' || code === 'F12';
            const isViewSource = cmdOrCtrl && code === 'KeyU';
            const isDevTools =
                cmdOrCtrl && (e.shiftKey || e.altKey) && ['KeyI', 'KeyJ', 'KeyC'].includes(code);
            if (isF12 || isViewSource || isDevTools) {
                e.preventDefault();
                e.stopPropagation();
            }
        };
        document.addEventListener('contextmenu', blockContextMenu);
        document.addEventListener('keydown', blockKeys, true);
        return () => {
            document.removeEventListener('contextmenu', blockContextMenu);
            document.removeEventListener('keydown', blockKeys, true);
        };
    }, [enabled]);

    return null;
}
