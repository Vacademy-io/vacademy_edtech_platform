package vacademy.io.admin_core_service.features.classroom.notify;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClientResponseException;
import vacademy.io.common.core.internal_api_wrapper.InternalClientUtils;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Sends one classroom WhatsApp message through notification_service's internal,
 * HMAC-signed endpoint. notification_service holds the template and the sending
 * account; this side only supplies the recipient and the variables.
 *
 * notification_service answers 404 while its own switch
 * ({@code classroom.whatsapp.enabled}) is off and 503 while the template for the
 * message is not configured. Both are reported as {@link Outcome#UNAVAILABLE}:
 * nothing could be sent to anyone, so the caller may offer the notice again
 * later. Any other failure is {@link Outcome#FAILED}. Nothing is ever thrown.
 */
@Component
@Slf4j
public class ClassroomWhatsAppClient {

    static final String ROUTE = "/notification-service/internal/v1/classroom/whatsapp-summary";

    /** Message kinds understood by notification_service. */
    public static final String KIND_WEEKLY_SUMMARY = "WEEKLY_SUMMARY";
    public static final String KIND_ALERTS = "ALERTS";

    /** SENT: accepted. UNAVAILABLE: the channel is off or not set up. FAILED: tried and refused. */
    public enum Outcome { SENT, UNAVAILABLE, FAILED, NO_ADDRESS }

    private final InternalClientUtils internalClientUtils;
    private final String notificationBaseUrl;
    private final String clientName;

    @Autowired
    public ClassroomWhatsAppClient(
            InternalClientUtils internalClientUtils,
            @Value("${notification.server.baseurl:http://notification-service:8076}") String notificationBaseUrl,
            @Value("${spring.application.name:admin_core_service}") String clientName) {
        this.internalClientUtils = internalClientUtils;
        this.notificationBaseUrl = notificationBaseUrl;
        this.clientName = clientName;
    }

    /** phone must already carry its country code (see ClassroomNotifyService). */
    public Outcome send(String kind, String phone, String instituteName, Map<String, String> variables) {
        if (phone == null || phone.isBlank()) return Outcome.NO_ADDRESS;
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("kind", kind);
        body.put("phone", phone.trim());
        body.put("institute_name", instituteName == null ? "" : instituteName);
        body.put("variables", variables == null ? Map.of() : variables);
        try {
            ResponseEntity<String> response = internalClientUtils.makeHmacRequest(
                    clientName, "POST", notificationBaseUrl, ROUTE, body);
            if (response != null && response.getStatusCode().is2xxSuccessful()) return Outcome.SENT;
            int status = response == null ? 0 : response.getStatusCode().value();
            log.warn("[classroom] WhatsApp {} not sent: status {}", kind, status);
            return outcomeOf(status);
        } catch (RestClientResponseException e) {
            log.warn("[classroom] WhatsApp {} not sent: status {}", kind, e.getStatusCode().value());
            return outcomeOf(e.getStatusCode().value());
        } catch (Exception e) {
            // No phone number in the log line.
            log.warn("[classroom] WhatsApp {} not sent: {}", kind, e.getMessage());
            return Outcome.FAILED;
        }
    }

    static Outcome outcomeOf(int status) {
        return status == 404 || status == 503 ? Outcome.UNAVAILABLE : Outcome.FAILED;
    }
}
