package vacademy.io.notification_service.features.announcements.controller;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.notification_service.features.announcements.dto.InstituteAnnouncementSettingsRequest;
import vacademy.io.notification_service.features.announcements.dto.InstituteAnnouncementSettingsResponse;
import vacademy.io.notification_service.features.announcements.service.InstituteAnnouncementSettingsService;
import vacademy.io.notification_service.features.chat.security.ChatIdentity;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/notification-service/v1/institute-settings")
@RequiredArgsConstructor
@Slf4j
@Validated
@Tag(name = "Institute Announcement Settings", description = "APIs for managing institute-specific announcement settings")
@CrossOrigin(origins = "*")
public class InstituteAnnouncementSettingsController {

    private final InstituteAnnouncementSettingsService settingsService;

    @Operation(summary = "Create or update institute announcement settings", 
               description = "Create new or update existing announcement settings for an institute")
    @ApiResponses(value = {
        @ApiResponse(responseCode = "200", description = "Settings updated successfully"),
        @ApiResponse(responseCode = "201", description = "Settings created successfully"),
        @ApiResponse(responseCode = "400", description = "Invalid request data"),
        @ApiResponse(responseCode = "500", description = "Internal server error")
    })
    @PostMapping
    public ResponseEntity<InstituteAnnouncementSettingsResponse> createOrUpdateSettings(
            @Valid @RequestBody InstituteAnnouncementSettingsRequest request,
            @AuthenticationPrincipal CustomUserDetails user,
            @RequestHeader(value = "clientId", required = false) String clientId) {
        requireInstituteAdmin(user, clientId, request.getInstituteId());
        
        log.info("Received request to create/update announcement settings for institute: {}", 
                request.getInstituteId());
        
        InstituteAnnouncementSettingsResponse response = settingsService.createOrUpdateSettings(request);
        
        log.info("Successfully created/updated announcement settings for institute: {}", 
                request.getInstituteId());
        
        return ResponseEntity.ok(response);
    }

    @Operation(summary = "Get institute announcement settings", 
               description = "Retrieve announcement settings for a specific institute")
    @ApiResponses(value = {
        @ApiResponse(responseCode = "200", description = "Settings retrieved successfully"),
        @ApiResponse(responseCode = "404", description = "Settings not found - returns default settings"),
        @ApiResponse(responseCode = "400", description = "Invalid institute ID"),
        @ApiResponse(responseCode = "500", description = "Internal server error")
    })
    @GetMapping("/institute/{instituteId}")
    public ResponseEntity<InstituteAnnouncementSettingsResponse> getSettingsByInstituteId(
            @Parameter(description = "Institute ID", required = true)
            @PathVariable @NotBlank(message = "Institute ID cannot be blank") String instituteId) {
        
        log.info("Received request to get announcement settings for institute: {}", instituteId);
        
        InstituteAnnouncementSettingsResponse response = settingsService.getSettingsByInstituteId(instituteId);
        
        log.info("Successfully retrieved announcement settings for institute: {}", instituteId);
        
        return ResponseEntity.ok(response);
    }

    @Operation(summary = "Get all institute settings", 
               description = "Retrieve announcement settings for all institutes (admin function)")
    @ApiResponses(value = {
        @ApiResponse(responseCode = "200", description = "All settings retrieved successfully"),
        @ApiResponse(responseCode = "500", description = "Internal server error")
    })
    @GetMapping("/all")
    public ResponseEntity<List<InstituteAnnouncementSettingsResponse>> getAllSettings() {
        // Cross-institute listing is closed: there is no platform-staff role to gate it on
        // (users.is_root_user is set for ~97% of accounts by ordinary sign-up/invite flows) and nothing calls it.
        throw new ResponseStatusException(HttpStatus.FORBIDDEN, "NOT_AVAILABLE");
    }

    @Operation(summary = "Delete institute announcement settings", 
               description = "Delete announcement settings for a specific institute")
    @ApiResponses(value = {
        @ApiResponse(responseCode = "204", description = "Settings deleted successfully"),
        @ApiResponse(responseCode = "404", description = "Settings not found"),
        @ApiResponse(responseCode = "400", description = "Invalid institute ID"),
        @ApiResponse(responseCode = "500", description = "Internal server error")
    })
    @DeleteMapping("/institute/{instituteId}")
    public ResponseEntity<Void> deleteSettings(
            @Parameter(description = "Institute ID", required = true)
            @PathVariable @NotBlank(message = "Institute ID cannot be blank") String instituteId,
            @AuthenticationPrincipal CustomUserDetails user,
            @RequestHeader(value = "clientId", required = false) String clientId) {
        requireInstituteAdmin(user, clientId, instituteId);
        
        log.info("Received request to delete announcement settings for institute: {}", instituteId);
        
        settingsService.deleteSettings(instituteId);
        
        log.info("Successfully deleted announcement settings for institute: {}", instituteId);
        
        return ResponseEntity.noContent().build();
    }

