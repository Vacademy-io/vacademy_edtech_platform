package vacademy.io.notification_service.features.announcements.controller;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.notification_service.features.announcements.dto.*;
import vacademy.io.notification_service.features.announcements.enums.AnnouncementStatus;
import vacademy.io.notification_service.features.announcements.enums.ModeType;
import vacademy.io.notification_service.features.announcements.security.AnnouncementAccessGuard;
import vacademy.io.notification_service.features.announcements.service.AnnouncementService;
import vacademy.io.notification_service.features.announcements.service.EmailConfigurationService;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import org.springframework.validation.annotation.Validated;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/notification-service/v1/announcements")
@RequiredArgsConstructor
@Slf4j
@CrossOrigin(origins = "*") // For internal service communication
@Validated
public class AnnouncementController {

    private final AnnouncementService announcementService;
    private final EmailConfigurationService emailConfigurationService;
    // Everything except creation is an admin-dashboard call and checks its caller; creation
    // stays open for the services that POST announcements without a user token.
    private final AnnouncementAccessGuard accessGuard;

    /**
     * Create a new announcement - Main API for other services
     */
    @PostMapping
    public ResponseEntity<AnnouncementResponse> createAnnouncement(@Valid @RequestBody CreateAnnouncementRequest request) {
        log.info("Creating announcement: {} for institute: {}", request.getTitle(), request.getInstituteId());

        try {
            AnnouncementResponse response = announcementService.createAnnouncement(request);
            return ResponseEntity.ok(response);
        } catch (Exception e) {
            log.error("Error creating announcement", e);
            return ResponseEntity.badRequest().build();
        }
    }

    /**
     * Get announcement by ID
     */
    @GetMapping("/{announcementId}")
    public ResponseEntity<AnnouncementResponse> getAnnouncement(
            @AuthenticationPrincipal CustomUserDetails user,
            @RequestHeader(value = "clientId", required = false) String clientId,
            @PathVariable @NotBlank(message = "Announcement ID is required") String announcementId) {
        accessGuard.requireStaffForAnnouncement(user, clientId, announcementId);
        try {
            AnnouncementResponse response = announcementService.getAnnouncement(announcementId);
            return ResponseEntity.ok(response);
        } catch (Exception e) {
            log.error("Error getting announcement: {}", announcementId, e);
            return ResponseEntity.notFound().build();
        }
    }

    /**
     * Get announcements by institute with pagination
     */
    @GetMapping("/institute/{instituteId}")
    public ResponseEntity<Page<AnnouncementResponse>> getAnnouncementsByInstitute(
            @AuthenticationPrincipal CustomUserDetails user,
            @RequestHeader(value = "clientId", required = false) String clientId,
            @PathVariable String instituteId,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size,
            @RequestParam(required = false) String status) {

        accessGuard.requireStaff(user, clientId, instituteId);
        try {
            Pageable pageable = PageRequest.of(page, size);
            Page<AnnouncementResponse> response;

            if (status != null) {
                AnnouncementStatus announcementStatus = AnnouncementStatus.valueOf(status.toUpperCase());
                response = announcementService.getAnnouncementsByInstituteAndStatus(instituteId, announcementStatus, pageable);
            } else {
                response = announcementService.getAnnouncementsByInstitute(instituteId, pageable);
            }

            return ResponseEntity.ok(response);
        } catch (Exception e) {
            log.error("Error getting announcements for institute: {}", instituteId, e);
            return ResponseEntity.badRequest().build();
        }
    }

    /**
     * Planned announcements for calendar view (admin/teacher dashboards)
     * Optional date filter using from/to (ISO LocalDateTime)
     */
    @GetMapping("/institute/{instituteId}/planned")
    public ResponseEntity<Page<AnnouncementCalendarItem>> getPlannedAnnouncements(
            @AuthenticationPrincipal CustomUserDetails user,
            @RequestHeader(value = "clientId", required = false) String clientId,
            @PathVariable String instituteId,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size,
            @RequestParam(required = false) String from,
            @RequestParam(required = false) String to) {
        accessGuard.requireStaff(user, clientId, instituteId);
        try {
            Pageable pageable = PageRequest.of(page, size);
            java.time.LocalDateTime fromDate = parseFlexibleDateTime(from);
            java.time.LocalDateTime toDate = parseFlexibleDateTime(to);
            return ResponseEntity.ok(announcementService.getPlannedAnnouncements(instituteId, fromDate, toDate, pageable));
        } catch (Exception e) {
            log.error("Error getting planned announcements for institute: {}", instituteId, e);
            return ResponseEntity.badRequest().build();
        }
    }

