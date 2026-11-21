package vacademy.io.notification_service.features.announcements.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.notification_service.features.announcements.dto.InstituteAnnouncementSettingsRequest;
import vacademy.io.notification_service.features.announcements.dto.InstituteAnnouncementSettingsResponse;
import vacademy.io.notification_service.features.announcements.entity.InstituteAnnouncementSettings;
import vacademy.io.notification_service.features.announcements.exception.AnnouncementException;
import vacademy.io.notification_service.features.announcements.exception.AnnouncementNotFoundException;
import vacademy.io.notification_service.features.announcements.exception.ValidationException;
import vacademy.io.notification_service.features.announcements.repository.InstituteAnnouncementSettingsRepository;

import java.time.LocalDateTime;

import java.util.List;
import java.util.Map;
import java.util.Optional;

@Service
@RequiredArgsConstructor
@Slf4j
public class InstituteAnnouncementSettingsService {

    private final InstituteAnnouncementSettingsRepository settingsRepository;
    private final ObjectMapper objectMapper;

    /**
     * Create or update institute announcement settings
     */
    @Transactional
    public InstituteAnnouncementSettingsResponse createOrUpdateSettings(InstituteAnnouncementSettingsRequest request) {
        if (request == null || request.getInstituteId() == null || request.getInstituteId().trim().isEmpty()) {
            throw new ValidationException("Institute ID cannot be null or empty");
        }

        try {
            log.info("Creating/updating announcement settings for institute: {}", request.getInstituteId());

            // Check if settings already exist
            Optional<InstituteAnnouncementSettings> existingSettings = 
                settingsRepository.findByInstituteId(request.getInstituteId());

            InstituteAnnouncementSettings settings;
            if (existingSettings.isPresent()) {
                settings = existingSettings.get();
                log.debug("Updating existing settings for institute: {}", request.getInstituteId());
            } else {
                settings = new InstituteAnnouncementSettings();
                settings.setInstituteId(request.getInstituteId());
                settings.setCreatedAt(LocalDateTime.now());
                log.debug("Creating new settings for institute: {}", request.getInstituteId());
            }

            // Convert request settings to Map for JSON storage
            Map<String, Object> settingsMap = convertRequestToMap(request.getSettings());
            if (existingSettings.isPresent()) {
                keepStoredFirebaseKey(settingsMap, existingSettings.get().getSettings());
            }
            settings.setSettings(settingsMap);
            settings.setUpdatedAt(LocalDateTime.now());

            // Save to database
            InstituteAnnouncementSettings savedSettings = settingsRepository.save(settings);
            log.info("Successfully saved announcement settings for institute: {}", request.getInstituteId());

            return mapToResponse(savedSettings);

        } catch (ValidationException e) {
            throw e;
        } catch (Exception e) {
            log.error("Error creating/updating announcement settings for institute: {}", request.getInstituteId(), e);
            throw new AnnouncementException("Failed to create/update announcement settings", "SETTINGS_UPDATE_ERROR", e);
        }
    }

    /**
     * Get institute announcement settings by institute ID
     */
    @Transactional(readOnly = true)
    public InstituteAnnouncementSettingsResponse getSettingsByInstituteId(String instituteId) {
        if (instituteId == null || instituteId.trim().isEmpty()) {
            throw new ValidationException("Institute ID cannot be null or empty");
        }

        try {
            log.debug("Retrieving announcement settings for institute: {}", instituteId);

            Optional<InstituteAnnouncementSettings> settings = settingsRepository.findByInstituteId(instituteId);
            
            if (settings.isEmpty()) {
                log.debug("No settings found for institute: {}, returning default settings", instituteId);
                return createDefaultSettingsResponse(instituteId);
            }

            return mapToResponse(settings.get());

        } catch (ValidationException e) {
            throw e;
        } catch (Exception e) {
            log.error("Error retrieving announcement settings for institute: {}", instituteId, e);
            throw new AnnouncementException("Failed to retrieve announcement settings", "SETTINGS_RETRIEVAL_ERROR", e);
        }
    }

