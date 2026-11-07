import { useQuery } from '@tanstack/react-query';
import {
    DEFAULT_LIVE_SESSION_SETTINGS,
    getLiveSessionSettings,
    type LiveSessionSettings,
} from '@/services/live-session-settings';
import {
    ADMIN_DISPLAY_SETTINGS_KEY,
    TEACHER_DISPLAY_SETTINGS_KEY,
    DEFAULT_LIVE_CLASS_SCHEDULING_SETTINGS,
} from '@/types/display-settings';
import { getDisplaySettingsWithFallback } from '@/services/display-settings';
import { getRolesForCurrentInstitute } from '@/lib/auth/instituteUtils';

export const LIVE_SESSION_SETTINGS_QUERY_KEY = ['institute-settings', 'LIVE_SESSION_SETTING'];
export const ROLE_DISPLAY_SETTINGS_QUERY_KEY = ['role-display-settings'];

/** Pick the display-settings key for the current admin's role (current institute) from the JWT. */
const resolveRoleKey = (): string => {
    try {
        // Roles in the institute being worked in — not every institute in the token.
        const roles = getRolesForCurrentInstitute();
        if (roles.includes('ADMIN')) return ADMIN_DISPLAY_SETTINGS_KEY;
        if (roles.includes('TEACHER')) return TEACHER_DISPLAY_SETTINGS_KEY;
    } catch {
        // fall through
    }
    return ADMIN_DISPLAY_SETTINGS_KEY;
};

/**
 * Reads the institute-level LiveSessionSettings document AND the current
 * role's display-settings document. Bulk / single scheduling visibility is
 * driven entirely by the per-role display settings now (the institute-wide
 * "Scheduling Modes" toggles were retired in favour of role-scoped control),
 * so we ignore the persisted institute-level flags for those two fields and
 * read role-level values directly. Other flags (allowedPlatforms, feedback,
 * etc.) still come straight from the institute setting.
 *
 * Always returns a fully-shaped settings object — defaults are applied client
 * side so callers never have to null-check individual flags. Use the loaded
 * values in UI guards like `if (settings.bulkScheduleEnabled) {...}`.
 */
export const useLiveSessionSettings = (): {
    settings: LiveSessionSettings;
    isLoading: boolean;
} => {
    const { data: institute, isLoading: instituteLoading } = useQuery({
        queryKey: LIVE_SESSION_SETTINGS_QUERY_KEY,
        queryFn: getLiveSessionSettings,
        staleTime: 5 * 60 * 1000,
    });

    const { data: roleDisplay, isLoading: roleLoading } = useQuery({
        queryKey: ROLE_DISPLAY_SETTINGS_QUERY_KEY,
        queryFn: () => getDisplaySettingsWithFallback(resolveRoleKey()),
        staleTime: 5 * 60 * 1000,
    });

    const base = institute ?? DEFAULT_LIVE_SESSION_SETTINGS;
    const roleScheduling =
        roleDisplay?.liveClassScheduling ?? DEFAULT_LIVE_CLASS_SCHEDULING_SETTINGS;

    const settings: LiveSessionSettings = {
        ...base,
        // Role-level is the single source of truth for entry-point visibility.
        // We deliberately do not AND with `base.{single,bulk}ScheduleEnabled`
        // any more, because the institute-wide UI for those toggles was
        // removed — an institute that previously turned them off would
        // otherwise be stuck off forever.
        bulkScheduleEnabled: roleScheduling.bulkScheduleEnabled,
        singleScheduleEnabled: roleScheduling.singleScheduleEnabled,
    };

    return {
        settings,
        isLoading: instituteLoading || roleLoading,
    };
};
