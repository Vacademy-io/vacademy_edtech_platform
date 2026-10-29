package vacademy.io.admin_core_service.features.engagement.client;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpMethod;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Component;
import vacademy.io.common.core.internal_api_wrapper.InternalClientUtils;

import java.util.List;
import java.util.Map;

/**
 * The engagement feature's HMAC calls to sibling services, in one place. Every method THROWS
 * on failure — providers must defer, never fabricate "no data" (this codebase's catch→empty
 * pathology is what turns a sibling-service outage into "this learner ignored us").
 *
 * Endpoints (all batched — one call per cohort):
 * - notification_service POST /internal/v1/engagement/ledger-batch          (Phase 0)
 * - assessment_service   POST /internal/student-analysis/assessment-history/batch
 * - auth_service         POST /internal/v1/analytics/student-login-stats/batch
 */
@Component
@Slf4j
public class EngagementInternalClients {

    @Autowired
    private InternalClientUtils internalClientUtils;

    private final ObjectMapper objectMapper = new ObjectMapper();

    @Value("${spring.application.name}")
    private String clientName;

    @Value("${notification.server.baseurl}")
    private String notificationServerBaseUrl;

    @Value("${assessment.server.baseurl}")
    private String assessmentServerBaseUrl;

    @Value("${auth.server.baseurl}")
    private String authServerBaseUrl;

    /** subjects: [{key(memberId), userId?, phone?, email?}] → LedgerBatchResponse JSON. */
    public JsonNode ledgerBatch(String instituteId, List<Map<String, String>> subjects, int recentWindowDays) {
        return ledgerBatch(instituteId, subjects, recentWindowDays, null);
    }

    /** contactWindowDays (B5): also return each subject's cross-system contact count for that window. */
    public JsonNode ledgerBatch(String instituteId, List<Map<String, String>> subjects, int recentWindowDays,
                                Integer contactWindowDays) {
        Map<String, Object> body = new java.util.HashMap<>(Map.of(
                "instituteId", instituteId,
                "recentWindowDays", recentWindowDays,
                "subjects", subjects));
        if (contactWindowDays != null) body.put("contactWindowDays", contactWindowDays);
        return post(notificationServerBaseUrl,
                "/notification-service/internal/v1/engagement/ledger-batch", body, "ledger-batch");
    }

    public JsonNode assessmentHistoryBatch(String instituteId, List<String> userIds, int sinceDays) {
        Map<String, Object> body = Map.of(
                "instituteId", instituteId,
                "userIds", userIds,
                "sinceDays", sinceDays);
        return post(assessmentServerBaseUrl,
                "/assessment-service/internal/student-analysis/assessment-history/batch", body, "assessment-batch");
    }

    public JsonNode loginStatsBatch(List<String> userIds, int sinceDays) {
        Map<String, Object> body = Map.of(
                "userIds", userIds,
                "sinceDays", sinceDays);
        return post(authServerBaseUrl,
                "/auth-service/internal/v1/analytics/student-login-stats/batch", body, "login-stats-batch");
    }

    /**
     * Recent inbound WhatsApp replies for an institute since a cursor (reply-ingestion sweep).
     * {@code sinceEpochMillis} is sent as plain digits — NOT an ISO string: makeHmacRequest runs
     * the route through UriComponentsBuilder, which re-encodes, so an ISO timestamp's ':' would
     * become %253A and the server's Instant.parse would 400 → the whole sweep silently no-ops.
     * instituteId is a UUID (URL-safe), so no encoding is needed on it either.
     */
    public JsonNode inboundSince(String instituteId, long sinceEpochMillis) {
        try {
            String route = "/notification-service/internal/v1/engagement/inbound-since"
                    + "?instituteId=" + instituteId
                    + "&since=" + sinceEpochMillis
                    // Email replies too (channel=EMAIL rows). An older notification-service ignores
                    // the flag and answers WhatsApp only, so the two can deploy in either order.
                    + "&includeEmail=true";
            ResponseEntity<String> response = internalClientUtils.makeHmacRequest(
                    clientName, HttpMethod.GET.name(), notificationServerBaseUrl, route, null);
            if (response == null || !response.getStatusCode().is2xxSuccessful() || response.getBody() == null) {
                throw new IllegalStateException("inbound-since returned "
                        + (response != null ? response.getStatusCode() : "null response"));
            }
            return objectMapper.readTree(response.getBody());
        } catch (Exception e) {
            throw new IllegalStateException("inbound-since failed: " + e.getMessage(), e);
        }
    }

    // --- D8 WhatsApp template lifecycle (notification_service delegates to WhatsAppTemplateManagerService) ---
    // templateId and instituteId are UUIDs (URL-safe), so the routes need no query encoding.

    private static final String WA_TEMPLATES = "/notification-service/internal/v1/whatsapp-templates";

