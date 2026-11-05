package vacademy.io.notification_service.features.notification_log.controller;

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
import vacademy.io.notification_service.features.notification_log.entity.NotificationLog;
import vacademy.io.notification_service.features.notification_log.repository.NotificationLogRepository;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

/**
 * Email and WhatsApp sends for the health-check portal's External APIs page.
 *
 * <p>SUPER-ADMIN ONLY, checked on every method. An institute is required: this table has no
 * index on time alone, so a cross-institute scan would walk all of it, while institute plus
 * date rides idx_notification_log_institute_date. List rows leave out recipients. A body that
 * is not JSON (an email's text, which can hold an OTP) is withheld, and each read is logged.
 */
@Slf4j
@RestController
@RequiredArgsConstructor
@RequestMapping("/notification-service/super-admin/v1/notification-logs")
public class SuperAdminNotificationLogController {

    private static final int MAX_PAGE_SIZE = 100;
    private static final int MAX_HOURS = 720;

    private static final PayloadRedactor REDACTOR = new PayloadRedactor(
            List.of("whatsappNumber", "phone", "phoneNumber", "mobile", "mobileNumber", "email", "to", "from",
                    "recipient", "recipientId"));

    private final NotificationLogRepository repository;
    private final ObjectMapper objectMapper;

    public record LogSummary(String id, String notificationType, String source, String instituteId,
            String deliveryStatus, String deliveryErrorCode, String deliveryErrorMessage, Instant notificationDate) {
    }

    public record LogDetail(String payload, String body) {
    }

    public record LogPage(List<LogSummary> content, long totalElements, int totalPages, int page) {
    }

    @GetMapping
    public ResponseEntity<LogPage> list(
            @RequestAttribute("user") CustomUserDetails user,
            @RequestParam String instituteId,
            @RequestParam(required = false) String notificationType,
            @RequestParam(required = false) String deliveryStatus,
            @RequestParam(defaultValue = "24") int hours,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "50") int size) {
        SuperAdminAuthUtil.requireSuperAdmin(user);
        Instant from = Instant.now().minusSeconds(Math.min(Math.max(hours, 1), MAX_HOURS) * 3600L);
        Page<NotificationLog> result = repository.findAll(
                filters(instituteId, notificationType, deliveryStatus, from),
                PageRequest.of(Math.max(page, 0), Math.min(Math.max(size, 1), MAX_PAGE_SIZE),
                        Sort.by(Sort.Direction.DESC, "notificationDate")));
        return ResponseEntity.ok(new LogPage(
                result.getContent().stream().map(SuperAdminNotificationLogController::summarize).toList(),
                result.getTotalElements(), result.getTotalPages(), result.getNumber()));
    }

    @GetMapping("/{id}")
    public ResponseEntity<LogDetail> detail(
            @RequestAttribute("user") CustomUserDetails user,
            @PathVariable String id) {
        SuperAdminAuthUtil.requireSuperAdmin(user);
        NotificationLog entity = repository.findById(id)
                .orElseThrow(() -> new VacademyException(HttpStatus.NOT_FOUND, "Log not found"));
        log.info("Super-admin {} read notification log {}", user.getUserId(), id);
        return ResponseEntity.ok(new LogDetail(redact(entity.getMessagePayload()), redact(entity.getBody())));
    }

    private static Specification<NotificationLog> filters(String instituteId, String notificationType,
            String deliveryStatus, Instant from) {
        return (root, query, cb) -> {
            List<Predicate> predicates = new ArrayList<>();
            predicates.add(cb.equal(root.get("instituteId"), instituteId));
            predicates.add(cb.greaterThanOrEqualTo(root.<Instant>get("notificationDate"), from));
            if (notificationType != null) {
                predicates.add(cb.equal(root.get("notificationType"), notificationType));
            }
            if (deliveryStatus != null) {
                predicates.add(cb.equal(root.get("deliveryStatus"), deliveryStatus));
            }
            return cb.and(predicates.toArray(new Predicate[0]));
        };
    }

    private static LogSummary summarize(NotificationLog entity) {
        return new LogSummary(entity.getId(), entity.getNotificationType(), entity.getSource(),
                entity.getInstituteId(), entity.getDeliveryStatus(), entity.getDeliveryErrorCode(),
                entity.getDeliveryErrorMessage(), entity.getNotificationDate());
    }

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
