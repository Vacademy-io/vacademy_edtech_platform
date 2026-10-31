package vacademy.io.admin_core_service.features.institute_api.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.web.context.request.RequestAttributes;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import vacademy.io.admin_core_service.features.admin_activity_logs.entity.AdminActivityLog;
import vacademy.io.admin_core_service.features.admin_activity_logs.repository.AdminActivityLogRepository;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.Map;

/**
 * Writes API-key and API-access changes to admin_activity_log (spec 6.3, T1.5).
 *
 * <p>Not the {@code @Auditable} aspect: that one takes the institute from the clientId
 * header, which for the super-admin endpoints is the portal's own institute, not the
 * institute being changed. Here the institute is explicit. The row is saved in the
 * caller's transaction, so it exists if and only if the change committed.
 *
 * <p>Never pass a plaintext key in {@code payload}; callers pass the prefix only.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class InstituteApiAuditWriter {

    public static final String ENTITY_API_KEY = "INSTITUTE_API_KEY";
    public static final String ENTITY_API_ACCESS = "INSTITUTE_API_ACCESS";
    /** An approved website of the Catalogue API (institute_website). */
    public static final String ENTITY_WEBSITE = "INSTITUTE_WEBSITE";

    private static final ObjectMapper MAPPER = new ObjectMapper()
            .registerModule(new JavaTimeModule())
            .disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);

    private final AdminActivityLogRepository repository;

    public void record(String instituteId,
                       CustomUserDetails actor,
                       String entityType,
                       String entityId,
                       String action,
                       String description,
                       Map<String, Object> payload,
                       Map<String, Object> before) {
        AdminActivityLog.AdminActivityLogBuilder row = AdminActivityLog.builder()
                .instituteId(instituteId)
                .actorId(actor == null ? null : actor.getUserId())
                .actorName(actor == null ? null : actor.getFullName())
                .actorEmail(actor == null ? null : actor.getUsername())
                .entityType(entityType)
                .entityId(entityId)
                .action(action)
                .description(description)
                .requestPayload(json(payload))
                .beforePayload(json(before))
                .responseStatus(200);
        HttpServletRequest request = currentRequest();
        if (request != null) {
            row.httpMethod(request.getMethod())
                    .endpoint(truncate(request.getRequestURI(), 512))
                    .ipAddress(truncate(clientIp(request), 64))
                    .userAgent(truncate(request.getHeader("User-Agent"), 512));
        }
        repository.save(row.build());
    }

    /**
     * A change made through a public API key rather than a signed-in user: the actor is
     * {@code api:<keyId>} (no user exists behind a key). Same row shape as {@link #record}.
     */
    public void recordApi(String instituteId,
                          String keyId,
                          String entityType,
                          String entityId,
                          String action,
                          String description,
                          Map<String, Object> payload,
                          Map<String, Object> before) {
        AdminActivityLog.AdminActivityLogBuilder row = AdminActivityLog.builder()
                .instituteId(instituteId)
                .actorId(truncate("api:" + keyId, 255))
                .actorName("API key")
                .entityType(entityType)
                .entityId(truncate(entityId, 255))
                .action(truncate(action, 64))
                .description(description)
                .requestPayload(json(payload))
                .beforePayload(json(before))
                .responseStatus(200);
        HttpServletRequest request = currentRequest();
        if (request != null) {
            row.httpMethod(request.getMethod())
                    .endpoint(truncate(request.getRequestURI(), 512))
                    .ipAddress(truncate(clientIp(request), 64))
                    .userAgent(truncate(request.getHeader("User-Agent"), 512));
        }
        repository.save(row.build());
    }

    private static String json(Map<String, Object> value) {
        if (value == null) {
            return null;
        }
        try {
            return MAPPER.writeValueAsString(value);
        } catch (Exception e) {
            log.warn("institute-api audit: payload not serialisable: {}", e.getMessage());
            return null;
        }
    }

    private static HttpServletRequest currentRequest() {
        RequestAttributes attrs = RequestContextHolder.getRequestAttributes();
        return attrs instanceof ServletRequestAttributes servlet ? servlet.getRequest() : null;
    }

    private static String clientIp(HttpServletRequest request) {
        String forwarded = request.getHeader("X-Forwarded-For");
        if (forwarded != null && !forwarded.isBlank()) {
            return forwarded.split(",")[0].trim();
        }
        String real = request.getHeader("X-Real-IP");
        if (real != null && !real.isBlank()) {
            return real;
        }
        return request.getRemoteAddr();
    }

    private static String truncate(String s, int max) {
        if (s == null) {
            return null;
        }
        return s.length() <= max ? s : s.substring(0, max);
    }
}