    /** Create a DRAFT template row at notification_service. body = WhatsAppTemplateDTO shape. */
    public JsonNode createWhatsAppTemplateDraft(Map<String, Object> dto) {
        return exec(HttpMethod.POST.name(), WA_TEMPLATES + "/draft", dto, "wa-template-draft");
    }

    /** Overwrite an existing DRAFT/REJECTED template (edit-then-resubmit path). */
    public JsonNode updateWhatsAppTemplateDraft(String templateId, Map<String, Object> dto) {
        return exec(HttpMethod.PUT.name(), WA_TEMPLATES + "/" + templateId, dto, "wa-template-update");
    }

    /** Submit a DRAFT/REJECTED template to Meta. Returns the post-submit status. */
    public JsonNode submitWhatsAppTemplate(String templateId) {
        return exec(HttpMethod.POST.name(), WA_TEMPLATES + "/" + templateId + "/submit", null, "wa-template-submit");
    }

    /** Read one template's current status/category/rejection. */
    public JsonNode getWhatsAppTemplate(String templateId) {
        return exec(HttpMethod.GET.name(), WA_TEMPLATES + "/" + templateId, null, "wa-template-get");
    }

    /**
     * Look up a template by natural key to adopt an orphaned draft after a lost create response.
     * Returns a node WITHOUT an "id" field ({}) when none exists. name is URL-safe (lowercase/
     * underscore/6-hex from metaName); instituteId is a UUID; language is en|hi — none need encoding.
     */
    public JsonNode getWhatsAppTemplateByName(String instituteId, String name, String language) {
        String route = WA_TEMPLATES + "/by-name?instituteId=" + instituteId
                + "&name=" + name + "&language=" + language;
        return exec(HttpMethod.GET.name(), route, null, "wa-template-by-name");
    }

    /** Poll Meta and refresh all of an institute's template statuses. Returns {synced}. */
    public JsonNode syncWhatsAppTemplates(String instituteId) {
        return exec(HttpMethod.POST.name(), WA_TEMPLATES + "/sync?instituteId=" + instituteId, null, "wa-template-sync");
    }

    private JsonNode exec(String method, String route, Object body, String what) {
        try {
            ResponseEntity<String> response = internalClientUtils.makeHmacRequest(
                    clientName, method, notificationServerBaseUrl, route, body);
            if (response == null || !response.getStatusCode().is2xxSuccessful() || response.getBody() == null) {
                throw new IllegalStateException(what + " returned "
                        + (response != null ? response.getStatusCode() : "null response"));
            }
            return objectMapper.readTree(response.getBody());
        } catch (Exception e) {
            throw new IllegalStateException("Engagement internal call failed: " + what + " — " + e.getMessage(), e);
        }
    }

    /**
     * Send a free-form WhatsApp session reply on behalf of the engine (auto-reply / human-answered
     * escalation). correlationId is the engagement action id → the Phase-0 ledger attributes the send.
     * Legal only inside Meta's 24h window; the caller guarantees it. Returns the response node (wamid).
     */
    public JsonNode sendWhatsAppReply(String instituteId, String phone, String text, String correlationId) {
        Map<String, Object> body = new java.util.HashMap<>();
        body.put("instituteId", instituteId);
        body.put("phone", phone);
        body.put("text", text);
        body.put("correlationId", correlationId);
        return post(notificationServerBaseUrl,
                "/notification-service/internal/v1/engagement/whatsapp-reply", body, "whatsapp-reply");
    }

    /** A assets attachment as a native WhatsApp session media message (image|video|document|audio). */
    public JsonNode sendWhatsAppMedia(String instituteId, String phone, String mediaType, String mediaUrl,
                                      String caption, String filename, String correlationId) {
        Map<String, Object> body = new java.util.HashMap<>();
        body.put("instituteId", instituteId);
        body.put("phone", phone);
        body.put("mediaType", mediaType);
        body.put("mediaUrl", mediaUrl);
        body.put("caption", caption);
        body.put("filename", filename);
        body.put("correlationId", correlationId);
        return post(notificationServerBaseUrl,
                "/notification-service/internal/v1/engagement/whatsapp-media", body, "whatsapp-media");
    }

    private JsonNode post(String baseUrl, String route, Object body, String what) {
        try {
            ResponseEntity<String> response = internalClientUtils.makeHmacRequest(
                    clientName, HttpMethod.POST.name(), baseUrl, route, body);
            if (response == null || !response.getStatusCode().is2xxSuccessful() || response.getBody() == null) {
                throw new IllegalStateException(what + " returned "
                        + (response != null ? response.getStatusCode() : "null response"));
            }
            return objectMapper.readTree(response.getBody());
        } catch (Exception e) {
            // Deliberate rethrow: the DataPointRegistry contract treats provider failure as
            // "defer these members", never as an empty payload.
            throw new IllegalStateException("Engagement internal call failed: " + what + " — " + e.getMessage(), e);
        }
    }
}
