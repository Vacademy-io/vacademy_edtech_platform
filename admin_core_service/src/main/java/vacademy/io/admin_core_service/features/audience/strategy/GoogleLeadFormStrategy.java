package vacademy.io.admin_core_service.features.audience.strategy;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.audience.dto.NormalizedLeadData;
import vacademy.io.admin_core_service.features.audience.dto.OAuthTokenResult;
import vacademy.io.admin_core_service.features.audience.dto.PlatformFormField;
import vacademy.io.admin_core_service.features.audience.dto.WebhookSubscriptionResult;
import vacademy.io.admin_core_service.features.audience.entity.FormWebhookConnector;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;

/**
 * Ad platform strategy for Google Lead Form Extensions.
 *
 * Authentication: no OAuth. Each connector has a server-generated random key (stored as
 * {@code vendor_id}) that the admin pastes into BOTH Google Ads fields — it is in the
 * webhook URL path and Google echoes it back as {@code google_key} in the body:
 *   POST /admin-core-service/api/v1/webhook/google/{googleKey}
 * The webhook is accepted only when the URL key names an active connector AND the body's
 * google_key equals it (see {@link #googleKeyMatches}).
 *
 * Google Ads sends the full lead payload in one POST, so no secondary API call needed.
 *
 * Payload format (https://developers.google.com/google-ads/webhook/docs/implementation):
 * {
 *   "lead_id": "...",            unique across all forms — the dedup key
 *   "google_key": "...",
 *   "api_version": "1.0",
 *   "form_id": 40000000000,      8-byte integers, NOT strings
 *   "campaign_id": 50000000000,
 *   "adgroup_id": 20000000000,   video / discovery ads only
 *   "creative_id": 30000000000,  video / discovery ads only
 *   "asset_group_id": 0,         Performance Max only
 *   "gcl_id": "...",
 *   "lead_submit_time": "2024-09-26T12:30:00Z",
 *   "user_column_data": [
 *     {"column_id": "FULL_NAME", "string_value": "John Doe"},
 *     {"column_id": "EMAIL",     "string_value": "john@example.com"},
 *     {"column_id": "PHONE_NUMBER", "string_value": "+91..."}
 *   ],
 *   "is_test": false
 * }
 * Google never sends the campaign NAME — only its id.
 *
 * Expected response: 200 {} on success; 4XX {"message"} is NOT retried, 5XX is retried.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class GoogleLeadFormStrategy implements AdPlatformStrategy {

    private static final String VENDOR_CODE = "GOOGLE_LEAD_ADS";

    /** Top-level payload ids kept on the lead as ad context, in Google's own key names. */
    private static final List<String> AD_CONTEXT_KEYS = List.of(
            "campaign_id", "form_id", "adgroup_id", "creative_id", "asset_group_id", "gcl_id");

    private final ObjectMapper objectMapper;

    @Override
    public String getVendorCode() {
        return VENDOR_CODE;
    }

    // ── Webhook verification ─────────────────────────────────────────────────

    @Override
    public boolean verifyWebhookSignature(String signatureHeader, String rawBody) {
        // Google Lead Form Extensions have no payload signature. Authentication is the
        // connector key: URL lookup + googleKeyMatches(), both done by the caller.
        return true;
    }

    /**
     * True when the payload's {@code google_key} equals the connector's key. Google
     * echoes back the Key configured on the lead form, so this proves the sender knows
     * the key and not only the URL. Constant-time compare; a missing key never matches.
     */
    public boolean googleKeyMatches(JsonNode root, String expectedKey) {
        String sent = text(root, "google_key");
        if (sent == null || expectedKey == null) return false;
        return MessageDigest.isEqual(
                sent.getBytes(StandardCharsets.UTF_8), expectedKey.getBytes(StandardCharsets.UTF_8));
    }

    @Override
    public Optional<String> handleVerificationChallenge(Map<String, String> queryParams,
            String verifyToken) {
        // Google Lead Forms don't use a hub-challenge pattern. No GET verification needed.
        return Optional.empty();
    }

    // ── Lead extraction ──────────────────────────────────────────────────────

    @Override
    public List<NormalizedLeadData> extractAndFetchLeads(String rawBody,
            FormWebhookConnector connector) {
        try {
            JsonNode root = objectMapper.readTree(rawBody);

            boolean isTest = root.path("is_test").asBoolean(false);
            String leadId = text(root, "lead_id");

            // Parse user_column_data into a flat map
            Map<String, String> rawFields = new LinkedHashMap<>();
            for (JsonNode col : root.path("user_column_data")) {
                String columnId = col.path("column_id").asText(null);
                String value = col.path("string_value").asText(null);
                if (columnId != null && value != null) {
                    // Normalize Google standard column IDs to common keys
                    rawFields.put(normalizeGoogleKey(columnId), value);
                }
            }

            // Ad context: which campaign / form / ad group / creative produced the lead.
            // Google sends the ids as JSON integers; text() reads them as strings.
            Map<String, String> adContext = new LinkedHashMap<>();
            for (String key : AD_CONTEXT_KEYS) {
                String value = text(root, key);
                // An unpopulated id can arrive as 0 rather than be omitted.
                if (value != null && !"0".equals(value)) adContext.put(key, value);
            }
            rawFields.putAll(adContext);

            // Extract standard fields from raw (before mapping changes keys)
            String rawEmail = rawFields.get("email");
            String rawPhone = rawFields.get("phone_number");
            String rawName = rawFields.get("full_name");

            // Apply field mapping from connector config
            Map<String, String> mappedFields = applyFieldMapping(rawFields, connector.getFieldMappingJson());
            // A DISCARD-unmapped mapping must not strip the ad context: routing rules key
            // on campaign_id, and a custom field named e.g. "gcl_id" should still fill.
            adContext.forEach(mappedFields::putIfAbsent);

            String campaignId = adContext.get("campaign_id");
            NormalizedLeadData lead = NormalizedLeadData.builder()
                    .platformLeadId(leadId)
                    .fields(mappedFields)
                    .email(rawEmail)
                    .phone(rawPhone)
                    .fullName(rawName)
                    .sourceType("GOOGLE_ADS")
                    .targetAudienceId(connector.getAudienceId())
                    .testLead(isTest)
                    .campaignId(campaignId)
                    .utmParams(buildUtmParams(campaignId, adContext))
                    .build();

            return List.of(lead);
        } catch (Exception e) {
            log.error("Failed to parse Google lead webhook payload", e);
            return List.of();
        }
    }

    // ── OAuth flow — not applicable for Google Lead Forms ────────────────────

    @Override
    public String buildOAuthUrl(String stateToken, String redirectUri) {
        throw new UnsupportedOperationException(
                "Google Lead Form Extensions use a static key, not OAuth");
    }

    @Override
    public OAuthTokenResult exchangeCodeForToken(String code, String redirectUri) {
        throw new UnsupportedOperationException(
                "Google Lead Form Extensions use a static key, not OAuth");
    }

    @Override
    public List<Map<String, String>> listConnectableAccounts(String accessToken) {
        return List.of();
    }

    @Override
    public List<PlatformFormField> fetchFormFields(String formId, String accessToken) {
        // Google Lead Form field definitions are not queryable via API;
        // admins configure field mapping manually from the form preview.
        return List.of(
                PlatformFormField.builder().key("FULL_NAME").label("Full Name").type("TEXT").standardField(true).build(),
                PlatformFormField.builder().key("EMAIL").label("Email").type("EMAIL").standardField(true).build(),
                PlatformFormField.builder().key("PHONE_NUMBER").label("Phone Number").type("PHONE").standardField(true).build(),
                PlatformFormField.builder().key("POSTAL_CODE").label("Postal Code").type("TEXT").standardField(true).build(),
                PlatformFormField.builder().key("CITY").label("City").type("TEXT").standardField(true).build()
        );
    }

    @Override
    public WebhookSubscriptionResult subscribePageToWebhooks(FormWebhookConnector connector, String decryptedToken) {
        // No subscription step for Google — webhook URL is pasted directly in Google Ads UI
        log.info("Google Lead Forms connector {} configured. Webhook URL must be set in Google Ads UI.", connector.getId());
        return WebhookSubscriptionResult.ok();
    }

    @Override
    public Optional<OAuthTokenResult> refreshToken(FormWebhookConnector connector,
            String decryptedCurrentToken) {
        // Static keys don't expire
        return Optional.empty();
    }

    // ── Attribution ──────────────────────────────────────────────────────────

    /**
     * UTM touch for a Google lead, so it shows up beside the institute's tagged links in
     * the leads table and the campaign report. utm_campaign is the campaign ID — Google
     * never sends the name. utm_content is the ad group (video/discovery) or, for
     * Performance Max, the asset group. Empty when Google sent no campaign.
     */
    private Map<String, String> buildUtmParams(String campaignId, Map<String, String> adContext) {
        if (campaignId == null) return Map.of();
        Map<String, String> utm = new LinkedHashMap<>();
        utm.put("utm_source", "google");
        utm.put("utm_medium", "lead_form");
        utm.put("utm_campaign", campaignId);
        String content = adContext.getOrDefault("adgroup_id", adContext.get("asset_group_id"));
        if (content != null) utm.put("utm_content", content);
        return utm;
    }

    /** Field as text — numbers included — or null when missing, JSON null or blank. */
    private static String text(JsonNode root, String field) {
        JsonNode node = root.path(field);
        if (node.isMissingNode() || node.isNull()) return null;
        String value = node.asText();
        return value == null || value.isBlank() ? null : value.trim();
    }

    // ── Field mapping ────────────────────────────────────────────────────────

    /**
     * Normalize Google's upper-case column IDs to lowercase common keys.
     * FULL_NAME → full_name, EMAIL → email, PHONE_NUMBER → phone_number, etc.
     * Custom questions are left as-is (already lowercase in Google's payload).
     */
    private String normalizeGoogleKey(String columnId) {
        return switch (columnId) {
            case "FULL_NAME" -> "full_name";
            case "EMAIL" -> "email";
            case "PHONE_NUMBER" -> "phone_number";
            case "POSTAL_CODE" -> "postal_code";
            case "CITY" -> "city";
            case "COUNTRY" -> "country";
            case "COMPANY_NAME" -> "company_name";
            case "JOB_TITLE" -> "job_title";
            default -> columnId.toLowerCase();
        };
    }

    private Map<String, String> applyFieldMapping(Map<String, String> rawFields,
            String fieldMappingJson) {
        if (fieldMappingJson == null || fieldMappingJson.isBlank()) return rawFields;

        try {
            JsonNode mappingRoot = objectMapper.readTree(fieldMappingJson);
            JsonNode mappings = mappingRoot.path("mappings");
            Map<String, String> result = new LinkedHashMap<>();

            for (JsonNode mapping : mappings) {
                String platformKey = mapping.path("platform_key").asText(null);
                String target = mapping.path("target").asText(null);
                if (platformKey == null || target == null) continue;

                String value = rawFields.get(platformKey);
                if (value == null) continue;

                if (target.startsWith("STANDARD:")) {
                    result.put(target.substring("STANDARD:".length()), value);
                } else if (target.startsWith("CUSTOM:")) {
                    result.put(target.substring("CUSTOM:".length()), value);
                } else {
                    result.put(target, value);
                }
            }

            String action = mappingRoot.path("unmapped_field_action").asText("DISCARD");
            if (!"DISCARD".equals(action)) {
                for (Map.Entry<String, String> e : rawFields.entrySet()) {
                    result.putIfAbsent(e.getKey(), e.getValue());
                }
            }
            return result;
        } catch (Exception e) {
            log.error("Failed to apply field mapping, using raw fields", e);
            return rawFields;
        }
    }
}
