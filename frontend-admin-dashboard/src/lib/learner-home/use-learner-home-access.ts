import { useMemo } from 'react';
import { getRolesForCurrentInstitute } from '@/lib/auth/instituteUtils';
import {
    readCurrentInstituteIdSafely,
    useCapabilities,
    useCapabilitiesStore,
} from '@/services/capabilities';
import { LEARNER_HOME_FEATURE } from './learner-home-access';

export interface LearnerHomeAccess {
    /** False while /capabilities/me has not answered for this institute. */
    isResolved: boolean;
    moduleOn: boolean;
    isAdmin: boolean;
}

function readRolesSafely(): string[] {
    try {
        return getRolesForCurrentInstitute();
    } catch {
        return [];
    }
}

export function useLearnerHomeAccess(): LearnerHomeAccess {
    const { can, isLoaded } = useCapabilities();
    const failed = useCapabilitiesStore((s) => s.status === 'error');
    const instituteId = readCurrentInstituteIdSafely();
    return useMemo(
        () => ({
            isResolved: isLoaded || failed,
            moduleOn: can(LEARNER_HOME_FEATURE),
            isAdmin: readRolesSafely().includes('ADMIN'),
        }),
        // instituteId: roles are per institute, so a switch must recompute.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [can, isLoaded, failed, instituteId]
    );
}
