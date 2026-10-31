package vacademy.io.admin_core_service.features.engagement.report;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpMethod;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Component;
import vacademy.io.common.core.internal_api_wrapper.InternalClientUtils;

import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Map;

/**
 * What happened to the engines' messages after they left: delivery, opens, bounces, WhatsApp
 * pricing and the first reply, from notification_service
 * (POST /notification-service/internal/v1/engagement/report-signals, design §5.2), keyed by the
 * engagement action id (the notification_log correlation id).
 *
 * <p>THROWS on any failure, never "no data": the report then marks delivery and replies as
 * unavailable instead of showing zero replies.
 */
@Component
@Slf4j
public class EngagementReportSignalsClient {

    static final String ROUTE = "/notification-service/internal/v1/engagement/report-signals";
    /**
     * Ids per call; the endpoint refuses more than 2000 and runs each call under its own 8s statement
     * timeout, so a long period's thousands of actions go in calls of this many, one after another.
     */
    static final int CHUNK = 1000;

    @Autowired
    private InternalClientUtils internalClientUtils;

    private final ObjectMapper objectMapper = new ObjectMapper();

    @Value("${spring.application.name}")
    private String clientName;

    @Value("${notification.server.baseurl}")
    private String notificationServerBaseUrl;

    /**
     * One action's message, as notification_service saw it. Times are epoch ms. subject is the email
     * subject actually sent (EMAIL only). templateCategory comes upper case (MARKETING),
     * pricingCategory in Meta's lower case. An action with no outgoing notification row (in-app,
     * tasks) is simply absent from the response: no signal, not a failure.
     */
    public record Signal(String channel, String recipient, Long sentAt, String subject,
                         String deliveryStatus, String deliveryErrorCode, String provider,
                         String templateName, String templateLanguage, String templateCategory,
                         String pricingType, String pricingCategory, Boolean pricingBillable, String pricingModel,
                         boolean delivered, boolean opened, boolean clicked, boolean bounced, boolean complained,
                         boolean emailTracked, Long firstReplyAt) {
    }

    public record Signals(boolean inboundEmailEnabled, Map<String, Signal> byActionId) {
    }

    public Signals fetch(String instituteId, List<String> actionIds, int replyWindowHours) {
        Map<String, Signal> out = new HashMap<>();
        boolean inboundEmail = false;
        for (int i = 0; i < actionIds.size(); i += CHUNK) {
            List<String> chunk = actionIds.subList(i, Math.min(actionIds.size(), i + CHUNK));
            Map<String, Object> body = new HashMap<>();
            body.put("instituteId", instituteId);
            body.put("actionIds", chunk);
            body.put("replyWindowHours", replyWindowHours);
            JsonNode root = post(body);
            inboundEmail |= root.path("inboundEmailEnabled").asBoolean(false);
            JsonNode actions = root.path("actions");
            Iterator<Map.Entry<String, JsonNode>> fields = actions.fields();
            while (fields.hasNext()) {
                Map.Entry<String, JsonNode> f = fields.next();
                out.put(f.getKey(), parse(f.getValue()));
            }
        }
        return new Signals(inboundEmail, out);
    }

    private static Signal parse(JsonNode n) {
        JsonNode ev = n.path("emailEvents");
        return new Signal(
                text(n, "channel"), text(n, "recipient"), epoch(n, "sentAt"), text(n, "subject"),
                text(n, "deliveryStatus"), text(n, "deliveryErrorCode"), text(n, "provider"),
                text(n, "templateName"), text(n, "templateLanguage"), text(n, "templateCategory"),
                text(n, "pricingType"), text(n, "pricingCategory"), bool(n, "pricingBillable"), text(n, "pricingModel"),
                ev.path("delivered").asBoolean(false), ev.path("opened").asBoolean(false),
                ev.path("clicked").asBoolean(false), ev.path("bounced").asBoolean(false),
                ev.path("complained").asBoolean(false),
                n.path("emailTracked").asBoolean(false), epoch(n, "firstReplyAt"));
    }

    private static String text(JsonNode n, String field) {
        JsonNode v = n.get(field);
        if (v == null || v.isNull() || v.isMissingNode()) return null;
        String s = v.asText();
        return s == null || s.isBlank() || "null".equals(s) ? null : s;
    }

    private static Long epoch(JsonNode n, String field) {
        JsonNode v = n.get(field);
        return v == null || v.isNull() || !v.isNumber() ? null : v.asLong();
    }

    private static Boolean bool(JsonNode n, String field) {
        JsonNode v = n.get(field);
        return v == null || v.isNull() || !v.isBoolean() ? null : v.asBoolean();
    }

    private JsonNode post(Object body) {
        try {
            ResponseEntity<String> response = internalClientUtils.makeHmacRequest(
                    clientName, HttpMethod.POST.name(), notificationServerBaseUrl, ROUTE, body);
            if (response == null || !response.getStatusCode().is2xxSuccessful() || response.getBody() == null) {
                throw new IllegalStateException("report-signals returned "
                        + (response != null ? response.getStatusCode() : "null response"));
            }
            return objectMapper.readTree(response.getBody());
        } catch (Exception e) {
            throw new IllegalStateException("Engagement internal call failed: report-signals — " + e.getMessage(), e);
        }
    }
}
