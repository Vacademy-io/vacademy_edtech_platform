/**
 * Applies one role's display settings to other roles.
 *
 * The settings page configures a single role at a time, and an institute that
 * wants its Counsellor, Front Desk and Co-ordinator roles to look alike had to
 * reproduce every toggle by hand, three times, without drifting. This is that job
 * done once.
 *
 * Two properties matter more than the copying itself:
 *
 * - **Each target keeps its own rules.** The blob is re-constrained per target via
 *   {@link applyRoleConstraints}, so copying an admin's settings onto a teacher
 *   does not hand teachers the Settings tab or institute-edit rights.
 * - **Targets are written one at a time.** Custom roles all live inside the single
 *   `ROLE_DISPLAY_SETTINGS` blob, and `saveDisplaySettings` writes it read-modify-
 *   write; firing those concurrently would have each read the pre-copy blob and the
 *   last write would drop every sibling. Sequential writes make each one read what
 *   the previous wrote. See `services/role-display-settings-blob.ts` for the same
 *   hazard between auto-saving cards.
 */

import { saveDisplaySettings } from '@/services/display-settings';
import type { DisplaySettingsData } from '@/types/display-settings';
import { applyRoleConstraints, type RoleKind } from './role-constraints';

/** A role the current settings can be copied onto. */
export interface RoleCopyTarget {
    /** Display-settings storage key, e.g. `CUSTOM_ROLE_DISPLAY_SETTINGS_<uuid>`. */
    settingsKey: string;
    /** Which constraint set applies to this role. */
    kind: RoleKind;
    /** Human name, used in results and toasts. */
    label: string;
}

export interface CopyToRolesResult {
    /** Labels of roles written successfully. */
    succeeded: string[];
    /** Roles that failed, with the reason, so the UI can name them. */
    failed: Array<{ label: string; message: string }>;
}

function messageOf(error: unknown): string {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const e = error as any;
    return e?.response?.data?.message || e?.message || 'Unknown error';
}

/**
 * Writes `settings` onto every target, constrained for each.
 *
 * Never throws: one role failing must not abandon the rest, because a partial copy
 * that reports which half landed is recoverable and an exception halfway through is
 * not. The caller decides how to present {@link CopyToRolesResult}.
 */
export async function copyDisplaySettingsToRoles(
    settings: DisplaySettingsData,
    targets: RoleCopyTarget[]
): Promise<CopyToRolesResult> {
    const result: CopyToRolesResult = { succeeded: [], failed: [] };

    for (const target of targets) {
        try {
            await saveDisplaySettings(
                target.settingsKey,
                applyRoleConstraints(settings, target.kind)
            );
            result.succeeded.push(target.label);
        } catch (error) {
            result.failed.push({ label: target.label, message: messageOf(error) });
        }
    }

    return result;
}
