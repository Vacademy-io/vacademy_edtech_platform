import { useQuery } from '@tanstack/react-query';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { GET_INSITITUTE_SETTINGS } from '@/constants/urls';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import i18n from '@/i18n';

// Module-scope constant (imported as a default across the app before any component
// mounts), so it cannot call useTranslation(); uses the i18next singleton instead.

/** Per-type default-assignee routing block (mirrors the backend QueryTypeAssignee). */
export interface QueryTypeAssignee {
    source: 'SUBJECT_TEACHER' | 'BATCH_TEACHER' | 'BOTH' | 'ROLE' | 'SPECIFIC_USERS' | 'NONE';
    role?: string | null;
    user_ids?: string[];
}

/** One configurable query type (mirrors the backend QueryTypeConfig). */
export interface QueryTypeConfig {
    key: string;
    label: string;
    enabled?: boolean;
    is_system?: boolean;
    learner_selectable?: boolean;
    assignee?: QueryTypeAssignee | null;
}

const SETTING_KEY = 'DOUBT_MANAGEMENT_SETTING';

/** The built-in academic type that always exists, even before an admin configures anything. */
export const SYSTEM_DOUBT_TYPE: QueryTypeConfig = {
    key: 'DOUBT',
    get label() {
        return i18n.t('studyLibraryDoubtManagementUseDoubtQueryTypes:doubt');
    },
    enabled: true,
    is_system: true,
    learner_selectable: true,
    assignee: { source: 'SUBJECT_TEACHER' },
};

const fetchQueryTypes = async (): Promise<QueryTypeConfig[]> => {
    const instituteId = getCurrentInstituteId();
    if (!instituteId) return [SYSTEM_DOUBT_TYPE];
    try {
        const response = await authenticatedAxiosInstance({
            method: 'GET',
            url: GET_INSITITUTE_SETTINGS,
            params: { instituteId, settingKey: SETTING_KEY },
        });
        const stored = response.data?.data?.query_types;
        if (!Array.isArray(stored) || stored.length === 0) return [SYSTEM_DOUBT_TYPE];
        // Always guarantee the system DOUBT type is present even if a stored payload dropped it.
        const hasDoubt = stored.some((t: QueryTypeConfig) => t?.key?.toUpperCase() === 'DOUBT');
        return hasDoubt ? stored : [SYSTEM_DOUBT_TYPE, ...stored];
    } catch {
        return [SYSTEM_DOUBT_TYPE];
    }
};

/**
 * Reads the institute's configured query types from DOUBT_MANAGEMENT_SETTING. Powers the inbox
 * Type filter and the Category column's key→label lookup. Falls back to a single system DOUBT type
 * so the UI is never empty.
 */
export const useDoubtQueryTypes = () => {
    const query = useQuery({
        queryKey: ['DOUBT_QUERY_TYPES'],
        queryFn: fetchQueryTypes,
        staleTime: 5 * 60 * 1000,
    });

    const queryTypes = query.data ?? [SYSTEM_DOUBT_TYPE];
    const enabledTypes = queryTypes.filter((t) => t.enabled !== false);
    const humanize = (key: string): string =>
        key
            .toLowerCase()
            .split(/[_\s]+/)
            .filter(Boolean)
            .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
            .join(' ');
    const isKnownType = (key?: string | null): boolean =>
        !!key && queryTypes.some((t) => t.key?.toUpperCase() === key.toUpperCase());
    const labelByKey = (key?: string | null): string => {
        if (!key) return i18n.t('studyLibraryDoubtManagementUseDoubtQueryTypes:doubt');
        const match = queryTypes.find((t) => t.key?.toUpperCase() === key.toUpperCase());
        // A doubt whose type was removed from settings falls back to a humanized key
        // (TECHNICAL_ISSUE → "Technical Issue") rather than the raw upper-snake key.
        return match?.label ?? humanize(key);
    };

    return { queryTypes, enabledTypes, labelByKey, isKnownType, ...query };
};
