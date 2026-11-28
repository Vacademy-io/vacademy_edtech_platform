package vacademy.io.admin_core_service.features.admin_activity_logs.controller;

import com.fasterxml.jackson.databind.JsonNode;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.features.admin_activity_logs.async.AsyncAuditDispatcher;
import vacademy.io.admin_core_service.features.admin_activity_logs.dto.InternalAuditRecordRequest;
import vacademy.io.admin_core_service.features.admin_activity_logs.entity.AdminActivityLog;

import java.util.Map;

/**
 * Service-to-service entry into admin_activity_log. Guarded by
 * {@code InternalAuthFilter} (HMAC clientName/Signature headers) via the
 * {@code /admin-core-service/internal/**} matcher — never reachable with a
 * user JWT. assessment_service reports assessment create/update/delete/
 * publish and question edits here so that "who changed this paper" has one
 * answer, on the same page as course and learner actions.
 */
@RestController
@RequestMapping("/admin-core-service/internal/audit/v1")
@RequiredArgsConstructor
@Slf4j
public class InternalAuditController {

    private final AsyncAuditDispatcher dispatcher;

    @PostMapping("/record")
    public ResponseEntity<Map<String, Boolean>> record(@RequestBody InternalAuditRecordRequest req) {
        if (isBlank(req.getInstituteId()) || isBlank(req.getEntityType()) || isBlank(req.getAction())) {
            return ResponseEntity.badRequest().body(Map.of("recorded", false));
        }
        AdminActivityLog row = AdminActivityLog.builder()
                .instituteId(req.getInstituteId())
                .actorId(req.getActorId())
                .actorName(req.getActorName())
                .actorEmail(req.getActorEmail())
                .entityType(req.getEntityType().trim().toUpperCase())
                .entityId(req.getEntityId())
                .action(req.getAction().trim().toUpperCase())
                .httpMethod(req.getHttpMethod())
                .endpoint(truncate(req.getEndpoint(), 512))
                .description(req.getDescription())
                .requestPayload(json(req.getRequestPayload()))
                .beforePayload(json(req.getBeforePayload()))
                .ipAddress(truncate(req.getIpAddress(), 64))
                .userAgent(truncate(req.getUserAgent(), 512))
                .responseStatus(req.getResponseStatus())
                .build();
        // Own short transaction, off the request thread: the caller has already
        // committed its business change and must not wait on, or fail with, us.
        dispatcher.dispatch(row);
        return ResponseEntity.ok(Map.of("recorded", true));
    }

    private static String json(JsonNode node) {
        return node == null || node.isNull() ? null : node.toString();
    }

    private static String truncate(String s, int max) {
        if (s == null) return null;
        return s.length() <= max ? s : s.substring(0, max);
    }

    private static boolean isBlank(String s) {
        return s == null || s.trim().isEmpty();
    }
}