    /**
     * Get all institute settings (admin function)
     */
    @Transactional(readOnly = true)
    public List<InstituteAnnouncementSettingsResponse> getAllSettings() {
        try {
            log.debug("Retrieving all institute announcement settings");
            
            List<InstituteAnnouncementSettings> allSettings = settingsRepository.findAll();
            return allSettings.stream()
                    .map(this::mapToResponse)
                    .toList();

        } catch (Exception e) {
            log.error("Error retrieving all announcement settings", e);
            throw new AnnouncementException("Failed to retrieve all announcement settings", "SETTINGS_RETRIEVAL_ERROR", e);
        }
    }

    /**
     * Delete institute announcement settings
     */
    @Transactional
    public void deleteSettings(String instituteId) {
        if (instituteId == null || instituteId.trim().isEmpty()) {
            throw new ValidationException("Institute ID cannot be null or empty");
        }

        try {
            log.info("Deleting announcement settings for institute: {}", instituteId);

            Optional<InstituteAnnouncementSettings> settings = settingsRepository.findByInstituteId(instituteId);
            
            if (settings.isEmpty()) {
                throw new AnnouncementNotFoundException("Announcement settings not found for institute: " + instituteId);
            }

            settingsRepository.delete(settings.get());
            log.info("Successfully deleted announcement settings for institute: {}", instituteId);

        } catch (AnnouncementNotFoundException e) {
            throw e;
        } catch (ValidationException e) {
            throw e;
        } catch (Exception e) {
            log.error("Error deleting announcement settings for institute: {}", instituteId, e);
            throw new AnnouncementException("Failed to delete announcement settings", "SETTINGS_DELETE_ERROR", e);
        }
    }

    /**
     * Check if a user role can perform a specific action based on institute settings
     */
    public boolean canUserPerformAction(String instituteId, String userRole, String action, String modeType) {
        try {
            log.debug("Checking permission for user role {} to perform {} action for mode {} in institute {}", 
                    userRole, action, modeType, instituteId);

            InstituteAnnouncementSettingsResponse settings = getSettingsByInstituteId(instituteId);
            return checkPermission(settings, userRole, action, modeType);

        } catch (Exception e) {
            log.warn("Error checking user permission, defaulting to false. Institute: {}, Role: {}, Action: {}", 
                    instituteId, userRole, action, e);
            return false;
        }
    }

    /**
     * Determine if email tracking is enabled for an institute. Defaults to true when not configured.
     */
    public boolean isEmailTrackingEnabled(String instituteId) {
        if (instituteId == null || instituteId.trim().isEmpty()) {
            return true;
        }

        try {
            Optional<InstituteAnnouncementSettings> settingsOpt = settingsRepository.findByInstituteId(instituteId);
            if (settingsOpt.isEmpty()) {
                return true; // fall back to default behaviour
            }

            Map<String, Object> settingsMap = settingsOpt.get().getSettings();
            Boolean rawFlag = extractEmailTrackingFlag(settingsMap);
            if (rawFlag != null) {
                return rawFlag;
            }

            // Fallback to DTO mapping in case of complex nested structures
            InstituteAnnouncementSettingsResponse response = mapToResponse(settingsOpt.get());
            if (response.getSettings() != null && response.getSettings().getGeneral() != null) {
                Boolean dtoFlag = response.getSettings().getGeneral().getEmailTrackingEnabled();
                if (dtoFlag != null) {
                    return dtoFlag;
                }
            }

        } catch (Exception e) {
            log.warn("Failed to resolve email tracking preference for institute {}. Defaulting to true. Error: {}",
                    instituteId, e.getMessage());
        }

        return true;
    }

    private Boolean extractEmailTrackingFlag(Map<String, Object> settingsMap) {
        if (settingsMap == null) {
            return null;
        }

        Object generalObj = settingsMap.get("general");
        if (!(generalObj instanceof Map<?, ?> generalMap)) {
            return null;
        }

        Object flag = generalMap.get("email_tracking_enabled");
        if (flag == null) {
            flag = generalMap.get("emailTrackingEnabled");
        }

        if (flag instanceof Boolean booleanFlag) {
            return booleanFlag;
        }

        if (flag instanceof String stringFlag) {
            return Boolean.parseBoolean(stringFlag);
        }

        return null;
    }

