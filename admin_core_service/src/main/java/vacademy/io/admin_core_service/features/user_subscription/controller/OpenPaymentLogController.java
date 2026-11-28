package vacademy.io.admin_core_service.features.user_subscription.controller;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.features.user_subscription.dto.PaymentLogDTO;
import vacademy.io.admin_core_service.features.user_subscription.service.PaymentLogService;

@RestController
@RequestMapping("/admin-core-service/open/v1/payment-log")
public class OpenPaymentLogController {
    @Autowired
    private PaymentLogService paymentLogService;

    @GetMapping
    public ResponseEntity<PaymentLogDTO> getPaymentLog(String paymentLogId) {
        PaymentLogDTO dto = paymentLogService.getPaymentLog(paymentLogId);
        // No login here: keep out how an offline payment was recorded (option labels can name
        // bank accounts; payer, notes and proof are the institute's business).
        if (dto != null) {
            dto.setPaymentSubMode(null);
            dto.setPaymentReference(null);
            dto.setPaymentDetailsJson(null);
            dto.setRecordedByUserId(null);
        }
        return ResponseEntity.ok(dto);
    }
}
