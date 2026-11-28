package vacademy.io.admin_core_service.features.enrollment_policy.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentLog;
import vacademy.io.admin_core_service.features.user_subscription.entity.UserPlan;
import vacademy.io.admin_core_service.features.user_subscription.enums.PaymentLogStatusEnum;
import vacademy.io.admin_core_service.features.user_subscription.repository.PaymentLogRepository;
import vacademy.io.common.payment.enums.PaymentStatusEnum;
import vacademy.io.common.payment.enums.PaymentType;
import vacademy.io.admin_core_service.features.common.util.JsonUtil;

import java.util.Date;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Persists a FAILED {@code payment_log} for an autopay charge the gateway refused,
 * carrying the gateway's own reason.
 *
 * <p>The sweep's charge runs inside {@code PaymentService.handleRecurringCharge}, which is
 * {@code @Transactional}: when the gateway throws, the payment_log it opened rolls back
 * with it and the attempt leaves no record anywhere except a log line. On 2026-09-19
 * fifteen members were refused and the reasons were unrecoverable by the time anyone
 * asked. This writes in its own transaction ({@link Propagation#REQUIRES_NEW}) so the row
 * survives the caller's rollback, and it never throws — a failure to record a failure
 * must not change the dunning outcome.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class RenewalFailureRecorder {

    private final PaymentLogRepository paymentLogRepository;

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void record(UserPlan plan, double amount, String currency, String vendor, String vendorId, String reason) {
        try {
            PaymentLog failed = new PaymentLog();
            failed.setUserId(plan.getUserId());
            failed.setUserPlan(plan);
            failed.setPaymentAmount(amount);
            failed.setCurrency(currency);
            failed.setVendor(vendor);
            failed.setVendorId(vendorId);
            failed.setDate(new Date());
            failed.setStatus(PaymentLogStatusEnum.FAILED.name());
            failed.setPaymentStatus(PaymentStatusEnum.FAILED.name());
            Map<String, Object> data = new LinkedHashMap<>();
            data.put("payment_type", PaymentType.RENEWAL.name());
            data.put("charge_automatically", true);
            data.put("attempt", plan.getRenewalAttemptCount());
            data.put("error", reason);
            failed.setPaymentSpecificData(JsonUtil.toJson(data));
            paymentLogRepository.save(failed);
        } catch (Exception e) {
            log.warn("[RenewalCharge] Could not persist failure record for plan {}: {}", plan.getId(), e.getMessage());
        }
    }
}