    /**
     * Past announcements for calendar view (admin/teacher dashboards)
     * Optional date filter using from/to (ISO LocalDateTime)
     */
    @GetMapping("/institute/{instituteId}/past")
    public ResponseEntity<Page<AnnouncementCalendarItem>> getPastAnnouncements(
            @AuthenticationPrincipal CustomUserDetails user,
            @RequestHeader(value = "clientId", required = false) String clientId,
            @PathVariable String instituteId,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size,
            @RequestParam(required = false) String from,
            @RequestParam(required = false) String to) {
        accessGuard.requireStaff(user, clientId, instituteId);
        try {
            Pageable pageable = PageRequest.of(page, size);
            java.time.LocalDateTime fromDate = parseFlexibleDateTime(from);
            java.time.LocalDateTime toDate = parseFlexibleDateTime(to);
            return ResponseEntity.ok(announcementService.getPastAnnouncements(instituteId, fromDate, toDate, pageable));
        } catch (Exception e) {
            log.error("Error getting past announcements for institute: {}", instituteId, e);
            return ResponseEntity.badRequest().build();
        }
    }

    // Accepts ISO-8601 local (yyyy-MM-dd'T'HH:mm:ss) or offset/Z timestamps (e.g., 2025-08-08T18:30:00Z)
    private java.time.LocalDateTime parseFlexibleDateTime(String value) {
        if (value == null || value.isBlank()) return null;
        try {
            return java.time.LocalDateTime.parse(value);
        } catch (java.time.format.DateTimeParseException e1) {
            try {
                return java.time.OffsetDateTime.parse(value).toLocalDateTime();
            } catch (java.time.format.DateTimeParseException e2) {
                try {
                    return java.time.Instant.parse(value).atZone(java.time.ZoneOffset.UTC).toLocalDateTime();
                } catch (java.time.format.DateTimeParseException e3) {
                    // Re-throw original to keep error context
                    throw e1;
                }
            }
        }
    }

    /**
     * Update an existing announcement before it has been delivered.
     * Blocked for ACTIVE/INACTIVE/EXPIRED/REJECTED, or SCHEDULED whose nextRunTime has passed.
     */
    @PutMapping("/{announcementId}")
    public ResponseEntity<AnnouncementResponse> updateAnnouncement(
            @AuthenticationPrincipal CustomUserDetails user,
            @RequestHeader(value = "clientId", required = false) String clientId,
            @PathVariable @NotBlank(message = "Announcement ID is required") String announcementId,
            @Valid @RequestBody CreateAnnouncementRequest request) {
        accessGuard.requireStaffForAnnouncement(user, clientId, announcementId);
        try {
            AnnouncementResponse response = announcementService.updateAnnouncement(announcementId, request);
            return ResponseEntity.ok(response);
        } catch (Exception e) {
            log.error("Error updating announcement: {}", announcementId, e);
            return ResponseEntity.badRequest().build();
        }
    }

    /**
     * Update announcement status
     */
    @PutMapping("/{announcementId}/status")
    public ResponseEntity<AnnouncementResponse> updateAnnouncementStatus(
            @AuthenticationPrincipal CustomUserDetails user,
            @RequestHeader(value = "clientId", required = false) String clientId,
            @PathVariable String announcementId,
            @RequestBody Map<String, String> statusUpdate) {
        accessGuard.requireStaffForAnnouncement(user, clientId, announcementId);
        try {
            String statusValue = statusUpdate.get("status");
            AnnouncementStatus status = AnnouncementStatus.valueOf(statusValue.toUpperCase());

            AnnouncementResponse response = announcementService.updateAnnouncementStatus(announcementId, status);
            return ResponseEntity.ok(response);
        } catch (Exception e) {
            log.error("Error updating announcement status: {}", announcementId, e);
            return ResponseEntity.badRequest().build();
        }
    }

    /**
     * Delete announcement
     */
    @DeleteMapping("/{announcementId}")
    public ResponseEntity<Void> deleteAnnouncement(
            @AuthenticationPrincipal CustomUserDetails user,
            @RequestHeader(value = "clientId", required = false) String clientId,
            @PathVariable String announcementId) {
        accessGuard.requireStaffForAnnouncement(user, clientId, announcementId);
        try {
            announcementService.deleteAnnouncement(announcementId);
            return ResponseEntity.noContent().build();
        } catch (Exception e) {
            log.error("Error deleting announcement: {}", announcementId, e);
            return ResponseEntity.badRequest().build();
        }
    }

