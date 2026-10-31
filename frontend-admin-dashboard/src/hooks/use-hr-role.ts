import { useMemo } from 'react';
import { TokenKey } from '@/constants/auth/tokens';
import { getInstituteId } from '@/constants/helper';
import { getTokenDecodedData, getTokenFromCookie } from '@/lib/auth/sessionUtility';

const ROLE_ADMIN = 'ADMIN';
const ROLE_HR_ADMIN = 'HR_ADMIN';
const ROLE_HR_MANAGER = 'HR_MANAGER';

export interface HrRoleAccess {
    /** Full HR & payroll authority: process/approve payroll, salary, compliance. */
    isHrAdmin: boolean;
    /** Team-scoped HR authority — can view payroll and act on team requests. */
    isHrStaff: boolean;
}

/**
 * The caller's HR authority in the CURRENT institute, read from the access token.
 *
 * Mirrors the backend's HrAccessGuard exactly: ADMIN and HR_ADMIN are HR admins;
 * HR_MANAGER is HR staff. Institute-scoped on purpose — being HR admin in one
 * institute says nothing about another (same reasoning as useIsMentor).
 *
 * This decides what the UI OFFERS, never what it is allowed to do: every HR
 * endpoint re-checks the same roles server-side and refuses regardless. Hiding a
 * button the backend would reject is a courtesy to the user, not a control.
 */
export function useHrRole(): HrRoleAccess {
    const instituteId = getInstituteId();

    return useMemo(() => {
        if (!instituteId) return { isHrAdmin: false, isHrStaff: false };

        const decoded = getTokenDecodedData(getTokenFromCookie(TokenKey.accessToken) || '');
        const roles = (decoded?.authorities?.[instituteId]?.roles ?? []).map((r) =>
            (r || '').toUpperCase()
        );

        const isHrAdmin = roles.includes(ROLE_ADMIN) || roles.includes(ROLE_HR_ADMIN);
        const isHrStaff = isHrAdmin || roles.includes(ROLE_HR_MANAGER);

        return { isHrAdmin, isHrStaff };
    }, [instituteId]);
}
