import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { RoleTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';

const ROLE_MAPPING = {
    ADMIN: SystemTerms.Admin,
    'CONTENT CREATOR': SystemTerms.CourseCreator,
    'ASSESSMENT CREATOR': SystemTerms.AssessmentCreator,
    EVALUATOR: SystemTerms.Evaluator,
    TEACHER: SystemTerms.Teacher,
    STUDENT: SystemTerms.Learner,
} as const;

type BackendRole = keyof typeof ROLE_MAPPING;

// Special mapping for role names that need to be normalized
const specialRoleMapping = (roleName: string): string => {
    // Remove spaces and convert to proper case for special roles
    switch (roleName) {
        case 'CONTENT CREATOR':
            return RoleTerms.CourseCreator;
        case 'ASSESSMENT CREATOR':
            return RoleTerms.AssessmentCreator;
        default:
            return ROLE_MAPPING[roleName as BackendRole];
    }
};

const isSpecialRole = (roleName: string): boolean => {
    return roleName === 'CONTENT CREATOR' || roleName === 'ASSESSMENT CREATOR';
};
/**
 * Maps a backend role name to its custom terminology based on naming settings
 * @param backendRole - The role name as received from backend
 * @returns The custom role name based on naming settings, or the original name if no mapping exists
 */
export const mapRoleToCustomName = (backendRole: string): string => {
    // Normalize the role name first
    if (isSpecialRole(backendRole)) {
        const systemTerm = ROLE_MAPPING[backendRole as BackendRole];
        return getTerminology(specialRoleMapping(backendRole), systemTerm);
    }
    const systemTerm = ROLE_MAPPING[backendRole as BackendRole];
    if (!systemTerm) return backendRole;
    return getTerminology(systemTerm, systemTerm);
};

/**
 * A role name fit to show: the institute's own term for system roles ("TEACHER" → "Teacher",
 * or whatever Naming Settings calls it), other all-caps names title-cased ("COUNSELLOR" →
 * "Counsellor"), and custom roles typed in mixed case left as they are.
 */
export const roleDisplayName = (role: string): string => {
    let mapped = role;
    try {
        mapped = mapRoleToCustomName(role);
    } catch {
        // Naming settings unreadable: fall through to the title-cased name.
    }
    if (mapped !== role || role !== role.toUpperCase()) return mapped;
    return role
        .replace(/[_\s]+/g, ' ')
        .trim()
        .toLowerCase()
        .replace(/\b\w/g, (c) => c.toUpperCase());
};
