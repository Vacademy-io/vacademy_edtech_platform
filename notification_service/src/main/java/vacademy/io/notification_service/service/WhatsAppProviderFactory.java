package vacademy.io.notification_service.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestTemplate;

/**
 * Factory for resolving WhatsApp providers and their credentials.
 * Returns WhatsAppProviderContext containing both the provider and normalized
 * credentials.
 * Handles multiple JSON structures for backward compatibility.
 */
// vendor-call-log: builds Meta/WATI providers; calls are recorded in MetaWhatsAppServiceProvider and WatiWhatsAppServiceProvider
@Component
@Slf4j
public class WhatsAppProviderFactory {

    private final ObjectMapper objectMapper;
    private final RestTemplate restTemplate;
    private final String metaApiBaseUrl;

    @Autowired
    public WhatsAppProviderFactory(ObjectMapper objectMapper, RestTemplate restTemplate,
            @org.springframework.beans.factory.annotation.Value("${meta.whatsapp.api.base.url:https://graph.facebook.com/v22.0}") String metaApiBaseUrl) {
        this.objectMapper = objectMapper;
        this.restTemplate = restTemplate;
        this.metaApiBaseUrl = metaApiBaseUrl;
    }

    /**
     * Resolve provider and credentials from institute settings.
     * This is the main method to use - returns both provider and normalized
     * credentials.
     * 
     * @param settingsRoot The root JSON node from institute settings (may or may
     *                     not have "setting" wrapper)
     * @return WhatsAppProviderContext with provider and credentials
     */
    public WhatsAppProviderContext resolve(JsonNode settingsRoot) {
        // Step 1: Normalize root - handle both { setting: {...} } and direct {...}
        // formats
        JsonNode normalizedRoot = normalizeRoot(settingsRoot);

        // Step 2: Navigate to UTILITY_WHATSAPP or UTILITY_META_WHATSAPP
        JsonNode utilityWhatsapp = normalizedRoot.path("WHATSAPP_SETTING")
                .path("data")
                .path("UTILITY_WHATSAPP");

        JsonNode utilityMetaWhatsapp = normalizedRoot.path("WHATSAPP_SETTING")
                .path("data")
                .path("UTILITY_META_WHATSAPP");

        // Step 3: Determine provider and extract credentials
        if (!utilityWhatsapp.isMissingNode() && utilityWhatsapp.has("provider")) {
            String provider = utilityWhatsapp.path("provider").asText("").toUpperCase();

            if ("WATI".equals(provider)) {
                log.info("Resolved WhatsApp provider: WATI");
                JsonNode watiCredentials = extractWatiCredentials(utilityWhatsapp);
                return WhatsAppProviderContext.builder()
                        .provider(new WatiWhatsAppServiceProvider(objectMapper, restTemplate))
                        .credentials(watiCredentials)
                        .providerType("WATI")
                        .build();
            }
        }

        // Check UTILITY_META_WHATSAPP for explicit Meta configuration
        if (!utilityMetaWhatsapp.isMissingNode()
                && "META".equalsIgnoreCase(utilityMetaWhatsapp.path("provider").asText(""))) {
            log.info("Resolved WhatsApp provider: META (from UTILITY_META_WHATSAPP)");
            JsonNode metaCredentials = extractMetaCredentials(utilityMetaWhatsapp);
            return WhatsAppProviderContext.builder()
                    .provider(new MetaWhatsAppServiceProvider(objectMapper, restTemplate, metaApiBaseUrl))
                    .credentials(metaCredentials)
                    .providerType("META")
                    .build();
        }

        // Fallback: Default to Meta using UTILITY_WHATSAPP credentials
        log.info("Resolved WhatsApp provider: META (default fallback)");
        JsonNode metaCredentials = extractMetaCredentials(utilityWhatsapp);
        return WhatsAppProviderContext.builder()
                .provider(new MetaWhatsAppServiceProvider(objectMapper, restTemplate, metaApiBaseUrl))
                .credentials(metaCredentials)
                .providerType("META")
                .build();
    }

    /**
     * Legacy method - kept for backward compatibility.
     * 
     * @deprecated Use resolve() instead which returns WhatsAppProviderContext
     */
    @Deprecated
    public WhatsAppServiceProvider getProvider(JsonNode settingsRoot) {
        return resolve(settingsRoot).getProvider();
    }

    /**
     * Normalize the root node to handle different JSON structures.
     * Some institutes have { setting: { WHATSAPP_SETTING: ... } }
     * Others have { WHATSAPP_SETTING: ... } directly
     */
    private JsonNode normalizeRoot(JsonNode root) {
        if (root == null) {
            return objectMapper.createObjectNode();
        }

        // Check if root has "setting" wrapper
        if (root.has("setting")) {
            return root.get("setting");
        }

        // Check if root has direct "WHATSAPP_SETTING"
        if (root.has("WHATSAPP_SETTING")) {
            return root;
        }

        // Return as-is and let downstream handle missing nodes
        return root;
    }

    /**
     * Extract and normalize WATI credentials.
     * Input may have: { wati: { apiKey, apiUrl, whatsappNumber } }
     * Output: { apiKey, apiUrl, whatsappNumber } (flat structure for provider)
     */
    private JsonNode extractWatiCredentials(JsonNode utilityNode) {
        ObjectNode result = objectMapper.createObjectNode();

        if (utilityNode.has("wati")) {
            JsonNode watiNode = utilityNode.get("wati");
            result.put("apiKey", watiNode.path("apiKey").asText(watiNode.path("api_key").asText("")));
            result.put("apiUrl",
                    watiNode.path("apiUrl").asText(watiNode.path("api_url").asText("https://live-server.wati.io")));
            result.put("whatsappNumber",
                    watiNode.path("whatsappNumber").asText(watiNode.path("whatsapp_number").asText("")));
        } else {
            // Fallback: credentials at root level
            result.put("apiKey", utilityNode.path("apiKey").asText(utilityNode.path("api_key").asText("")));
            result.put("apiUrl", utilityNode.path("apiUrl")
                    .asText(utilityNode.path("api_url").asText("https://live-server.wati.io")));
            result.put("whatsappNumber",
                    utilityNode.path("whatsappNumber").asText(utilityNode.path("whatsapp_number").asText("")));
        }

        return result;
    }

    /**
     * Extract and normalize Meta credentials.
     * Input may have: { meta: { accessToken, appId/phoneNumberId } }
     * Output: { accessToken, phoneNumberId } (flat structure for provider)
     */
    private JsonNode extractMetaCredentials(JsonNode utilityNode) {
        ObjectNode result = objectMapper.createObjectNode();

        if (utilityNode.has("meta")) {
            JsonNode metaNode = utilityNode.get("meta");
            result.put("accessToken", metaNode.path("accessToken").asText(metaNode.path("access_token").asText("")));
            result.put("phoneNumberId", metaNode.path("appId")
                    .asText(metaNode.path("phone_number_id").asText(metaNode.path("phoneNumberId").asText(""))));
        } else {
            // Fallback: credentials at root level (legacy format)
            result.put("accessToken",
                    utilityNode.path("accessToken").asText(utilityNode.path("access_token").asText("")));
            result.put("phoneNumberId", utilityNode.path("appId")
                    .asText(utilityNode.path("phone_number_id").asText(utilityNode.path("phoneNumberId").asText(""))));
        }

        return result;
    }
}
