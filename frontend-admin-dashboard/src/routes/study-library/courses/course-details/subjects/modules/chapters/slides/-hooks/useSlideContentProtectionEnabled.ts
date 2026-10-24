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
 * URL-only `?access=dev` bypass (tolerant of a stray extra "?"). NOT sticky:
 * protection switches back on the instant the param is gone from the URL.
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
 * Whether Slide Content Protection is enabled for the current user (per-role
 * institute setting). Used by the YouTube player, which needs an overlay to
 * block right-click on its cross-origin iframe. Always false under `?access=dev`.
 */
export function useSlideContentProtectionEnabled(): boolean {
    const { data } = useQuery({
        queryKey: ['slide-content-protection'],
        queryFn: fetchProtection,
        staleTime: 30 * 1000,
    });

    const roles = getRolesForCurrentInstitute();

    if (isDevBypass() || !data) return false;
    if (data.roles && typeof data.roles === 'object') {
        // Highest role wins (ADMIN > TEACHER > LEARNER), same as download
        // permission, so a user who is both an admin and a student is not
        // resolved as an admin here and a learner there.
        const canonicalRoles = roles.map(normalizeRoleKey).filter(Boolean);
        const effectiveRole = effectiveRoleKey(canonicalRoles);
        if (effectiveRole) return data.roles[effectiveRole] === true;
        return canonicalRoles.some((r) => data.roles![r] === true);
    }
    return !!data.enabled; // legacy institute-wide
}
