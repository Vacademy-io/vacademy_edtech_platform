/**
 * The rules a role's display settings must satisfy no matter what the editor
 * produced, applied on every write.
 *
 * These used to live inline in each of the three settings panels' `save()`, which
 * was fine while a panel could only ever write its own role. "Copy these settings
 * to other roles" breaks that assumption: it takes one role's blob and writes it
 * under another's key, and the constraints are NOT the same for every role — admin
 * force-shows the Settings tab, teacher and custom roles strip it entirely and deny
 * institute editing. Copying admin → teacher without re-applying the target's rules
 * hands every teacher a Settings tab and institute-edit rights, which is the one
 * mistake in this feature that is a privilege escalation rather than a cosmetic
 * slip.
 *
 * So the constraint lives here, keyed by the role it applies to, and both the save
 * path and the copy path call it. Adding a rule in one place now covers both.
 */

import {
    ADMIN_DISPLAY_SETTINGS_KEY,
    CUSTOM_ROLE_DISPLAY_SETTINGS_KEY,
    TEACHER_DISPLAY_SETTINGS_KEY,
    type DisplaySettingsData,
} from '@/types/display-settings';

/**
 * Which rule-set applies. Custom roles are governed exactly as teachers are —
 * they are staff without institute ownership — but they are named separately
 * because that is a decision, not a coincidence, and the two could diverge.
 */
export type RoleKind = 'admin' | 'teacher' | 'custom';

/** The sidebar tab only an admin may see. */
const SETTINGS_TAB_ID = 'settings';

/** The role kind a display-settings storage key belongs to. */
export function roleKindForSettingsKey(settingsKey: string): RoleKind {
    if (settingsKey === ADMIN_DISPLAY_SETTINGS_KEY) return 'admin';
    if (settingsKey === TEACHER_DISPLAY_SETTINGS_KEY) return 'teacher';
    if (
        settingsKey === CUSTOM_ROLE_DISPLAY_SETTINGS_KEY ||
        settingsKey.startsWith(`${CUSTOM_ROLE_DISPLAY_SETTINGS_KEY}_`)
    ) {
        return 'custom';
    }
    // An unrecognised key is not a reason to write unconstrained settings. Treat it
    // as the most restricted kind.
    return 'custom';
}

/**
 * Returns `settings` with the target role's non-negotiable rules applied. Pure —
 * the input is not mutated, so a caller can keep showing the unconstrained editor
 * state while persisting the constrained one.
 */
export function applyRoleConstraints(
    settings: DisplaySettingsData,
    kind: RoleKind
): DisplaySettingsData {
    if (kind === 'admin') {
        return {
            ...settings,
            // Admin constraint: the Settings tab cannot be hidden — hiding it is how
            // an institute locks itself out of its own configuration.
            sidebar: (settings.sidebar || []).map((tab) =>
                tab.id === SETTINGS_TAB_ID ? { ...tab, visible: true } : tab
            ),
        };
    }

    // Teacher and custom roles: no Settings tab at all, and no institute editing.
    return {
        ...settings,
        sidebar: (settings.sidebar || []).filter((tab) => tab.id !== SETTINGS_TAB_ID),
        permissions: {
            ...settings.permissions,
            canViewInstituteDetails: settings.permissions?.canViewInstituteDetails ?? false,
            canEditInstituteDetails: false,
            canEditProfileDetails: settings.permissions?.canEditProfileDetails ?? false,
        },
    };
}