    @Operation(summary = "Check user permissions", 
               description = "Check if a user role can perform a specific action for a mode type in an institute")
    @ApiResponses(value = {
        @ApiResponse(responseCode = "200", description = "Permission check completed"),
        @ApiResponse(responseCode = "400", description = "Invalid request parameters"),
        @ApiResponse(responseCode = "500", description = "Internal server error")
    })
    @GetMapping("/institute/{instituteId}/permissions")
    public ResponseEntity<Map<String, Boolean>> checkUserPermissions(
            @Parameter(description = "Institute ID", required = true)
            @PathVariable @NotBlank(message = "Institute ID cannot be blank") String instituteId,
            
            @Parameter(description = "User role (e.g., STUDENT, TEACHER, ADMIN)", required = true)
            @RequestParam @NotBlank(message = "User role cannot be blank") String userRole,
            
            @Parameter(description = "Action to check (e.g., send, create)", required = true)
            @RequestParam @NotBlank(message = "Action cannot be blank") String action,
            
            @Parameter(description = "Mode type (e.g., COMMUNITY, DASHBOARD_PIN, SYSTEM_ALERT)", required = true)
            @RequestParam @NotBlank(message = "Mode type cannot be blank") String modeType) {
        
        log.info("Checking permissions for institute: {}, role: {}, action: {}, mode: {}", 
                instituteId, userRole, action, modeType);
        
        boolean canPerform = settingsService.canUserPerformAction(instituteId, userRole, action, modeType);
        
        Map<String, Boolean> response = Map.of(
            "canPerform", canPerform,
            "instituteId", true,
            "userRole", true,
            "action", true,
            "modeType", true
        );
        
        log.info("Permission check result for institute: {}, role: {}, action: {}, mode: {} -> {}", 
                instituteId, userRole, action, modeType, canPerform);
        
        return ResponseEntity.ok(response);
    }

    @Operation(summary = "Get default settings template", 
               description = "Get the default settings template for creating institute settings")
    @ApiResponses(value = {
        @ApiResponse(responseCode = "200", description = "Default template retrieved successfully")
    })
    @GetMapping("/default-template")
    public ResponseEntity<InstituteAnnouncementSettingsResponse> getDefaultTemplate() {
        
        log.info("Received request for default settings template");
        
        // Create a response with default settings but no institute ID
        InstituteAnnouncementSettingsResponse response = settingsService.getSettingsByInstituteId("default-template");
        response.setInstituteId(null); // Remove the placeholder institute ID
        response.setId(null);
        response.setCreatedAt(null);
        response.setUpdatedAt(null);
        
        log.info("Successfully returned default settings template");
        
        return ResponseEntity.ok(response);
    }

    @Operation(summary = "Validate settings", 
               description = "Validate announcement settings without saving them")
    @ApiResponses(value = {
        @ApiResponse(responseCode = "200", description = "Settings are valid"),
        @ApiResponse(responseCode = "400", description = "Settings validation failed"),
        @ApiResponse(responseCode = "500", description = "Internal server error")
    })
    @PostMapping("/validate")
    public ResponseEntity<Map<String, Object>> validateSettings(
            @Valid @RequestBody InstituteAnnouncementSettingsRequest request) {
        
        log.info("Received request to validate announcement settings for institute: {}", 
                request.getInstituteId());
        
        // If we reach here, the @Valid annotation has passed
        Map<String, Object> response = Map.of(
            "valid", true,
            "message", "Settings validation passed",
            "instituteId", request.getInstituteId()
        );
        
        log.info("Settings validation passed for institute: {}", request.getInstituteId());
        
        return ResponseEntity.ok(response);
    }

    /**
     * Settings writes are admin-only and tenant-scoped: the caller must hold ADMIN in the institute named
     * by the verified clientId header, and may only change that institute's settings.
     */
    private static void requireInstituteAdmin(CustomUserDetails user, String clientId, String targetInstituteId) {
        ChatIdentity id = ChatIdentity.from(user, clientId);
        if (!id.isAdmin()) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "ADMIN_REQUIRED");
        }
        if (targetInstituteId == null || !targetInstituteId.equals(id.instituteId())) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "INSTITUTE_MISMATCH");
        }
    }
}
