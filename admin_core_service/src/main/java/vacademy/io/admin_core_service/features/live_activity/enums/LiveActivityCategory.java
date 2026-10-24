package vacademy.io.admin_core_service.features.live_activity.enums;

/**
 * Feed categories. These map 1:1 to the tabs in the Live Activity UI and to the
 * per-role sub-tab visibility flags in Display Settings, so renaming one is a
 * coordinated change across {@code sidebar/constant.ts} and the display-settings defaults.
 */
public enum LiveActivityCategory {
    INVITE_FORM,
    LEAD_FORM,
    CALL,
    PAYMENT,
    COUNSELLOR
}