    /**
     * Submit announcement for approval
     */
    @PostMapping("/{announcementId}/submit-approval")
    public ResponseEntity<AnnouncementResponse> submitForApproval(
            @AuthenticationPrincipal CustomUserDetails user,
            @RequestHeader(value = "clientId", required = false) String clientId,
            @PathVariable String announcementId,
            @RequestParam String submittedByRole) {
        accessGuard.requireStaffForAnnouncement(user, clientId, announcementId);
        try {
            AnnouncementResponse response = announcementService.submitForApproval(announcementId, submittedByRole);
            return ResponseEntity.ok(response);
        } catch (Exception e) {
            log.error("Error submitting announcement for approval: {}", announcementId, e);
            return ResponseEntity.badRequest().build();
        }
    }

    /**
     * Approve announcement (ADMIN)
     */
    @PostMapping("/{announcementId}/approve")
    public ResponseEntity<AnnouncementResponse> approveAnnouncement(
            @AuthenticationPrincipal CustomUserDetails user,
            @RequestHeader(value = "clientId", required = false) String clientId,
            @PathVariable String announcementId,
            // Ignored: the role comes from the caller's token. Kept so existing clients still bind.
            @RequestParam(required = false) String approvedByRole) {
        accessGuard.requireAdminForAnnouncement(user, clientId, announcementId);
        try {
            AnnouncementResponse response = announcementService.approveAnnouncement(announcementId, "ADMIN");
            return ResponseEntity.ok(response);
        } catch (Exception e) {
            log.error("Error approving announcement: {}", announcementId, e);
            return ResponseEntity.badRequest().build();
        }
    }

    /**
     * Get email configurations for dropdown
     */
    @GetMapping("/email-configurations/{instituteId}")
    public ResponseEntity<List<EmailConfigDTO>> getEmailConfigurations(
            @AuthenticationPrincipal CustomUserDetails user,
            @RequestHeader(value = "clientId", required = false) String clientId,
            @PathVariable String instituteId) {
        accessGuard.requireStaff(user, clientId, instituteId);
        try {
            List<EmailConfigDTO> configurations = emailConfigurationService.getEmailConfigurations(instituteId);
            return ResponseEntity.ok(configurations);
        } catch (Exception e) {
            log.error("Error getting email configurations for institute: {}", instituteId, e);
            return ResponseEntity.badRequest().build();
        }
    }

    // COMMENTED OUT - Unused endpoint (service method doesn't exist)
    // /**
    //  * Debug endpoint to check institute settings structure
    //  */
    // @GetMapping("/debug/institute-settings/{instituteId}")
    // public ResponseEntity<?> debugInstituteSettings(@PathVariable String instituteId) {
    //     try {
    //         var institute = emailConfigurationService.getInstituteSettings(instituteId);
    //         if (institute == null) {
    //             return ResponseEntity.ok(Map.of(
    //                 "instituteId", instituteId,
    //                 "error", "Institute not found",
    //                 "message", "The institute with this ID does not exist in the database"
    //             ));
    //         }
    //
    //         return ResponseEntity.ok(Map.of(
    //             "instituteId", instituteId,
    //             "instituteName", institute.getInstituteName(),
    //             "hasSettings", institute.getSetting() != null && !institute.getSetting().trim().isEmpty(),
    //             "settings", institute.getSetting() != null ? institute.getSetting() : "null",
    //             "settingsLength", institute.getSetting() != null ? institute.getSetting().length() : 0
    //         ));
    //     } catch (Exception e) {
    //         log.error("Error getting institute settings for debug: {}", instituteId, e);
    //         return ResponseEntity.badRequest().body(Map.of(
    //             "instituteId", instituteId,
    //             "error", e.getMessage(),
    //             "message", "Failed to fetch institute from admin-core-service"
    //         ));
    //     }
    // }

    // COMMENTED OUT - Unused endpoint (service method doesn't exist)
    // /**
    //  * Generate settings JSON for manual database update
    //  */
    // @PostMapping("/email-configurations/{instituteId}/generate-json")
    // public ResponseEntity<?> generateSettingsJson(
    //         @PathVariable String instituteId,
    //         @RequestBody EmailConfigDTO emailConfig) {
    //     try {
    //         String generatedJson = emailConfigurationService.generateSettingsJson(instituteId, emailConfig);
    //         return ResponseEntity.ok(Map.of(
    //             "instituteId", instituteId,
    //             "generatedSettingsJson", generatedJson,
    //             "message", "Copy this JSON and update the institute settings in the database"
    //         ));
    //     } catch (Exception e) {
    //         log.error("Error generating settings JSON for institute: {}", instituteId, e);
    //         return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
    //     }
    // }

