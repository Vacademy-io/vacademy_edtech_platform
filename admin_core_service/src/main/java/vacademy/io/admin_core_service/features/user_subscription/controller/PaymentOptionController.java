package vacademy.io.admin_core_service.features.user_subscription.controller;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.admin_core_service.features.admin_activity_logs.annotation.Auditable;
import vacademy.io.admin_core_service.features.common.enums.StatusEnum;
import vacademy.io.admin_core_service.features.user_subscription.dto.PaymentOptionDTO;
import vacademy.io.admin_core_service.features.user_subscription.dto.PaymentOptionFilterDTO;
import vacademy.io.admin_core_service.features.user_subscription.enums.PaymentOptionTag;
import vacademy.io.admin_core_service.features.user_subscription.service.PaymentOptionService;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.List;

@RestController
@RequestMapping("/admin-core-service/v1/payment-option")
public class PaymentOptionController {
    @Autowired
    private PaymentOptionService paymentOptionService;

    /**
     * Create — or, when the body carries an existing id (the Settings page edits
     * this way), replace — a payment option. Returns the saved option so the client
     * and the audit row get the server-generated id.
     *
     * <p>The audit action is decided by the pre-call snapshot: a row that already
     * existed makes this an UPDATE, otherwise a CREATE.
     */
    @PostMapping
    @Auditable(
            entityType = "PAYMENT_PLAN",
            action = "CREATE",
            actionExpr = "#before != null ? 'UPDATE' : 'CREATE'",
            captureBefore = "@paymentOptionService.auditSnapshot(#paymentOptionDTO?.id)",
            entityIdExpr = "#result?.body?.id",
            descriptionExpr = "(#before != null ? 'updated' : 'created') + ' payment plan ' + #paymentOptionDTO?.name")
    public ResponseEntity<PaymentOptionDTO> savePaymentOption(@RequestBody PaymentOptionDTO paymentOptionDTO,
                                                              @RequestAttribute("user") CustomUserDetails userDetails) {
        return ResponseEntity.ok(paymentOptionService.savePaymentOption(paymentOptionDTO, userDetails));
    }

    @PostMapping("/get-payment-options")
    public ResponseEntity<List<PaymentOptionDTO>> getPaymentOptions(@RequestBody PaymentOptionFilterDTO paymentOptionFilterDTO, @RequestAttribute("user") CustomUserDetails userDetails) {
        return ResponseEntity.ok(paymentOptionService.getPaymentOptions(paymentOptionFilterDTO,userDetails));
    }

    @PostMapping("/make-default-payment-option")
    @Auditable(
            entityType = "PAYMENT_PLAN",
            action = "MAKE_DEFAULT",
            entityIdExpr = "#paymentOptionId",
            descriptionExpr = "'made payment plan ' + @paymentOptionService.auditName(#paymentOptionId) + ' the default'")
    public ResponseEntity<String> changeDefaultPaymentOption(String source,
                                                                             String sourceId,
                                                                             String paymentOptionId,
                                                                             @RequestAttribute("user") CustomUserDetails userDetails) {
        return ResponseEntity.ok(paymentOptionService.makeDefaultPaymentOption(paymentOptionId,source,sourceId));
    }

    @DeleteMapping
    @Auditable(
            entityType = "PAYMENT_PLAN",
            action = "DELETE",
            entityIdExpr = "T(java.lang.String).join(',', #paymentOptionIds)",
            descriptionExpr = "'deleted ' + @paymentOptionService.auditLabel(#paymentOptionIds)")
    public ResponseEntity<String> deletePaymentOptions(@RequestBody List<String> paymentOptionIds, @RequestAttribute("user") CustomUserDetails userDetails) {
        return ResponseEntity.ok(paymentOptionService.deletePaymentOption(paymentOptionIds,userDetails));
    }

    @PutMapping
    @Auditable(
            entityType = "PAYMENT_PLAN",
            action = "UPDATE",
            captureBefore = "@paymentOptionService.auditSnapshot(#paymentOptionDTO?.id)",
            entityIdExpr = "#paymentOptionDTO?.id",
            descriptionExpr = "'updated payment plan ' + #paymentOptionDTO?.name")
    public ResponseEntity<PaymentOptionDTO> editPaymentOption(@RequestBody PaymentOptionDTO paymentOptionDTO) {
        return ResponseEntity.ok(paymentOptionService.editPaymentOption(paymentOptionDTO));
    }

    @GetMapping("/default-payment-option")
    public ResponseEntity<PaymentOptionDTO>getDeafultPaymentOptionForSource(@RequestParam String source, @RequestParam String sourceId) {
        return ResponseEntity.ok(paymentOptionService.getPaymentOption(source,sourceId, PaymentOptionTag.DEFAULT.name(),List.of(StatusEnum.ACTIVE.name())).get().mapToPaymentOptionDTO());
    }

}
