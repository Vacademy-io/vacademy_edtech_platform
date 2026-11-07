package vacademy.io.admin_core_service.features.institute.service.setting;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.institute.setting_history.InstituteSettingWriter;
import vacademy.io.admin_core_service.features.institute.dto.settings.WhatsAppProviderCredentialsRequest;
import vacademy.io.admin_core_service.features.institute.dto.settings.SwitchWhatsAppProviderRequest;
import vacademy.io.admin_core_service.features.institute.dto.settings.WhatsAppProviderStatusResponse;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.institute.entity.Institute;

import java.util.*;

@Service
@RequiredArgsConstructor
@Slf4j
public class WhatsAppSettingService {

    private final InstituteRepository instituteRepository;
    private final ObjectMapper objectMapper;
    private final InstituteSettingWriter instituteSettingWriter;

    /**
     * Gets the current status of configured and active WhatsApp providers for an
     * institute.
     */
    public WhatsAppProviderStatusResponse getProviderStatus(String instituteId) {
        Institute institute = getInstitute(instituteId);
        JsonNode root = getSettingNode(institute.getSetting());

        JsonNode settingsMap = root.has("setting") ? root.get("setting") : root;
        JsonNode utilityWhatsapp = settingsMap.path("WHATSAPP_SETTING").path("data").path("UTILITY_WHATSAPP");

        String activeProvider = utilityWhatsapp.path("provider").asText("META").toUpperCase();

        boolean hasCombot = isConfigured(utilityWhatsapp, "combot", "apiKey");
        boolean hasWati = isConfigured(utilityWhatsapp, "wati", "apiKey");
        boolean hasMeta = isConfigured(utilityWhatsapp, "meta", "access_token");

        return WhatsAppProviderStatusResponse.builder()
                .instituteId(instituteId)
                .activeProvider(activeProvider)
                .providers(List.of(
                        WhatsAppProviderStatusResponse.ProviderDetails.builder()
                                .name("COMBOT")
                                .isConfigured(hasCombot)
                                .isActive("COMBOT".equals(activeProvider))
                                .credentials(extractCredentials(utilityWhatsapp, "combot"))
                                .build(),
                        WhatsAppProviderStatusResponse.ProviderDetails.builder()
                                .name("WATI")
                                .isConfigured(hasWati)
                                .isActive("WATI".equals(activeProvider))
                                .credentials(extractCredentials(utilityWhatsapp, "wati"))
                                .build(),
                        WhatsAppProviderStatusResponse.ProviderDetails.builder()
                                .name("META")
                                .isConfigured(hasMeta)
                                .isActive("META".equals(activeProvider))
                                .credentials(extractCredentials(utilityWhatsapp, "meta"))
                                .build()))
                .build();
    }

    /**
     * Switches the active WhatsApp provider.
     */
    @Transactional
    @org.springframework.cache.annotation.CacheEvict(value = { "openInstituteDetails",
            "openInstituteDetailsNonBatches" }, key = "#instituteId")
    public void switchProvider(String instituteId, SwitchWhatsAppProviderRequest request) {
        String newProvider = request.getNewProvider().toUpperCase();

        if (!List.of("COMBOT", "WATI", "META").contains(newProvider)) {
            throw new VacademyException("Invalid provider type. Allowed types: COMBOT, WATI, META.");
        }

        Institute institute = getInstitute(instituteId);
        ObjectNode root = getMutableSettingNode(institute.getSetting());
        ObjectNode utilityWhatsapp = getOrCreateUtilityWhatsappNode(root);

        // Check if the requested provider is actually configured
        if (newProvider.equals("WATI") && !isConfigured(utilityWhatsapp, "wati", "apiKey")) {
            throw new VacademyException("Cannot switch to WATI. Credentials are not configured or missing 'apiKey'.");
        }
        if (newProvider.equals("COMBOT") && !isConfigured(utilityWhatsapp, "combot", "apiKey")) {
            throw new VacademyException("Cannot switch to COMBOT. Credentials are not configured or missing 'apiKey'.");
        }
        if (newProvider.equals("META") && !isConfigured(utilityWhatsapp, "meta", "access_token")) {
            throw new VacademyException(
                    "Cannot switch to META. Credentials are not configured or missing 'access_token'.");
        }

        utilityWhatsapp.put("provider", newProvider);
        saveSettings(institute, root);
        log.info("Institute {} successfully switched active WhatsApp Provider to {}", instituteId, newProvider);
    }

    /**
     * Updates or Adds credentials for a given WhatsApp provider.
     */
    @Transactional
    @org.springframework.cache.annotation.CacheEvict(value = { "openInstituteDetails",
            "openInstituteDetailsNonBatches" }, key = "#instituteId")
    public void updateCredentials(String instituteId, WhatsAppProviderCredentialsRequest request) {
        String providerName = request.getProviderName().toLowerCase();

        if (!List.of("combot", "wati", "meta").contains(providerName)) {
            throw new VacademyException("Invalid provider name. Allowed: combot, wati, meta.");
        }

        Institute institute = getInstitute(instituteId);
        ObjectNode root = getMutableSettingNode(institute.getSetting());
        ObjectNode utilityWhatsapp = getOrCreateUtilityWhatsappNode(root);

        // Fetch or create the particular provider node
        ObjectNode providerNode;
        if (utilityWhatsapp.has(providerName)) {
            providerNode = (ObjectNode) utilityWhatsapp.get(providerName);
        } else {
            providerNode = utilityWhatsapp.putObject(providerName);
        }

        // Apply new credentials
        for (Map.Entry<String, String> entry : request.getCredentials().entrySet()) {
            providerNode.put(entry.getKey(), entry.getValue());
        }

        saveSettings(institute, root);
        log.info("Updated configured WhatsApp credentials for provider '{}' in Institute '{}'", providerName,
                instituteId);
    }