    // COMMENTED OUT - Unused endpoint (service method doesn't exist)
    // /**
    //  * Get email configuration by type
    //  */
    // @GetMapping("/email-configurations/{instituteId}/{emailType}")
    // public ResponseEntity<EmailConfigDTO> getEmailConfigurationByType(
    //         @PathVariable String instituteId,
    //         @PathVariable String emailType) {
    //     try {
    //         EmailConfigDTO configuration = emailConfigurationService.getEmailConfigurationByType(instituteId, emailType);
    //         if (configuration != null) {
    //             return ResponseEntity.ok(configuration);
    //         } else {
    //             return ResponseEntity.notFound().build();
    //         }
    //     } catch (Exception e) {
    //         log.error("Error getting email configuration for institute: {} type: {}", instituteId, emailType, e);
    //         return ResponseEntity.badRequest().build();
    //     }
    // }

    /**
     * Add new email configuration
     */
    @PostMapping("/email-configurations/{instituteId}")
    public ResponseEntity<?> addEmailConfiguration(
            @AuthenticationPrincipal CustomUserDetails user,
            @RequestHeader(value = "clientId", required = false) String clientId,
            @PathVariable String instituteId,
            @RequestBody EmailConfigDTO emailConfig,
            @RequestHeader(value = "Authorization", required = false) String authToken) {
        // Staff, not ADMIN-only: non-admin roles can be given the Settings page (ui.showSettings).
        accessGuard.requireStaff(user, clientId, instituteId);
        try {
            log.info("Received request to add email configuration for institute: {}, config: {}", instituteId, emailConfig);
            log.info("Auth token provided: {}", authToken != null ? "Yes" : "No");

            // Validate required fields
            if (emailConfig.getEmail() == null || emailConfig.getEmail().trim().isEmpty()) {
                return ResponseEntity.badRequest().body(Map.of("error", "Email is required"));
            }
            if (emailConfig.getType() == null || emailConfig.getType().trim().isEmpty()) {
                return ResponseEntity.badRequest().body(Map.of("error", "Type is required"));
            }
            if (emailConfig.getName() == null || emailConfig.getName().trim().isEmpty()) {
                return ResponseEntity.badRequest().body(Map.of("error", "Name is required"));
            }

            // Extract Bearer token if present
            String token = null;
            if (authToken != null && authToken.startsWith("Bearer ")) {
                token = authToken.substring(7);
            }

            EmailConfigDTO addedConfig = emailConfigurationService.addEmailConfiguration(instituteId, emailConfig, token);
            return ResponseEntity.ok(addedConfig);
        } catch (Exception e) {
            log.error("Error adding email configuration for institute: {}", instituteId, e);
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    /**
     * Update an existing email configuration. The path param `{emailType}` is the
     * primary key — it is immutable. Only email/name (and any optional fields the
     * service knows how to persist) can change.
     */
    @PutMapping("/email-configurations/{instituteId}/{emailType}")
    public ResponseEntity<?> updateEmailConfiguration(
            @AuthenticationPrincipal CustomUserDetails user,
            @RequestHeader(value = "clientId", required = false) String clientId,
            @PathVariable String instituteId,
            @PathVariable String emailType,
            @RequestBody EmailConfigDTO emailConfig,
            @RequestHeader(value = "Authorization", required = false) String authToken) {
        // Staff, not ADMIN-only: non-admin roles can be given the Settings page (ui.showSettings).
        accessGuard.requireStaff(user, clientId, instituteId);
        try {
            String token = null;
            if (authToken != null && authToken.startsWith("Bearer ")) {
                token = authToken.substring(7);
            }

            EmailConfigDTO updatedConfig = emailConfigurationService.updateEmailConfiguration(
                    instituteId, emailType, emailConfig, token);
            if (updatedConfig != null) {
                return ResponseEntity.ok(updatedConfig);
            }
            return ResponseEntity.notFound().build();
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        } catch (Exception e) {
            log.error("Error updating email configuration for institute: {} type: {}",
                    instituteId, emailType, e);
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    /**
     * Delete an email configuration by type.
     */
    @DeleteMapping("/email-configurations/{instituteId}/{emailType}")
    public ResponseEntity<?> deleteEmailConfiguration(
            @AuthenticationPrincipal CustomUserDetails user,
            @RequestHeader(value = "clientId", required = false) String clientId,
            @PathVariable String instituteId,
            @PathVariable String emailType,
            @RequestHeader(value = "Authorization", required = false) String authToken) {
        // Staff, not ADMIN-only: non-admin roles can be given the Settings page (ui.showSettings).
        accessGuard.requireStaff(user, clientId, instituteId);
        try {
            String token = null;
            if (authToken != null && authToken.startsWith("Bearer ")) {
                token = authToken.substring(7);
            }

            boolean deleted = emailConfigurationService.deleteEmailConfiguration(
                    instituteId, emailType, token);
            if (deleted) {
                return ResponseEntity.noContent().build();
            }
            return ResponseEntity.notFound().build();
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        } catch (Exception e) {
            log.error("Error deleting email configuration for institute: {} type: {}",
                    instituteId, emailType, e);
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    /**
     * Reject announcement (ADMIN)
     */
    @PostMapping("/{announcementId}/reject")
    public ResponseEntity<AnnouncementResponse> rejectAnnouncement(
            @AuthenticationPrincipal CustomUserDetails user,
            @RequestHeader(value = "clientId", required = false) String clientId,
            @PathVariable String announcementId,
            // Ignored: the role comes from the caller's token. Kept so existing clients still bind.
            @RequestParam(required = false) String rejectedByRole,
            @RequestParam(required = false) String reason) {
        accessGuard.requireAdminForAnnouncement(user, clientId, announcementId);
        try {
            AnnouncementResponse response = announcementService.rejectAnnouncement(announcementId, "ADMIN", reason);
            return ResponseEntity.ok(response);
        } catch (Exception e) {
            log.error("Error rejecting announcement: {}", announcementId, e);
            return ResponseEntity.badRequest().build();
        }
    }

    /**
     * Manually trigger announcement delivery (for testing/admin use)
     */
    @PostMapping("/{announcementId}/deliver")
    public ResponseEntity<Map<String, String>> deliverAnnouncement(
            @AuthenticationPrincipal CustomUserDetails user,
            @RequestHeader(value = "clientId", required = false) String clientId,
            @PathVariable String announcementId) {
        accessGuard.requireStaffForAnnouncement(user, clientId, announcementId);
        try {
            // Guard: delivery will internally be a no-op if pending approval or rejected
            announcementService.processAnnouncementDelivery(announcementId);
            return ResponseEntity.ok(Map.of("message", "Announcement delivery initiated", "announcementId", announcementId));
        } catch (Exception e) {
            log.error("Error delivering announcement: {}", announcementId, e);
            return ResponseEntity.badRequest()
                    .body(Map.of("error", "Failed to deliver announcement", "message", e.getMessage()));
        }
    }

    /**
     * Get announcement delivery statistics
     */
    @GetMapping("/{announcementId}/stats")
    public ResponseEntity<AnnouncementResponse.AnnouncementStatsResponse> getAnnouncementStats(
            @AuthenticationPrincipal CustomUserDetails user,
            @RequestHeader(value = "clientId", required = false) String clientId,
            @PathVariable String announcementId) {
        accessGuard.requireStaffForAnnouncement(user, clientId, announcementId);
        try {
            return ResponseEntity.ok(announcementService.getAnnouncementStats(announcementId));
        } catch (Exception e) {
            log.error("Error getting announcement stats: {}", announcementId, e);
            return ResponseEntity.badRequest().build();
        }
    }

    /**
     * List per-recipient delivery + read/dismiss state for an announcement
     * (admin analytics: which students have seen/dismissed it)
     */
    @GetMapping("/{announcementId}/recipients")
    public ResponseEntity<Page<AnnouncementRecipientInteractionResponse>> getRecipientInteractions(
            @AuthenticationPrincipal CustomUserDetails user,
            @RequestHeader(value = "clientId", required = false) String clientId,
            @PathVariable String announcementId,
            @RequestParam(required = false) String modeType,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {
        accessGuard.requireStaffForAnnouncement(user, clientId, announcementId);
        try {
            ModeType mode = modeType != null ? ModeType.valueOf(modeType.toUpperCase()) : null;
            Pageable pageable = PageRequest.of(page, size);
            return ResponseEntity.ok(announcementService.getRecipientInteractions(announcementId, mode, pageable));
        } catch (Exception e) {
            log.error("Error getting recipient interactions for announcement: {}", announcementId, e);
            return ResponseEntity.badRequest().build();
        }
    }

    /**
     * Debug endpoint to check email tracking data for an announcement
     */
    @GetMapping("/{announcementId}/debug-email-tracking")
    public ResponseEntity<?> debugEmailTracking(
            @AuthenticationPrincipal CustomUserDetails user,
            @RequestHeader(value = "clientId", required = false) String clientId,
            @PathVariable String announcementId) {
        accessGuard.requireStaffForAnnouncement(user, clientId, announcementId);
        try {
            return ResponseEntity.ok(announcementService.debugEmailTracking(announcementId));
        } catch (Exception e) {
            log.error("Error debugging email tracking: {}", announcementId, e);
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    /**
     * Test endpoint to check institute settings parsing
     */
    @GetMapping("/email-configurations/{instituteId}/test-settings")
    public ResponseEntity<?> testSettingsParsing(
            @AuthenticationPrincipal CustomUserDetails user,
            @RequestHeader(value = "clientId", required = false) String clientId,
            @PathVariable String instituteId) {
        accessGuard.requireStaff(user, clientId, instituteId);
        try {
            // Use the existing getEmailConfigurations method to test parsing
            List<EmailConfigDTO> configs = emailConfigurationService.getEmailConfigurations(instituteId);

            return ResponseEntity.ok(Map.of(
                "instituteId", instituteId,
                "emailConfigurationsCount", configs.size(),
                "emailConfigurations", configs,
                "message", "Settings parsing successful"
            ));
        } catch (Exception e) {
            log.error("Error testing settings parsing for institute: {}", instituteId, e);
            return ResponseEntity.badRequest().body(Map.of("error", "Failed to parse settings: " + e.getMessage()));
        }
    }

    /**
     * Recovery endpoint to restore default email configurations
     */
    @PostMapping("/email-configurations/{instituteId}/restore-defaults")
    public ResponseEntity<?> restoreDefaultEmailConfigurations(
            @AuthenticationPrincipal CustomUserDetails user,
            @RequestHeader(value = "clientId", required = false) String clientId,
            @PathVariable String instituteId,
            @RequestHeader(value = "Authorization", required = false) String authToken) {
        accessGuard.requireAdmin(user, clientId, instituteId);
        try {
            log.info("Restoring default email configurations for institute: {}", instituteId);

            // Extract Bearer token
            String token = null;
            if (authToken != null && authToken.startsWith("Bearer ")) {
                token = authToken.substring(7);
            }

            // Add common email configurations
            List<EmailConfigDTO> defaultConfigs = List.of(
                EmailConfigDTO.builder()
                    .email("marketing@vidyayatan.com")
                    .name("Marketing Team")
                    .type("MARKETING_EMAIL")
                    .description("Marketing and promotional emails")
                    .build(),
                EmailConfigDTO.builder()
                    .email("notifications@vidyayatan.com")
                    .name("System Notifications")
                    .type("UTILITY_EMAIL")
                    .description("System and utility notifications")
                    .build(),
                EmailConfigDTO.builder()
                    .email("info@vidyayatan.com")
                    .name("General Information")
                    .type("INFO_EMAIL")
                    .description("General information emails")
                    .build()
            );

            List<EmailConfigDTO> addedConfigs = new ArrayList<>();
            for (EmailConfigDTO config : defaultConfigs) {
                try {
                    EmailConfigDTO added = emailConfigurationService.addEmailConfiguration(instituteId, config, token);
                    addedConfigs.add(added);
                } catch (Exception e) {
                    log.warn("Failed to add default config {}: {}", config.getType(), e.getMessage());
                }
            }

            return ResponseEntity.ok(Map.of(
                "message", "Default email configurations restored",
                "addedConfigurations", addedConfigs,
                "totalAdded", addedConfigs.size()
            ));

        } catch (Exception e) {
            log.error("Error restoring default email configurations for institute: {}", instituteId, e);
            return ResponseEntity.badRequest().body(Map.of("error", "Failed to restore defaults: " + e.getMessage()));
        }
    }

    @PostMapping("/multiple")
    public ResponseEntity<String> createAnnouncements(@Valid @RequestBody List<CreateAnnouncementRequest> requests) {

        for(CreateAnnouncementRequest request:requests){
            try {
                AnnouncementResponse response = announcementService.createAnnouncement(request);
            } catch (Exception e) {
                log.error("Error creating announcement", e);
            }
        }
        return ResponseEntity.ok("");
    }
}
