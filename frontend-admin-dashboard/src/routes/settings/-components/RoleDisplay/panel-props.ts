/**
 * Shared props for the three role display-settings panels (Admin, Teacher and
 * custom roles).
 *
 * The panels own their editor state and save themselves, so the page around them
 * normally needs to know nothing. The one exception is "Copy to other roles": it
 * copies the SAVED settings of the open role, so it has to know when the panel is
 * holding unsaved edits and refuse rather than silently copy the pre-edit state.
 */
export interface RoleDisplayPanelProps {
    /** Called whenever the panel's unsaved-changes state flips. */
    onDirtyChange?: (dirty: boolean) => void;
}
