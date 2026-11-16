package vacademy.io.admin_core_service.features.commerce.returns.controller;

import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.features.commerce.returns.dto.RefundDtos;
import vacademy.io.admin_core_service.features.commerce.returns.service.CommerceRefundService;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.time.LocalDate;

/**
 * Refunds ({@code /commerce/v1/refunds}): a manager gives back the open due of an order, through
 * the gateway or paid out by hand. There is no manual "processed" for a gateway refund.
 */
@RestController
@RequestMapping("/admin-core-service/commerce/v1/refunds")
public class CommerceRefundController {

    private final CommerceRefundService refundService;

    public CommerceRefundController(CommerceRefundService refundService) {
        this.refundService = refundService;
    }

    @PostMapping
    public ResponseEntity<RefundDtos.RefundView> create(
            @RequestParam("instituteId") String instituteId,
            @RequestBody(required = false) RefundDtos.CreateRefundRequest request,
            @RequestAttribute("user") CustomUserDetails user) {
        RefundDtos.RefundView view = refundService.create(user, instituteId, request);
        return ResponseEntity.status(Boolean.TRUE.equals(view.getReplayed()) ? HttpStatus.OK : HttpStatus.CREATED)
                .body(view);
    }

    @GetMapping
    public ResponseEntity<RefundDtos.RefundPage> list(
            @RequestParam("instituteId") String instituteId,
            @RequestParam(value = "status", required = false) String status,
            @RequestParam(value = "method", required = false) String method,
            @RequestParam(value = "order_id", required = false) String orderId,
            @RequestParam(value = "from", required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
            @RequestParam(value = "to", required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to,
            @RequestParam(value = "page", defaultValue = "0") int page,
            @RequestParam(value = "pageSize", defaultValue = "20") int pageSize,
            @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(refundService.list(user, instituteId, status, method, orderId, from, to, page,
                pageSize));
    }

    @GetMapping("/{refundId}")
    public ResponseEntity<RefundDtos.RefundView> get(
            @PathVariable("refundId") String refundId,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(refundService.get(user, instituteId, refundId));
    }

    @PostMapping("/{refundId}/record-payout")
    public ResponseEntity<RefundDtos.RefundView> recordPayout(
            @PathVariable("refundId") String refundId,
            @RequestParam("instituteId") String instituteId,
            @RequestBody(required = false) RefundDtos.PayoutRequest request,
            @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(refundService.recordPayout(user, instituteId, refundId, request));
    }

    @PostMapping("/{refundId}/cancel")
    public ResponseEntity<RefundDtos.RefundView> cancel(
            @PathVariable("refundId") String refundId,
            @RequestParam("instituteId") String instituteId,
            @RequestBody(required = false) RefundDtos.CancelRequest request,
            @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(refundService.cancel(user, instituteId, refundId, request));
    }

    @PostMapping("/{refundId}/check")
    public ResponseEntity<RefundDtos.RefundView> check(
            @PathVariable("refundId") String refundId,
            @RequestParam("instituteId") String instituteId,
            @RequestBody(required = false) RefundDtos.CheckRequest request,
            @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(refundService.check(user, instituteId, refundId, request));
    }
}
