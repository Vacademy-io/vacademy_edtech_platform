package vacademy.io.notification_service.features.external_communication_log.controller;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.persistence.criteria.Predicate;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.auth.util.SuperAdminAuthUtil;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.logging.PayloadRedactor;
import vacademy.io.notification_service.features.external_communication_log.entity.ExternalCommunicationLog;
import vacademy.io.notification_service.features.external_communication_log.model.ExternalCommunicationSource;
import vacademy.io.notification_service.features.external_communication_log.model.ExternalCommunicationStatus;
import vacademy.io.notification_service.features.external_communication_log.repository.ExternalCommunicationLogRepository;

import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;

/**
 * Vendor request and response bodies for the health-check portal's External APIs page.
 *
 * <p>SUPER-ADMIN ONLY, checked on every method. These rows hold recipients' phone numbers
 * and message content across every institute, so they must not move to a path covered by
 * the broad permitAll entries in WebSecurityConfig. Bodies are only returned one row at a
 * time, masked, and each read is logged.
 */
@Slf4j
@RestController
@RequiredArgsConstructor
@RequestMapping("/notification-service/super-admin/v1/external-communication-logs")
public class SuperAdminExternalCommunicationLogController {

    private static final int MAX_PAGE_SIZE = 100;

    /** Vendor payloads carry recipients in these keys, on top of the default credential names. */
    private static final PayloadRedactor REDACTOR = new PayloadRedactor(
            List.of("whatsappNumber", "phone", "phoneNumber", "mobile", "mobileNumber", "email"));

    private final ExternalCommunicationLogRepository repository;
    private final ObjectMapper objectMapper;

    public record LogSummary(String id, ExternalCommunicationSource source, String sourceId,
            ExternalCommunicationStatus status, String errorMessage,
            Instant createdAt, Instant updatedAt) {
    }

    public record LogDetail(LogSummary summary, String payload, String response) {
    }

    public record LogPage(List<LogSummary> content, long totalElements, int totalPages, int page) {
    }

    @GetMapping
    public ResponseEntity<LogPage> list(
            @RequestAttribute("user") CustomUserDetails user,
            @RequestParam(required = false) ExternalCommunicationSource source,
            @RequestParam(required = false) ExternalCommunicationStatus status,
            @RequestParam(required = false) Integer hours,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "50") int size) {
        SuperAdminAuthUtil.requireSuperAdmin(user);
        PageRequest pageRequest = PageRequest.of(Math.max(page, 0), Math.min(Math.max(size, 1), MAX_PAGE_SIZE),
                Sort.by(Sort.Direction.DESC, "createdAt"));
        Page<ExternalCommunicationLog> result = repository.findAll(filters(source, status, hours), pageRequest);
        return ResponseEntity.ok(new LogPage(
                result.getContent().stream().map(SuperAdminExternalCommunicationLogController::summarize).toList(),
                result.getTotalElements(), result.getTotalPages(), result.getNumber()));
    }

    @GetMapping("/{id}")
    public ResponseEntity<LogDetail> detail(
            @RequestAttribute("user") CustomUserDetails user,
            @PathVariable String id) {
        SuperAdminAuthUtil.requireSuperAdmin(user);
        ExternalCommunicationLog entity = repository.findById(id)
                .orElseThrow(() -> new VacademyException(HttpStatus.NOT_FOUND, "Log not found"));
        log.info("Super-admin {} read external communication log {}", user.getUserId(), id);
        return ResponseEntity.ok(new LogDetail(summarize(entity),
                redact(entity.getPayloadJson()), redact(entity.getResponseJson())));
    }

    private static Specification<ExternalCommunicationLog> filters(ExternalCommunicationSource source,
            ExternalCommunicationStatus status, Integer hours) {
        return (root, query, cb) -> {
            List<Predicate> predicates = new ArrayList<>();
            if (source != null) {
                predicates.add(cb.equal(root.get("source"), source));
            }
            if (status != null) {
                predicates.add(cb.equal(root.get("status"), status));
            }
            if (hours != null) {
                predicates.add(cb.greaterThanOrEqualTo(root.<LocalDateTime>get("createdAt"),
                        LocalDateTime.now().minusHours(hours)));
            }
            return cb.and(predicates.toArray(new Predicate[0]));
        };
    }

    private static LogSummary summarize(ExternalCommunicationLog entity) {
        return new LogSummary(entity.getId(), entity.getSource(), entity.getSourceId(), entity.getStatus(),
                entity.getErrorMessage(), toInstant(entity.getCreatedAt()), toInstant(entity.getUpdatedAt()));
    }

    /** The entity's naive timestamps are in the JVM's zone. A naked one would be read as local time by browsers. */
    private static Instant toInstant(LocalDateTime value) {
        return value == null ? null : value.atZone(ZoneId.systemDefault()).toInstant();
    }

    /** Bodies that are not JSON have no keys to mask, so they are withheld rather than returned raw. */
    private String redact(String body) {
        if (body == null) {
            return null;
        }
        try {
            Object tree = objectMapper.readValue(body, Object.class);
            return objectMapper.writeValueAsString(REDACTOR.redact(tree));
        } catch (JsonProcessingException e) {
            return "[withheld: body is not JSON, " + body.length() + " chars]";
        }
    }
}
