package vacademy.io.admin_core_service.features.user_subscription.controller;

import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.core.security.InstituteAccessValidator;
import vacademy.io.admin_core_service.features.user_subscription.dto.PaymentRowsDTO;
import vacademy.io.admin_core_service.features.user_subscription.service.PaymentVoidService;
import vacademy.io.common.auth.model.CustomUserDetails;

/**
 * What voiding or deleting a payment would take with it, for the confirmation dialogs.
 *
 * <p>{@code GET /v1/user-plan/payment-logs/{paymentLogId}/rows?instituteId=xxx}
 */
@RestController
@RequestMapping("/admin-core-service/v1/user-plan")
@RequiredArgsConstructor
public class PaymentRowsController {

    private final PaymentVoidService paymentVoidService;
    private final InstituteAccessValidator instituteAccessValidator;

    @GetMapping("/payment-logs/{paymentLogId}/rows")
    public ResponseEntity<PaymentRowsDTO> paymentRows(
            @PathVariable String paymentLogId,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails userDetails) {
        instituteAccessValidator.validateUserAccess(userDetails, instituteId);
        return ResponseEntity.ok(paymentVoidService.describeRows(paymentLogId, instituteId));
    }
}
