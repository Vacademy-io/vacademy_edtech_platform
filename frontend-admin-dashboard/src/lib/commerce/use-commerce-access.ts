import { useMemo } from 'react';
import { getRolesForCurrentInstitute } from '@/lib/auth/instituteUtils';
import {
    readCurrentInstituteIdSafely,
    useCapabilities,
    useCapabilitiesStore,
} from '@/services/capabilities';
import { type CommerceAccess, resolveCommerceAccess } from './commerce-access';

/** Roles can come from storage or a cookie that is unreadable; that means "none". */
function readRolesSafely(): string[] {
    try {
        return getRolesForCurrentInstitute();
    } catch {
        return [];
    }
}

export interface CommerceAccessState extends CommerceAccess {
    /**
     * False while `/capabilities/v1/me` has not answered for this institute. The
     * access object already reads as "module off" then (fail closed); screens use
     * this to show a skeleton instead of the locked page for that moment. A call
     * that FAILED counts as resolved: the answer stays "off".
     */
    isResolved: boolean;
}

/**
 * The signed-in person's commerce access in the CURRENT institute. Institute
 * scoped on purpose, like useHrRole: a store manager here is nobody elsewhere.
 */
export function useCommerceAccess(): CommerceAccessState {
    const { can, isLoaded } = useCapabilities();
    const failed = useCapabilitiesStore((s) => s.status === 'error');
    const instituteId = readCurrentInstituteIdSafely();
    return useMemo(() => {
        const access = resolveCommerceAccess({ roles: readRolesSafely(), isFeatureOn: can });
        return { ...access, isResolved: isLoaded || failed };
        // instituteId: the roles are read per institute, so a switch must recompute.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [can, isLoaded, failed, instituteId]);
}
