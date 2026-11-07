import { useMemo } from 'react';
import { getRolesForCurrentInstitute } from '@/lib/auth/instituteUtils';

export interface VimotionRoleInfo {
    roles: string[];
    isAdmin: boolean;
    isContentCreator: boolean;
}

// Reads the viewer's roles in the current institute off the JWT. ADMIN gates the Team tab
// and the Top Up flow; CONTENT CREATOR sees credits read-only and cannot top up.
export function useVimotionRole(): VimotionRoleInfo {
    return useMemo(() => {
        const roles = getRolesForCurrentInstitute().map((r) => r.toUpperCase());
        return {
            roles,
            isAdmin: roles.includes('ADMIN'),
            isContentCreator: roles.includes('CONTENT CREATOR'),
        };
    }, []);
}
