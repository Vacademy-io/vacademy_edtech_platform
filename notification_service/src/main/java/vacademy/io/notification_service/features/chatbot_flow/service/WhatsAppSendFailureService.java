package vacademy.io.notification_service.features.chatbot_flow.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import vacademy.io.notification_service.features.notification_log.entity.NotificationLog;
import vacademy.io.notification_service.features.notification_log.repository.NotificationLogRepository;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Records a WhatsApp message that we tried to send and the provider refused.
 *
 * <p>Until now a rejected send left no trace anywhere the admin could see it — the provider
 * exception was logged and the conversation simply had a gap where the reply should be. This
 * writes the attempt to {@code notification_log} as a normal OUTGOING row (so it lands in the
 * conversation at the right point in time) with a {@code message_payload} that marks it FAILED:
 *
 * <pre>{"deliveryStatus":"FAILED","error":"...","attemptedType":"text"}</pre>
 *
 * <p>{@code WhatsAppInboxService} reads that marker and the Inbox renders the bubble as
 * <b>Not delivered</b>, with the conversation row flagged so it is visible without opening it.
 * The shape deliberately matches the {@code deliveryStatus}/{@code error} keys the template
 * renderer already produces, so the UI has exactly one failure contract to handle.
 */
@Service
@Slf4j
@RequiredArgsConstructor
public class WhatsAppSendFailureService {

    /** notification_log marker read back by the Inbox for non-template send failures. */
    public static final String FAILED_STATUS = "FAILED";

    /**
     * SQL LIKE pattern matching the marker inside message_payload. Passed as a bind parameter (not
     * inlined into the query text) so the JSON colon can never be read as a named parameter.
     */
    public static final String FAILED_PAYLOAD_LIKE = "%\"deliveryStatus\":\"" + FAILED_STATUS + "\"%";

    private final NotificationLogRepository notificationLogRepository;
    private final ObjectMapper objectMapper;

    /**
     * Log one rejected send. Never throws — the caller is already on a failure path and a second
     * exception there would mask the original one.
     *
     * @param attemptedType text | interactive | media | template — what we tried to send
     * @param body          the message text we tried to deliver (or a short description)
     * @param source        who was sending: CHATBOT_FLOW, INBOX, ENGAGEMENT_ENGINE, ...
     */
    public void logFailure(String instituteId, String phone, String businessChannelId, String userId,
                           String attemptedType, String body, String source, String error) {
        logFailure(instituteId, phone, businessChannelId, userId, attemptedType, body, source, error, null);
    }

    /**
     * As above, plus caller-supplied fields merged into the stored payload.
     * <p>
     * A refused media send uses this to keep {@code mediaType} / {@code mediaUrl} on the row, so the
     * failed bubble can still show which image the admin tried to send instead of an empty box.
     * The failure markers win on a key clash — the reason a row exists must not be overwritable.
     */
    public void logFailure(String instituteId, String phone, String businessChannelId, String userId,
                           String attemptedType, String body, String source, String error,
                           Map<String, Object> extraPayload) {
        if (phone == null || phone.isBlank()) return;
        try {
            Map<String, Object> payload = new LinkedHashMap<>();
            if (extraPayload != null) payload.putAll(extraPayload);
            payload.put("deliveryStatus", FAILED_STATUS);
            payload.put("error", truncate(error, 1000));
            payload.put("attemptedType", attemptedType != null ? attemptedType : "text");

            NotificationLog failedLog = new NotificationLog();
            failedLog.setNotificationType("WHATSAPP_MESSAGE_OUTGOING");
            failedLog.setChannelId(phone);
            failedLog.setBody(body);
            failedLog.setSource(source != null ? source : "CHATBOT_FLOW");
            failedLog.setSenderBusinessChannelId(businessChannelId);
            failedLog.setInstituteId(instituteId);
            failedLog.setUserId(userId);
            failedLog.setNotificationDate(Instant.now());
            failedLog.setMessagePayload(objectMapper.writeValueAsString(payload));

            notificationLogRepository.save(failedLog);
            log.info("Logged failed WhatsApp send: phone={}, type={}, source={}, error={}",
                    phone, attemptedType, source, truncate(error, 200));
        } catch (Exception e) {
            log.warn("Could not log failed WhatsApp send for phone={}: {}", phone, e.getMessage());
        }
    }

    private String truncate(String s, int max) {
        if (s == null) return null;
        return s.length() <= max ? s : s.substring(0, max) + "...";
    }
}