    /**
     * Get default settings for an institute
     */
    private InstituteAnnouncementSettingsResponse createDefaultSettingsResponse(String instituteId) {
        InstituteAnnouncementSettingsResponse response = new InstituteAnnouncementSettingsResponse();
        response.setInstituteId(instituteId);
        response.setCreatedAt(LocalDateTime.now());
        response.setUpdatedAt(LocalDateTime.now());
        
        // Create default settings
        InstituteAnnouncementSettingsResponse.AnnouncementSettings defaultSettings = 
            new InstituteAnnouncementSettingsResponse.AnnouncementSettings();
        
        // Community defaults
        InstituteAnnouncementSettingsResponse.CommunitySettings community = 
            new InstituteAnnouncementSettingsResponse.CommunitySettings();
        community.setStudentsCanSend(false);
        community.setTeachersCanSend(true);
        community.setAdminsCanSend(true);
        community.setAllowReplies(true);
        community.setModerationEnabled(false);
        defaultSettings.setCommunity(community);
        
        // Dashboard pin defaults
        InstituteAnnouncementSettingsResponse.DashboardPinSettings dashboardPins = 
            new InstituteAnnouncementSettingsResponse.DashboardPinSettings();
        dashboardPins.setStudentsCanCreate(false);
        dashboardPins.setTeachersCanCreate(true);
        dashboardPins.setAdminsCanCreate(true);
        dashboardPins.setMaxDurationHours(24);
        dashboardPins.setMaxPinsPerUser(5);
        dashboardPins.setRequireApproval(false);
        defaultSettings.setDashboardPins(dashboardPins);
        
        // System alert defaults
        InstituteAnnouncementSettingsResponse.SystemAlertSettings systemAlerts = 
            new InstituteAnnouncementSettingsResponse.SystemAlertSettings();
        systemAlerts.setStudentsCanSend(false);
        systemAlerts.setTeachersCanSend(true);
        systemAlerts.setAdminsCanSend(true);
        systemAlerts.setAutoDismissHours(72);
        defaultSettings.setSystemAlerts(systemAlerts);
        
        // Direct message defaults
        InstituteAnnouncementSettingsResponse.DirectMessageSettings directMessages = 
            new InstituteAnnouncementSettingsResponse.DirectMessageSettings();
        directMessages.setStudentsCanSend(true);
        directMessages.setTeachersCanSend(true);
        directMessages.setAdminsCanSend(true);
        directMessages.setAllowStudentToStudent(false);
        directMessages.setAllowReplies(true);
        directMessages.setModerationEnabled(false);
        defaultSettings.setDirectMessages(directMessages);
        
        // Stream defaults
        InstituteAnnouncementSettingsResponse.StreamSettings streams = 
            new InstituteAnnouncementSettingsResponse.StreamSettings();
        streams.setStudentsCanSend(false);
        streams.setTeachersCanSend(true);
        streams.setAdminsCanSend(true);
        streams.setAllowDuringClass(true);
        streams.setAutoArchiveHours(24);
        defaultSettings.setStreams(streams);
        
        // Resource defaults
        InstituteAnnouncementSettingsResponse.ResourceSettings resources = 
            new InstituteAnnouncementSettingsResponse.ResourceSettings();
        resources.setStudentsCanUpload(false);
        resources.setTeachersCanUpload(true);
        resources.setAdminsCanUpload(true);
        resources.setMaxFileSizeMb(50);
        defaultSettings.setResources(resources);

        // App overlay defaults (full-screen announcement on app open)
        InstituteAnnouncementSettingsResponse.AppOverlaySettings appOverlays =
            new InstituteAnnouncementSettingsResponse.AppOverlaySettings();
        appOverlays.setStudentsCanSend(false);
        appOverlays.setTeachersCanSend(true);
        appOverlays.setAdminsCanSend(true);
        defaultSettings.setAppOverlays(appOverlays);

        // General defaults
        InstituteAnnouncementSettingsResponse.GeneralSettings general = 
            new InstituteAnnouncementSettingsResponse.GeneralSettings();
        general.setAnnouncementApprovalRequired(false);
        general.setMaxAnnouncementsPerDay(10);
        general.setDefaultTimezone("Asia/Kolkata");
        general.setRetentionDays(365);
        general.setEmailTrackingEnabled(true);
        defaultSettings.setGeneral(general);

        // Chat defaults (conversation-centric DM/batch/community). All open by default.
        defaultSettings.setChat(createDefaultChatSettings());

        response.setSettings(defaultSettings);
        return response;
    }

