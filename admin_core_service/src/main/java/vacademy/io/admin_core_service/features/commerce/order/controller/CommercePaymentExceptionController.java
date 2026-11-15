package vacademy.io.admin_core_service.features.commerce.order.controller;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.Builder;
import lombok.Data;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.util.StringUtils;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.features.commerce.audit.CommerceAuditService;
import vacademy.io.admin_core_service.features.commerce.order.payment.CommercePaymentException;
import vacademy.io.admin_core_service.features.commerce.order.payment.CommercePaymentExceptionRepository;
import vacademy.io.admin_core_service.features.commerce.security.CommerceAccessGuard;
import vacademy.io.admin_core_service.features.commerce.security.CommerceFeature;
import vacademy.io.admin_core_service.features.commerce.security.CommerceRole;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.math.BigDecimal;
import java.util.Date;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Money that arrived and could not be used, for staff ({@code /commerce/v1/payment-exceptions}):
 * orders paid after their stock was gone and second payments for an order that was already
 * paid. Until the automatic refund exists this list is how a person learns that a
 * buyer is owed money; an entry is closed by hand once the refund was made at the gateway.
 * The store manager and the accountant may read and close; the institute is the one the guard
 * checked, and every query carries it.
 */
@RestController
@RequestMapping("/admin-core-service/commerce/v1/payment-exceptions")
@RequiredArgsConstructor
public class CommercePaymentExceptionController {

    static final Set<CommerceRole> ROLES = Set.of(CommerceRole.STORE_MANAGER, CommerceRole.ACCOUNTANT);
    static final int MAX_PAGE_SIZE = 50;

    private final CommerceAccessGuard accessGuard;
    private final CommercePaymentExceptionRepository exceptions;
    private final CommerceAuditService auditService;
    private final ObjectMapper objectMapper;

    @Data
    @Builder
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class Row {
        private String id;
        private String orderId;
        private String orderNumber;
        private String kind;
        private String gatewayOrderId;
        private String gatewayPaymentId;
        private BigDecimal amount;
        private String currency;
        private String status;
        private String detail;
        private String createdAt;
        private String resolvedAt;
        private String resolvedBy;
        private String resolutionNote;
    }

    @Data
    @Builder
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class RowPage {
        private List<Row> exceptions;
        private int page;
        private int pageSize;
        private long total;
    }

    @GetMapping
    public ResponseEntity<RowPage> list(@RequestParam("instituteId") String instituteId,
                                        @RequestParam(value = "status", defaultValue = "OPEN") String status,
                                        @RequestParam(value = "page", defaultValue = "0") int page,
                                        @RequestParam(value = "pageSize", defaultValue = "20") int pageSize,
                                        @RequestAttribute("user") CustomUserDetails user) {
        accessGuard.require(user, instituteId, CommerceFeature.ORDERS, ROLES);
        int size = Math.min(Math.max(pageSize, 1), MAX_PAGE_SIZE);
        int index = Math.max(page, 0);
        String wanted = status == null ? "" : status.trim().toUpperCase();
        Page<CommercePaymentException> found;
        if ("ALL".equals(wanted)) {
            found = exceptions.findByInstituteIdOrderByCreatedAtDesc(instituteId, PageRequest.of(index, size));
        } else if (CommercePaymentException.STATUS_OPEN.equals(wanted)
                || CommercePaymentException.STATUS_RESOLVED.equals(wanted)) {
            found = exceptions.findByInstituteIdAndStatusOrderByCreatedAtDesc(instituteId, wanted,
                    PageRequest.of(index, size));
        } else {
            throw new VacademyException(HttpStatus.BAD_REQUEST, "status is OPEN, RESOLVED or ALL.");
        }
        return ResponseEntity.ok(RowPage.builder()
                .exceptions(found.getContent().stream().map(CommercePaymentExceptionController::row).toList())
                .page(index).pageSize(size).total(found.getTotalElements()).build());
    }

    /** Closes an entry after the money went back. The note says how (the gateway refund id). */
    @PostMapping("/{id}/resolve")
    public ResponseEntity<Map<String, Object>> resolve(@PathVariable("id") String id,
                                                       @RequestParam("instituteId") String instituteId,
                                                       @RequestBody(required = false) Map<String, Object> body,
                                                       @RequestAttribute("user") CustomUserDetails user) {
        accessGuard.require(user, instituteId, CommerceFeature.ORDERS, ROLES);
        Object sent = body == null ? null : body.get("note");
        String note = sent == null ? null : sent.toString().trim();
        if (!StringUtils.hasText(note) || note.length() > 500) {
            throw new VacademyException(HttpStatus.BAD_REQUEST,
                    "note is required (at most 500 characters): how the money went back.");
        }
        if (exceptions.resolve(id, instituteId, user.getUserId(), note, new Date()) != 1) {
            throw new VacademyException(HttpStatus.NOT_FOUND, "No open payment exception with this id.");
        }
        String detail;
        try {
            detail = objectMapper.writeValueAsString(Map.of("note", note));
        } catch (JsonProcessingException e) {
            detail = null;
        }
        auditService.record(instituteId, user.getUserId(), "PAYMENT_EXCEPTION_RESOLVED", "PAYMENT_EXCEPTION", id,
                detail);
        return ResponseEntity.ok(Map.of("id", id, "status", CommercePaymentException.STATUS_RESOLVED));
    }

    private static Row row(CommercePaymentException e) {
        return Row.builder()
                .id(e.getId())
                .orderId(e.getCommerceOrderId())
                .orderNumber(e.getOrderNumber())
                .kind(e.getKind())
                .gatewayOrderId(e.getGatewayOrderId())
                .gatewayPaymentId(StringUtils.hasText(e.getGatewayPaymentId()) ? e.getGatewayPaymentId() : null)
                .amount(e.getAmount())
                .currency(e.getCurrency())
                .status(e.getStatus())
                .detail(e.getDetail())
                .createdAt(e.getCreatedAt() == null ? null : e.getCreatedAt().toInstant().toString())
                .resolvedAt(e.getResolvedAt() == null ? null : e.getResolvedAt().toInstant().toString())
                .resolvedBy(e.getResolvedBy())
                .resolutionNote(e.getResolutionNote())
                .build();
    }
}
