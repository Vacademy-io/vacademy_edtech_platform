package vacademy.io.notification_service.features.announcements.dto;

import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import vacademy.io.notification_service.features.announcements.enums.ScheduleType;
import vacademy.io.notification_service.features.announcements.validation.FutureInScheduleZone;

import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

@Getter
@Setter
@AllArgsConstructor
@NoArgsConstructor
public class CreateAnnouncementRequest {
    
    @NotBlank(message = "Title is required")
    @Size(max = 500, message = "Title must not exceed 500 characters")
    private String title;
    
    @NotNull(message = "Content is required")
    @Valid
    private RichTextDataRequest content;
    
    @NotBlank(message = "Institute ID is required")
    private String instituteId;
    
    @NotBlank(message = "Created by is required")
    private String createdBy;
    
    @Size(max = 255, message = "Creator name must not exceed 255 characters")
    private String createdByName;
    
    @Size(max = 100, message = "Creator role must not exceed 100 characters")
    private String createdByRole;
    
    @Size(max = 50, message = "Timezone must not exceed 50 characters")
    private String timezone;

    /** Optional correlation: what this announcement is about ("LEAD") and which one. */
    private String entity;
    private String entityId;
    
    // Recipients (Inclusions)
    @NotEmpty(message = "At least one recipient is required")
    @Valid
    private List<RecipientRequest> recipients;
    
    // Exclusions moved to individual recipients - keeping for backward compatibility
    @Valid
    private List<RecipientRequest> exclusions;
    
    // Modes
    @NotEmpty(message = "At least one mode is required")
    @Valid
    private List<ModeRequest> modes;
    
    // Mediums
    @Valid
    private List<MediumRequest> mediums;
    
    // Scheduling
    @Valid
    private SchedulingRequest scheduling;
    
    @Getter
    @Setter
    @AllArgsConstructor
    @NoArgsConstructor
    public static class RichTextDataRequest {
        
        @NotBlank(message = "Content type is required")
        @Pattern(regexp = "^(text|html|video|image)$", message = "Content type must be one of: text, html, video, image")
        private String type;
        
        @NotBlank(message = "Content is required")
        private String content;
    }
    
    @Getter
    @Setter
    @AllArgsConstructor
    @NoArgsConstructor
    public static class RecipientRequest {

        @NotBlank(message = "Recipient type is required")
        @Pattern(regexp = "^(ROLE|USER|PACKAGE_SESSION|PACKAGE_SESSION_COMMA_SEPARATED_ORG_ROLES|TAG|CUSTOM_FIELD_FILTER|AUDIENCE)$", message = "Recipient type must be one of: ROLE, USER, PACKAGE_SESSION, PACKAGE_SESSION_COMMA_SEPARATED_ORG_ROLES, TAG, CUSTOM_FIELD_FILTER, AUDIENCE")
        private String recipientType; // ROLE, USER, PACKAGE_SESSION, PACKAGE_SESSION_COMMA_SEPARATED_ORG_ROLES, TAG, CUSTOM_FIELD_FILTER, AUDIENCE

        @NotBlank(message = "Recipient ID is required", groups = {RecipientRequest.StandardRecipient.class})
        private String recipientId;

        @Size(max = 255, message = "Recipient name must not exceed 255 characters")
        private String recipientName;

        // Custom field filters applied to this recipient (before exclusions)
        @Valid
        private List<CustomFieldFilter> customFieldFilters;

        // Exclusions for this recipient (applied after custom field filters)
        @Valid
        private List<Exclusion> exclusions;

        // Interface for validation groups
        public interface StandardRecipient {}
        public interface CustomFieldFilterRecipient {}
        
        @Getter
        @Setter
        @AllArgsConstructor
        @NoArgsConstructor
        public static class CustomFieldFilter {
            // Custom field ID (preferred)
            @Size(max = 255, message = "Custom field ID must not exceed 255 characters")
            private String customFieldId;