    /**
     * Default chat settings — everything open, with empty community-rule scaffolding.
     */
    private vacademy.io.notification_service.features.chat.dto.ChatSettings createDefaultChatSettings() {
        var chat = new vacademy.io.notification_service.features.chat.dto.ChatSettings();
        chat.setEnabled(false); // OFF by default — an institute admin opts in via Settings

        var batch = new vacademy.io.notification_service.features.chat.dto.ChatSettings.BatchGroupSettings();
        batch.setStudentsCanPost(true);
        batch.setTeachersCanPost(true);
        chat.setBatchGroup(batch);

        var community = new vacademy.io.notification_service.features.chat.dto.ChatSettings.CommunityChatSettings();
        community.setStudentsCanPost(true);
        community.setTeachersCanPost(true);
        community.setAdminsCanPost(true);
        var rules = new vacademy.io.notification_service.features.chat.dto.ChatRulesDto();
        rules.setAcknowledgementRequired(false);
        var guidelines = new vacademy.io.notification_service.features.chat.dto.ChatRulesDto.Guidelines();
        guidelines.setTitle("Community Guidelines");
        rules.setGuidelines(guidelines);
        rules.setPosting(new vacademy.io.notification_service.features.chat.dto.ChatRulesDto.Posting());
        rules.setAutoModeration(new vacademy.io.notification_service.features.chat.dto.ChatRulesDto.AutoModeration());
        community.setRules(rules);
        chat.setCommunity(community);

        var direct = new vacademy.io.notification_service.features.chat.dto.ChatSettings.DirectSettings();
        direct.setEnabled(true);
        for (String sender : java.util.List.of("student", "teacher", "admin")) {
            java.util.Map<String, Boolean> row = new java.util.HashMap<>();
            for (String target : java.util.List.of("student", "teacher", "admin")) {
                row.put(target, true);
            }
            direct.getMatrix().put(sender, row);
        }
        chat.setDirect(direct);

        chat.setAttachments(new vacademy.io.notification_service.features.chat.dto.ChatSettings.AttachmentSettings());
        return chat;
    }

    /**
     * Convert request settings to Map for JSON storage
     */
    private Map<String, Object> convertRequestToMap(InstituteAnnouncementSettingsRequest.AnnouncementSettings settings) {
        try {
            @SuppressWarnings("unchecked")
            Map<String, Object> result = objectMapper.convertValue(settings, Map.class);
            return result;
        } catch (Exception e) {
            log.error("Error converting settings to map", e);
            throw new ValidationException("Invalid settings format");
        }
    }

    /**
     * The Firebase service-account key never leaves the service: responses carry only whether one is
     * stored. Nothing reads the key from a response — MultiTenantFirebaseManager reads the entity map.
     */
    private static void redactFirebaseKey(InstituteAnnouncementSettingsResponse.AnnouncementSettings settings) {
        if (settings == null || settings.getFirebase() == null) {
            return;
        }
        InstituteAnnouncementSettingsResponse.FirebaseSettings firebase = settings.getFirebase();
        firebase.setConfigured(!isBlank(firebase.getServiceAccountJson()) || !isBlank(firebase.getServiceAccountJsonBase64()));
        firebase.setServiceAccountJson(null);
        firebase.setServiceAccountJsonBase64(null);
    }

