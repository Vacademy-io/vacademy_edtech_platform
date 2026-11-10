import { TokenKey } from '@/constants/auth/tokens';
import { getTokenDecodedData, getTokenFromCookie } from '@/lib/auth/sessionUtility';

/**
 * Institutes where the signed-in user holds ADMIN, `currentId` first. Only decides whether the
 * "My schools" switch is offered: /usage/multi checks ADMIN on every id itself.
 */
export function adminInstituteIds(currentId: string): string[] {
    try {
        const authorities = getTokenDecodedData(getTokenFromCookie(TokenKey.accessToken))
            ?.authorities as Record<string, { roles?: unknown }> | undefined;
        const ids = Object.entries(authorities ?? {})
            .filter(([, authority]) => {
                const roles = authority?.roles;
                return Array.isArray(roles) && roles.includes('ADMIN');
            })
            .map(([id]) => id);
        return ids.includes(currentId) ? [currentId, ...ids.filter((id) => id !== currentId)] : ids;
    } catch {
        return [];
    }
}
