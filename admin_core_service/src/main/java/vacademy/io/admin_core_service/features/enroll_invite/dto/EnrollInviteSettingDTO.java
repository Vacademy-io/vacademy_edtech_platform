package vacademy.io.admin_core_service.features.enroll_invite.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.Data;
import java.util.List;

/**
 * Main DTO to parse the complex settings JSON from the EnrollInvite entity.
 * This single class contains all nested DTOs as static inner classes
 * and can hold multiple, independent setting blocks.
 */
@Data
@JsonIgnoreProperties(ignoreUnknown = true)
public class EnrollInviteSettingDTO {

    @JsonProperty("setting")
    private Settings setting;

    @Data
    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class Settings {

        /**
         * A block for all settings related to Sub-Organization creation.
         * This is scalable for future sub-org-related settings.
         */
        @JsonProperty("SUB_ORG_SETTING")
        private SubOrgSetting subOrgSetting;

        /**
         * Team-notification config for this invite link: who gets mailed when a
         * learner fills the enrollment form. Mirrors the audience campaign's
         * to_notify, but kept in setting_json so no new column is needed.
         */
        @JsonProperty("NOTIFICATION_SETTING")
        private NotificationSetting notificationSetting;


        // You can add other top-level setting blocks here
    }

    // --- Team Notification Setting Block ---
    @Data
    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class NotificationSetting {

        /**
         * Comma-separated team email addresses that receive the "form filled"
         * alert. Same storage shape as audience.to_notify.
         */
        @JsonProperty("TO_NOTIFY")
        private String toNotify;

        /**
         * Explicit off-switch. Null is treated as enabled so a saved recipient
         * list keeps working; only {@code false} suppresses the alert.
         */
        @JsonProperty("ENABLED")
        private Boolean enabled;
    }

    // --- Sub-Organization Setting Block ---
    @Data
    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class SubOrgSetting {

        /**
         * This block contains the mapping of custom field IDs
         * to their logical purpose (e.g., "name", "email").
         */
        @JsonProperty("CUSTOM_FIELD_MAPPING")
        private CustomFieldSetting customFieldMapping;

        /**
         * This block defines which logical field is used
         * to determine the roles of the new user.
         */
        @JsonProperty("ROLE_CONFIGURATION")
        private RoleConfiguration roleConfiguration;

        /**
         * Auth service roles to assign to users enrolling via this invite.
         * e.g. ["TEACHER"], ["ADMIN"], ["STUDENT", "TEACHER"]
         */
        @JsonProperty("AUTH_ROLES")
        private List<String> authRoles;

        /**
         * Seat cap for the sub-org. Carried here for CPO-backed sub-orgs because the
         * mirror PaymentOption + synthetic PaymentPlan is shared across sub-orgs that
         * pick the same CPO (UNIQUE constraint on payment_option.complex_payment_option_id),
         * so per-sub-org member_count can't live on the org's PaymentPlan. Scoped FREE
         * invites read this when populating their own PaymentPlan.memberCount.
         */
        @JsonProperty("MEMBER_COUNT")
        private Integer memberCount;

        /**
         * Allow-list of custom-role names a sub-org admin can assign on /manage-suborg-teams
         * Add Member. Configured at sub-org creation, editable later by the parent admin
         * via PATCH /institute/v1/sub-org/{id}/team-roles. Distinct from {@link #authRoles},
         * which is the auth-service role assigned to the sub-org admin themselves.
         * Empty / null = no restriction (legacy behaviour — every custom role available).
         */
        @JsonProperty("ALLOWED_TEAM_ROLES")
        private List<String> allowedTeamRoles;

        /**
         * Permissions to assign to the sub-org admin's FSPSSM rows (stored on the
         * access_permission column as a comma-separated string). Picked by the parent
         * institute admin at sub-org creation. Examples: ["FULL"], ["CREATE_COURSE"],
         * ["FULL","CREATE_COURSE"]. Null / empty → the legacy default "FULL" is applied,
         * so existing sub-orgs created before this field shipped behave unchanged.
         */
        @JsonProperty("ADMIN_PERMISSIONS")
        private List<String> adminPermissions;

    }

    @Data
    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class RoleConfiguration {
        @JsonProperty("roleFieldKey")
        private String roleFieldKey;
    }

    // --- Sub-Org Custom Field Mapping Classes ---
    @Data
    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class CustomFieldSetting {
        @JsonProperty("data")
        private CustomFieldSettingData data;
    }

    @Data
    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class CustomFieldSettingData {
        @JsonProperty("allCustomFields")
        private List<CustomFieldMapItem> allCustomFields;
    }

    @Data
    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class CustomFieldMapItem {
        @JsonProperty("customFieldId")
        private String customFieldId;

        @JsonProperty("fieldName")
        private String fieldName;
    }

}
