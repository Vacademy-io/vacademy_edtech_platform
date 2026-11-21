package vacademy.io.admin_core_service.features.credits.controller;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.admin_core_service.features.credits.client.CreditClient;
import vacademy.io.admin_core_service.features.credits.client.MeteringFields;

import java.math.BigDecimal;
import java.util.HashMap;
import java.util.Map;

/**
 * The credit wallet for notification-service's email billing: read the balance before a send, and
 * charge the hourly total of emails beyond the free allowance (request_type 'email', use case
 * 'email_send'). Lives under "/admin-core-service/internal/**", which requires the service HMAC.
 */
@RestController
@RequestMapping("/admin-core-service/internal/credits/v1/email")
@RequiredArgsConstructor
@Slf4j
public class EmailCreditsInternalController {

    static final String REQUEST_TYPE = "email";
    static final String USE_CASE = "email_send";
    /** One hourly charge above this is a bug upstream, not usage (250,000 emails). */
    static final BigDecimal MAX_CHARGE = new BigDecimal("10000");

    private final CreditClient creditClient;

    public record ChargeRequest(String instituteId, BigDecimal credits, Long units, String periodMonth,
            String idempotencyKey) {
    }

    @GetMapping("/balance")
    public ResponseEntity<Map<String, Object>> balance(@RequestParam String instituteId) {
        Map<String, Object> body = new HashMap<>();
        body.put("instituteId", instituteId);
        body.put("balance", creditClient.readBalance(instituteId).map(BigDecimal::valueOf).orElse(null));
        return ResponseEntity.ok(body);
    }

    @PostMapping("/charge")
    public ResponseEntity<Map<String, Object>> charge(@RequestBody ChargeRequest request) {
        if (request == null || request.instituteId() == null || request.instituteId().isBlank()
                || request.credits() == null || request.credits().signum() <= 0
                || request.credits().compareTo(MAX_CHARGE) > 0
                || request.idempotencyKey() == null || !request.idempotencyKey().startsWith("email:")) {
            log.warn("Refused email credit charge: {}", request);
            return ResponseEntity.badRequest().body(Map.of("charged", false, "error", "INVALID_CHARGE"));
        }
        long units = request.units() == null ? 0 : request.units();
        String month = request.periodMonth() == null ? "" : request.periodMonth();
        Map<String, Object> context = new HashMap<>();
        context.put("units", units);
        context.put("period_month", month);
        boolean charged = creditClient.deductPrecomputed(request.instituteId(), REQUEST_TYPE,
                "Emails sent — " + units + " beyond the free allowance (" + month + ")",
                request.credits(), request.idempotencyKey(),
                MeteringFields.system(USE_CASE).usageContext(context).build());
        return ResponseEntity.ok(Map.of("charged", charged));
    }
}