    /**
     * Removes the configured credentials for a provider.
     * If the provider was currently active, the system falls back to the next
     * available one.
     */
    @Transactional
    @org.springframework.cache.annotation.CacheEvict(value = { "openInstituteDetails",
            "openInstituteDetailsNonBatches" }, key = "#instituteId")
    public void removeCredentials(String instituteId, String providerName) {
        providerName = providerName.toLowerCase();

        if (!List.of("combot", "wati", "meta").contains(providerName)) {
            throw new VacademyException("Invalid provider name. Allowed: combot, wati, meta.");
        }

        Institute institute = getInstitute(instituteId);
        ObjectNode root = getMutableSettingNode(institute.getSetting());
        ObjectNode utilityWhatsapp = getOrCreateUtilityWhatsappNode(root);

        // Step 1: Remove the provider credentials entirely from JSON
        if (utilityWhatsapp.has(providerName)) {
            utilityWhatsapp.remove(providerName);
        }

        // Step 2: Fallback logic - If we just deleted the Active Provider, we MUST
        // switch!
        String activeProvider = utilityWhatsapp.path("provider").asText("META").toLowerCase();

        if (activeProvider.equals(providerName)) {
            // Find another configured provider
            boolean hasCombot = isConfigured(utilityWhatsapp, "combot", "apiKey");
            boolean hasWati = isConfigured(utilityWhatsapp, "wati", "apiKey");
            boolean hasMeta = isConfigured(utilityWhatsapp, "meta", "access_token");

            String newActive = "";
            if (hasCombot)
                newActive = "COMBOT";
            else if (hasWati)
                newActive = "WATI";
            else if (hasMeta)
                newActive = "META";

            utilityWhatsapp.put("provider", newActive); // if all empty, will be ""
            log.info("Active provider was deleted! Auto-falling back to: {}", newActive.isEmpty() ? "NONE" : newActive);
        }

        saveSettings(institute, root);
        log.info("Successfully removed WhatsApp credentials for '{}' in Institute '{}'", providerName, instituteId);
    }

    // --- Helper Methods ---

    private Institute getInstitute(String instituteId) {
        return instituteRepository.findById(instituteId)
                .orElseThrow(() -> new VacademyException("Institute Not Found: " + instituteId));
    }

    private JsonNode getSettingNode(String settingJson) {
        if (settingJson == null || settingJson.isBlank()) {
            return objectMapper.createObjectNode();
        }
        try {
            return objectMapper.readTree(settingJson);
        } catch (JsonProcessingException e) {
            log.warn("Corrupted setting JSON for institute, returning empty object", e);
            return objectMapper.createObjectNode();
        }
    }

    private ObjectNode getMutableSettingNode(String settingJson) {
        return (ObjectNode) getSettingNode(settingJson);
    }

    private ObjectNode getOrCreateUtilityWhatsappNode(ObjectNode root) {
        ObjectNode settingsMap;
        if (root.has("setting")) {
            settingsMap = (ObjectNode) root.get("setting");
        } else {
            settingsMap = root;
        }

        ObjectNode whatsappSetting;
        if (settingsMap.has("WHATSAPP_SETTING")) {
            whatsappSetting = (ObjectNode) settingsMap.get("WHATSAPP_SETTING");
        } else {
            whatsappSetting = settingsMap.putObject("WHATSAPP_SETTING");
        }

        ObjectNode dataNode;
        if (whatsappSetting.has("data")) {
            dataNode = (ObjectNode) whatsappSetting.get("data");
        } else {
            dataNode = whatsappSetting.putObject("data");
        }

        if (dataNode.has("UTILITY_WHATSAPP")) {
            return (ObjectNode) dataNode.get("UTILITY_WHATSAPP");
        } else {
            return dataNode.putObject("UTILITY_WHATSAPP");
        }
    }

    /**
     * Extracts credentials for a provider, masking sensitive fields (apiKey, access_token).
     */
    private Map<String, String> extractCredentials(JsonNode utilityWhatsapp, String providerKey) {
        if (!utilityWhatsapp.has(providerKey)) {
            return Collections.emptyMap();
        }
        JsonNode providerNode = utilityWhatsapp.get(providerKey);
        Map<String, String> creds = new LinkedHashMap<>();
        providerNode.fields().forEachRemaining(entry -> {
            creds.put(entry.getKey(), entry.getValue().asText(""));
        });
        return creds;
    }

    private boolean isConfigured(JsonNode utilityWhatsapp, String providerKey, String mandatoryField) {
        if (!utilityWhatsapp.has(providerKey))
            return false;
        JsonNode providerNode = utilityWhatsapp.get(providerKey);
        return providerNode.has(mandatoryField) && !providerNode.get(mandatoryField).asText("").isBlank();
    }

    private void saveSettings(Institute institute, ObjectNode root) {
        try {
            instituteSettingWriter.save(institute, objectMapper.writeValueAsString(root));
        } catch (JsonProcessingException e) {
            throw new VacademyException("Error saving Institute JSON: " + e.getMessage());
        }
    }
}
