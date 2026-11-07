package vacademy.io.assessment_service.features.assessment.audit;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletRequest;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.HashMap;
import java.util.Map;

/**
 * Reports admin actions on assessments to admin_core's activity log, so
 * "who created / edited / deleted this paper" is answered on the same
 * Activity Logs page as courses and learners. The audit table lives in
 * admin_core_service; this service has no @Auditable aspect of its own.
 *
 * Fire-and-forget: the row is posted off the request thread and every
 * failure is logged and swallowed. An audit hiccup must never fail or slow
 * the teacher's save. The request context (IP, user-agent, URL) is captured
 * on the caller's thread because it is gone by the time the async runs.
 */
@Service
@Slf4j
public class AssessmentAuditClient {

    public static final String ENTITY_ASSESSMENT = "ASSESSMENT";
    public static final String ACTION_CREATE = "CREATE";
    public static final String ACTION_UPDATE = "UPDATE";
    public static final String ACTION_DELETE = "DELETE";
    public static final String ACTION_PUBLISH = "PUBLISH";
    public static final String ACTION_EDIT_QUESTION = "EDIT_QUESTION";

    private final AssessmentAuditSender sender;
    private final ObjectMapper objectMapper;

    // The @Async hop lives in a separate bean on purpose: calling an @Async
    // method on `this` bypasses the Spring proxy and runs it inline, on the
    // teacher's request thread, with the HTTP round-trip to admin_core.
    public AssessmentAuditClient(AssessmentAuditSender sender, ObjectMapper objectMapper) {
        this.sender = sender;
        this.objectMapper = objectMapper;
    }

    /**
     * Record one action. Call AFTER the business change committed; nothing
     * here can undo it, so a failed save must not be reported as done.
     *
     * @param payload what the admin sent (or a small summary); serialised as JSON
     */
    public void record(CustomUserDetails user, String instituteId, String action, String assessmentId,
                       String description, Object payload) {
        try {
            Map<String, Object> body = new HashMap<>();
            body.put("institute_id", instituteId);
            body.put("actor_id", user != null ? user.getUserId() : null);
            body.put("actor_name", user != null ? user.getFullName() : null);
            body.put("actor_email", user != null ? user.getUsername() : null);
            body.put("entity_type", ENTITY_ASSESSMENT);
            body.put("entity_id", assessmentId);
            body.put("action", action);
            body.put("description", description);
            body.put("request_payload", payload == null ? null : objectMapper.valueToTree(payload));
            HttpServletRequest request = currentRequest();
            if (request != null) {
                body.put("http_method", request.getMethod());
                body.put("endpoint", request.getRequestURI());
                body.put("ip_address", clientIp(request));
                body.put("user_agent", request.getHeader("User-Agent"));
            }
            body.put("response_status", 200);
            sender.send(body);
        } catch (Exception e) {
            log.warn("assessment audit not recorded ({} {}): {}", action, assessmentId, e.getMessage());
        }
    }

    private static HttpServletRequest currentRequest() {
        try {
            var attrs = RequestContextHolder.getRequestAttributes();
            return attrs instanceof ServletRequestAttributes sra ? sra.getRequest() : null;
        } catch (Exception e) {
            return null;
        }
    }

    private static String clientIp(HttpServletRequest request) {
        String forwarded = request.getHeader("X-Forwarded-For");
        if (forwarded != null && !forwarded.isBlank()) {
            return forwarded.split(",")[0].trim();
        }
        return request.getRemoteAddr();
    }
}
