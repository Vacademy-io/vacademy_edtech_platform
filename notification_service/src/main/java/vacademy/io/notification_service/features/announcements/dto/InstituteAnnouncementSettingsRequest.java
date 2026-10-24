package vacademy.io.notification_service.features.announcements.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class InstituteAnnouncementSettingsRequest {
    
    @NotBlank(message = "Institute ID is required")
    private String instituteId;
    
    @NotNull(message = "Settings are required")
    @Valid
    private AnnouncementSettings settings;
    
    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    public static class AnnouncementSettings {
        
        @Valid
        private CommunitySettings community;
        
        @Valid
        private DashboardPinSettings dashboardPins;
        
        @Valid
        private SystemAlertSettings systemAlerts;
        
        @Valid
        private DirectMessageSettings directMessages;
        
        @Valid
        private StreamSettings streams;
        
        @Valid
        private ResourceSettings resources;
        
        @Valid
        private AppOverlaySettings appOverlays;

        @Valid
        private GeneralSettings general;

        @Valid
        private FirebaseSettings firebase;

        @Valid
        private vacademy.io.notification_service.features.chat.dto.ChatSettings chat;

        /**
         * Copy-recipient (CC/BCC) config for transactional email. Must stay declared here or
         * convertRequestToMap silently drops it on every settings save.
         */
        @Valid
        private vacademy.io.notification_service.features.send.dto.EmailCcSettings emailCc;
    }
    
    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    public static class CommunitySettings {
        @JsonProperty("students_can_send")
        private Boolean studentsCanSend = false;
        
        @JsonProperty("teachers_can_send")
        private Boolean teachersCanSend = true;
        
        @JsonProperty("admins_can_send")
        private Boolean adminsCanSend = true;
        
        @JsonProperty("allow_replies")
        private Boolean allowReplies = true;
        
        @JsonProperty("moderation_enabled")
        private Boolean moderationEnabled = false;
        
        @JsonProperty("allowed_tags")
        private List<String> allowedTags;
    }
    
    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    public static class DashboardPinSettings {
        @JsonProperty("students_can_create")
        private Boolean studentsCanCreate = false;
        
        @JsonProperty("teachers_can_create")
        private Boolean teachersCanCreate = true;
        
        @JsonProperty("admins_can_create")
        private Boolean adminsCanCreate = true;
        
        @JsonProperty("max_duration_hours")
        private Integer maxDurationHours = 24;
        
        @JsonProperty("max_pins_per_user")
        private Integer maxPinsPerUser = 5;
        
        @JsonProperty("require_approval")
        private Boolean requireApproval = false;
    }
    
    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    public static class SystemAlertSettings {
        @JsonProperty("students_can_send")
        private Boolean studentsCanSend = false;
        
        @JsonProperty("teachers_can_send")
        private Boolean teachersCanSend = true;
        
        @JsonProperty("admins_can_send")
        private Boolean adminsCanSend = true;
        
        @JsonProperty("high_priority_roles")
        private List<String> highPriorityRoles;
        
        @JsonProperty("auto_dismiss_hours")
        private Integer autoDismissHours = 72;
    }
    
    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    public static class DirectMessageSettings {
        @JsonProperty("students_can_send")
        private Boolean studentsCanSend = true;
        
        @JsonProperty("teachers_can_send")
        private Boolean teachersCanSend = true;
        
        @JsonProperty("admins_can_send")
        private Boolean adminsCanSend = true;
        
        @JsonProperty("allow_student_to_student")
        private Boolean allowStudentToStudent = false;
        
        @JsonProperty("allow_replies")
        private Boolean allowReplies = true;
        
        @JsonProperty("moderation_enabled")
        private Boolean moderationEnabled = false;
    }
    
    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    public static class StreamSettings {
        @JsonProperty("students_can_send")
        private Boolean studentsCanSend = false;
        
        @JsonProperty("teachers_can_send")
        private Boolean teachersCanSend = true;
        
        @JsonProperty("admins_can_send")
        private Boolean adminsCanSend = true;
        
        @JsonProperty("allow_during_class")
        private Boolean allowDuringClass = true;
        
        @JsonProperty("auto_archive_hours")
        private Integer autoArchiveHours = 24;
    }
    
    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    public static class ResourceSettings {
        @JsonProperty("students_can_upload")
        private Boolean studentsCanUpload = false;
        
        @JsonProperty("teachers_can_upload")
        private Boolean teachersCanUpload = true;
        
        @JsonProperty("admins_can_upload")
        private Boolean adminsCanUpload = true;
        
        @JsonProperty("allowed_folders")
        private List<String> allowedFolders;
        
        @JsonProperty("allowed_categories")
        private List<String> allowedCategories;
        
        @JsonProperty("max_file_size_mb")
        private Integer maxFileSizeMb = 50;
    }
    
    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    public static class AppOverlaySettings {
        @JsonProperty("students_can_send")
        private Boolean studentsCanSend = false;

        @JsonProperty("teachers_can_send")
        private Boolean teachersCanSend = true;

        @JsonProperty("admins_can_send")
        private Boolean adminsCanSend = true;
    }

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    public static class GeneralSettings {
        @JsonProperty("announcement_approval_required")
        private Boolean announcementApprovalRequired = false;
        
        @JsonProperty("max_announcements_per_day")
        private Integer maxAnnouncementsPerDay = 10;
        
        @JsonProperty("allowed_mediums")
        private List<String> allowedMediums;
        
        @JsonProperty("default_timezone")
        private String defaultTimezone = "Asia/Kolkata";
        
        @JsonProperty("retention_days")
        private Integer retentionDays = 365;

        @JsonProperty("email_tracking_enabled")
        private Boolean emailTrackingEnabled = true;
    }
    
    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    public static class FirebaseSettings {
        @JsonProperty("enabled")
        // No default: when a request omits "enabled" the stored value is kept on save. The flag is informational
        // (shown in the admin page); MultiTenantFirebaseManager sends whenever a key is stored.
        private Boolean enabled;
        
        @JsonProperty("serviceAccountJson")
        private String serviceAccountJson;
        
        @JsonProperty("serviceAccountJsonBase64")
        private String serviceAccountJsonBase64;
    }
}