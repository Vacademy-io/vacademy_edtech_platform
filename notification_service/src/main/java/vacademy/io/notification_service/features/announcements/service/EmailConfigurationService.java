package vacademy.io.notification_service.features.announcements.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import vacademy.io.notification_service.constants.NotificationConstants;
import vacademy.io.notification_service.features.announcements.dto.EmailConfigDTO;
import vacademy.io.notification_service.features.notification_log.repository.EmailAddressMappingRepository;
import vacademy.io.notification_service.institute.InstituteInternalService;

import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Service for managing email configurations and providing dropdown options
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class EmailConfigurationService {

    private final InstituteInternalService instituteInternalService;
    private final ObjectMapper objectMapper;
    private final EmailAddressMappingRepository emailAddressMappingRepository;

    // Platform-wide default sender; used as fallback when an institute has no email config.
    // Driven by SES_SENDER_EMAIL env var. If unset, falls back to support@vacademy.io.
    @Value("${app.ses.sender.email:support@vacademy.io}")
    private String defaultSenderEmail;
    
    /**
     * Return only the from-addresses an institute has explicitly configured in
     * institute.setting.EMAIL_SETTING.data (lowercased + deduped). The platform default
     * fallback is NOT included — callers that need "all senders including default"
     * should use {@link #getEmailConfigurations(String)} or
     * {@code EmailService.listInstituteEmailSenders}.
     *
     * Used by the Notification Hub to scope per-institute email stats safely.
     */
    public List<String> getInstituteConfiguredFromAddresses(String instituteId) {
        try {
            var institute = instituteInternalService.getInstituteByInstituteId(instituteId);
            if (institute == null) {
                // Likely cause: admin.core.service.baseurl / HMAC creds mismatch.
                // Kept at WARN since this is a genuinely actionable error in any environment.
                log.warn("getInstituteConfiguredFromAddresses: institute lookup returned NULL for id={}",
                        instituteId);
                return List.of();
            }
            if (institute.getSetting() == null) {
                log.debug("getInstituteConfiguredFromAddresses: institute {} has setting=null (no EMAIL_SETTING configured)",
                        instituteId);
                return List.of();
            }
            List<String> result = parseInstituteEmailSettings(institute.getSetting()).stream()
                    .map(EmailConfigDTO::getEmail)
                    .filter(e -> e != null && !e.isBlank())
                    .map(e -> e.toLowerCase().trim())
                    .distinct()
                    .toList();
            log.debug("getInstituteConfiguredFromAddresses: institute={} resolved {} from-address(es)",
                    instituteId, result.size());
            return result;
        } catch (Exception e) {
            log.warn("Failed to read configured from-addresses for institute {}: {}", instituteId, e.getMessage(), e);
            return List.of();
        }
    }

    /**
     * Get available email configurations for dropdown
     */
    public List<EmailConfigDTO> getEmailConfigurations(String instituteId) {
        List<EmailConfigDTO> configurations = new ArrayList<>();
        
        try {
            // Get institute settings
            var institute = instituteInternalService.getInstituteByInstituteId(instituteId);
            if (institute != null && institute.getSetting() != null) {
                // Parse institute email settings and build configurations
                configurations = parseInstituteEmailSettings(institute.getSetting());
            }
            
            // Add default configurations if none found
            if (configurations.isEmpty()) {
                log.warn("No email configurations found for institute: {}, returning defaults", instituteId);
                configurations = getDefaultEmailConfigurations();
            }
            
        } catch (Exception e) {
            log.error("Error getting email configurations for institute: {}", instituteId, e);
            configurations = getDefaultEmailConfigurations();
        }
        
        return configurations;
    }
    
    /**
     * Parse institute settings to extract email configurations
     */
    private List<EmailConfigDTO> parseInstituteEmailSettings(String settingsJson) {
        List<EmailConfigDTO> configs = new ArrayList<>();
        
        try {
            JsonNode settings = objectMapper.readTree(settingsJson);
            
            // Navigate to EMAIL_SETTING.data
            JsonNode emailSettingsData = settings
                    .path(NotificationConstants.SETTING)
                    .path(NotificationConstants.EMAIL_SETTING)
                    .path(NotificationConstants.DATA);
            
            if (!emailSettingsData.isMissingNode() && emailSettingsData.isObject()) {
                log.info("Found EMAIL_SETTING.data, parsing email configurations...");
                
                // Iterate through all email configurations
                Iterator<Map.Entry<String, JsonNode>> fields = emailSettingsData.fields();
                while (fields.hasNext()) {
                    Map.Entry<String, JsonNode> entry = fields.next();
                    String emailType = entry.getKey();
                    JsonNode configNode = entry.getValue();
                    
                    // Extract fields from each email configuration
                    // The "from" field may contain a display name: "Vet Education <info@vet.com>"
                    String fromRaw = configNode.path(NotificationConstants.FROM).asText("");
                    String fromEmail = fromRaw;
                    String fromName = null;

                    // Parse "Display Name <email@domain.com>" format
                    if (fromRaw.contains("<") && fromRaw.contains(">")) {
                        int ltIdx = fromRaw.indexOf('<');
                        int gtIdx = fromRaw.indexOf('>');
                        fromName = fromRaw.substring(0, ltIdx).trim();
                        fromEmail = fromRaw.substring(ltIdx + 1, gtIdx).trim();
                    }

                    // Fallback display name to formatted email type if not set
                    String displayName = (fromName != null && !fromName.isEmpty())
                            ? fromName
                            : formatEmailTypeName(emailType);

                    // Build EmailConfigDTO. `id` is set to the email type so the
                    // frontend has a stable handle for update/delete; type is the
                    // primary key inside EMAIL_SETTING.data.
                    EmailConfigDTO dto = EmailConfigDTO.builder()
                            .id(emailType)
                            .email(fromEmail)
                            .name(displayName)
                            .type(emailType)
                            .description("Email configuration for " + formatEmailTypeName(emailType))
                            .displayText(displayName + " (" + fromEmail + ")")
                            .maxPerDay(configNode.has(NotificationConstants.MAX_PER_DAY) ? configNode.path(NotificationConstants.MAX_PER_DAY).asInt(0) : null)
                            .timezone(configNode.hasNonNull(NotificationConstants.TIMEZONE) ? configNode.path(NotificationConstants.TIMEZONE).asText() : null)
                            .sendAfterHour(configNode.has(NotificationConstants.SEND_AFTER_HOUR) ? configNode.path(NotificationConstants.SEND_AFTER_HOUR).asInt(0) : null)
                            .postalAddress(configNode.hasNonNull(NotificationConstants.POSTAL_ADDRESS) ? configNode.path(NotificationConstants.POSTAL_ADDRESS).asText() : null)
                            .listUnsubscribe(configNode.has(NotificationConstants.LIST_UNSUBSCRIBE) ? configNode.path(NotificationConstants.LIST_UNSUBSCRIBE).asBoolean(false) : null)
                            .skipWeekends(configNode.has(NotificationConstants.SKIP_WEEKENDS) ? configNode.path(NotificationConstants.SKIP_WEEKENDS).asBoolean(false) : null)
                            .rampEnabled(configNode.has(NotificationConstants.RAMP_ENABLED) ? configNode.path(NotificationConstants.RAMP_ENABLED).asBoolean(false) : null)
                            .rampStartPerDay(configNode.has(NotificationConstants.RAMP_START_PER_DAY) ? configNode.path(NotificationConstants.RAMP_START_PER_DAY).asInt(0) : null)
                            .rampStep(configNode.has(NotificationConstants.RAMP_STEP) ? configNode.path(NotificationConstants.RAMP_STEP).asInt(0) : null)
                            .rampEveryDays(configNode.has(NotificationConstants.RAMP_EVERY_DAYS) ? configNode.path(NotificationConstants.RAMP_EVERY_DAYS).asInt(0) : null)
                            .rampCeiling(configNode.has(NotificationConstants.RAMP_CEILING) ? configNode.path(NotificationConstants.RAMP_CEILING).asInt(0) : null)
                            .rampStartedOn(configNode.hasNonNull(NotificationConstants.RAMP_STARTED_ON) ? configNode.path(NotificationConstants.RAMP_STARTED_ON).asText() : null)
                            .build();
                    
                    configs.add(dto);
                    log.info("Parsed email config: type={}, from={}", emailType, fromEmail);
                }
            } else {
                log.warn("EMAIL_SETTING.data not found or not an object in settings JSON");
            }
            
        } catch (Exception e) {
            log.error("Error parsing institute email settings", e);
        }
        
        return configs;
    }
    
    /**
     * Format email type name for display
     */
    private String formatEmailTypeName(String emailType) {
        if (emailType == null) return "";
        
        // Convert DEVELOPER_EMAIL to "Developer Email"
        String formatted = emailType.replace("_", " ").toLowerCase();
        
        // Capitalize first letter of each word
        StringBuilder result = new StringBuilder();
        boolean capitalizeNext = true;
        
        for (char c : formatted.toCharArray()) {
            if (Character.isWhitespace(c)) {
                capitalizeNext = true;
                result.append(c);
            } else if (capitalizeNext) {
                result.append(Character.toUpperCase(c));
                capitalizeNext = false;
            } else {
                result.append(c);
            }
        }
        
        return result.toString();
    }
    
    /**
     * Add new email configuration
     */
    public EmailConfigDTO addEmailConfiguration(String instituteId, EmailConfigDTO emailConfig, String authToken) {
        try {
            log.info("Adding email configuration for institute: {}, type: {}", instituteId, emailConfig.getType());
            
            // Validate input
            if (emailConfig.getEmail() == null || emailConfig.getEmail().isEmpty()) {
                throw new IllegalArgumentException("Email address is required");
            }
            if (emailConfig.getType() == null || emailConfig.getType().isEmpty()) {
                throw new IllegalArgumentException("Email type is required");
            }
            
            // Get current settings
            var institute = instituteInternalService.getInstituteByInstituteId(instituteId);
            if (institute == null) {
                throw new IllegalArgumentException("Institute not found: " + instituteId);
            }
            
            String currentSettings = institute.getSetting();
            if (currentSettings == null || currentSettings.trim().isEmpty()) {
                currentSettings = "{}";
            }
            
            JsonNode settingsNode = objectMapper.readTree(currentSettings);
            ObjectNode rootNode = (ObjectNode) settingsNode;
            
            // Ensure EMAIL_SETTING.data structure exists
            ensureEmailSettingsDataStructure(rootNode);
            
            // Get EMAIL_SETTING.data node
            ObjectNode emailData = (ObjectNode) rootNode
                    .path(NotificationConstants.SETTING)
                    .path(NotificationConstants.EMAIL_SETTING)
                    .path(NotificationConstants.DATA);
            
            // Check if email type already exists
            if (emailData.has(emailConfig.getType())) {
                throw new IllegalArgumentException("Email type '" + emailConfig.getType() + "' already exists. Use PUT to update.");
            }
            
            // Create new email configuration node. The `from` field encodes the
            // display name as "Name <email>" when a name is provided, so it
            // appears in the recipient's inbox; otherwise we store the bare
            // email so no auto-derived fallback ever leaks into outbound mail.
            ObjectNode newConfigNode = objectMapper.createObjectNode();
            String addEmail = emailConfig.getEmail().trim();
            String addName = emailConfig.getName() != null ? emailConfig.getName().trim() : "";
            String fromValue = addName.isEmpty()
                    ? addEmail
                    : (addName + " <" + addEmail + ">");
            newConfigNode.put(NotificationConstants.FROM, fromValue);
            applySendingControls(newConfigNode, emailConfig);
            newConfigNode.put(NotificationConstants.HOST, "smtp.gmail.com");
            newConfigNode.put(NotificationConstants.PORT, 587);
            newConfigNode.put(NotificationConstants.USERNAME, "SMTP_USERNAME");
            newConfigNode.put(NotificationConstants.PASSWORD, "SMTP_PASSWORD");
            
            // Add to EMAIL_SETTING.data
            emailData.set(emailConfig.getType(), newConfigNode);
            
            // Convert back to JSON string
            String updatedSettings = objectMapper.writeValueAsString(rootNode);
            
            // Update in database
            boolean updated = instituteInternalService.updateInstituteSettings(instituteId, updatedSettings, authToken);
            
            if (!updated) {
                log.warn("Failed to persist email configuration to database for institute: {}", instituteId);
                log.info("Manual update required. Updated settings JSON:\n{}", updatedSettings);
            } else {
                log.info("Successfully added email configuration: {} for institute: {}", emailConfig.getType(), instituteId);
            }

            // Keep email_address_mapping in sync so inbound emails can be routed to this institute
            try {
                if (emailConfig.getEmail() != null && !emailConfig.getEmail().isBlank()) {
                    emailAddressMappingRepository.upsert(
                            UUID.randomUUID().toString(),
                            emailConfig.getEmail().toLowerCase().trim(),
                            instituteId,
                            emailConfig.getType()
                    );
                }
            } catch (Exception e) {
                log.warn("Failed to upsert email_address_mapping for {}: {}", emailConfig.getEmail(), e.getMessage());
            }

            return emailConfig;
            
        } catch (Exception e) {
            log.error("Error adding email configuration", e);
            throw new RuntimeException("Failed to add email configuration: " + e.getMessage(), e);
        }
    }
    
    /**
     * Sending controls are optional and PATCH-like: a null field leaves the stored value alone,
     * so an admin editing the display name never wipes a daily cap set earlier.
     */
    private void applySendingControls(ObjectNode node, EmailConfigDTO dto) {
        if (dto.getMaxPerDay() != null) node.put(NotificationConstants.MAX_PER_DAY, Math.max(0, dto.getMaxPerDay()));
        if (dto.getTimezone() != null) {
            String tz = dto.getTimezone().trim();
            if (tz.isEmpty()) node.remove(NotificationConstants.TIMEZONE);
            else { java.time.ZoneId.of(tz); node.put(NotificationConstants.TIMEZONE, tz); } // throws on a bad zone → 400
        }
        if (dto.getSendAfterHour() != null) node.put(NotificationConstants.SEND_AFTER_HOUR, Math.max(0, Math.min(23, dto.getSendAfterHour())));
        if (dto.getPostalAddress() != null) {
            String a = dto.getPostalAddress().trim();
            if (a.isEmpty()) node.remove(NotificationConstants.POSTAL_ADDRESS); else node.put(NotificationConstants.POSTAL_ADDRESS, a);
        }
        if (dto.getListUnsubscribe() != null) node.put(NotificationConstants.LIST_UNSUBSCRIBE, dto.getListUnsubscribe());
        if (dto.getSkipWeekends() != null) node.put(NotificationConstants.SKIP_WEEKENDS, dto.getSkipWeekends());
        if (dto.getRampStartPerDay() != null) node.put(NotificationConstants.RAMP_START_PER_DAY, Math.max(0, dto.getRampStartPerDay()));
        if (dto.getRampStep() != null) node.put(NotificationConstants.RAMP_STEP, Math.max(0, dto.getRampStep()));
        if (dto.getRampEveryDays() != null) node.put(NotificationConstants.RAMP_EVERY_DAYS, Math.max(1, dto.getRampEveryDays()));
        if (dto.getRampCeiling() != null) node.put(NotificationConstants.RAMP_CEILING, Math.max(0, dto.getRampCeiling()));
        if (dto.getRampStartedOn() != null) {
            String d = dto.getRampStartedOn().trim();
            if (d.isEmpty()) node.remove(NotificationConstants.RAMP_STARTED_ON);
            else { java.time.LocalDate.parse(d); node.put(NotificationConstants.RAMP_STARTED_ON, d); } // throws on a bad date -> 400
        }
        if (dto.getRampEnabled() != null) {
            node.put(NotificationConstants.RAMP_ENABLED, dto.getRampEnabled());
            // Day 0 is stamped once, when the ramp is switched on. Without it every edit would
            // restart the schedule at the opening volume and the warm-up would never progress.
            if (dto.getRampEnabled() && !node.hasNonNull(NotificationConstants.RAMP_STARTED_ON)) {
                node.put(NotificationConstants.RAMP_STARTED_ON, java.time.LocalDate.now().toString());
            }
        }
    }

    /**
     * Ensure EMAIL_SETTING.data structure exists in settings
     */
    private void ensureEmailSettingsDataStructure(ObjectNode rootNode) {
        // Ensure "setting" exists
        if (!rootNode.has(NotificationConstants.SETTING) || 
            !(rootNode.get(NotificationConstants.SETTING) instanceof ObjectNode)) {
            rootNode.set(NotificationConstants.SETTING, objectMapper.createObjectNode());
        }
        ObjectNode settingNode = (ObjectNode) rootNode.get(NotificationConstants.SETTING);
        
        // Ensure "EMAIL_SETTING" exists
        if (!settingNode.has(NotificationConstants.EMAIL_SETTING) || 
            !(settingNode.get(NotificationConstants.EMAIL_SETTING) instanceof ObjectNode)) {
            settingNode.set(NotificationConstants.EMAIL_SETTING, objectMapper.createObjectNode());
        }
        ObjectNode emailSettingNode = (ObjectNode) settingNode.get(NotificationConstants.EMAIL_SETTING);
        
        // Ensure "data" exists
        if (!emailSettingNode.has(NotificationConstants.DATA) || 
            !(emailSettingNode.get(NotificationConstants.DATA) instanceof ObjectNode)) {
            emailSettingNode.set(NotificationConstants.DATA, objectMapper.createObjectNode());
        }
    }
    
    /**
     * Default email configurations surfaced when an institute has no email config set up.
     * The primary entry is the platform-wide SES sender (env var SES_SENDER_EMAIL), with
     * support@vacademy.io as the ultimate fallback if the env var is unset.
     */
    private List<EmailConfigDTO> getDefaultEmailConfigurations() {
        String senderEmail = StringUtils.hasText(defaultSenderEmail) ? defaultSenderEmail : "support@vacademy.io";

        List<EmailConfigDTO> configs = new ArrayList<>();

        configs.add(EmailConfigDTO.builder()
            .id("UTILITY_EMAIL")
            .email(senderEmail)
            .name("Vacademy Support")
            .type("UTILITY_EMAIL")
            .description("Default platform sender — utility and system notifications")
            .displayText("Vacademy Support (default)")
            .build());

        return configs;
    }

    /**
     * Update an existing email configuration. `emailType` is the primary key and
     * is immutable — only the from-address and display name can change. Returns
     * null if the type does not exist for the institute.
     */
    public EmailConfigDTO updateEmailConfiguration(
            String instituteId,
            String emailType,
            EmailConfigDTO emailConfig,
            String authToken
    ) {
        try {
            if (emailType == null || emailType.isBlank()) {
                throw new IllegalArgumentException("Email type is required");
            }
            if (emailConfig.getEmail() == null || emailConfig.getEmail().isBlank()) {
                throw new IllegalArgumentException("Email address is required");
            }

            var institute = instituteInternalService.getInstituteByInstituteId(instituteId);
            if (institute == null) {
                throw new IllegalArgumentException("Institute not found: " + instituteId);
            }

            String currentSettings = institute.getSetting();
            if (currentSettings == null || currentSettings.trim().isEmpty()) {
                // No settings yet — treat the update as an upsert so a not-yet-persisted
                // sender can be saved for the first time from the edit form.
                currentSettings = "{}";
            }

            JsonNode settingsNode = objectMapper.readTree(currentSettings);
            if (!(settingsNode instanceof ObjectNode rootNode)) {
                return null;
            }

            // Upsert semantics: ensure the EMAIL_SETTING.data container exists and create the
            // type node if it isn't stored yet. This is what lets an admin override the virtual
            // "support@vacademy.io" default (which has no DB row) straight from the edit form —
            // previously this returned null → 404 and the default could never be changed.
            ensureEmailSettingsDataStructure(rootNode);
            ObjectNode emailData = (ObjectNode) rootNode
                    .path(NotificationConstants.SETTING)
                    .path(NotificationConstants.EMAIL_SETTING)
                    .path(NotificationConstants.DATA);

            boolean isNewConfig = !emailData.has(emailType);
            ObjectNode existingConfigNode = isNewConfig
                    ? objectMapper.createObjectNode()
                    : (ObjectNode) emailData.get(emailType);
            if (isNewConfig) {
                // Seed placeholder SMTP so a freshly-created sender routes through the shared
                // SES SMTP account (same convention as addEmailConfiguration).
                existingConfigNode.put(NotificationConstants.HOST, "smtp.gmail.com");
                existingConfigNode.put(NotificationConstants.PORT, 587);
                existingConfigNode.put(NotificationConstants.USERNAME, "SMTP_USERNAME");
                existingConfigNode.put(NotificationConstants.PASSWORD, "SMTP_PASSWORD");
                emailData.set(emailType, existingConfigNode);
            }

            // Read the previous from-address (raw) so we can detect an email change
            // and keep the email_address_mapping table in sync.
            String previousFromRaw = existingConfigNode.path(NotificationConstants.FROM).asText("");
            String previousEmail = previousFromRaw;
            boolean previouslyHadStoredName =
                    previousFromRaw.contains("<") && previousFromRaw.contains(">");
            if (previouslyHadStoredName) {
                int ltIdx = previousFromRaw.indexOf('<');
                int gtIdx = previousFromRaw.indexOf('>');
                previousEmail = previousFromRaw.substring(ltIdx + 1, gtIdx).trim();
            }

            // Format the new `from` string. Match the parser's expectation:
            // "Display Name <email@domain.com>" when the user has chosen a name,
            // otherwise just the bare email.
            //
            // Safety net for pre-existing rows: if the row was previously stored
            // as a bare email (no display name persisted), the GET response
            // returned an auto-derived fallback name (e.g. "Utility Email").
            // If the incoming `name` is unchanged from that fallback — i.e. the
            // user edited something else (like a typo in the email address) and
            // didn't touch the name field — we must NOT promote that fallback
            // to a stored display name, because emails would suddenly start
            // going out with "Utility Email" / "Marketing Email" as the
            // sender label. Treat it as no name set instead.
            String newEmail = emailConfig.getEmail().trim();
            String newName = emailConfig.getName() != null ? emailConfig.getName().trim() : "";
            String autoFallbackName = formatEmailTypeName(emailType);
            boolean incomingMatchesAutoFallback = newName.equalsIgnoreCase(autoFallbackName);
            boolean treatAsNoName =
                    newName.isEmpty()
                            || (!previouslyHadStoredName && incomingMatchesAutoFallback);

            String newFrom = treatAsNoName ? newEmail : (newName + " <" + newEmail + ">");
            existingConfigNode.put(NotificationConstants.FROM, newFrom);
            applySendingControls(existingConfigNode, emailConfig);

            String updatedSettings = objectMapper.writeValueAsString(rootNode);
            boolean persisted = instituteInternalService.updateInstituteSettings(
                    instituteId, updatedSettings, authToken);
            if (!persisted) {
                log.warn("Failed to persist updated email configuration for institute: {}, type: {}",
                        instituteId, emailType);
                log.info("Manual update required. Updated settings JSON:\n{}", updatedSettings);
            } else {
                log.info("Updated email configuration: type={}, institute={}", emailType, instituteId);
            }

            // Keep email_address_mapping in sync.
            try {
                if (!previousEmail.isBlank()
                        && !previousEmail.equalsIgnoreCase(newEmail)) {
                    // Old address is no longer this institute's `emailType` sender —
                    // soft-delete the mapping so inbound routing doesn't keep using it.
                    emailAddressMappingRepository.deactivateByInstituteIdAndEmailAddress(
                            instituteId, previousEmail);
                }
                emailAddressMappingRepository.upsert(
                        UUID.randomUUID().toString(),
                        newEmail.toLowerCase().trim(),
                        instituteId,
                        emailType);
            } catch (Exception e) {
                log.warn("Failed to sync email_address_mapping on update (institute={}, type={}): {}",
                        instituteId, emailType, e.getMessage());
            }

            // Return the canonical, post-update view. Mirror what a follow-up
            // GET would parse: the fallback when no real name is stored, the
            // user's chosen name otherwise.
            String returnedName = treatAsNoName ? autoFallbackName : newName;
            // Echo the stored node (controls included): the settings page replaces its row
            // state with this response, so a bare DTO would visibly reset the ramp/cap fields.
            EmailConfigDTO echoed = parseInstituteEmailSettings(updatedSettings).stream()
                    .filter(c -> emailType.equals(c.getType()))
                    .findFirst()
                    .orElse(null);
            if (echoed != null) {
                echoed.setDescription(emailConfig.getDescription() != null ? emailConfig.getDescription() : echoed.getDescription());
                return echoed;
            }
            return EmailConfigDTO.builder()
                    .id(emailType)
                    .email(newEmail)
                    .name(returnedName)
                    .type(emailType)
                    .description("Email configuration for " + autoFallbackName)
                    .displayText(returnedName + " (" + newEmail + ")")
                    .build();
        } catch (IllegalArgumentException e) {
            // Surface bad input as-is so the controller can map it to a 4xx.
            throw e;
        } catch (Exception e) {
            log.error("Error updating email configuration (institute={}, type={})",
                    instituteId, emailType, e);
            throw new RuntimeException("Failed to update email configuration: " + e.getMessage(), e);
        }
    }

    /**
     * Delete an email configuration by type. Returns false if the type is not
     * present for the institute (treated as a 404 by the controller).
     */
    public boolean deleteEmailConfiguration(String instituteId, String emailType, String authToken) {
        try {
            if (emailType == null || emailType.isBlank()) {
                throw new IllegalArgumentException("Email type is required");
            }

            var institute = instituteInternalService.getInstituteByInstituteId(instituteId);
            if (institute == null) {
                throw new IllegalArgumentException("Institute not found: " + instituteId);
            }

            String currentSettings = institute.getSetting();
            if (currentSettings == null || currentSettings.trim().isEmpty()) {
                return false;
            }

            JsonNode settingsNode = objectMapper.readTree(currentSettings);
            if (!(settingsNode instanceof ObjectNode rootNode)) {
                return false;
            }

            JsonNode emailDataNode = rootNode
                    .path(NotificationConstants.SETTING)
                    .path(NotificationConstants.EMAIL_SETTING)
                    .path(NotificationConstants.DATA);
            if (!(emailDataNode instanceof ObjectNode emailData) || !emailData.has(emailType)) {
                return false;
            }

            emailData.remove(emailType);

            String updatedSettings = objectMapper.writeValueAsString(rootNode);
            boolean persisted = instituteInternalService.updateInstituteSettings(
                    instituteId, updatedSettings, authToken);
            if (!persisted) {
                log.warn("Failed to persist deleted email configuration for institute: {}, type: {}",
                        instituteId, emailType);
                return false;
            }

            try {
                emailAddressMappingRepository.deactivateByInstituteIdAndEmailType(
                        instituteId, emailType);
            } catch (Exception e) {
                log.warn("Failed to deactivate email_address_mapping on delete (institute={}, type={}): {}",
                        instituteId, emailType, e.getMessage());
            }

            log.info("Deleted email configuration: type={}, institute={}", emailType, instituteId);
            return true;
        } catch (IllegalArgumentException e) {
            throw e;
        } catch (Exception e) {
            log.error("Error deleting email configuration (institute={}, type={})",
                    instituteId, emailType, e);
            throw new RuntimeException("Failed to delete email configuration: " + e.getMessage(), e);
        }
    }
}