    private static boolean isBlank(String s) {
        return s == null || s.isBlank();
    }

    /**
     * An admin saving any settings tab posts back what it loaded, and the loaded settings never contain
     * the key (see redactFirebaseKey) — so a blank key in the request means "unchanged", not "remove".
     * Keep the stored key unless a new one is supplied. {@code incoming} is the map about to be saved.
     */
    @SuppressWarnings("unchecked")
    private static void keepStoredFirebaseKey(Map<String, Object> incoming, Map<String, Object> stored) {
        if (incoming == null || stored == null || !(stored.get("firebase") instanceof Map<?, ?> storedFb)) {
            return;
        }
        Object storedJson = storedFb.get("serviceAccountJson");
        Object storedB64 = storedFb.get("serviceAccountJsonBase64");
        boolean storedHasKey = (storedJson instanceof String s1 && !s1.isBlank()) || (storedB64 instanceof String s2 && !s2.isBlank());
        if (!storedHasKey) {
            return;
        }
        Map<String, Object> incomingFb = incoming.get("firebase") instanceof Map<?, ?> m
                ? new java.util.LinkedHashMap<>((Map<String, Object>) m)
                : new java.util.LinkedHashMap<>();
        boolean incomingHasKey = !isBlank(incomingFb.get("serviceAccountJson") instanceof String s ? s : null)
                || !isBlank(incomingFb.get("serviceAccountJsonBase64") instanceof String s ? s : null);
        if (incomingHasKey) {
            return; // a new key was pasted — replace
        }
        incomingFb.put("serviceAccountJson", storedJson);
        incomingFb.put("serviceAccountJsonBase64", storedB64);
        if (incomingFb.get("enabled") == null) {
            incomingFb.put("enabled", storedFb.get("enabled"));
        }
        incomingFb.remove("configured");
        incoming.put("firebase", incomingFb);
    }

    /**
     * Map entity to response DTO
     */
    private InstituteAnnouncementSettingsResponse mapToResponse(InstituteAnnouncementSettings entity) {
        try {
            InstituteAnnouncementSettingsResponse response = new InstituteAnnouncementSettingsResponse();
            response.setId(entity.getId());
            response.setInstituteId(entity.getInstituteId());
            response.setCreatedAt(entity.getCreatedAt());
            response.setUpdatedAt(entity.getUpdatedAt());
            
            // Convert Map to settings object
            InstituteAnnouncementSettingsResponse.AnnouncementSettings settings =
                objectMapper.convertValue(entity.getSettings(),
                    InstituteAnnouncementSettingsResponse.AnnouncementSettings.class);
            redactFirebaseKey(settings);
            response.setSettings(settings);

            return response;
        } catch (Exception e) {
            log.error("Error mapping entity to response", e);
            throw new AnnouncementException("Error processing settings data", "MAPPING_ERROR", e);
        }
    }

    /**
     * Check if user has permission for specific action
     */
    private boolean checkPermission(InstituteAnnouncementSettingsResponse settings, String userRole, String action, String modeType) {
        if (settings == null || settings.getSettings() == null) {
            return false;
        }

        String roleKey = userRole.toLowerCase();
        InstituteAnnouncementSettingsResponse.AnnouncementSettings announcementSettings = settings.getSettings();
        
        switch (modeType.toUpperCase()) {
            case "COMMUNITY":
                return checkCommunityPermission(announcementSettings.getCommunity(), roleKey, action);
            case "DASHBOARD_PIN":
                return checkDashboardPinPermission(announcementSettings.getDashboardPins(), roleKey, action);
            case "SYSTEM_ALERT":
                return checkSystemAlertPermission(announcementSettings.getSystemAlerts(), roleKey, action);
            case "DM":
                return checkDirectMessagePermission(announcementSettings.getDirectMessages(), roleKey, action);
            case "STREAM":
                return checkStreamPermission(announcementSettings.getStreams(), roleKey, action);
            case "RESOURCES":
                return checkResourcePermission(announcementSettings.getResources(), roleKey, action);
            case "APP_OVERLAY":
                return checkAppOverlayPermission(announcementSettings.getAppOverlays(), roleKey, action);
            default:
                return false;
        }
    }