            // Deprecated: kept for backward compatibility
            @Size(max = 255, message = "Field name must not exceed 255 characters")
            private String fieldName;

            @NotBlank(message = "Field value is required")
            @Size(max = 1000, message = "Field value must not exceed 1000 characters")
            private String fieldValue;

            // Optional: operator type (equals, contains, startsWith, etc.)
            @Size(max = 50, message = "Operator must not exceed 50 characters")
            private String operator; // Default: "equals"
        }

        @Getter
        @Setter
        @AllArgsConstructor
        @NoArgsConstructor
        public static class Exclusion {

            @NotBlank(message = "Exclusion type is required")
            @Pattern(regexp = "^(ROLE|USER|PACKAGE_SESSION|PACKAGE_SESSION_COMMA_SEPARATED_ORG_ROLES|TAG|CUSTOM_FIELD_FILTER|AUDIENCE)$", message = "Exclusion type must be one of: ROLE, USER, PACKAGE_SESSION, PACKAGE_SESSION_COMMA_SEPARATED_ORG_ROLES, TAG, CUSTOM_FIELD_FILTER, AUDIENCE")
            private String exclusionType;

            private String exclusionId; // For USER, ROLE, PACKAGE_SESSION, etc.

            // Custom field filters for this exclusion (optional)
            @Valid
            private List<CustomFieldFilter> customFieldFilters;
        }
    }
    
    @Getter
    @Setter
    @AllArgsConstructor
    @NoArgsConstructor
    public static class ModeRequest {
        
        @NotBlank(message = "Mode type is required")
        @Pattern(regexp = "^(SYSTEM_ALERT|DASHBOARD_PIN|DM|STREAM|RESOURCES|COMMUNITY|TASKS|APP_OVERLAY)$",
                 message = "Mode type must be one of: SYSTEM_ALERT, DASHBOARD_PIN, DM, STREAM, RESOURCES, COMMUNITY, TASKS, APP_OVERLAY")
        private String modeType; // SYSTEM_ALERT, DASHBOARD_PIN, DM, STREAM, RESOURCES, COMMUNITY, TASKS, APP_OVERLAY
        
        private Map<String, Object> settings;
    }
    
    @Getter
    @Setter
    @AllArgsConstructor
    @NoArgsConstructor
    public static class MediumRequest {
        
        @NotBlank(message = "Medium type is required")
        @Pattern(regexp = "^(WHATSAPP|PUSH_NOTIFICATION|EMAIL)$", 
                 message = "Medium type must be one of: WHATSAPP, PUSH_NOTIFICATION, EMAIL")
        private String mediumType; // WHATSAPP, PUSH_NOTIFICATION, EMAIL
        
        private Map<String, Object> config;
    }
    
    @Getter
    @Setter
    @AllArgsConstructor
    @NoArgsConstructor
    public static class EmailConfigRequest {
        
        @NotBlank(message = "Subject is required")
        private String subject;
        
        private String template = "announcement_email";
        
        private String forceToEmail; // Optional override
        
        @NotBlank(message = "From email is required")
        private String fromEmail;
        
        private String fromName; // Optional display name
        
        @NotBlank(message = "Email type is required")
        @Pattern(regexp = "^(marketing|transactional|notifications)$", 
                 message = "Email type must be one of: marketing, transactional, notifications")
        private String emailType; // marketing, transactional, notifications
    }
    
    @Getter
    @Setter
    @AllArgsConstructor
    @NoArgsConstructor
    @FutureInScheduleZone
    public static class SchedulingRequest {
        
        @NotNull(message = "Schedule type is required")
        private ScheduleType scheduleType;
        
        @Size(max = 100, message = "Cron expression must not exceed 100 characters")
        private String cronExpression;
        
        @Size(max = 50, message = "Timezone must not exceed 50 characters")
        private String timezone;
        
        // Future-ness is checked in the schedule's timezone by @FutureInScheduleZone
        private LocalDateTime startDate;
        
        private LocalDateTime endDate;
    }
}