    private boolean checkAppOverlayPermission(InstituteAnnouncementSettingsResponse.AppOverlaySettings appOverlays, String role, String action) {
        // Institutes with settings saved before APP_OVERLAY existed have no block stored —
        // fall back to the mode defaults (teachers/admins can send) instead of denying everyone.
        if (appOverlays == null) {
            return "teacher".equals(role) || "faculty".equals(role) || "admin".equals(role);
        }
        return switch (role) {
            case "student" -> Boolean.TRUE.equals(appOverlays.getStudentsCanSend());
            case "teacher", "faculty" -> Boolean.TRUE.equals(appOverlays.getTeachersCanSend());
            case "admin" -> Boolean.TRUE.equals(appOverlays.getAdminsCanSend());
            default -> false;
        };
    }

    private boolean checkCommunityPermission(InstituteAnnouncementSettingsResponse.CommunitySettings community, String role, String action) {
        if (community == null) return false;
        return switch (role) {
            case "student" -> Boolean.TRUE.equals(community.getStudentsCanSend());
            case "teacher", "faculty" -> Boolean.TRUE.equals(community.getTeachersCanSend());
            case "admin" -> Boolean.TRUE.equals(community.getAdminsCanSend());
            default -> false;
        };
    }

    private boolean checkDashboardPinPermission(InstituteAnnouncementSettingsResponse.DashboardPinSettings dashboardPins, String role, String action) {
        if (dashboardPins == null) return false;
        return switch (role) {
            case "student" -> Boolean.TRUE.equals(dashboardPins.getStudentsCanCreate());
            case "teacher", "faculty" -> Boolean.TRUE.equals(dashboardPins.getTeachersCanCreate());
            case "admin" -> Boolean.TRUE.equals(dashboardPins.getAdminsCanCreate());
            default -> false;
        };
    }

    private boolean checkSystemAlertPermission(InstituteAnnouncementSettingsResponse.SystemAlertSettings systemAlerts, String role, String action) {
        if (systemAlerts == null) return false;
        return switch (role) {
            case "student" -> Boolean.TRUE.equals(systemAlerts.getStudentsCanSend());
            case "teacher", "faculty" -> Boolean.TRUE.equals(systemAlerts.getTeachersCanSend());
            case "admin" -> Boolean.TRUE.equals(systemAlerts.getAdminsCanSend());
            default -> false;
        };
    }

    private boolean checkDirectMessagePermission(InstituteAnnouncementSettingsResponse.DirectMessageSettings directMessages, String role, String action) {
        if (directMessages == null) return false;
        return switch (role) {
            case "student" -> Boolean.TRUE.equals(directMessages.getStudentsCanSend());
            case "teacher", "faculty" -> Boolean.TRUE.equals(directMessages.getTeachersCanSend());
            case "admin" -> Boolean.TRUE.equals(directMessages.getAdminsCanSend());
            default -> false;
        };
    }

    private boolean checkStreamPermission(InstituteAnnouncementSettingsResponse.StreamSettings streams, String role, String action) {
        if (streams == null) return false;
        return switch (role) {
            case "student" -> Boolean.TRUE.equals(streams.getStudentsCanSend());
            case "teacher", "faculty" -> Boolean.TRUE.equals(streams.getTeachersCanSend());
            case "admin" -> Boolean.TRUE.equals(streams.getAdminsCanSend());
            default -> false;
        };
    }

    private boolean checkResourcePermission(InstituteAnnouncementSettingsResponse.ResourceSettings resources, String role, String action) {
        if (resources == null) return false;
        return switch (role) {
            case "student" -> Boolean.TRUE.equals(resources.getStudentsCanUpload());
            case "teacher", "faculty" -> Boolean.TRUE.equals(resources.getTeachersCanUpload());
            case "admin" -> Boolean.TRUE.equals(resources.getAdminsCanUpload());
            default -> false;
        };
    }
}